import { db, applyCors, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  // GET: list all leagues (public)
  if (req.method === 'GET') {
    try {
      const snap = await db.collection('leagues').get();
      const leagues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ leagues });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.body;
  const userId = claims.userId;

  try {
    // ─── CREATE ───────────────────────────────────────────
    if (action === 'create') {
      const { name, type, visibility, passcode, entryFee, currency, prizeDistribution, pointsSystem, matchScope, selectedGroups, selectedRounds, predictionMode, houseRules } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
      if (name.trim().length > 60) return res.status(400).json({ error: 'Name too long (max 60 chars)' });

      const mode = predictionMode === 'classic' ? 'classic' : 'simple';

      // Prize-league feature flag — load on every create so the server
      // is always source-of-truth even if a client has a stale flag value.
      // Caching here is unnecessary; create is rare.
      const flagSnap = await db.collection('settings').doc('featureFlags').get();
      const prizeLeaguesEnabled = flagSnap.exists && flagSnap.data()?.enablePrizeLeagues === true;
      // Numeric bounds — entryFee must be a non-negative finite number under
      // a sane cap; prize distribution percentages must be integers in [0..100].
      const fee = Number(entryFee || 0);
      if (!Number.isFinite(fee) || fee < 0 || fee > 10000) {
        return res.status(400).json({ error: 'Invalid entryFee' });
      }

      // Gate: reject any prize-league shape when the platform-wide flag
      // is off. Catches both old clients with a stale `true` and any
      // direct API calls. Returns 403 with the spec-mandated message.
      if (!prizeLeaguesEnabled) {
        if (type === 'paid' || fee > 0) {
          return res.status(403).json({ error: 'Prize leagues are currently disabled.' });
        }
      }

      if (prizeDistribution) {
        const { first = 0, second = 0, third = 0 } = prizeDistribution;
        const isPct = (v) => Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= 100;
        if (!isPct(first) || !isPct(second) || !isPct(third)) {
          return res.status(400).json({ error: 'Invalid prizeDistribution' });
        }
        if (type === 'paid' && (first + second + third) !== 100) {
          return res.status(400).json({ error: 'Prize distribution must total 100%' });
        }
      }

      // House Rules validation: private leagues only, 500 char hard cap,
      // plain-text (HTML escaped on render — we store raw, render-time
      // sanitization). Whitespace-only stores as null.
      let houseRulesPersist = null;
      if (houseRules && typeof houseRules === 'object' && typeof houseRules.content === 'string') {
        const trimmed = houseRules.content.trim();
        if (trimmed) {
          if (visibility !== 'private') {
            return res.status(400).json({ error: 'House Rules are only allowed on private leagues.' });
          }
          if (trimmed.length > 500) {
            return res.status(400).json({ error: 'House Rules must be 500 characters or fewer.' });
          }
          houseRulesPersist = {
            content: trimmed,
            lastUpdatedAt: FieldValue.serverTimestamp(),
            lastUpdatedBy: userId,
          };
        }
      }

      if (pointsSystem) {
        const allowed = new Set(['correctResult', 'correctScore', 'penaltyBonus', 'extraTimeBonus']);
        for (const [k, v] of Object.entries(pointsSystem)) {
          if (!allowed.has(k)) return res.status(400).json({ error: `Unknown points key: ${k}` });
          if (!Number.isInteger(v) || v < 0 || v > 50) {
            return res.status(400).json({ error: `Invalid pointsSystem.${k}` });
          }
        }
      }

      if (visibility === 'private' && !passcode?.trim()) {
        return res.status(400).json({ error: 'Passcode required for private leagues' });
      }
      if (passcode && passcode.length > 32) {
        return res.status(400).json({ error: 'Passcode too long' });
      }

      // 4 hex chars of randomness defends against the (very rare) case of
      // two creates colliding on the same `slug-millisecond`. Without it
      // the second create would silently overwrite the first via `set`.
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const randomSuffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      const leagueId = `${slug}-${Date.now()}-${randomSuffix}`;
      const leagueRef = db.collection('leagues').doc(leagueId);

      await leagueRef.set({
        id: leagueId,
        name: name.trim(),
        // type silently coerced to 'free' when prize leagues are off —
        // matches the simplified create flow (no type picker visible).
        type: prizeLeaguesEnabled ? (type || 'free') : 'free',
        visibility: visibility || 'public',
        // passcode is NOT stored on the public doc anymore — see private
        // subcollection write below. Field stays null for compatibility
        // with older readers that only check this property to know whether
        // a league is private.
        passcode: null,
        entryFee: prizeLeaguesEnabled ? (entryFee || 0) : 0,
        currency: currency || 'USDC',
        prizeDistribution: prizeLeaguesEnabled ? (prizeDistribution || { first: 50, second: 30, third: 20 }) : null,
        pointsSystem: pointsSystem || { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 },
        matchScope: matchScope || 'all',
        selectedGroups: selectedGroups || null,
        selectedRounds: selectedRounds || null,
        predictionMode: mode,
        createdBy: userId,
        members: [userId],
        memberCount: 1,
        createdAt: FieldValue.serverTimestamp(),
        status: 'active',
        houseRules: houseRulesPersist,
      });

      // Private leagues: store the passcode in a server-only subdoc so
      // it never appears in any client-visible league read.
      if (visibility === 'private') {
        await leagueRef.collection('private').doc('auth').set({
          passcode: passcode.trim().toUpperCase(),
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // Respond immediately, update user doc in background
      res.status(200).json({ leagueId });
      db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) }).catch(() => {});

    // ─── JOIN ─────────────────────────────────────────────
    } else if (action === 'join') {
      const { leagueId, passcode } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (league.members?.includes(userId)) return res.status(400).json({ error: 'Already a member' });

      if (league.visibility === 'private') {
        if (!passcode) return res.status(403).json({ error: 'This is a private league. A passcode is required to join.' });
        // Read the canonical passcode from the private subcollection.
        // Fall back to the legacy `league.passcode` field for leagues
        // that haven't been migrated yet (see admin migrateLeaguePasscodes).
        const privSnap = await leagueRef.collection('private').doc('auth').get();
        const truePasscode = privSnap.exists ? (privSnap.data().passcode || null) : league.passcode;
        if (!truePasscode || passcode.trim().toUpperCase() !== truePasscode) {
          return res.status(403).json({ error: 'Incorrect passcode' });
        }
      }

      // Parallel writes. If the league has houseRules, also stamp the
      // member's per-league acknowledgment timestamp so the
      // HouseRulesCard on the league page knows whether to default to
      // expanded (first view) or collapsed (subsequent views).
      const hasHouseRules = !!(league.houseRules && league.houseRules.content);
      const memberWrites = [
        leagueRef.update({ members: FieldValue.arrayUnion(userId), memberCount: FieldValue.increment(1) }),
        db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) }),
      ];
      if (hasHouseRules) {
        // Per-(user,league) doc keyed by composite ID. Cheap and avoids
        // a per-user array of acknowledgments that would balloon.
        const ackId = `${userId}__${leagueId}`;
        memberWrites.push(
          db.collection('leagueMemberAcks').doc(ackId).set({
            userId,
            leagueId,
            houseRulesAcknowledgedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        );
      }
      await Promise.all(memberWrites);
      return res.status(200).json({ success: true });

    // ─── LEAVE ────────────────────────────────────────────
    } else if (action === 'leave') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (!league.members?.includes(userId)) return res.status(400).json({ error: 'Not a member' });
      if (league.createdBy === userId) return res.status(400).json({ error: 'League creator cannot leave. Delete the league instead.' });

      // Parallel writes, respond immediately
      await Promise.all([
        leagueRef.update({ members: FieldValue.arrayRemove(userId), memberCount: FieldValue.increment(-1) }),
        db.collection('users').doc(userId).update({ leagues: FieldValue.arrayRemove(leagueId) }),
      ]);

      // Delete predictions in background (non-blocking)
      res.status(200).json({ success: true });
      db.collection('predictions').where('userId', '==', userId).where('leagueId', '==', leagueId).get()
        .then(snap => { if (!snap.empty) { const batch = db.batch(); snap.docs.forEach(d => batch.delete(d.ref)); return batch.commit(); } })
        .catch(e => console.error('Prediction cleanup failed:', e.message));

    // ─── DELETE ────────────────────────────────────────────
    } else if (action === 'delete') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });
      if (leagueId === 'global' || leagueId === 'global-simple') return res.status(400).json({ error: 'Cannot delete a global league' });

      const [userSnap, leagueSnap] = await Promise.all([
        db.collection('users').doc(userId).get(),
        db.collection('leagues').doc(leagueId).get(),
      ]);

      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      const userRole = userSnap.data()?.role;
      if (league.createdBy !== userId && userRole !== 'superadmin' && userRole !== 'admin') {
        return res.status(403).json({ error: 'Only the league creator or an admin can delete a league' });
      }

      // Delete the league doc immediately and respond
      await db.collection('leagues').doc(leagueId).delete();
      res.status(200).json({ success: true, deleted: leagueId });

      // Background cleanup: predictions + member user docs (non-blocking)
      const memberIds = league.members || [];
      const cleanupPromises = memberIds.map(mid =>
        db.collection('users').doc(mid).update({ leagues: FieldValue.arrayRemove(leagueId) }).catch(() => {})
      );
      db.collection('predictions').where('leagueId', '==', leagueId).get()
        .then(snap => {
          const docs = snap.docs;
          for (let i = 0; i < docs.length; i += 500) {
            const batch = db.batch();
            docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
            cleanupPromises.push(batch.commit());
          }
          return Promise.all(cleanupPromises);
        })
        .catch(e => console.error('Delete cleanup failed:', e.message));

    // ─── EDIT HOUSE RULES (creator only) ──────────────────
    } else if (action === 'editHouseRules') {
      const { leagueId, content } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const league = leagueSnap.data();
      if (league.createdBy !== userId) {
        return res.status(403).json({ error: 'Only the league creator can edit House Rules' });
      }
      if (league.visibility !== 'private') {
        return res.status(400).json({ error: 'House Rules are only allowed on private leagues.' });
      }

      // null / empty / whitespace clears the field; non-empty replaces it.
      const trimmed = typeof content === 'string' ? content.trim() : '';
      if (trimmed.length > 500) {
        return res.status(400).json({ error: 'House Rules must be 500 characters or fewer.' });
      }
      const houseRulesUpdate = trimmed
        ? { content: trimmed, lastUpdatedAt: FieldValue.serverTimestamp(), lastUpdatedBy: userId }
        : null;

      await leagueRef.update({ houseRules: houseRulesUpdate });

      // Reset all members' acknowledgments so the updated rules
      // re-default to expanded on next view (with an "updated" badge).
      // Cheap: only writes for users who had acknowledged the prior rules.
      if (trimmed) {
        const acks = await db.collection('leagueMemberAcks').where('leagueId', '==', leagueId).get();
        const batch = db.batch();
        acks.docs.forEach((d) => {
          batch.update(d.ref, { houseRulesAcknowledgedAt: null, houseRulesUpdatedSinceAck: true });
        });
        if (!acks.empty) await batch.commit();
      }
      return res.status(200).json({ success: true });

    // ─── ACKNOWLEDGE HOUSE RULES (any member) ────────────
    } else if (action === 'acknowledgeHouseRules') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      // Idempotent — first ack stays; subsequent calls just stamp the time
      // (cheap, no harm). We never overwrite the FIRST acknowledgment time
      // to preserve the join-time signal.
      const ackId = `${userId}__${leagueId}`;
      await db.collection('leagueMemberAcks').doc(ackId).set({
        userId,
        leagueId,
        houseRulesAcknowledgedAt: FieldValue.serverTimestamp(),
        houseRulesUpdatedSinceAck: false,
      }, { merge: true });
      return res.status(200).json({ success: true });

    // ─── REPORT CONTENT (any member) ──────────────────────
    } else if (action === 'reportContent') {
      // Generic UGC report. v1 only supports content_type 'league_house_rules'
      // but the shape is reusable for other UGC later.
      const { contentType, contentId, reason } = req.body;
      if (contentType !== 'league_house_rules') {
        return res.status(400).json({ error: 'Unsupported content type' });
      }
      if (!contentId) return res.status(400).json({ error: 'contentId required' });

      // Verify the league exists and the reporter is a member. Prevents
      // spam reports from non-members.
      const leagueSnap = await db.collection('leagues').doc(contentId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const members = leagueSnap.data().members || [];
      if (!members.includes(userId)) return res.status(403).json({ error: 'Only members can report' });

      const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;
      await db.collection('contentReports').add({
        reporterUserId: userId,
        contentType,
        contentId,
        reason: trimmedReason || null,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true });

    } else {
      return res.status(400).json({ error: 'Invalid action. Use: create, join, leave, delete, editHouseRules, acknowledgeHouseRules, or reportContent' });
    }
  } catch (e) {
    console.error('League error:', e);
    if (!res.headersSent) return res.status(500).json({ error: e.message });
  }
}
