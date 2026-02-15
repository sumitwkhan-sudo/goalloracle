import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
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

  // POST: create or join league (authenticated)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.body;
  const userId = claims.userId;

  try {
    if (action === 'create') {
      const { name, type, entryFee, currency, prizeDistribution, pointsSystem } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });

      if (type === 'paid' && prizeDistribution) {
        const total = (prizeDistribution.first || 0) + (prizeDistribution.second || 0) + (prizeDistribution.third || 0);
        if (total !== 100) return res.status(400).json({ error: 'Prize distribution must total 100%' });
      }

      const leagueId = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
      const leagueRef = db.collection('leagues').doc(leagueId);

      await leagueRef.set({
        id: leagueId,
        name: name.trim(),
        type: type || 'free',
        entryFee: entryFee || 0,
        currency: currency || 'USDC',
        prizeDistribution: prizeDistribution || { first: 50, second: 30, third: 20 },
        pointsSystem: pointsSystem || { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 },
        createdBy: userId,
        members: [userId],
        memberCount: 1,
        createdAt: FieldValue.serverTimestamp(),
        status: 'active',
      });

      // Add league to user's leagues
      const userRef = db.collection('users').doc(userId);
      await userRef.update({ leagues: FieldValue.arrayUnion(leagueId) });

      return res.status(200).json({ leagueId });

    } else if (action === 'join') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (league.members?.includes(userId)) return res.status(400).json({ error: 'Already a member' });

      await leagueRef.update({
        members: FieldValue.arrayUnion(userId),
        memberCount: FieldValue.increment(1),
      });
      await db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) });

      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('League error:', e);
    return res.status(500).json({ error: e.message });
  }
}
