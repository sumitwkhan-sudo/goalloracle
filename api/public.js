import { db, corsHeaders } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { type } = req.query;

  try {
    if (type === 'stats') {
      const [usersSnap, leaguesSnap] = await Promise.all([
        db.collection('users').get(),
        db.collection('leagues').get(),
      ]);
      const leagues = leaguesSnap.docs.map(d => d.data());
      return res.status(200).json({
        totalPlayers: usersSnap.size,
        activeLeagues: leaguesSnap.size,
        totalPrizePools: leagues.reduce((s, l) => s + (l.entryFee || 0) * (l.memberCount || 0), 0),
      });

    } else if (type === 'results') {
      const snap = await db.collection('matchResults').get();
      const results = {};
      snap.docs.forEach(d => { results[d.id] = d.data(); });
      return res.status(200).json({ results });
    }

    return res.status(400).json({ error: 'Invalid type param. Use ?type=stats or ?type=results' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
