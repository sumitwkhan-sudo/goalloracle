import { db, admin, applyCors, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { ipHash } from './_lib/security.js';
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
      // Admin-toggleable feature flags. Stored at /settings/featureFlags
      // and read by every client on mount via /api/public?type=flags.
      // Allowed flags are whitelisted so a typo can't write arbitrary
      // keys onto the doc.
      const ALLOWED = new Set(['quickPicksEnabled', 'classicEnabled']);
      const { flag, value } = req.body;
      if (!ALLOWED.has(flag)) return res.status(400).json({ error: `Unknown flag: ${flag}` });
      if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be boolean' });
      const ref = db.collection('settings').doc('featureFlags');
      const snap = await ref.get();
      const prev = snap.exists ? (snap.data() || {}) : {};
      await ref.set({ ...prev, [flag]: value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('adminLogs').add({
        action: 'set_feature_flag',
        flag, value,
        previousValue: prev[flag] ?? null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, flag, value });
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

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('Admin error:', e);
    return res.status(500).json({ error: e.message });
  }
}
