/**
 * bracketSurvival.js
 *
 * Pure helpers for the dashboard "bracket survival" widget. Given a
 * user's Quick Picks knockout predictions and the live match results,
 * answer "how many of my picks are still alive?" round by round.
 *
 * Survival model:
 *   A team is "eliminated" if they played a knockout match in the
 *   actual tournament and lost. A user pick is "alive" if the team
 *   they predicted to advance hasn't been eliminated yet.
 *
 * This is an approximation — picking a team to win a specific match
 * matters less than the team simply still being in the tournament,
 * but the latter is what drives the engagement number ("Brazil's
 * still in, my R16/QF/SF/Final picks for Brazil are all alive").
 */

import { ROUND_ORDER } from './bracketUtils';

/**
 * Walk completed match results and return the set of teams that lost
 * a match. Requires matchLookup (from WORLD_CUP_MATCHES) so we can
 * map a matchId's score to actual home/away team names.
 */
export function getEliminatedTeams(matchResults, matchLookup) {
  const elim = new Set();
  if (!matchResults || !matchLookup) return elim;
  for (const [matchId, r] of Object.entries(matchResults)) {
    if (!r?.completed) continue;
    const meta = matchLookup[matchId];
    if (!meta || !meta.home || !meta.away) continue;
    const home = meta.home;
    const away = meta.away;
    if (r.homeScore > r.awayScore) elim.add(away);
    else if (r.awayScore > r.homeScore) elim.add(home);
    // Equal scores in a knockout would imply penalties — without a
    // recorded penalty winner we can't say which team is out, so we
    // leave both teams "alive" rather than guess.
  }
  return elim;
}

/**
 * Count the user's surviving picks per knockout round.
 *
 * @param {Object} knockoutPredictions  pred.knockoutPredictions
 * @param {Object} matchResults         { [matchId]: { completed, homeScore, awayScore } }
 * @param {Object} matchLookup          { [matchId]: { home, away } } — actual fixtures
 * @returns {Object} { roundOf32: { alive, total }, ... }
 */
export function computeSurvival(knockoutPredictions, matchResults, matchLookup) {
  const eliminated = getEliminatedTeams(matchResults, matchLookup);
  const out = {};
  for (const round of ROUND_ORDER) {
    const slots = Array.isArray(knockoutPredictions?.[round]) ? knockoutPredictions[round] : [];
    let alive = 0;
    let total = 0;
    for (const slot of slots) {
      if (!slot?.winnerId) continue;
      total++;
      if (!eliminated.has(slot.winnerId)) alive++;
    }
    out[round] = { alive, total };
  }
  return out;
}

/**
 * Convenience: returns true if no completed matches exist yet (used
 * to flip the survival card into pre-tournament copy).
 */
export function isPreTournament(matchResults) {
  if (!matchResults) return true;
  return !Object.values(matchResults).some((r) => r?.completed);
}
