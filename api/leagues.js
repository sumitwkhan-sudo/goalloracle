import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v)); return res.status(200).json({}); }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

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
      const { name, type, visibility, passcode, entryFee, currency, prizeDistribution, pointsSystem, matchScope, selectedGroups, selectedRounds, predictionMode } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
      if (name.trim().length > 60) return res.status(400).json({ error: 'Name too long (max 60 chars)' });

      const mode = predictionMode === 'classic' ? 'classic' : 'simple';

      // Numeric bounds — entryFee must be a non-negative finite number under
      // a sane cap; prize distribution percentages must be integers in [0..100].
      const fee = Number(entryFee || 0);
      if (!Number.isFinite(fee) || fee < 0 || fee > 10000) {
        return res.status(400).json({ error: 'Invalid entryFee' });
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

      const leagueId = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
      const leagueRef = db.collection('leagues').doc(leagueId);

      await leagueRef.set({
        id: leagueId,
        name: name.trim(),
        type: type || 'free',
        visibility: visibility || 'public',
        passcode: visibility === 'private' ? passcode.trim().toUpperCase() : null,
        entryFee: entryFee || 0,
        currency: currency || 'USDC',
        prizeDistribution: prizeDistribution || { first: 50, second: 30, third: 20 },
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
      });

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
        if (passcode.trim().toUpperCase() !== league.passcode) {
          return res.status(403).json({ error: 'Incorrect passcode' });
        }
      }

      // Parallel writes
      await Promise.all([
        leagueRef.update({ members: FieldValue.arrayUnion(userId), memberCount: FieldValue.increment(1) }),
        db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) }),
      ]);
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

    } else {
      return res.status(400).json({ error: 'Invalid action. Use: create, join, leave, or delete' });
    }
  } catch (e) {
    console.error('League error:', e);
    if (!res.headersSent) return res.status(500).json({ error: e.message });
  }
}
