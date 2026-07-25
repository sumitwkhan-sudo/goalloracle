import { db, admin, applyCors, verifyAuth } from './_lib/firebase.js';
import {
  buildLeaderboardRows,
  rebuildLeaderboardCache,
  readLeaderboardCache,
  buildRow,
  sortRows,
  CACHE_FRESH_MS,
} from './_lib/leaderboardCache.js';

// ALL league boards serve from the materialized /leaderboardCache docs
// (~5 reads per hit) and rebuild lazily on staleness (or on result ingest
// for the global league). Live per-request computation — whose reads scale
// with member count — only ever runs once per staleness window per league,
// no matter how many people are watching. This is the scale contract:
// viewing cost is O(1), computing cost is O(members) but amortized across
// every viewer in the window.
const CACHE_ALL_LEAGUES = true;

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { leagueId } = req.query;
  if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });

  try {
    let data = null;
    let servedFromCache = false;

    if (CACHE_ALL_LEAGUES) {
      const cached = await readLeaderboardCache(db, leagueId, CACHE_FRESH_MS);
      if (cached) {
        data = cached;
        servedFromCache = true;
      } else {
        // Stale/missing — compute live once and persist for everyone else.
        // (Global also rebuilds proactively on result ingest; private
        // leagues refresh here, at most once per staleness window.)
        data = await rebuildLeaderboardCache(db, admin, leagueId);
      }
    } else {
      data = await buildLeaderboardRows(db, admin, leagueId);
    }
    if (!data) return res.status(404).json({ error: 'League not found' });

    // Own-row freshness overlay: an authenticated caller who just saved must
    // see THEIR OWN row current even when the board came from the cache.
    // Rebuild just their row from live docs (≤4 reads) and re-sort.
    if (servedFromCache && req.headers.authorization) {
      try {
        const claims = await verifyAuth(req);
        const uid = claims?.userId || claims?.sub;
        if (uid && data.leaderboard.some((r) => r.userId === uid)) {
          const [userSnap, predSnap, legacyPredSnap, scoreSnap] = await Promise.all([
            db.collection('users').doc(uid).get(),
            db.collection('simplePredictions').doc(`${uid}__${leagueId}`).get(),
            db.collection('simplePredictions').doc(uid).get(),
            db.collection('simplePredictions').doc(`${uid}__${leagueId}`).collection('scores').doc(leagueId).get(),
          ]);
          const u = userSnap.exists ? userSnap.data() : null;
          const pred = predSnap.exists ? predSnap.data() : (legacyPredSnap.exists ? legacyPredSnap.data() : null);
          const prevRow = data.leaderboard.find((r) => r.userId === uid);
          const score = scoreSnap.exists
            ? { totalScore: scoreSnap.data().totalScore || 0, totalAccuracy: scoreSnap.data().totalAccuracy || 0 }
            : { totalScore: prevRow?.totalScore || 0, totalAccuracy: prevRow?.totalAccuracy || 0 };
          const row = buildRow({
            userId: uid,
            user: u ? {
              displayName: u.displayName || u.email?.split('@')[0] || uid.slice(0, 8),
              usernameSet: u.usernameSet || false,
              country: u.country || null,
            } : null,
            pred,
            score,
            knockoutOnly: false,
            groupStageStarted: data.groupStageStarted,
            liveStandings: null,
          });
          // Preserve the cached live score (overlay skips the live standings scan).
          if (prevRow) row.liveGroupScore = prevRow.liveGroupScore || 0;
          data = {
            ...data,
            leaderboard: sortRows(data.leaderboard.map((r) => (r.userId === uid ? row : r))),
          };
        }
      } catch { /* overlay is best-effort — cached row is still correct-ish */ }
    }

    // Authenticated responses stay out of shared caches (the own-row overlay
    // is caller-specific); anonymous responses edge-cache for 5 minutes —
    // the underlying board is only ~15-min fresh anyway, and every avoided
    // origin hit used to cost a full fan-out.
    if (req.headers.authorization) {
      res.setHeader('Cache-Control', 'private, no-store');
    } else {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
    }
    return res.status(200).json({ leaderboard: data.leaderboard, groupStageStarted: data.groupStageStarted });
  } catch (e) {
    console.error('[simple-leaderboard] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
