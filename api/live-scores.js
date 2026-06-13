/**
 * /api/live-scores — public read of the in-progress score feed
 * (/liveMatchScores, written every minute by the live-scores cron).
 *
 * Served via the admin SDK so the Standings page gets live scores without
 * depending on a client-side Firestore rule for /liveMatchScores. Same shape
 * the client merges with matchResults (mergeLiveScores). Provisional only —
 * never final scoring. Edge-cached briefly since it changes ~once a minute.
 */

import { db, applyCors } from './_lib/firebase.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const snap = await db.collection('liveMatchScores').get();
    const live = {};
    snap.forEach((d) => {
      const x = d.data() || {};
      if (typeof x.homeScore !== 'number' || typeof x.awayScore !== 'number') return;
      live[d.id] = {
        homeScore: x.homeScore,
        awayScore: x.awayScore,
        status: x.status || 'IN_PLAY',
        minute: typeof x.minute === 'number' ? x.minute : null,
      };
    });
    res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40');
    return res.status(200).json({ live });
  } catch (e) {
    // Never break the page — just report no live scores.
    return res.status(200).json({ live: {} });
  }
}
