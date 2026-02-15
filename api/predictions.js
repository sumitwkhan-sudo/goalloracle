import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  // GET: get predictions or leaderboard (public for leaderboard)
  if (req.method === 'GET') {
    const { type, userId, leagueId } = req.query;

    try {
      if (type === 'leaderboard' && leagueId) {
        const snap = await db.collection('predictions').where('leagueId', '==', leagueId).get();
        const byUser = {};
        snap.docs.forEach(d => {
          const data = d.data();
          if (!byUser[data.userId]) byUser[data.userId] = {};
          byUser[data.userId][data.matchId] = data;
        });
        return res.status(200).json({ leaderboard: byUser });

      } else if (type === 'user' && userId && leagueId) {
        const snap = await db.collection('predictions')
          .where('userId', '==', userId)
          .where('leagueId', '==', leagueId)
          .get();
        const preds = {};
        snap.docs.forEach(d => { const data = d.data(); preds[data.matchId] = data; });
        return res.status(200).json({ predictions: preds });
      }

      return res.status(400).json({ error: 'Invalid query params' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  // POST: save predictions (authenticated)
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const userId = claims.userId;
  const { leagueId, predictions } = req.body;

  if (!leagueId || !predictions) return res.status(400).json({ error: 'Missing leagueId or predictions' });

  // Verify user is a member of this league
  const leagueSnap = await db.collection('leagues').doc(leagueId).get();
  if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
  if (!leagueSnap.data().members?.includes(userId)) return res.status(403).json({ error: 'Not a member of this league' });

  try {
    const batch = db.batch();
    let count = 0;

    for (const [matchId, pred] of Object.entries(predictions)) {
      if (!pred.result) continue;

      // TODO: Add server-side lock check here using match times
      const ref = db.collection('predictions').doc(`${userId}_${leagueId}_${matchId}`);
      batch.set(ref, {
        userId,
        leagueId,
        matchId,
        result: pred.result,
        score: { home: pred.score?.home || '', away: pred.score?.away || '' },
        extraTime: pred.extraTime || false,
        penalties: pred.penalties || false,
        updatedAt: FieldValue.serverTimestamp(),
        submittedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      count++;
    }

    await batch.commit();
    return res.status(200).json({ saved: count });
  } catch (e) {
    console.error('Save predictions error:', e);
    return res.status(500).json({ error: e.message });
  }
}
