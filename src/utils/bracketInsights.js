/**
 * bracketInsights — pure helpers that compute one-line bracket insights
 * (biggest upset, etc.) from a user's knockout predictions.
 *
 * Lifted out of BracketInsightsRow.jsx so the share modal can reuse the
 * same logic without dragging in JSX. Don't add UI here.
 */

import { getRank } from '../data/fifaRankings';

const ROUND_DEPTH = {
  roundOf32: 1, roundOf16: 2, quarterFinals: 3,
  semiFinals: 4, thirdPlace: 4, final: 5,
};

const ROUND_LABEL = {
  roundOf32: 'R32', roundOf16: 'R16',
  quarterFinals: 'QF', semiFinals: 'SF',
  thirdPlace: '3rd-place', final: 'the Final',
};

/**
 * Returns the lowest-FIFA-ranked team the user picked to advance the
 * furthest, scored by `rank * round_depth`. Teams ranked top 16 are
 * skipped — those are the favorites and not "upsets" in any meaningful
 * sense. Returns null when no qualifying upset exists.
 *
 * @param {Object} knockoutPredictions  { roundOf32: [{winnerId,...}], ... }
 * @returns {{team:string, rank:number, round:string, score:number} | null}
 */
export function biggestUpset(knockoutPredictions) {
  if (!knockoutPredictions) return null;
  let best = null;
  for (const round of Object.keys(ROUND_DEPTH)) {
    const picks = knockoutPredictions[round] || [];
    for (const p of picks) {
      if (!p?.winnerId) continue;
      const rank = getRank(p.winnerId);
      if (!rank || rank <= 16) continue;
      const score = rank * ROUND_DEPTH[round];
      if (!best || score > best.score) {
        best = { team: p.winnerId, rank, round, score };
      }
    }
  }
  return best;
}

export const ROUND_LABELS = ROUND_LABEL;
