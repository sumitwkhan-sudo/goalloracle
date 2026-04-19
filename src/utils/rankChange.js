/**
 * Rank-change tracker for leaderboards.
 *
 * Persists a snapshot of each user's rank to localStorage per league so the
 * next page load can compare current ranks against stored ones and show
 * up/down/unchanged arrows. Snapshots older than STALE_MS are refreshed on
 * the next read; fresher snapshots are preserved so rapid refreshes don't
 * erase the delta.
 */

const STORAGE_PREFIX = 'lb_snap_';
const STALE_MS = 6 * 60 * 60 * 1000; // 6 hours

const key = (leagueId) => `${STORAGE_PREFIX}${leagueId}`;

export function readSnapshot(leagueId) {
  try {
    const raw = localStorage.getItem(key(leagueId));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.ranks || typeof parsed.ts !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeSnapshot(leagueId, ranks) {
  try {
    localStorage.setItem(key(leagueId), JSON.stringify({ ts: Date.now(), ranks }));
  } catch {}
}

/**
 * Given a sorted leaderboard (array of { userId, ... }), returns a map
 * userId -> delta. Positive = moved up, negative = moved down, 0 = unchanged,
 * undefined = no prior rank for this user.
 *
 * Refreshes the stored snapshot if it's older than STALE_MS, so users who
 * return the next day see their movement vs. yesterday.
 */
export function computeRankDeltas(leagueId, sortedEntries) {
  const ranks = {};
  sortedEntries.forEach((e, i) => { ranks[e.userId] = i + 1; });

  const prior = readSnapshot(leagueId);
  const deltas = {};
  if (prior?.ranks) {
    for (const uid of Object.keys(ranks)) {
      const prev = prior.ranks[uid];
      if (typeof prev === 'number') deltas[uid] = prev - ranks[uid]; // +ve = climbed
    }
  }

  const stale = !prior || (Date.now() - prior.ts > STALE_MS);
  if (stale) writeSnapshot(leagueId, ranks);

  return deltas;
}
