import { db, corsHeaders } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v)); return res.status(200).json({}); }
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

    } else if (type === 'league') {
      // Minimal public league meta for crawler-side OG/meta injection.
      // Only returns leagues that are public (or global). Private leagues
      // are omitted to avoid leaking their existence via unfurl previews.
      const { id } = req.query;
      if (!id) return res.status(400).json({ error: 'id required' });
      const snap = await db.collection('leagues').doc(id).get();
      if (!snap.exists) return res.status(404).json({ error: 'not found' });
      const data = snap.data();
      if (data.visibility && data.visibility !== 'public') {
        return res.status(404).json({ error: 'not found' });
      }
      // Cache league meta at the edge for an hour; stale OK for a day.
      res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
      return res.status(200).json({
        id: snap.id,
        name: data.name || 'League',
        memberCount: data.memberCount || 0,
        predictionMode: data.predictionMode || 'classic',
        type: data.type || 'free',
      });
    }

    return res.status(400).json({ error: 'Invalid type param. Use ?type=stats, ?type=results, or ?type=league&id=...' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
