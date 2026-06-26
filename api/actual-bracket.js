/**
 * /api/actual-bracket — the REAL Round-of-32, resolved per side as groups
 * finish. Powers the knockout-real-reseed feature (the wizard reflects real
 * advancing teams progressively). Public + edge-cached briefly so a freshly
 * decided group shows within ~1 min. Provisional/derived data only — never
 * touches scoring (scoring is per-fixture team-name, computed elsewhere).
 *
 * Response: { allGroupsComplete, groupsComplete: [letters],
 *   r32: { 'r32-01': { home, away, homeReal, awayReal }, ... } }
 * Resolved sides carry the real team NAME + *Real:true; undecided sides are
 * null + *Real:false (the client keeps the user's predicted team there).
 */

import { db, applyCors } from './_lib/firebase.js';
import { resolveActualR32 } from './_lib/bracketResolver.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const snap = await db.collection('matchResults').get();
    const results = {};
    snap.forEach((d) => { results[d.id] = d.data(); });
    const out = resolveActualR32(results);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json(out);
  } catch (e) {
    // Never break the wizard — fall back to "nothing resolved" so the client
    // shows the user's predicted bracket as before.
    return res.status(200).json({ allGroupsComplete: false, groupsComplete: [], r32: {} });
  }
}
