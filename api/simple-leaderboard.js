import { db, corsHeaders } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({});
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { leagueId } = req.query;
  if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });

  try {
    const leagueSnap = await db.collection('leagues').doc(leagueId).get();
    if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
    const members = leagueSnap.data().members || [];
    if (members.length === 0) return res.status(200).json({ leaderboard: [] });

    // Fetch user info in batches
    const users = {};
    for (let i = 0; i < members.length; i += 30) {
      const batch = members.slice(i, i + 30);
      const usersSnap = await db.collection('users').where('id', 'in', batch).get();
      usersSnap.docs.forEach(d => {
        const u = d.data();
        users[d.id] = {
          displayName: u.displayName || u.email?.split('@')[0] || d.id.slice(0, 8),
          usernameSet: u.usernameSet || false,
        };
      });
    }

    // Fetch all simple predictions
    const predsSnap = await db.collection('simplePredictions').get();
    const preds = {};
    predsSnap.docs.forEach(d => { preds[d.id] = d.data(); });

    const leaderboard = members.map(userId => {
      const user = users[userId] || { displayName: userId.slice(0, 8), usernameSet: false };
      const pred = preds[userId];
      const ts = pred?.submittedAt || pred?.updatedAt;
      return {
        userId,
        displayName: user.displayName,
        usernameSet: user.usernameSet,
        hasSubmitted: !!pred,
        isComplete: pred?.isComplete || false,
        submittedAt: ts?._seconds ? ts._seconds * 1000 : ts?.toMillis ? ts.toMillis() : ts || null,
        totalAccuracy: 0,
      };
    });

    // Complete first, then submitted, then submission time, then alphabetical
    leaderboard.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return b.isComplete ? 1 : -1;
      if (a.hasSubmitted !== b.hasSubmitted) return b.hasSubmitted ? 1 : -1;
      if (a.submittedAt && b.submittedAt) return a.submittedAt - b.submittedAt;
      if (a.submittedAt) return -1;
      if (b.submittedAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    return res.status(200).json({ leaderboard });
  } catch (e) {
    console.error('[simple-leaderboard] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
