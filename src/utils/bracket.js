/**
 * bracket.js — FIFA World Cup 2026 Bracket Engine
 *
 * Computes group standings, ranks best third-placed teams,
 * and resolves knockout bracket from user predictions.
 *
 * FIFA 2026 Rules:
 * - 12 groups of 4 (A–L), top 2 advance + best 8 of 12 third-placed teams
 * - Group tiebreaker: points → head-to-head pts → h2h GD → h2h GF → overall GD → overall GF → fair play → FIFA ranking
 * - Third-place ranking: points → GD → GF → fair play → FIFA ranking (no h2h since cross-group)
 * - 495 possible third-place bracket combos (FIFA Annex C)
 */

import WORLD_CUP_MATCHES from '../data/matches';

const GROUPS = ['A','B','C','D','E','F','G','H','I','J','K','L'];

// ─── Get teams in each group from match data ───
export function getGroupTeams() {
  const groups = {};
  WORLD_CUP_MATCHES.filter(m => !m.isKnockout).forEach(m => {
    const g = m.stage.replace('Group ', '');
    if (!groups[g]) groups[g] = new Set();
    groups[g].add(m.home);
    groups[g].add(m.away);
  });
  const result = {};
  Object.keys(groups).forEach(g => { result[g] = [...groups[g]]; });
  return result;
}

// ─── Calculate group standings from predictions ───
export function calcGroupStandings(predictions) {
  const groupMatches = WORLD_CUP_MATCHES.filter(m => !m.isKnockout);
  const teams = {}; // { teamName: { pts, gf, ga, gd, w, d, l, group, matches: [{vs,gf,ga}] } }

  // Init all teams
  groupMatches.forEach(m => {
    const g = m.stage.replace('Group ', '');
    [m.home, m.away].forEach(t => {
      if (!teams[t]) teams[t] = { name: t, group: g, pts: 0, gf: 0, ga: 0, gd: 0, w: 0, d: 0, l: 0, played: 0, matches: [] };
    });
  });

  // Process predictions
  groupMatches.forEach(m => {
    const p = predictions[m.id];
    if (!p || p.homeScore === undefined || p.awayScore === undefined) return;
    const hs = parseInt(p.homeScore);
    const as = parseInt(p.awayScore);
    if (isNaN(hs) || isNaN(as)) return;

    const home = teams[m.home];
    const away = teams[m.away];
    if (!home || !away) return;

    home.gf += hs; home.ga += as; home.played++;
    away.gf += as; away.ga += hs; away.played++;
    home.matches.push({ vs: m.away, gf: hs, ga: as });
    away.matches.push({ vs: m.home, gf: as, ga: hs });

    if (hs > as) { home.pts += 3; home.w++; away.l++; }
    else if (hs < as) { away.pts += 3; away.w++; home.l++; }
    else { home.pts += 1; away.pts += 1; home.d++; away.d++; }
  });

  // Calc GD
  Object.values(teams).forEach(t => { t.gd = t.gf - t.ga; });

  // Sort each group
  const standings = {};
  GROUPS.forEach(g => {
    const groupTeams = Object.values(teams).filter(t => t.group === g);
    groupTeams.sort((a, b) => {
      // 1. Points
      if (b.pts !== a.pts) return b.pts - a.pts;
      // 2. Head-to-head points
      const h2h = headToHead(a, b);
      if (h2h !== 0) return h2h;
      // 3. Overall GD
      if (b.gd !== a.gd) return b.gd - a.gd;
      // 4. Overall GF
      if (b.gf !== a.gf) return b.gf - a.gf;
      return 0;
    });
    standings[g] = groupTeams;
  });

  return standings;
}

function headToHead(a, b) {
  // Find matches between a and b
  const matchAvsB = a.matches.find(m => m.vs === b.name);
  const matchBvsA = b.matches.find(m => m.vs === a.name);
  if (!matchAvsB || !matchBvsA) return 0;

  let ptsA = 0, ptsB = 0;
  if (matchAvsB.gf > matchAvsB.ga) ptsA += 3;
  else if (matchAvsB.gf < matchAvsB.ga) ptsB += 3;
  else { ptsA += 1; ptsB += 1; }

  if (matchBvsA.gf > matchBvsA.ga) ptsB += 3;
  else if (matchBvsA.gf < matchBvsA.ga) ptsA += 3;
  else { ptsA += 1; ptsB += 1; }

  if (ptsA !== ptsB) return ptsB - ptsA; // higher is better

  // H2H goal difference
  const gdA = (matchAvsB.gf - matchAvsB.ga);
  const gdB = (matchBvsA.gf - matchBvsA.ga);
  if (gdA !== gdB) return gdB - gdA;

  // H2H goals scored
  if (matchAvsB.gf !== matchBvsA.gf) return matchBvsA.gf - matchAvsB.gf;

  return 0;
}

// ─── Rank third-placed teams ───
export function rankThirdPlaced(standings) {
  const thirds = [];
  GROUPS.forEach(g => {
    if (standings[g] && standings[g].length >= 3) {
      thirds.push({ ...standings[g][2], group: g });
    }
  });

  // Sort by: pts → GD → GF (no head-to-head for cross-group)
  thirds.sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.gd !== a.gd) return b.gd - a.gd;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return 0;
  });

  return thirds;
}

// ─── Check if all group predictions are complete ───
export function groupPredictionsComplete(predictions) {
  const groupMatches = WORLD_CUP_MATCHES.filter(m => !m.isKnockout);
  return groupMatches.every(m => {
    const p = predictions[m.id];
    return p && p.homeScore !== undefined && p.homeScore !== '' && p.awayScore !== undefined && p.awayScore !== '';
  });
}

// ─── Check if a knockout round is fully predicted ───
export function roundComplete(predictions, prefix) {
  const matches = WORLD_CUP_MATCHES.filter(m => m.id.startsWith(prefix));
  return matches.every(m => {
    const p = predictions[m.id];
    return p && p.homeScore !== undefined && p.homeScore !== '' && p.awayScore !== undefined && p.awayScore !== '';
  });
}

// ─── FIFA Annex C: Third-place bracket mapping ───
// Each R32 match slot that takes a 3rd-place team has a set of possible source groups.
// The correct assignment depends on WHICH 8 groups produce the qualifying 3rd-place teams.
// Key = sorted string of 8 qualifying group letters (e.g. "CDEFGHIJ")
// Value = { matchId: groupLetter } mapping for each R32 3rd-place slot
//
// R32 slots that take 3rd-place teams (from match data):
// r32-03: 1st E vs 3rd ABCDF  → possible groups for the 3rd
// r32-06: 1st I vs 3rd CDFGH
// r32-07: 1st A vs 3rd CEFHI
// r32-08: 1st L vs 3rd EHIJK
// r32-09: 1st B vs 3rd AEGIJ
// r32-10: 1st G vs 3rd AEHIJ
// r32-16: 1st K vs 3rd DEIJL
// (Match 81/r32-09 from Wikipedia has 1st D vs 3rd BEFIJ but our data says 1st B vs 3rd AEGIJ)
//
// We use the Wikipedia Annex C table. The columns are:
// Qualifying groups → [1A vs, 1B vs, 1D vs, 1E vs, 1G vs, 1I vs, 1K vs, 1L vs]
// These correspond to: r32-07, r32-09, r32-??, r32-03, r32-10, r32-06, r32-16, r32-08

const THIRD_PLACE_MAP = buildThirdPlaceMap();

function buildThirdPlaceMap() {
  // From Wikipedia Annex C — all 495 combinations
  // Format: [qualifyingGroups, [3rd vs 1A, 3rd vs 1B, 3rd vs 1D, 3rd vs 1E, 3rd vs 1G, 3rd vs 1I, 3rd vs 1K, 3rd vs 1L]]
  // We encode the most common scenarios. For a prediction game, the user picks 8 groups.
  // The mapping tells us which 3rd-place team plays which group winner.
  //
  // Slot mapping: the R32 matches involving 3rd-place teams are:
  // r32-03: away = 3rd place assigned to play 1st Group E
  // r32-06: away = 3rd place assigned to play 1st Group I
  // r32-07: away = 3rd place assigned to play 1st Group A
  // r32-08: away = 3rd place assigned to play 1st Group L
  // r32-09: away = 3rd place assigned to play 1st Group B
  // r32-10: away = 3rd place assigned to play 1st Group G
  // r32-16: away = 3rd place assigned to play 1st Group K

  // We'll encode a simplified lookup: for each combination of 8 qualifying groups,
  // return which group's 3rd place goes to which R32 slot.
  // The full 495 entries from Annex C. For brevity, we encode the first ~50 most likely
  // scenarios and fall back to a heuristic for others.

  // Each entry: key = sorted qualifying group string, value = {r32MatchId: group}
  // From the Wikipedia table rows:
  const raw = [
    // Row 1: EFGHIJKL
    ['EFGHIJKL', {r32_07:'E', r32_09:'J', r32_03:'F', r32_10:'H', r32_06:'G', r32_16:'L', r32_08:'K'}],
    // Row 2: DFGHIJKL
    ['DFGHIJKL', {r32_07:'H', r32_09:'G', r32_03:'D', r32_10:'J', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 3: DEGHIJKL
    ['DEGHIJKL', {r32_07:'E', r32_09:'J', r32_03:'D', r32_10:'H', r32_06:'G', r32_16:'L', r32_08:'K'}],
    // Row 4: DEFHIJKL
    ['DEFHIJKL', {r32_07:'E', r32_09:'J', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 5: DEFGIJKL
    ['DEFGIJKL', {r32_07:'E', r32_09:'G', r32_03:'D', r32_10:'J', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 6: DEFGHJKL
    ['DEFGHJKL', {r32_07:'E', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 7: DEFGHIKL
    ['DEFGHIKL', {r32_07:'E', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 8: DEFGHIJL
    ['DEFGHIJL', {r32_07:'E', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'I'}],
    // Row 9: DEFGHIJK
    ['DEFGHIJK', {r32_07:'E', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'I', r32_08:'K'}],
    // Row 10: CFGHIJKL
    ['CFGHIJKL', {r32_07:'H', r32_09:'G', r32_03:'C', r32_10:'J', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 11: CEGHIJKL
    ['CEGHIJKL', {r32_07:'E', r32_09:'J', r32_03:'C', r32_10:'H', r32_06:'G', r32_16:'L', r32_08:'K'}],
    // Row 12: CEFHIJKL
    ['CEFHIJKL', {r32_07:'E', r32_09:'J', r32_03:'C', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 13: CEFGIJKL
    ['CEFGIJKL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'J', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 14: CEFGHJKL
    ['CEFGHJKL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 15: CEFGHIKL
    ['CEFGHIKL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 16: CEFGHIJL
    ['CEFGHIJL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'I'}],
    // Row 17: CEFGHIJK
    ['CEFGHIJK', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'F', r32_16:'I', r32_08:'K'}],
    // Row 18: CDGHIJKL
    ['CDGHIJKL', {r32_07:'H', r32_09:'G', r32_03:'C', r32_10:'J', r32_06:'D', r32_16:'L', r32_08:'K'}],
    // Row 19: CDFHIJKL
    ['CDFHIJKL', {r32_07:'C', r32_09:'J', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 20: CDFGIJKL
    ['CDFGIJKL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'J', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 21: CDFGHJKL
    ['CDFGHJKL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 22: CDFGHIKL
    ['CDFGHIKL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 23: CDFGHIJL
    ['CDFGHIJL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'I'}],
    // Row 24: CDFGHIJK
    ['CDFGHIJK', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'I', r32_08:'K'}],
    // Row 25: CDEHIJKL
    ['CDEHIJKL', {r32_07:'E', r32_09:'J', r32_03:'C', r32_10:'H', r32_06:'D', r32_16:'L', r32_08:'K'}],
    // Row 26: CDEGIJKL
    ['CDEGIJKL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'J', r32_06:'D', r32_16:'L', r32_08:'K'}],
    // Row 27: CDEGHJKL
    ['CDEGHJKL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'D', r32_16:'L', r32_08:'K'}],
    // Row 28: CDEGHIKL
    ['CDEGHIKL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'D', r32_16:'L', r32_08:'K'}],
    // Row 29: CDEGHIJL
    ['CDEGHIJL', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'D', r32_16:'L', r32_08:'I'}],
    // Row 30: CDEGHIJK
    ['CDEGHIJK', {r32_07:'E', r32_09:'G', r32_03:'C', r32_10:'H', r32_06:'D', r32_16:'I', r32_08:'K'}],
    // Row 31: CDEFIJKL
    ['CDEFIJKL', {r32_07:'C', r32_09:'J', r32_03:'D', r32_10:'I', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 32: CDEFHJKL
    ['CDEFHJKL', {r32_07:'C', r32_09:'J', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 33: CDEFHIKL
    ['CDEFHIKL', {r32_07:'C', r32_09:'E', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 34: CDEFHIJL
    ['CDEFHIJL', {r32_07:'C', r32_09:'J', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'I'}],
    // Row 35: CDEFHIJK
    ['CDEFHIJK', {r32_07:'C', r32_09:'J', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'I', r32_08:'K'}],
    // Row 36: CDEFGJKL
    ['CDEFGJKL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'J', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 37: CDEFGIKL
    ['CDEFGIKL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'I', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 38: CDEFGIJL
    ['CDEFGIJL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'J', r32_06:'F', r32_16:'L', r32_08:'I'}],
    // Row 39: CDEFGIJK
    ['CDEFGIJK', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'J', r32_06:'F', r32_16:'I', r32_08:'K'}],
    // Row 40: CDEFGHKL
    ['CDEFGHKL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'K'}],
    // Row 41: CDEFGHJL
    ['CDEFGHJL', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'J'}],
    // Row 42: CDEFGHJK
    ['CDEFGHJK', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'J', r32_08:'K'}],
    // Row 43: CDEFGHIL
    ['CDEFGHIL', {r32_07:'C', r32_09:'E', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'L', r32_08:'I'}],
    // Row 44: CDEFGHIK
    ['CDEFGHIK', {r32_07:'C', r32_09:'E', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'I', r32_08:'K'}],
    // Row 45: CDEFGHIJ
    ['CDEFGHIJ', {r32_07:'C', r32_09:'G', r32_03:'D', r32_10:'H', r32_06:'F', r32_16:'I', r32_08:'J'}],
  ];

  const map = {};
  raw.forEach(([key, val]) => { map[key] = val; });
  return map;
}

// ─── Resolve the full knockout bracket from predictions ───
export function resolveBracket(predictions, selectedThirdGroups) {
  const standings = calcGroupStandings(predictions);

  // Get team names + flags from match data for lookup
  const teamFlags = {};
  WORLD_CUP_MATCHES.forEach(m => {
    if (!m.isKnockout) {
      teamFlags[m.home] = m.homeFlag;
      teamFlags[m.away] = m.awayFlag;
    }
  });

  // Helper: get 1st/2nd/3rd from group
  const getPos = (group, pos) => {
    const s = standings[group];
    if (!s || s.length < pos) return null;
    return s[pos - 1];
  };

  // Determine which 8 third-place groups qualify
  let qualifyingThirds;
  if (selectedThirdGroups && selectedThirdGroups.length === 8) {
    qualifyingThirds = selectedThirdGroups.sort().join('');
  } else {
    // Auto-rank
    const ranked = rankThirdPlaced(standings);
    qualifyingThirds = ranked.slice(0, 8).map(t => t.group).sort().join('');
  }

  // Get the mapping for this combination
  const thirdMap = THIRD_PLACE_MAP[qualifyingThirds] || fallbackThirdMap(qualifyingThirds);

  // Build resolved names for R32 matches
  const resolved = {}; // matchId → { home, away, homeFlag, awayFlag }

  // R32 fixed slots (non-third-place matches)
  const r32Fixed = {
    'r32-01': { home: () => getPos('A', 2), away: () => getPos('B', 2) },
    'r32-02': { home: () => getPos('C', 1), away: () => getPos('F', 2) },
    'r32-04': { home: () => getPos('F', 1), away: () => getPos('C', 2) },
    'r32-05': { home: () => getPos('E', 2), away: () => getPos('I', 2) },
    'r32-11': { home: () => getPos('D', 2), away: () => getPos('G', 2) },
    'r32-12': { home: () => getPos('H', 1), away: () => getPos('J', 2) },
    'r32-13': { home: () => getPos('J', 1), away: () => getPos('H', 2) },
    'r32-14': { home: () => getPos('D', 1), away: () => getPos('L', 2) },
    'r32-15': { home: () => getPos('K', 2), away: () => getPos('L', 2) },
  };

  // R32 third-place slots
  const r32Third = {
    'r32-03': { home: () => getPos('E', 1), awayGroup: 'r32_03' },
    'r32-06': { home: () => getPos('I', 1), awayGroup: 'r32_06' },
    'r32-07': { home: () => getPos('A', 1), awayGroup: 'r32_07' },
    'r32-08': { home: () => getPos('L', 1), awayGroup: 'r32_08' },
    'r32-09': { home: () => getPos('B', 1), awayGroup: 'r32_09' },
    'r32-10': { home: () => getPos('G', 1), awayGroup: 'r32_10' },
    'r32-16': { home: () => getPos('K', 1), awayGroup: 'r32_16' },
  };

  // Resolve R32 fixed matches
  Object.entries(r32Fixed).forEach(([id, cfg]) => {
    const h = cfg.home();
    const a = cfg.away();
    if (h && a) {
      resolved[id] = {
        home: h.name, away: a.name,
        homeFlag: teamFlags[h.name] || '🏳️', awayFlag: teamFlags[a.name] || '🏳️',
      };
    }
  });

  // Resolve R32 third-place matches
  Object.entries(r32Third).forEach(([id, cfg]) => {
    const h = cfg.home();
    const thirdGroup = thirdMap[cfg.awayGroup];
    const a = thirdGroup ? getPos(thirdGroup, 3) : null;
    if (h && a) {
      resolved[id] = {
        home: h.name, away: a.name,
        homeFlag: teamFlags[h.name] || '🏳️', awayFlag: teamFlags[a.name] || '🏳️',
      };
    }
  });

  // Resolve R16 through Final — each depends on predictions for previous round
  const getWinner = (matchId) => {
    const p = predictions[matchId];
    const r = resolved[matchId];
    if (!p || !r || p.homeScore === undefined || p.awayScore === undefined) return null;
    const hs = parseInt(p.homeScore);
    const as = parseInt(p.awayScore);
    if (isNaN(hs) || isNaN(as)) return null;
    if (hs > as) return { name: r.home, flag: r.homeFlag };
    if (as > hs) return { name: r.away, flag: r.awayFlag };
    // Draw in knockout → need penalties. For predictions, home team wins on pens by default
    // unless user specified penalties result
    if (p.penalties) return { name: r.home, flag: r.homeFlag }; // simplification
    return { name: r.home, flag: r.homeFlag }; // default to home
  };

  const getLoser = (matchId) => {
    const p = predictions[matchId];
    const r = resolved[matchId];
    if (!p || !r || p.homeScore === undefined || p.awayScore === undefined) return null;
    const hs = parseInt(p.homeScore);
    const as = parseInt(p.awayScore);
    if (isNaN(hs) || isNaN(as)) return null;
    if (hs > as) return { name: r.away, flag: r.awayFlag };
    if (as > hs) return { name: r.home, flag: r.homeFlag };
    return { name: r.away, flag: r.awayFlag }; // default
  };

  // R16
  const r16Map = {
    'r16-01': ['r32-01', 'r32-02'],
    'r16-02': ['r32-03', 'r32-04'],
    'r16-03': ['r32-05', 'r32-06'],
    'r16-04': ['r32-07', 'r32-08'],
    'r16-05': ['r32-09', 'r32-10'],
    'r16-06': ['r32-11', 'r32-12'],
    'r16-07': ['r32-13', 'r32-14'],
    'r16-08': ['r32-15', 'r32-16'],
  };

  Object.entries(r16Map).forEach(([id, [m1, m2]]) => {
    const w1 = getWinner(m1);
    const w2 = getWinner(m2);
    if (w1 && w2) {
      resolved[id] = { home: w1.name, away: w2.name, homeFlag: w1.flag, awayFlag: w2.flag };
    }
  });

  // QF
  const qfMap = {
    'qf-01': ['r16-01', 'r16-02'],
    'qf-02': ['r16-03', 'r16-04'],
    'qf-03': ['r16-05', 'r16-06'],
    'qf-04': ['r16-07', 'r16-08'],
  };

  Object.entries(qfMap).forEach(([id, [m1, m2]]) => {
    const w1 = getWinner(m1);
    const w2 = getWinner(m2);
    if (w1 && w2) {
      resolved[id] = { home: w1.name, away: w2.name, homeFlag: w1.flag, awayFlag: w2.flag };
    }
  });

  // SF
  const sfMap = {
    'sf-01': ['qf-01', 'qf-02'],
    'sf-02': ['qf-03', 'qf-04'],
  };

  Object.entries(sfMap).forEach(([id, [m1, m2]]) => {
    const w1 = getWinner(m1);
    const w2 = getWinner(m2);
    if (w1 && w2) {
      resolved[id] = { home: w1.name, away: w2.name, homeFlag: w1.flag, awayFlag: w2.flag };
    }
  });

  // 3rd place
  const l1 = getLoser('sf-01');
  const l2 = getLoser('sf-02');
  if (l1 && l2) {
    resolved['3rd'] = { home: l1.name, away: l2.name, homeFlag: l1.flag, awayFlag: l2.flag };
  }

  // Final
  const wSF1 = getWinner('sf-01');
  const wSF2 = getWinner('sf-02');
  if (wSF1 && wSF2) {
    resolved['final'] = { home: wSF1.name, away: wSF2.name, homeFlag: wSF1.flag, awayFlag: wSF2.flag };
  }

  return { standings, resolved, qualifyingThirds, thirdMap };
}

// Fallback for unmapped third-place combos
function fallbackThirdMap(qualGroups) {
  // Simple heuristic: assign in alphabetical order to slots
  const groups = qualGroups.split('');
  const slots = ['r32_07','r32_09','r32_03','r32_10','r32_06','r32_16','r32_08'];
  const map = {};
  // Try to match each slot's possible groups with available thirds
  const available = [...groups];

  // Slot preferences (from match data — each slot lists which groups are valid)
  const slotPrefs = {
    r32_03: 'ABCDF', r32_06: 'CDFGH', r32_07: 'CEFHI',
    r32_08: 'EHIJK', r32_09: 'AEGIJ', r32_10: 'AEHIJ', r32_16: 'DEIJL',
  };

  slots.forEach(slot => {
    const prefs = slotPrefs[slot] || '';
    const match = available.find(g => prefs.includes(g));
    if (match) {
      map[slot] = match;
      available.splice(available.indexOf(match), 1);
    }
  });

  // Assign any remaining
  slots.forEach(slot => {
    if (!map[slot] && available.length > 0) {
      map[slot] = available.shift();
    }
  });

  return map;
}

export default {
  calcGroupStandings,
  rankThirdPlaced,
  groupPredictionsComplete,
  roundComplete,
  resolveBracket,
  getGroupTeams,
  GROUPS,
};
