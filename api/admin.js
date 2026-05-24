import { db, admin, applyCors, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { ipHash, normalizeBypassEmail, _invalidateBypassCache } from './_lib/security.js';
import { sendOperatorAlert } from './_lib/alerts.js';
import WORLD_CUP_MATCHES from '../src/data/matches.js';

async function getRole(userId) {
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) return null;
  return userSnap.data().role || null;
}

async function isAdmin(userId) {
  const role = await getRole(userId);
  return role === 'admin' || role === 'superadmin';
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const userId = claims.userId;
  if (!(await isAdmin(userId))) return res.status(403).json({ error: 'Admin access required' });

  // GET: list match results or users
  if (req.method === 'GET') {
    const { type } = req.query;
    try {
      if (type === 'results') {
        const snap = await db.collection('matchResults').get();
        const results = {};
        snap.docs.forEach(d => { results[d.id] = d.data(); });
        return res.status(200).json({ results });
      } else if (type === 'users') {
        const snap = await db.collection('users').get();
        return res.status(200).json({ users: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      } else if (type === 'leaguesEnriched') {
        // Admin-only list: every league with creator display name + the
        // private-league passcode joined in server-side. Client can't
        // read the /leagues/{id}/private/auth subcollection where new-
        // format passcodes live (PR #121), so the join happens here.
        const leaguesSnap = await db.collection('leagues').get();
        const leagues = leaguesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Resolve creator displayName AND every member's displayName via
        // one batched user-doc fetch. Each league.createdBy + every entry
        // of league.members is a userId; many will repeat (a single user
        // is in multiple leagues, plus is themselves the creator). Build
        // the unique set first to keep the read count tight.
        const userIdSet = new Set();
        for (const l of leagues) {
          if (l.createdBy) userIdSet.add(l.createdBy);
          if (Array.isArray(l.members)) for (const m of l.members) if (m) userIdSet.add(m);
        }
        const userIds = Array.from(userIdSet);
        const creatorNames = {};
        const userNames = {};
        // db.getAll() accepts up to 1000 doc refs in a single round trip.
        // For larger admin populations chunk the calls so we don't trip
        // the limit. Round-trip count stays O(users / 1000).
        const CHUNK = 1000;
        for (let i = 0; i < userIds.length; i += CHUNK) {
          const slice = userIds.slice(i, i + CHUNK);
          const userRefs = slice.map(id => db.collection('users').doc(id));
          const userSnaps = await db.getAll(...userRefs);
          for (const snap of userSnaps) {
            if (snap.exists) {
              const d = snap.data();
              const name = d.displayName || d.username || null;
              if (name) {
                userNames[snap.id] = name;
                creatorNames[snap.id] = name;
              }
            }
          }
        }

        // Batch-fetch the private/auth subcollection doc for every
        // private league. Same pattern as lookupByPasscode in
        // api/leagues.js — one round trip via db.getAll on the per-
        // league auth refs.
        const privateLeagues = leagues.filter(l => l.visibility === 'private');
        const passcodes = {};
        if (privateLeagues.length > 0) {
          const authRefs = privateLeagues.map(l =>
            db.collection('leagues').doc(l.id).collection('private').doc('auth')
          );
          const authSnaps = await db.getAll(...authRefs);
          for (let i = 0; i < authSnaps.length; i++) {
            const snap = authSnaps[i];
            const leagueId = privateLeagues[i].id;
            if (snap.exists && snap.data()?.passcode) {
              passcodes[leagueId] = snap.data().passcode;
            }
          }
        }

        const enriched = leagues.map(l => ({
          ...l,
          creatorDisplayName: creatorNames[l.createdBy] || null,
          // Prefer subcollection (new format); fall back to legacy public
          // field for any league that pre-dates the subcollection refactor.
          passcode: passcodes[l.id] || l.passcode || null,
        }));

        // Return the userNames map alongside the leagues so the admin
        // dashboard can render member lists without making N more
        // requests. ~30 bytes per (userId, displayName) pair × thousands
        // of users = well under 200 KB, fine for an admin-only payload.
        return res.status(200).json({ leagues: enriched, userNames });
      }
      return res.status(400).json({ error: 'Invalid type' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    if (action === 'updateResult') {
      const { matchId, homeScore, awayScore, extraTime, penalties } = req.body;
      if (!matchId || homeScore === undefined || awayScore === undefined) {
        return res.status(400).json({ error: 'Missing match data' });
      }

      // Detect re-score: if a verified result already exists with different
      // numbers, this is a correction (operator typo or retroactive
      // disciplinary action). Quick Picks scoring re-renders on every page
      // load so user leaderboards self-correct, but the operator should
      // know this happened — alert email plus extended audit log entry.
      const prevSnap = await db.collection('matchResults').doc(matchId).get();
      const prev = prevSnap.exists ? prevSnap.data() : null;
      const newH = parseInt(homeScore);
      const newA = parseInt(awayScore);
      const isCorrection = prev?.completed === true && (
        prev.homeScore !== newH ||
        prev.awayScore !== newA ||
        !!prev.extraTime !== !!extraTime ||
        !!prev.penalties !== !!penalties
      );

      await db.collection('matchResults').doc(matchId).set({
        matchId,
        homeScore: newH,
        awayScore: newA,
        extraTime: extraTime || false,
        penalties: penalties || false,
        completed: true,
        updatedBy: userId,
        updatedAt: FieldValue.serverTimestamp(),
      });

      if (isCorrection) {
        await sendOperatorAlert(
          `Match result corrected: ${matchId}`,
          {
            what: `An admin (${userId}) just changed a previously-verified match result. Quick Picks scoring is computed on every leaderboard render, so user leaderboards will reflect the new numbers automatically on the next page load. No manual rescore needed — but you should know this happened in case it was unintended.`,
            why: [
              'Operator typo on the original result entry',
              'VAR overturn / retroactive disciplinary action that the oracle hadn\'t picked up',
              'Manual override of an oracle-verified score',
            ],
            resolution: [
              'If this was you and intentional: ignore this email.',
              'If this was unexpected: check adminLogs for `update_match_result` entries on this match to see who changed it and when.',
              `Match: ${matchId}. Previous: ${prev.homeScore}-${prev.awayScore} (ET=${!!prev.extraTime}, PEN=${!!prev.penalties}). New: ${newH}-${newA} (ET=${!!extraTime}, PEN=${!!penalties}).`,
            ],
            context: {
              matchId,
              previous: `${prev.homeScore}-${prev.awayScore} ET=${!!prev.extraTime} PEN=${!!prev.penalties}`,
              new: `${newH}-${newA} ET=${!!extraTime} PEN=${!!penalties}`,
              changedBy: userId,
            },
          },
        );
      }

      // Log admin action
      await db.collection('adminLogs').add({
        action: 'update_match_result',
        matchId,
        result: { homeScore, awayScore, extraTime, penalties },
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true });

    } else if (action === 'setRole') {
      const { targetUserId, newRole } = req.body;
      if (!targetUserId || !newRole) return res.status(400).json({ error: 'Missing user/role' });
      if (!['user', 'admin', 'superadmin'].includes(newRole)) return res.status(400).json({ error: 'Invalid role' });

      // Only superadmins can grant or revoke superadmin. Plain admins can
      // only flip between 'user' and 'admin'.
      const callerRole = await getRole(userId);
      if (newRole === 'superadmin' && callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can assign the superadmin role' });
      }
      const targetCurrentRole = await getRole(targetUserId);
      if (targetCurrentRole === 'superadmin' && callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can change a superadmin' });
      }

      await db.collection('users').doc(targetUserId).update({ role: newRole });
      await db.collection('adminLogs').add({
        action: 'set_user_role',
        targetUserId,
        newRole,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true });

    } else if (action === 'deleteUser') {
      // Permanently delete a user account. Wipes:
      //  - /users/{id}
      //  - /predictions where userId == id (classic mode)
      //  - /simplePredictions where userId == id (Quick Picks, every league)
      //  - membership in every league.members array they appear in
      //  - their entry in deviceFingerprints + signupIps
      //  - their Firebase Auth account (so their Google login can't recreate
      //    the same UID and silently re-attach to a stale doc)
      //
      // Superadmin-only. Cannot delete yourself or another superadmin.
      const { targetUserId } = req.body;
      if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });
      if (targetUserId === userId) return res.status(400).json({ error: "Can't delete yourself" });

      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can delete a user' });
      }

      const targetSnap = await db.collection('users').doc(targetUserId).get();
      if (!targetSnap.exists) return res.status(404).json({ error: 'User not found' });
      const target = targetSnap.data();
      if (target.role === 'superadmin') {
        return res.status(403).json({ error: "Can't delete a superadmin. Demote first." });
      }

      const cleanupOps = [];

      // Predictions (classic). leagueId is on each doc, but we only need
      // to filter by userId — global classic + per-league classic both live
      // here keyed by composite ID.
      const classicSnap = await db.collection('predictions').where('userId', '==', targetUserId).get();
      for (let i = 0; i < classicSnap.docs.length; i += 500) {
        const b = db.batch();
        classicSnap.docs.slice(i, i + 500).forEach(d => b.delete(d.ref));
        cleanupOps.push(b.commit());
      }

      // Simple predictions (Quick Picks) — composite docs keyed by
      // userId__leagueId, plus the legacy single-doc path /simplePredictions/{userId}.
      const simpleSnap = await db.collection('simplePredictions').where('userId', '==', targetUserId).get();
      for (let i = 0; i < simpleSnap.docs.length; i += 500) {
        const b = db.batch();
        simpleSnap.docs.slice(i, i + 500).forEach(d => b.delete(d.ref));
        cleanupOps.push(b.commit());
      }
      cleanupOps.push(db.collection('simplePredictions').doc(targetUserId).delete().catch(() => {}));

      // League memberships
      const leaguesSnap = await db.collection('leagues').where('members', 'array-contains', targetUserId).get();
      for (let i = 0; i < leaguesSnap.docs.length; i += 500) {
        const b = db.batch();
        leaguesSnap.docs.slice(i, i + 500).forEach(d => b.update(d.ref, { members: FieldValue.arrayRemove(targetUserId) }));
        cleanupOps.push(b.commit());
      }

      // Anti-Sybil records (so the freed device/IP slot can be reused).
      const fpSnap = await db.collection('deviceFingerprints').where('userIds', 'array-contains', targetUserId).get();
      const ipSnap = await db.collection('signupIps').where('userIds', 'array-contains', targetUserId).get();
      const sybilBatch = db.batch();
      fpSnap.docs.forEach(d => sybilBatch.update(d.ref, { userIds: FieldValue.arrayRemove(targetUserId) }));
      ipSnap.docs.forEach(d => sybilBatch.update(d.ref, { userIds: FieldValue.arrayRemove(targetUserId) }));
      cleanupOps.push(sybilBatch.commit().catch(() => {}));

      // Wait for cleanup before deleting the user doc — avoids leaving
      // dangling memberships if the user-doc delete races ahead.
      await Promise.all(cleanupOps);

      await db.collection('users').doc(targetUserId).delete();

      // Firebase Auth account — best-effort. Custom-token UIDs (auth_*) may
      // not have a Firebase Auth record at all; deleteUser throws 'user-not-found'
      // in that case, which is fine.
      try {
        await admin.auth().deleteUser(targetUserId);
      } catch (e) {
        if (e?.code !== 'auth/user-not-found') {
          console.warn('[deleteUser] Firebase Auth delete failed:', e?.message);
        }
      }

      await db.collection('adminLogs').add({
        action: 'delete_user',
        targetUserId,
        targetEmail: target.email || null,
        targetDisplayName: target.displayName || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        deleted: {
          predictions: classicSnap.size,
          simplePredictions: simpleSnap.size,
          leagueMemberships: leaguesSnap.size,
          fingerprints: fpSnap.size,
          ips: ipSnap.size,
        },
      });

      return res.status(200).json({
        success: true,
        deleted: {
          predictions: classicSnap.size,
          simplePredictions: simpleSnap.size,
          leagueMemberships: leaguesSnap.size,
          fingerprints: fpSnap.size,
          ips: ipSnap.size,
        },
      });

    } else if (action === 'deleteLeague') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });
      if (leagueId === 'global') return res.status(400).json({ error: 'Cannot delete the global league' });

      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      await db.collection('leagues').doc(leagueId).delete();

      await db.collection('adminLogs').add({
        action: 'delete_league',
        leagueId,
        leagueName: league.name,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      // Cleanup: remove league from member docs + delete predictions
      const memberIds = league.members || [];
      const cleanupPromises = memberIds.map(mid =>
        db.collection('users').doc(mid).update({ leagues: FieldValue.arrayRemove(leagueId) }).catch(() => {})
      );

      const predSnap = await db.collection('predictions').where('leagueId', '==', leagueId).get();
      const docs = predSnap.docs;
      for (let i = 0; i < docs.length; i += 500) {
        const batch = db.batch();
        docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        cleanupPromises.push(batch.commit());
      }

      await Promise.all(cleanupPromises);

      return res.status(200).json({ success: true, deleted: leagueId });
    }

    if (action === 'renameLeague') {
      const { leagueId, name } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Name is required' });
      if (trimmed.length > 60) return res.status(400).json({ error: 'Name too long (max 60 chars)' });

      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const prevName = leagueSnap.data().name || null;
      if (prevName === trimmed) return res.status(200).json({ success: true, name: trimmed, unchanged: true });

      await db.collection('leagues').doc(leagueId).update({ name: trimmed });
      await db.collection('adminLogs').add({
        action: 'rename_league',
        leagueId,
        previousName: prevName,
        newName: trimmed,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true, name: trimmed });
    }

    if (action === 'backfillCountries') {
      // One-shot: walk every user and assign a country if they don't have
      // one. Product-directed override map wins; everyone else defaults to
      // US (we can't geolocate server-side per-user after the fact).
      const OVERRIDES = { 'lebida2352': 'PK', 'Sumit': 'BD' };
      const usersSnap = await db.collection('users').get();
      let updated = 0;
      let skipped = 0;
      const overrideHits = [];
      const docs = usersSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        let batchCount = 0;
        docs.slice(i, i + 400).forEach(d => {
          const u = d.data();
          if (u.country) { skipped++; return; }
          const override = OVERRIDES[u.displayName];
          const country = override || 'US';
          if (override) overrideHits.push({ displayName: u.displayName, country });
          batch.update(d.ref, { country });
          batchCount++;
        });
        if (batchCount > 0) {
          await batch.commit();
          updated += batchCount;
        }
      }
      await db.collection('adminLogs').add({
        action: 'backfill_countries',
        adminId: userId,
        updated,
        skipped,
        overrides: overrideHits,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, updated, skipped, overrides: overrideHits });
    }

    if (action === 'assignWallet') {
      const { targetUserId, walletAddress } = req.body;
      if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });
      const trimmed = (walletAddress || '').trim();
      // Empty string clears the field; otherwise must be a valid EVM address.
      if (trimmed && !/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        return res.status(400).json({ error: 'Invalid EVM wallet address' });
      }
      const userSnap = await db.collection('users').doc(targetUserId).get();
      if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
      const previous = userSnap.data().walletAddress || null;
      await db.collection('users').doc(targetUserId).update({
        walletAddress: trimmed || null,
        walletAssignedBy: trimmed ? userId : null,
        walletAssignedAt: trimmed ? FieldValue.serverTimestamp() : null,
      });
      await db.collection('adminLogs').add({
        action: 'assign_wallet',
        targetUserId,
        previousWallet: previous,
        newWallet: trimmed || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, walletAddress: trimmed || null });
    }

    if (action === 'setFeatureFlag') {
      // Platform-wide feature flags. Stored at /settings/featureFlags
      // and read by every client on mount via /api/public?type=flags.
      // Allowed flags are whitelisted so a typo can't write arbitrary
      // keys onto the doc.
      //
      // Superadmin-only — feature flags are platform-wide config and
      // tightening here matches the security model for the other
      // platform-level superadmin actions (setRole-to-superadmin,
      // deleteUser, etc). The previous admin-or-superadmin gate was
      // legacy; this is the right policy going forward.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can change feature flags' });
      }
      const ALLOWED = new Set(['quickPicksEnabled', 'classicEnabled', 'enablePrizeLeagues']);
      const { flag, value, reason } = req.body;
      if (!ALLOWED.has(flag)) return res.status(400).json({ error: `Unknown flag: ${flag}` });
      if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be boolean' });
      // Reason is optional free text for the audit trail. Cap at 280
      // chars (tweet-length) so the audit log doc stays small.
      const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 280) : null;
      const ref = db.collection('settings').doc('featureFlags');
      const snap = await ref.get();
      const prev = snap.exists ? (snap.data() || {}) : {};
      await ref.set({ ...prev, [flag]: value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('adminLogs').add({
        action: 'set_feature_flag',
        flag, value,
        previousValue: prev[flag] ?? null,
        reason: trimmedReason || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, flag, value });
    }

    if (action === 'getFeatureFlagAuditLog') {
      // Recent feature-flag changes for display in the admin console.
      // Superadmin-only, same as setFeatureFlag. Filters by `flag` if
      // supplied; otherwise returns the most recent changes across all
      // flags. Capped at 50 entries to bound the read cost.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can read the audit log' });
      }
      const { flag, limit } = req.body || {};
      const cap = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
      // Fetch the most recent set_feature_flag entries with a single
      // composite-free query, then filter by flag in-memory if needed.
      // Avoids requiring a manual Firestore index for (action ==, flag ==,
      // timestamp desc) and keeps the audit log discovery cheap.
      const overFetch = flag ? cap * 5 : cap;
      const snap = await db.collection('adminLogs')
        .where('action', '==', 'set_feature_flag')
        .orderBy('timestamp', 'desc')
        .limit(overFetch)
        .get();
      // Resolve adminId → displayName so the UI doesn't show raw UIDs.
      const filtered = (flag && typeof flag === 'string')
        ? snap.docs.filter((d) => d.data().flag === flag)
        : snap.docs;
      const limited = filtered.slice(0, cap);
      const entries = await Promise.all(limited.map(async (d) => {
        const data = d.data();
        let actorName = data.adminId;
        try {
          const u = await db.collection('users').doc(data.adminId).get();
          if (u.exists) actorName = u.data().displayName || data.adminId;
        } catch {}
        return {
          id: d.id,
          flag: data.flag,
          value: data.value,
          previousValue: data.previousValue ?? null,
          reason: data.reason || null,
          actorId: data.adminId,
          actorName,
          timestamp: data.timestamp?.toDate?.()?.toISOString?.() || null,
        };
      }));
      return res.status(200).json({ entries });
    }

    if (action === 'banIp') {
      // Add an IP (or its raw hash) to the blocklist. Either pass `ip` (the
      // raw v4/v6 address) or `ipHash` (the sha256 hex) — useful for banning
      // an IP you only have the hashed form of from the user doc.
      const { ip, ipHash: rawHash, reason } = req.body;
      const hash = rawHash || (ip ? ipHash(ip) : null);
      if (!hash) return res.status(400).json({ error: 'Missing ip or ipHash' });
      await db.collection('bannedIps').doc(hash).set({
        bannedBy: userId,
        bannedAt: FieldValue.serverTimestamp(),
        reason: (reason || '').toString().slice(0, 200) || null,
        ipPreview: ip ? `${String(ip).slice(0, 8)}…` : null,
      });
      await db.collection('adminLogs').add({
        action: 'ban_ip',
        ipHash: hash,
        adminId: userId,
        reason: reason || null,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, ipHash: hash });
    }

    if (action === 'unbanIp') {
      const { ip, ipHash: rawHash } = req.body;
      const hash = rawHash || (ip ? ipHash(ip) : null);
      if (!hash) return res.status(400).json({ error: 'Missing ip or ipHash' });
      await db.collection('bannedIps').doc(hash).delete().catch(() => {});
      await db.collection('adminLogs').add({
        action: 'unban_ip',
        ipHash: hash,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'listBannedIps') {
      const snap = await db.collection('bannedIps').get();
      return res.status(200).json({
        bans: snap.docs.map(d => ({ ipHash: d.id, ...d.data() })),
      });
    }

    if (action === 'migrateLeaguePasscodes') {
      // One-shot: walk every league with a non-null `passcode` field on
      // its public doc, copy that passcode into /leagues/{id}/private/auth
      // (admin-SDK-only readable per Firestore rules), and clear the field
      // on the public doc. Idempotent — leagues already migrated have
      // passcode == null and are skipped.
      const snap = await db.collection('leagues').get();
      let migrated = 0;
      let skipped = 0;
      const errors = [];
      for (const d of snap.docs) {
        const data = d.data();
        if (!data.passcode) { skipped++; continue; }
        try {
          await d.ref.collection('private').doc('auth').set({
            passcode: String(data.passcode),
            migratedAt: FieldValue.serverTimestamp(),
            migratedBy: userId,
          }, { merge: true });
          await d.ref.update({ passcode: null });
          migrated++;
        } catch (e) {
          errors.push({ leagueId: d.id, error: e.message });
        }
      }
      await db.collection('adminLogs').add({
        action: 'migrate_league_passcodes',
        adminId: userId,
        migrated,
        skipped,
        errorCount: errors.length,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, migrated, skipped, errors });
    }

    if (action === 'oracleSmokeTest') {
      // Server-side smoke test of the oracle pipeline against a real
      // recent match in a chosen competition. Single source: football-
      // data.org. (We dropped api-sports.io because their free tier
      // doesn't include current World Cup data; results can be contested
      // by users via support@goaloracle.io and superadmins can override
      // a wrong score via /api/admin → updateResult.)
      const { parseFootballDataResponse } = await import('./_lib/oracleParsers.js');
      const COMPETITION_MAP = {
        PL: { fdCode: 'PL', label: 'English Premier League' },
        CL: { fdCode: 'CL', label: 'UEFA Champions League' },
        BL1: { fdCode: 'BL1', label: 'Bundesliga' },
        PD: { fdCode: 'PD', label: 'La Liga' },
        SA: { fdCode: 'SA', label: 'Serie A' },
        WC: { fdCode: 'WC', label: 'FIFA World Cup' },
      };
      const comp = COMPETITION_MAP[(req.body.competition || 'PL').toUpperCase()] || COMPETITION_MAP.PL;
      const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;
      const checks = [];
      const note = (name, ok, detail = '') => checks.push({ name, ok, detail });

      // 1) Pick a recent FINISHED match in this competition
      let fdMatch = null, fdParsed = null;
      if (!FD_KEY) note('football-data.org key', false, 'FOOTBALL_DATA_API_KEY not set in Vercel env');
      else {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
          const r = await fetch(
            `https://api.football-data.org/v4/competitions/${comp.fdCode}/matches?dateFrom=${sevenDaysAgo}&dateTo=${today}`,
            { headers: { 'X-Auth-Token': FD_KEY } },
          );
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          const finished = (data.matches || []).filter(m => m.status === 'FINISHED');
          if (finished.length === 0) note('list recent matches', false, 'no FINISHED matches in last 7 days');
          else {
            finished.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
            fdMatch = finished[0];
            note('list recent matches', true, `picked ${fdMatch.homeTeam?.name} vs ${fdMatch.awayTeam?.name}`);
            const detail = await fetch(`https://api.football-data.org/v4/matches/${fdMatch.id}`, { headers: { 'X-Auth-Token': FD_KEY } }).then(r => r.json());
            fdParsed = parseFootballDataResponse(detail);
            note('parse match detail', true, `${fdParsed.homeScore}-${fdParsed.awayScore} (ET=${fdParsed.extraTime}, PEN=${fdParsed.penalties})`);
          }
        } catch (e) {
          note('football-data.org', false, e.message);
        }
      }

      // 2) Standings probe — confirms we can also pull live group/league
      // tables from the same provider.
      if (FD_KEY) {
        try {
          const r = await fetch(`https://api.football-data.org/v4/competitions/${comp.fdCode}/standings`, { headers: { 'X-Auth-Token': FD_KEY } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          const table = data.standings?.find(s => s.type === 'TOTAL')?.table || [];
          if (table.length === 0) throw new Error('empty TOTAL table');
          note('standings probe', true, `${table.length} teams; #1 ${table[0].team?.name} (${table[0].points} pts)`);
        } catch (e) {
          note('standings probe', false, e.message);
        }
      }

      const failed = checks.filter(c => !c.ok).length;
      await db.collection('adminLogs').add({
        action: 'oracle_smoke_test',
        adminId: userId,
        competition: comp.label,
        passed: checks.length - failed,
        failed,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({
        competition: comp.label,
        runAt: new Date().toISOString(),
        passed: checks.length - failed,
        failed,
        checks,
      });
    }

    if (action === 'reconcile') {
      // Audit a Quick Picks league. Returns:
      //   - prediction submission stats (total users / submitted / complete)
      //   - matchResult ingestion check (every kicked-off match has a result)
      //   - per-match pick distribution if matchId is provided
      //   - any users whose picks throw on score computation
      //
      // Design note: Quick Picks scoring is currently client-side, so there
      // is no stored "final score" to reconcile against. This endpoint
      // surfaces enough data to spot drift manually + flags structurally
      // bad picks before they cause leaderboard glitches.
      const { leagueId, matchId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });

      // 1) League roster
      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const memberIds = leagueSnap.data().members || [];

      // 2) Predictions for those members in this league. Composite doc IDs
      //    are `${userId}__${leagueId}`; fall back to legacy `userId` doc
      //    for global-simple, mirroring /api/simple-leaderboard.
      const compositeIds = memberIds.map(uid => `${uid}__${leagueId}`);
      const preds = {};
      for (let i = 0; i < compositeIds.length; i += 30) {
        const batch = compositeIds.slice(i, i + 30);
        const snap = await db.collection('simplePredictions')
          .where(admin.firestore.FieldPath.documentId(), 'in', batch)
          .get();
        snap.docs.forEach(d => { const data = d.data(); if (data?.userId) preds[data.userId] = data; });
      }
      if (leagueId === 'global-simple') {
        const missing = memberIds.filter(uid => !preds[uid]);
        for (let i = 0; i < missing.length; i += 30) {
          const batch = missing.slice(i, i + 30);
          const snap = await db.collection('simplePredictions')
            .where(admin.firestore.FieldPath.documentId(), 'in', batch)
            .get();
          snap.docs.forEach(d => { if (!preds[d.id]) preds[d.id] = d.data(); });
        }
      }

      const predUsers = Object.keys(preds);
      const submitted = predUsers.length;
      const complete = predUsers.filter(uid => {
        const finalPick = preds[uid]?.knockoutPredictions?.final?.[0];
        return !!(preds[uid]?.isComplete || finalPick?.winnerId);
      }).length;

      // 3) Match results coverage. Walk WORLD_CUP_MATCHES and check which
      //    have already kicked off; flag any without a stored matchResult.
      const now = Date.now();
      const completedMatches = WORLD_CUP_MATCHES.filter(m => {
        const [hh, mm] = m.time.split(':').map(Number);
        const d = new Date(`${m.date}T00:00:00Z`);
        d.setUTCHours(hh + 4, mm, 0, 0);
        return d.getTime() < now - 3 * 60 * 60 * 1000; // FT'd > 3h ago
      });
      const resultsSnap = await db.collection('matchResults').get();
      const resultsByMatchId = {};
      resultsSnap.docs.forEach(d => { resultsByMatchId[d.id] = d.data(); });
      const missingResults = completedMatches
        .filter(m => !resultsByMatchId[m.id] || resultsByMatchId[m.id].completed !== true)
        .map(m => m.id);

      // 4) Per-match pick distribution for the optional matchId param.
      let pickDistribution = null;
      if (matchId) {
        const counts = {};
        let predictedCount = 0;
        for (const uid of predUsers) {
          const ko = preds[uid]?.knockoutPredictions || {};
          const allRounds = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
          for (const round of allRounds) {
            const arr = ko[round] || [];
            const slot = arr.find(s => s?.matchId === matchId);
            if (slot?.winnerId) {
              counts[slot.winnerId] = (counts[slot.winnerId] || 0) + 1;
              predictedCount++;
              break;
            }
          }
        }
        pickDistribution = { matchId, totalPredicted: predictedCount, byTeam: counts };
      }

      // 5) Surface users whose payload is structurally malformed enough that
      //    the leaderboard would fail to render them. Cheap defensive check.
      const malformed = [];
      for (const uid of predUsers) {
        const p = preds[uid];
        try {
          if (p.groupPredictions && typeof p.groupPredictions !== 'object') throw new Error('groupPredictions not object');
          if (p.bestThirdPicks && !Array.isArray(p.bestThirdPicks)) throw new Error('bestThirdPicks not array');
          if (p.knockoutPredictions && typeof p.knockoutPredictions !== 'object') throw new Error('knockoutPredictions not object');
        } catch (e) {
          malformed.push({ userId: uid, error: e.message });
        }
      }

      await db.collection('adminLogs').add({
        action: 'reconcile',
        leagueId, matchId: matchId || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        summary: { totalMembers: memberIds.length, submitted, complete, missingResultCount: missingResults.length },
      });

      return res.status(200).json({
        leagueId,
        runAt: new Date().toISOString(),
        members: { total: memberIds.length, submitted, complete },
        results: {
          completedMatchesExpected: completedMatches.length,
          completedMatchesIngested: completedMatches.length - missingResults.length,
          missingResults,
        },
        pickDistribution,
        malformed,
      });
    }

    if (action === 'inspectFingerprint') {
      // Look up which user IDs share a given device fingerprint. Useful for
      // investigating Sybil reports.
      const { visitorId } = req.body;
      if (!visitorId) return res.status(400).json({ error: 'Missing visitorId' });
      const snap = await db.collection('deviceFingerprints').doc(visitorId).get();
      if (!snap.exists) return res.status(200).json({ visitorId, userIds: [] });
      return res.status(200).json({ visitorId, ...snap.data() });
    }

    if (action === 'clearAntiSybilForUser') {
      // Wipes a user from all deviceFingerprints docs + signupIps docs they
      // appear in. Lets the operator bring an account "back to brand-new"
      // for QA — also a manual unblock when someone gets stuck behind the
      // device-per-email wall on a deploy without ANTI_SYBIL_BYPASS_EMAILS
      // configured. Admin-only; logged.
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      const fpSnap = await db.collection('deviceFingerprints').where('userIds', 'array-contains', userId).get();
      const ipSnap = await db.collection('signupIps').where('userIds', 'array-contains', userId).get();
      const { FieldValue } = await import('firebase-admin/firestore');
      const batch = db.batch();
      fpSnap.docs.forEach(d => batch.update(d.ref, { userIds: FieldValue.arrayRemove(userId) }));
      ipSnap.docs.forEach(d => batch.update(d.ref, { userIds: FieldValue.arrayRemove(userId) }));
      await batch.commit();

      await db.collection('adminLogs').add({
        action: 'clearAntiSybilForUser',
        targetUserId: userId,
        actor: claims.userId,
        timestamp: new Date(),
        cleared: { fingerprints: fpSnap.size, ips: ipSnap.size },
      }).catch(() => {});

      return res.status(200).json({
        ok: true,
        cleared: { fingerprints: fpSnap.size, ips: ipSnap.size },
      });
    }

    if (action === 'getAntiSybilBypassList') {
      // Returns the current Firestore-managed bypass list. Env-var
      // entries (ANTI_SYBIL_BYPASS_EMAILS) are NOT included — those are
      // bootstrap-only and not editable from the UI.
      const snap = await db.collection('config').doc('antiSybilBypass').get();
      const emails = snap.exists ? (snap.data()?.emails || []) : [];
      const envEmails = (process.env.ANTI_SYBIL_BYPASS_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
      return res.status(200).json({ emails, envEmails });
    }

    if (action === 'setAntiSybilBypassList') {
      // Replace the full list. UI sends the desired final state — we
      // don't do incremental add/remove because the list is small and
      // last-writer-wins is fine for a single-operator panel.
      const { emails } = req.body;
      if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails must be an array' });
      // Cap at 200 to keep the doc small; way past any realistic need.
      if (emails.length > 200) return res.status(400).json({ error: 'Max 200 entries' });
      const cleaned = Array.from(new Set(
        emails.map(e => typeof e === 'string' ? e.trim() : '').filter(Boolean)
      ));
      // Validate each entry parses to a normalized email.
      const invalid = cleaned.filter(e => !normalizeBypassEmail(e));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Invalid email(s): ${invalid.slice(0, 3).join(', ')}` });
      }
      await db.collection('config').doc('antiSybilBypass').set({
        emails: cleaned,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: claims.userId,
      }, { merge: true });
      _invalidateBypassCache(); // best-effort; only invalidates this lambda instance
      await db.collection('adminLogs').add({
        action: 'setAntiSybilBypassList',
        actor: claims.userId,
        timestamp: FieldValue.serverTimestamp(),
        count: cleaned.length,
      }).catch(() => {});
      return res.status(200).json({ ok: true, count: cleaned.length, emails: cleaned });
    }

    if (action === 'backfillEmails') {
      // Backfills user.email + user.emailDedupeKey for any user doc where
      // email is missing/null. The legacy custom-token sign-in path used
      // to overwrite a real email with null because fbUser.email is null
      // after signInWithCustomToken; this action recovers the address from
      // Firebase Auth's user record (when it has one) for already-affected
      // accounts.
      //
      // Scope: scans every users doc, filters the ones missing email,
      // looks each up via admin.auth().getUser(uid). Skips users where
      // even Firebase Auth has no email — those need a fresh sign-in to
      // populate, which the new auth-flow upsert (api/auth/{google,verify-code})
      // takes care of automatically the next time they log in.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can run backfill' });
      }
      const dryRun = req.body?.dryRun === true;

      const snap = await db.collection('users').get();
      const targets = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        if (!data.email) targets.push(d.id);
      });

      const results = { scanned: snap.size, missing: targets.length, fixed: 0, stillMissing: 0, errors: [] };

      if (dryRun) {
        return res.status(200).json({ ...results, dryRun: true, sample: targets.slice(0, 10) });
      }

      // Process in chunks of 50 to keep Firestore writes manageable.
      for (let i = 0; i < targets.length; i += 50) {
        const chunk = targets.slice(i, i + 50);
        await Promise.all(chunk.map(async (uid) => {
          try {
            // admin.auth().getUser throws auth/user-not-found if the UID
            // never had a Firebase Auth record. Catch and skip.
            const fbUser = await admin.auth().getUser(uid).catch(() => null);
            const email = fbUser?.email
              || fbUser?.providerData?.find(p => p.email)?.email
              || null;
            if (!email) {
              results.stillMissing++;
              return;
            }
            const { normalizeEmail } = await import('./_lib/security.js');
            await db.collection('users').doc(uid).set({
              email,
              emailDedupeKey: normalizeEmail(email),
              emailBackfilledAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            results.fixed++;
          } catch (e) {
            results.errors.push({ uid, error: e.message });
          }
        }));
      }

      await db.collection('adminLogs').add({
        action: 'backfill_emails',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        ...results,
      }).catch(() => {});

      return res.status(200).json(results);
    }

    if (action === 'inspectUser') {
      // Diagnostic for sign-in regressions. Returns the canonical Firestore
      // state for a given email so we can see whether duplicate /users/* docs
      // (one did:privy:* + one auth_*, or two auth_* with the same dedupe
      // key) are stranding the client's getDoc lookup. Read-only.
      //
      // Triggered from the Admin panel; not surfaced to regular users.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can inspect users' });
      }
      const rawEmail = (req.body?.email || '').toString().trim().toLowerCase();
      if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return res.status(400).json({ error: 'Valid email required' });
      }
      const { normalizeEmail } = await import('./_lib/security.js');
      const dedupeKey = normalizeEmail(rawEmail);

      const collectDoc = (d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          email: data.email ?? null,
          emailDedupeKey: data.emailDedupeKey ?? null,
          displayName: data.displayName ?? null,
          displayNameLower: data.displayNameLower ?? null,
          role: data.role ?? null,
          country: data.country ?? null,
          usernameSet: data.usernameSet,
          onboardingComplete: data.onboardingComplete,
          banned: data.banned ?? false,
          bannedReason: data.bannedReason ?? null,
          deviceFingerprint: data.deviceFingerprint ?? null,
          signupIpHash: data.signupIpHash ?? null,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
          emailBackfilledAt: data.emailBackfilledAt?.toDate?.()?.toISOString?.() ?? null,
          emailUpdatedAt: data.emailUpdatedAt?.toDate?.()?.toISOString?.() ?? null,
          leagues: Array.isArray(data.leagues) ? data.leagues : [],
        };
      };

      const [byKey, byEmail] = await Promise.all([
        db.collection('users').where('emailDedupeKey', '==', dedupeKey).get(),
        db.collection('users').where('email', '==', rawEmail).get(),
      ]);
      const byKeyDocs = byKey.docs.map(collectDoc);
      const byEmailDocs = byEmail.docs.map(collectDoc);

      // Also pull the Firebase Auth record (if any). Useful for diagnosing
      // cases where the client got a custom token bound to a UID that
      // doesn't have a Firestore doc.
      let firebaseAuthRecord = null;
      try {
        const u = await admin.auth().getUserByEmail(rawEmail);
        firebaseAuthRecord = {
          uid: u.uid,
          email: u.email || null,
          emailVerified: !!u.emailVerified,
          providers: (u.providerData || []).map((p) => p.providerId),
          disabled: !!u.disabled,
        };
      } catch {
        firebaseAuthRecord = null;
      }

      // De-dup IDs and report whether the pickPreferredUserDoc tiebreaker
      // would resolve to the same UID we'd return from /api/auth/google.
      const seen = new Map();
      [...byKeyDocs, ...byEmailDocs].forEach((d) => seen.set(d.id, d));
      const allDocs = Array.from(seen.values());
      const privyMatches = allDocs.filter((d) => d.id.startsWith('did:privy:'));
      const wouldResolveTo = privyMatches[0]?.id || allDocs[0]?.id || null;

      return res.status(200).json({
        queriedEmail: rawEmail,
        normalizedDedupeKey: dedupeKey,
        byEmailDedupeKey: byKeyDocs,
        byEmail: byEmailDocs,
        firebaseAuthRecord,
        duplicateCount: allDocs.length,
        wouldResolveTo,
      });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('Admin error:', e);
    return res.status(500).json({ error: e.message });
  }
}
