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
import { resolveThirdPlaceSlots } from './fifaThirdPlaceRules';

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
    if (!p || !p.score) return;
    const hs = parseInt(p.score.home);
    const as = parseInt(p.score.away);
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
    return p && p.score && p.score.home !== undefined && p.score.home !== '' && p.score.away !== undefined && p.score.away !== '';
  });
}

// ─── Check if a knockout round is fully predicted ───
export function roundComplete(predictions, prefix) {
  const matches = WORLD_CUP_MATCHES.filter(m => m.id.startsWith(prefix));
  return matches.every(m => {
    const p = predictions[m.id];
    return p && p.result;
  });
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

  // Get the mapping for this combination via the shared resolver, which
  // sources from annexe-c.json (canonical FIFA Annexe C). There is no
  // algorithmic fallback: unknown combinations (e.g. partial predictions
  // with < 8 thirds) leave the contingent R32 slots unresolved rather
  // than silently producing wrong brackets.
  let thirdMap = {};
  try {
    thirdMap = resolveThirdPlaceSlots(qualifyingThirds.split(''));
  } catch {
    // Partial predictions or unknown combo — leave contingent slots blank.
  }

  // Build resolved names for R32 matches
  const resolved = {}; // matchId → { home, away, homeFlag, awayFlag }

  // R32 fixed slots (non-third-place matches)
  const r32Fixed = {
    // R32 fixed slots (non-third-place: group winner/runner-up vs group winner/runner-up)
    'r32-01': { home: () => getPos('A', 2), away: () => getPos('B', 2) },
    'r32-02': { home: () => getPos('C', 1), away: () => getPos('F', 2) },
    'r32-04': { home: () => getPos('F', 1), away: () => getPos('C', 2) },
    'r32-05': { home: () => getPos('E', 2), away: () => getPos('I', 2) },
    'r32-11': { home: () => getPos('D', 2), away: () => getPos('G', 2) },
    'r32-12': { home: () => getPos('H', 1), away: () => getPos('J', 2) },
    'r32-13': { home: () => getPos('K', 2), away: () => getPos('L', 2) },
    'r32-15': { home: () => getPos('J', 1), away: () => getPos('H', 2) },
  };

  // R32 third-place slots (group winner vs best 3rd-place team)
  const r32Third = {
    'r32-03': { home: () => getPos('E', 1), awayGroup: 'r32_03' },
    'r32-06': { home: () => getPos('I', 1), awayGroup: 'r32_06' },
    'r32-07': { home: () => getPos('A', 1), awayGroup: 'r32_07' },
    'r32-08': { home: () => getPos('L', 1), awayGroup: 'r32_08' },
    'r32-09': { home: () => getPos('D', 1), awayGroup: 'r32_09' },
    'r32-10': { home: () => getPos('G', 1), awayGroup: 'r32_10' },
    'r32-14': { home: () => getPos('B', 1), awayGroup: 'r32_14' },
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
    if (!p || !r) return null;
    // Predictions store score as p.score.home / p.score.away
    const hs = parseInt(p.score?.home);
    const as = parseInt(p.score?.away);
    // If user picked a result, use that as primary signal (especially for draws in knockouts)
    if (p.result === 'home') return { name: r.home, flag: r.homeFlag };
    if (p.result === 'away') return { name: r.away, flag: r.awayFlag };
    // Fallback to score comparison
    if (isNaN(hs) || isNaN(as)) return null;
    if (hs > as) return { name: r.home, flag: r.homeFlag };
    if (as > hs) return { name: r.away, flag: r.awayFlag };
    // Draw — shouldn't happen in knockouts but default to home
    return { name: r.home, flag: r.homeFlag };
  };

  const getLoser = (matchId) => {
    const p = predictions[matchId];
    const r = resolved[matchId];
    if (!p || !r) return null;
    const hs = parseInt(p.score?.home);
    const as = parseInt(p.score?.away);
    if (p.result === 'home') return { name: r.away, flag: r.awayFlag };
    if (p.result === 'away') return { name: r.home, flag: r.homeFlag };
    if (isNaN(hs) || isNaN(as)) return null;
    if (hs > as) return { name: r.away, flag: r.awayFlag };
    if (as > hs) return { name: r.home, flag: r.homeFlag };
    return { name: r.away, flag: r.awayFlag };
  };

  // R16 — must match match data: r16-XX home/away = W R32-YY / W R32-ZZ
  const r16Map = {
    'r16-01': ['r32-03', 'r32-06'],
    'r16-02': ['r32-01', 'r32-04'],
    'r16-03': ['r32-02', 'r32-05'],
    'r16-04': ['r32-07', 'r32-08'],
    'r16-05': ['r32-13', 'r32-12'],
    'r16-06': ['r32-09', 'r32-10'],
    'r16-07': ['r32-15', 'r32-11'],
    'r16-08': ['r32-14', 'r32-16'],
  };

  Object.entries(r16Map).forEach(([id, [m1, m2]]) => {
    const w1 = getWinner(m1);
    const w2 = getWinner(m2);
    if (w1 && w2) {
      resolved[id] = { home: w1.name, away: w2.name, homeFlag: w1.flag, awayFlag: w2.flag };
    }
  });

  // QF — M97: W89 vs W90, M98: W93 vs W94, M99: W91 vs W92, M100: W95 vs W96
  const qfMap = {
    'qf-01': ['r16-01', 'r16-02'],
    'qf-02': ['r16-05', 'r16-06'],
    'qf-03': ['r16-03', 'r16-04'],
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


export default {
  calcGroupStandings,
  rankThirdPlaced,
  groupPredictionsComplete,
  roundComplete,
  resolveBracket,
  getGroupTeams,
  GROUPS,
};
