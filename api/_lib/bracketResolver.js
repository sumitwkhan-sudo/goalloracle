/**
 * bracketResolver.js — server-side bracket state from accumulated match
 * results. Self-contained: does NOT import from src/utils/ because those
 * client-side files use extensionless imports and a top-level JSON import
 * (annexe-c.json), both of which crash Vercel's Node ESM runtime at
 * module load. Vitest tolerates them via Vite's resolver, which is why
 * unit tests passed but the deployed cron 500'd at import time.
 *
 * Lets the auto-poll cron look up knockout matches by actual team name
 * once they're determined, instead of skipping them while placeholders
 * ("W R32-01", "1st Group A") remain in matches.js.
 *
 * Flow:
 *   1. Walk matchResults, compute per-group standings using the FIFA
 *      Article 11 within-group tiebreaker (points → H2H → GD → GF).
 *   2. Once all 12 groups have completed all 6 matches, allocate the 8
 *      best third-placed teams (Article 13: points → GD → GF → group
 *      letter as deterministic backstop) into R32 slots via Annexe C.
 *   3. Walk WORLD_CUP_MATCHES forward, resolving placeholders against
 *      the computed standings + accumulated knockout results.
 *
 * Returns { resolved, allGroupsComplete, errors }. Matches that can't
 * be resolved yet (their predecessor isn't done) simply don't appear in
 * `resolved` — the caller treats absence as "skip for now, retry later".
 */

import { createRequire } from 'module';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';
import { determineWinnerFromResult } from './oracleParsers.js';

// Use createRequire so the JSON import works under Node's strict ESM
// without needing the experimental `with { type: 'json' }` syntax.
const requireCjs = createRequire(import.meta.url);
const annexeC = requireCjs('../../src/data/annexe-c.json');

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// ─── matches.js R32 third-place slot id ↔ FIFA Annexe C M-id ───
const M_TO_R32_ID = {
  M74: 'r32-03', M77: 'r32-06', M79: 'r32-07', M80: 'r32-08',
  M81: 'r32-09', M82: 'r32-10', M85: 'r32-14', M87: 'r32-16',
};
// Eligibility-letters string in the matches.js placeholder ("3rd ABCDF")
// → matches.js R32 id. Five letters per slot, sorted into canonical form.
const ELIGIBILITY_TO_R32_ID = {
  ABCDF: 'r32-03', CDFGH: 'r32-06', CEFHI: 'r32-07', EHIJK: 'r32-08',
  BEFIJ: 'r32-09', AEHIJ: 'r32-10', EFGIJ: 'r32-14', DEIJL: 'r32-16',
};

// ─── Group standings (FIFA Article 11 within-group tiebreaker) ───
//
// Server-side equivalent of src/utils/bracket.js's calcGroupStandings,
// rewritten to take matchResults directly (no predictions adapter) and
// without dragging in the client-side import chain.

function buildGroupStandings(matchResults) {
  const groupMatches = WORLD_CUP_MATCHES.filter((m) => !m.isKnockout);
  const teams = {};

  groupMatches.forEach((m) => {
    const g = (m.stage || '').replace('Group ', '');
    [m.home, m.away].forEach((t) => {
      if (!teams[t]) {
        teams[t] = {
          name: t, group: g, pts: 0, gf: 0, ga: 0, gd: 0, w: 0, d: 0, l: 0,
          played: 0, matches: [],
        };
      }
    });
  });

  groupMatches.forEach((m) => {
    const r = matchResults[m.id];
    if (!r || r.completed !== true) return;
    if (typeof r.homeScore !== 'number' || typeof r.awayScore !== 'number') return;

    const home = teams[m.home];
    const away = teams[m.away];
    if (!home || !away) return;

    const hs = r.homeScore;
    const as_ = r.awayScore;
    home.gf += hs; home.ga += as_; home.played += 1;
    away.gf += as_; away.ga += hs; away.played += 1;
    home.matches.push({ vs: m.away, gf: hs, ga: as_ });
    away.matches.push({ vs: m.home, gf: as_, ga: hs });

    if (hs > as_) { home.pts += 3; home.w += 1; away.l += 1; }
    else if (hs < as_) { away.pts += 3; away.w += 1; home.l += 1; }
    else { home.pts += 1; away.pts += 1; home.d += 1; away.d += 1; }
  });

  Object.values(teams).forEach((t) => { t.gd = t.gf - t.ga; });

  const standings = {};
  GROUP_LETTERS.forEach((g) => {
    const groupTeams = Object.values(teams).filter((t) => t.group === g);
    groupTeams.sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      const h2h = headToHeadDelta(a, b);
      if (h2h !== 0) return h2h;
      if (b.gd !== a.gd) return b.gd - a.gd;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return 0;
    });
    standings[g] = groupTeams;
  });

  return standings;
}

// Pairwise head-to-head: 3 pts for the team that beat the other in their
// direct match, 0 if drawn or unplayed. FIFA's full mini-league applies
// when 3+ teams are tied; this simpler pairwise variant matches what
// src/utils/bracket.js was using and is acceptable while genuine 3-way
// ties at the same point total remain rare in the new 4-team groups.
function headToHeadDelta(a, b) {
  const aVsB = a.matches.find((m) => m.vs === b.name);
  const bVsA = b.matches.find((m) => m.vs === a.name);
  if (!aVsB || !bVsA) return 0;
  let ptsA = 0;
  let ptsB = 0;
  if (aVsB.gf > aVsB.ga) ptsA += 3;
  else if (aVsB.gf < aVsB.ga) ptsB += 3;
  else { ptsA += 1; ptsB += 1; }
  return ptsB - ptsA; // higher pts → ranked higher (sort wants negative for a)
}

// ─── Annexe C allocation of best 8 of 12 third-placed teams ───

function allocateThirdsToBracketsLocal(top8, allGroups) {
  if (!Array.isArray(top8) || top8.length !== 8) {
    throw new Error(`allocateThirdsToBrackets expects 8 thirds, got ${top8?.length ?? 0}`);
  }
  const key = top8.map((t) => t.group).sort().join('');
  const routing = annexeC.lookup?.[key];
  if (!routing) throw new Error(`No Annexe C routing for advancing groups: ${key}`);

  const allocation = {};
  for (const [matchId, slot] of Object.entries(routing)) {
    const groupLetter = slot[1]; // "3X" → "X"
    const thirdFromGroup = allGroups[groupLetter]?.find((t) => t.groupPosition === 3);
    if (!thirdFromGroup) {
      throw new Error(`Annexe C routed ${matchId} → 3${groupLetter} but group ${groupLetter} has no 3rd-placed team`);
    }
    allocation[matchId] = thirdFromGroup;
  }
  return allocation;
}

function isGroupComplete(standings, letter) {
  const teams = standings[letter];
  if (!teams || teams.length !== 4) return false;
  return teams.every((t) => t.played === 3);
}

// Annexe C routing of the best-8 thirds → { r32Id: teamName }. Requires ALL
// groups complete (the 12 thirds must be ranked against each other). Returns
// null if not all complete; throws on an Annexe C lookup miss. Shared by
// resolveActualBracket + resolveActualR32 so the two never diverge.
function computeTop8ByMatch(standings) {
  const allComplete = GROUP_LETTERS.every((l) => isGroupComplete(standings, l));
  if (!allComplete) return null;
  const allGroups = buildAllGroupsForAnnexeC(standings);
  const thirds = GROUP_LETTERS.map((l) => allGroups[l]?.[2]).filter(Boolean);
  thirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.group.localeCompare(b.group);
  });
  const top8 = thirds.slice(0, 8);
  const allocation = allocateThirdsToBracketsLocal(top8, allGroups);
  const out = {};
  for (const [mId, teamObj] of Object.entries(allocation)) {
    const r32Id = M_TO_R32_ID[mId];
    if (r32Id) out[r32Id] = teamObj.teamId;
  }
  return out;
}

function buildAllGroupsForAnnexeC(standings) {
  const allGroups = {};
  for (const letter of GROUP_LETTERS) {
    const teams = standings[letter];
    if (!teams) continue;
    allGroups[letter] = teams.map((t, idx) => ({
      teamId: t.name,
      group: letter,
      groupPosition: idx + 1,
      points: t.pts,
      goalDifference: t.gd,
      goalsFor: t.gf,
      fairPlayPoints: 0,
      fifaRanking: 50,
    }));
  }
  return allGroups;
}

// ─── Placeholder resolution ───

function resolveR32Placeholder(label, standings, top8ByMatch) {
  if (!label) return null;
  const m1 = label.match(/^1st Group ([A-L])$/i);
  if (m1) {
    if (!isGroupComplete(standings, m1[1])) return null;
    return standings[m1[1]]?.[0]?.name || null;
  }
  const m2 = label.match(/^2nd Group ([A-L])$/i);
  if (m2) {
    if (!isGroupComplete(standings, m2[1])) return null;
    return standings[m2[1]]?.[1]?.name || null;
  }
  const m3 = label.match(/^3rd ([A-L]{5})$/i);
  if (m3) {
    const eligibility = m3[1].toUpperCase().split('').sort().join('');
    const r32Id = ELIGIBILITY_TO_R32_ID[eligibility];
    if (r32Id && top8ByMatch && top8ByMatch[r32Id]) return top8ByMatch[r32Id];
  }
  return null;
}

function lookupKnockoutResult(label, resolved, matchResults) {
  if (!label) return null;
  const w = label.match(/^W (R32|R16|QF|SF)-?0*(\d+)$/i);
  if (w) {
    const stage = w[1].toLowerCase();
    const num = String(w[2]).padStart(2, '0');
    const lookupId = `${stage}-${num}`;
    const teams = resolved[lookupId];
    const result = matchResults[lookupId];
    if (!teams || !result) return null;
    const winner = determineWinnerFromResult(result);
    if (winner === 'home') return teams.home;
    if (winner === 'away') return teams.away;
    return null;
  }
  const l = label.match(/^L (SF)-?0*(\d+)$/i);
  if (l) {
    const num = String(l[2]).padStart(2, '0');
    const lookupId = `sf-${num}`;
    const teams = resolved[lookupId];
    const result = matchResults[lookupId];
    if (!teams || !result) return null;
    const winner = determineWinnerFromResult(result);
    if (winner === 'home') return teams.away;
    if (winner === 'away') return teams.home;
    return null;
  }
  return null;
}

// ─── Public entry point ───

export function resolveActualBracket(matchResults) {
  const errors = [];
  const standings = buildGroupStandings(matchResults || {});

  const allGroupsComplete = GROUP_LETTERS.every((letter) => {
    const teams = standings[letter];
    if (!teams || teams.length !== 4) return false;
    return teams.every((t) => t.played === 3);
  });

  let top8ByMatch = null;
  if (allGroupsComplete) {
    try {
      top8ByMatch = computeTop8ByMatch(standings);
    } catch (e) {
      errors.push(`Annexe C lookup failed: ${e.message}`);
    }
  }

  const resolved = {};

  // R32 — depends on group standings (and Annexe C for 3rd-place spots).
  for (const m of WORLD_CUP_MATCHES.filter((x) => x.id.startsWith('r32-'))) {
    const home = resolveR32Placeholder(m.home, standings, top8ByMatch);
    const away = resolveR32Placeholder(m.away, standings, top8ByMatch);
    if (home && away) resolved[m.id] = { home, away };
  }

  // R16, QF, SF, 3rd, Final — resolve in stage order so each stage's
  // results can feed the next.
  const knockoutOrder = ['r16-', 'qf-', 'sf-', '3rd', 'final'];
  for (const prefix of knockoutOrder) {
    for (const m of WORLD_CUP_MATCHES.filter((x) =>
      x.isKnockout && (x.id.startsWith(prefix) || x.id === prefix),
    )) {
      if (resolved[m.id]) continue;
      const home = lookupKnockoutResult(m.home, resolved, matchResults);
      const away = lookupKnockoutResult(m.away, resolved, matchResults);
      if (home && away) resolved[m.id] = { home, away };
    }
  }

  return { resolved, allGroupsComplete, errors };
}

// Per-side real Round-of-32 resolution for progressive reseeding (the
// knockout-real-reseed feature). Each R32 slot's home/away resolves
// INDEPENDENTLY: a direct-position side ("1st/2nd Group X") becomes real the
// moment that group COMPLETES; a third-place side resolves only once ALL
// groups complete (Annexe C). Unresolved sides come back null with *Real:false
// so the client keeps the user's predicted team there.
// Returns { allGroupsComplete, groupsComplete:[letters], r32: { matchId:
// { home, away, homeReal, awayReal } } }. Reuses resolveR32Placeholder (which
// already gates direct positions on isGroupComplete) so it can never show a
// not-yet-final group leader.
export function resolveActualR32(matchResults) {
  const standings = buildGroupStandings(matchResults || {});
  const groupsComplete = GROUP_LETTERS.filter((l) => isGroupComplete(standings, l));
  const allGroupsComplete = groupsComplete.length === GROUP_LETTERS.length;
  let top8ByMatch = null;
  if (allGroupsComplete) {
    try { top8ByMatch = computeTop8ByMatch(standings); } catch { top8ByMatch = null; }
  }
  const r32 = {};
  for (const m of WORLD_CUP_MATCHES.filter((x) => x.id.startsWith('r32-'))) {
    const home = resolveR32Placeholder(m.home, standings, top8ByMatch);
    const away = resolveR32Placeholder(m.away, standings, top8ByMatch);
    r32[m.id] = { home: home || null, away: away || null, homeReal: !!home, awayReal: !!away };
  }
  return { allGroupsComplete, groupsComplete, r32 };
}

// ─── Quick Picks scoring inputs ───
//
// Adapter (R1) that turns /matchResults into the `actuals` shape
// calculateSimpleScore() expects:
//   { groupStandings, advancingThirds, knockoutResults }
//
//   groupStandings:  { A: ['1st','2nd','3rd','4th'], ... } — ordered team
//                    names per group. Only groups whose 3 matches are all
//                    played are included; partial groups are omitted so a
//                    half-finished group can't be mis-scored.
//   advancingThirds: array of GROUP LETTERS whose 3rd-placed team advanced
//                    to the R32 (the best 8 of 12 per Annexe C). Empty until
//                    every group is complete (Annexe C needs all 12 thirds).
//   knockoutResults: { matchId: { winnerId: <teamName> } } for every knockout
//                    fixture that has a decided result, keyed by the same
//                    matches.js ids the predictions use (r32-01 … final).
//
// Reuses buildGroupStandings + the Annexe C thirds logic + resolveActualBracket
// so this never diverges from how the live bracket itself is resolved.
// Pure: same matchResults in → same actuals out. Safe to call with partial
// results (returns whatever is known so far for partial-bracket scoring).
export function buildSimpleActuals(matchResults) {
  const results = matchResults || {};
  const standings = buildGroupStandings(results);

  // Group standings — ordered team names, only for fully-played groups.
  const groupStandings = {};
  for (const letter of GROUP_LETTERS) {
    const teams = standings[letter];
    if (teams && teams.length === 4 && teams.every((t) => t.played === 3)) {
      groupStandings[letter] = teams.map((t) => t.name);
    }
  }

  // Advancing thirds (group letters) — only once all 12 groups are done,
  // because Annexe C ranks all 12 third-placed teams against each other.
  let advancingThirds = [];
  const allGroupsComplete = GROUP_LETTERS.every((l) => groupStandings[l]);
  if (allGroupsComplete) {
    const allGroups = buildAllGroupsForAnnexeC(standings);
    const thirds = GROUP_LETTERS
      .map((l) => allGroups[l]?.[2])
      .filter(Boolean);
    // Same cross-group tiebreak order resolveActualBracket uses.
    thirds.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
      if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
      return a.group.localeCompare(b.group);
    });
    advancingThirds = thirds.slice(0, 8).map((t) => t.group);
  }

  // Knockout winners — derive the winning TEAM NAME for every knockout
  // fixture that has both its teams resolved and a decided result.
  const { resolved } = resolveActualBracket(results);
  const knockoutResults = {};
  for (const [matchId, teams] of Object.entries(resolved)) {
    const result = results[matchId];
    if (!result) continue;
    const side = determineWinnerFromResult(result);
    if (side === 'home') knockoutResults[matchId] = { winnerId: teams.home };
    else if (side === 'away') knockoutResults[matchId] = { winnerId: teams.away };
  }

  return { groupStandings, advancingThirds, knockoutResults };
}

// LIVE (provisional) group standings — like buildSimpleActuals' groupStandings
// but INCLUDES partially-played groups so a "live score" can reflect the
// CURRENT table before a group finishes. buildSimpleActuals deliberately omits
// a group until all 3 matches are played (so the official score can't be
// mis-scored mid-group); this is the opposite — it returns the current
// ordering for any group that has at least one completed match. Groups with
// no completed match are omitted (their order would be arbitrary).
//
// Returns { standings: { A: ['1st','2nd','3rd','4th'], ... }, matchesPlayed }.
export function buildLiveGroupStandings(matchResults) {
  const standings = buildGroupStandings(matchResults || {});
  const live = {};
  let matchesPlayed = 0;
  for (const letter of GROUP_LETTERS) {
    const teams = standings[letter];
    if (!teams || teams.length !== 4) continue;
    // Each completed match increments `played` for two teams, so the group's
    // match count is half the sum of per-team played counts.
    const groupPlayed = teams.reduce((s, t) => s + (t.played || 0), 0) / 2;
    if (groupPlayed > 0) {
      live[letter] = teams.map((t) => t.name);
      matchesPlayed += groupPlayed;
    }
  }
  return { standings: live, matchesPlayed };
}
