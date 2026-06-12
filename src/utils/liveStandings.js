/**
 * liveStandings.js — current group tables from MATCH RESULTS (client-side).
 *
 * Mirrors the server's buildGroupStandings (api/_lib/bracketResolver.js):
 * points → pairwise head-to-head → goal difference → goals for. Kept in lock-
 * step so the on-screen standings order matches the order the live-score
 * column is graded against. Pure: same results in → same tables out.
 *
 * Returns full team rows (played/W/D/L/GF/GA/GD/Pts) for the standings UI,
 * unlike the server helper which only emits ordered names for scoring.
 */

import WORLD_CUP_MATCHES from '../data/matches';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

const GROUP_MATCHES = WORLD_CUP_MATCHES.filter((m) => !m.isKnockout);

// Pairwise head-to-head: 3 to whoever won the direct match, 0 if drawn or
// not yet played. Matches the server's simpler pairwise variant (full FIFA
// mini-league only differs in rare 3-way ties).
function headToHeadDelta(a, b) {
  const am = a.matches.find((m) => m.vs === b.name);
  if (!am) return 0;
  if (am.gf > am.ga) return -1; // a ranks higher
  if (am.gf < am.ga) return 1;
  return 0;
}

/**
 * Build current standings for every group from completed match results.
 * @param {Object} matchResults  { matchId: { homeScore, awayScore, completed } }
 * @returns {Object} { A: [teamRow, ...sorted], ... } — always 4 rows/group.
 */
export function computeLiveStandings(matchResults = {}) {
  const teams = {};
  GROUP_MATCHES.forEach((m) => {
    const g = (m.stage || '').replace('Group ', '');
    [m.home, m.away].forEach((t) => {
      if (!teams[t]) {
        teams[t] = { name: t, group: g, pts: 0, gf: 0, ga: 0, gd: 0, w: 0, d: 0, l: 0, played: 0, matches: [] };
      }
    });
  });

  GROUP_MATCHES.forEach((m) => {
    const r = matchResults[m.id];
    if (!r || r.completed !== true) return;
    if (typeof r.homeScore !== 'number' || typeof r.awayScore !== 'number') return;
    const home = teams[m.home];
    const away = teams[m.away];
    if (!home || !away) return;
    const hs = r.homeScore;
    const as = r.awayScore;
    home.gf += hs; home.ga += as; home.played += 1;
    away.gf += as; away.ga += hs; away.played += 1;
    home.matches.push({ vs: m.away, gf: hs, ga: as });
    away.matches.push({ vs: m.home, gf: as, ga: hs });
    if (hs > as) { home.pts += 3; home.w += 1; away.l += 1; }
    else if (hs < as) { away.pts += 3; away.w += 1; home.l += 1; }
    else { home.pts += 1; away.pts += 1; home.d += 1; away.d += 1; }
  });

  Object.values(teams).forEach((t) => { t.gd = t.gf - t.ga; });

  const standings = {};
  GROUP_LETTERS.forEach((g) => {
    standings[g] = Object.values(teams)
      .filter((t) => t.group === g)
      .sort((a, b) => {
        if (b.pts !== a.pts) return b.pts - a.pts;
        const h2h = headToHeadDelta(a, b);
        if (h2h !== 0) return h2h;
        if (b.gd !== a.gd) return b.gd - a.gd;
        if (b.gf !== a.gf) return b.gf - a.gf;
        return a.name.localeCompare(b.name);
      });
  });
  return standings;
}

// How many group matches have a completed result (gates "has the tournament
// started" UI states).
export function countGroupMatchesPlayed(matchResults = {}) {
  let n = 0;
  for (const m of GROUP_MATCHES) {
    const r = matchResults[m.id];
    if (r && r.completed === true && typeof r.homeScore === 'number' && typeof r.awayScore === 'number') n += 1;
  }
  return n;
}

// Whether a single group's three matches are all played (for "FINAL" badges).
export function isGroupComplete(standings, letter) {
  const rows = standings?.[letter];
  return Array.isArray(rows) && rows.length === 4 && rows.every((t) => t.played === 3);
}
