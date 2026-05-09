/**
 * bracketResolver.js — server-side bracket state from accumulated match
 * results. Lets the auto-poll cron look up knockout matches by actual
 * team name once they're determined, instead of skipping them while
 * placeholders ("W R32-01", "1st Group A") remain in matches.js.
 *
 * Flow:
 *   1. Convert matchResults → predictions shape (so bracket.js can reuse
 *      its existing calcGroupStandings).
 *   2. If all 12 groups have completed all 6 matches, run thirdPlaceAllocation
 *      to resolve which 3rd-place team plays which R32 slot via Annexe C.
 *   3. Walk WORLD_CUP_MATCHES forward, resolving placeholders against the
 *      computed standings + accumulated knockout results.
 *
 * Returns a partial bracket map: { matchId: { home, away } }. Matches that
 * can't be resolved yet (their predecessor isn't done) simply don't appear
 * in the map — the caller treats absence as "skip for now, retry later".
 */

import { calcGroupStandings } from '../../src/utils/bracket.js';
import {
  GROUP_LETTERS,
  allocateThirdsToBrackets,
} from '../../src/utils/thirdPlaceAllocation.js';
import { determineWinnerFromResult } from './oracleParsers.js';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';

// matches.js R32 third-place slot id ↔ FIFA Annexe C M-id.
const M_TO_R32_ID = {
  M74: 'r32-03', M77: 'r32-06', M79: 'r32-07', M80: 'r32-08',
  M81: 'r32-09', M82: 'r32-10', M85: 'r32-14', M87: 'r32-16',
};

// Group of 5 letters → which R32 match the 3rd-placed team plays in.
// Keyed by the 5 letters in the matches.js placeholder string ("3rd ABCDF").
const ELIGIBILITY_TO_R32_ID = {
  ABCDF: 'r32-03', CDFGH: 'r32-06', CEFHI: 'r32-07', EHIJK: 'r32-08',
  BEFIJ: 'r32-09', AEHIJ: 'r32-10', EFGIJ: 'r32-14', DEIJL: 'r32-16',
};

function resultsToPredictions(matchResults) {
  const predictions = {};
  for (const [matchId, r] of Object.entries(matchResults || {})) {
    if (!r || r.completed !== true) continue;
    if (typeof r.homeScore !== 'number' || typeof r.awayScore !== 'number') continue;
    predictions[matchId] = {
      score: { home: String(r.homeScore), away: String(r.awayScore) },
    };
  }
  return predictions;
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

function isGroupComplete(standings, letter) {
  const teams = standings[letter];
  if (!teams || teams.length !== 4) return false;
  return teams.every((t) => t.played === 3);
}

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
    // Third-placed team allocation requires ALL 12 groups to be complete
    // (top8ByMatch is only computed when allGroupsComplete is true).
    const eligibility = m3[1].toUpperCase().split('').sort().join('');
    const r32Id = ELIGIBILITY_TO_R32_ID[eligibility];
    if (r32Id && top8ByMatch && top8ByMatch[r32Id]) return top8ByMatch[r32Id];
  }
  return null;
}

// Map from matches.js id ('r32-01') back to the W/L reference syntax
// other matches use ("W R32-01") so we can quickly look up.
function lookupKnockoutResult(label, resolved, matchResults) {
  if (!label) return null;
  const w = label.match(/^W (R32|R16|QF|SF)-?0*(\d+)$/i);
  if (w) {
    const stage = w[1].toLowerCase();
    const num = String(w[2]).padStart(2, '0');
    const lookupId = `${stage}-${num}`; // r32-01, r16-02, qf-03, sf-04
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

/**
 * Resolve as much of the bracket as the current matchResults allow.
 *
 * @param {object} matchResults  Map of matchId → matchResult document.
 * @returns {{ resolved: Object, allGroupsComplete: boolean, errors: string[] }}
 *   resolved          — { matchId: { home, away } } for every knockout
 *                       match whose teams are now known.
 *   allGroupsComplete — true iff every group has all 6 matches verified.
 *   errors            — non-fatal issues encountered (e.g. Annexe C lookup
 *                       failed because the top-8 thirds combo is malformed).
 */
export function resolveActualBracket(matchResults) {
  const errors = [];
  const predictions = resultsToPredictions(matchResults);
  const standings = calcGroupStandings(predictions);

  const allGroupsComplete = GROUP_LETTERS.every((letter) => {
    const teams = standings[letter];
    if (!teams || teams.length !== 4) return false;
    return teams.every((t) => t.played === 3);
  });

  let top8ByMatch = null;
  if (allGroupsComplete) {
    try {
      const allGroups = buildAllGroupsForAnnexeC(standings);
      const thirds = GROUP_LETTERS
        .map((l) => allGroups[l]?.[2])
        .filter(Boolean);
      thirds.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;
        if (b.goalDifference !== a.goalDifference) return b.goalDifference - a.goalDifference;
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        return a.group.localeCompare(b.group);
      });
      const top8 = thirds.slice(0, 8);
      const allocation = allocateThirdsToBrackets(top8, allGroups);
      // allocation is { 'M74': teamObj, 'M77': teamObj, ... }
      top8ByMatch = {};
      for (const [mId, teamObj] of Object.entries(allocation)) {
        const r32Id = M_TO_R32_ID[mId];
        if (r32Id) top8ByMatch[r32Id] = teamObj.teamId;
      }
    } catch (e) {
      errors.push(`Annexe C lookup failed: ${e.message}`);
    }
  }

  const resolved = {};

  // R32: home is "1st/2nd Group X", away is "1st/2nd Group X" or "3rd ABCDF".
  for (const m of WORLD_CUP_MATCHES.filter((x) => x.id.startsWith('r32-'))) {
    const home = resolveR32Placeholder(m.home, standings, top8ByMatch);
    const away = resolveR32Placeholder(m.away, standings, top8ByMatch);
    if (home && away) resolved[m.id] = { home, away };
  }

  // R16, QF, SF, 3rd, Final — resolved by walking forward in stage order.
  // Order matters: R16 depends on R32, QF on R16, SF on QF, 3rd/Final on SF.
  const knockoutOrder = ['r16-', 'qf-', 'sf-', '3rd', 'final'];
  for (const prefix of knockoutOrder) {
    for (const m of WORLD_CUP_MATCHES.filter((x) => x.isKnockout && (x.id.startsWith(prefix) || x.id === prefix))) {
      if (resolved[m.id]) continue;
      const home = lookupKnockoutResult(m.home, resolved, matchResults);
      const away = lookupKnockoutResult(m.away, resolved, matchResults);
      if (home && away) resolved[m.id] = { home, away };
    }
  }

  return { resolved, allGroupsComplete, errors };
}
