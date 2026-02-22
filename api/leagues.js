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

  // POST: create, join, leave, or delete league (authenticated)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.body;
  const userId = claims.userId;

  try {
    // ─── CREATE ───────────────────────────────────────────
    if (action === 'create') {
      const { name, type, visibility, passcode, entryFee, currency, prizeDistribution, pointsSystem, matchScope, selectedGroups, selectedRounds } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

      if (type === 'paid' && prizeDistribution) {
        const total = (prizeDistribution.first || 0) + (prizeDistribution.second || 0) + (prizeDistribution.third || 0);
        if (total !== 100) return res.status(400).json({ error: 'Prize distribution must total 100%' });
      }

      if (visibility === 'private' && !passcode?.trim()) {
        return res.status(400).json({ error: 'Passcode required for private leagues' });
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
        createdBy: userId,
        members: [userId],
        memberCount: 1,
        createdAt: FieldValue.serverTimestamp(),
        status: 'active',
      });

      await db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) });
      return res.status(200).json({ leagueId });

    // ─── JOIN ─────────────────────────────────────────────
    } else if (action === 'join') {
      const { leagueId, passcode } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (league.members?.includes(userId)) return res.status(400).json({ error: 'Already a member' });

      // Passcode check for private leagues
      if (league.visibility === 'private') {
        if (!passcode) return res.status(403).json({ error: 'This is a private league. A passcode is required to join.' });
        if (passcode.trim().toUpperCase() !== league.passcode) {
          return res.status(403).json({ error: 'Incorrect passcode' });
        }
      }

      await leagueRef.update({
        members: FieldValue.arrayUnion(userId),
        memberCount: FieldValue.increment(1),
      });
      await db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) });
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

      await leagueRef.update({
        members: FieldValue.arrayRemove(userId),
        memberCount: FieldValue.increment(-1),
      });
      await db.collection('users').doc(userId).update({ leagues: FieldValue.arrayRemove(leagueId) });

      // Delete user's predictions for this league
      const predsSnap = await db.collection('predictions')
        .where('userId', '==', userId)
        .where('leagueId', '==', leagueId)
        .get();
      if (!predsSnap.empty) {
        const batch = db.batch();
        predsSnap.docs.forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      return res.status(200).json({ success: true });

    // ─── DELETE ────────────────────────────────────────────
    } else if (action === 'delete') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      // Only superadmin/admin or the creator can delete
      const userSnap = await db.collection('users').doc(userId).get();
      const userRole = userSnap.data()?.role;

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (league.createdBy !== userId && userRole !== 'superadmin' && userRole !== 'admin') {
        return res.status(403).json({ error: 'Only the league creator or an admin can delete a league' });
      }

      // Prevent deleting the global league
      if (leagueId === 'global') return res.status(400).json({ error: 'Cannot delete the global league' });

      // Delete all predictions for this league (batch in chunks of 500)
      const predsSnap = await db.collection('predictions').where('leagueId', '==', leagueId).get();
      const predDocs = predsSnap.docs;
      for (let i = 0; i < predDocs.length; i += 500) {
        const batch = db.batch();
        predDocs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }

      // Remove league from all member user docs
      const memberIds = league.members || [];
      for (const memberId of memberIds) {
        try {
          await db.collection('users').doc(memberId).update({ leagues: FieldValue.arrayRemove(leagueId) });
        } catch (e) {
          console.error(`Failed to remove league from user ${memberId}:`, e.message);
        }
      }

      // Delete the league doc
      await leagueRef.delete();
      return res.status(200).json({ success: true, deleted: leagueId });
    }

    return res.status(400).json({ error: 'Invalid action. Use: create, join, leave, or delete' });
  } catch (e) {
    console.error('League error:', e);
    return res.status(500).json({ error: e.message });
  }
}
