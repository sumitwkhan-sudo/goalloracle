/**
 * scoringSimple.js
 *
 * Scoring engine for Simple Mode predictions.
 *
 * Group stage: 3 / 2 / 1 / 1 pts for 1st / 2nd / 3rd / 4th correct.
 * Best third:  2 pts per correctly picked qualifying 3rd-place group.
 * Knockouts:   per-pick weight escalates by round — 2 in R32, 3 in R16,
 *              5 in QF, 8 in SF, 5 in 3rd-place, 12 in the Final.
 *
 * Accuracy = totalScore / maxPossible. Denominator adjusts for partial
 * submissions so users who only filled the group stage can still rank.
 */

import { GROUPS, ROUND_ORDER } from './bracketUtils';

export const GROUP_STAGE_POINTS_PER_POSITION = { 1: 3, 2: 2, 3: 1, 4: 1 };
export const GROUP_STAGE_MAX_PER_GROUP = 7; // 3 + 2 + 1 + 1
export const GROUP_STAGE_MAX = GROUP_STAGE_MAX_PER_GROUP * GROUPS.length; // 84
export const BEST_THIRD_POINTS_PER_PICK = 2;
export const BEST_THIRD_MAX = 8 * BEST_THIRD_POINTS_PER_PICK; // 16

export const KNOCKOUT_POINTS_PER_PICK = {
  roundOf32: 2,
  roundOf16: 3,
  quarterFinals: 5,
  semiFinals: 8,
  thirdPlace: 5,
  final: 12,
};
const KNOCKOUT_PICKS_PER_ROUND = {
  roundOf32: 16,
  roundOf16: 8,
  quarterFinals: 4,
  semiFinals: 2,
  thirdPlace: 1,
  final: 1,
};
export const KNOCKOUT_MAX_PER_ROUND = Object.fromEntries(
  Object.entries(KNOCKOUT_PICKS_PER_ROUND).map(([r, n]) => [r, n * KNOCKOUT_POINTS_PER_PICK[r]]),
); // { roundOf32: 32, roundOf16: 24, quarterFinals: 20, semiFinals: 16, thirdPlace: 5, final: 12 }
export const KNOCKOUT_MAX = Object.values(KNOCKOUT_MAX_PER_ROUND).reduce((s, n) => s + n, 0); // 109
export const TOTAL_MAX = GROUP_STAGE_MAX + BEST_THIRD_MAX + KNOCKOUT_MAX; // 209

/**
 * Score a single group: compare predicted ranking to actual ranking.
 * Actual ranking is an ordered array [1st, 2nd, 3rd, 4th] of team names.
 */
export function scoreGroup(predictedRanking, actualRanking) {
  if (!Array.isArray(predictedRanking) || !Array.isArray(actualRanking)) return 0;
  let pts = 0;
  for (let i = 0; i < 4; i++) {
    if (!predictedRanking[i] || !actualRanking[i]) continue;
    if (predictedRanking[i] === actualRanking[i]) {
      pts += GROUP_STAGE_POINTS_PER_POSITION[i + 1] || 0;
    }
  }
  return pts;
}

/**
 * Score the group stage across all 12 groups.
 *
 * @param {Object} groupPredictions  { A: { ranking: [..] }, ... }
 * @param {Object} actualStandings   { A: ['team1','team2','team3','team4'], ... }
 */
export function scoreGroupStage(groupPredictions, actualStandings) {
  let pts = 0;
  for (const g of GROUPS) {
    const predicted = groupPredictions?.[g]?.ranking;
    const actual = actualStandings?.[g];
    if (predicted && actual) pts += scoreGroup(predicted, actual);
  }
  return pts;
}

/**
 * Score the best-third selection.
 *
 * @param {string[]} picks              Group letters the user picked.
 * @param {string[]} actualAdvancing    Group letters that actually advanced.
 */
export function scoreBestThird(picks, actualAdvancing) {
  if (!Array.isArray(picks) || !Array.isArray(actualAdvancing)) return 0;
  const actual = new Set(actualAdvancing);
  let pts = 0;
  for (const g of picks) {
    if (actual.has(g)) pts += BEST_THIRD_POINTS_PER_PICK;
  }
  return pts;
}

/**
 * Score a single round of knockouts. Each correct winner earns
 * `KNOCKOUT_POINTS_PER_PICK[roundKey]` so later rounds are worth more.
 *
 * @param {Array<{matchId,winnerId}>} predictedRound
 * @param {Object<string,{winnerId:string}>} actualResultsByMatchId
 * @param {string} roundKey  e.g. 'roundOf32', 'final'
 */
export function scoreKnockoutRound(predictedRound, actualResultsByMatchId, roundKey) {
  if (!Array.isArray(predictedRound)) return 0;
  const perPick = KNOCKOUT_POINTS_PER_PICK[roundKey] || 0;
  if (!perPick) return 0;
  let pts = 0;
  for (const pick of predictedRound) {
    if (!pick || !pick.winnerId) continue;
    const actual = actualResultsByMatchId?.[pick.matchId];
    if (actual && actual.winnerId && actual.winnerId === pick.winnerId) pts += perPick;
  }
  return pts;
}

/**
 * Score all knockout rounds that have been submitted *and* have results.
 */
export function scoreKnockouts(knockoutPredictions, actualResultsByMatchId) {
  let pts = 0;
  for (const round of ROUND_ORDER) {
    pts += scoreKnockoutRound(knockoutPredictions?.[round], actualResultsByMatchId, round);
  }
  return pts;
}

/**
 * Figure out which sections of the user's submission are "complete enough" to
 * be scored. Used to set the accuracy denominator for partial submissions.
 */
export function detectSubmittedSections(simplePrediction) {
  const groupSubmitted = Object.values(simplePrediction?.groupPredictions || {})
    .some((g) => Array.isArray(g?.ranking) && g.ranking.filter(Boolean).length === 4);
  const bestThirdSubmitted = Array.isArray(simplePrediction?.bestThirdPicks)
    && simplePrediction.bestThirdPicks.length === 8;
  const knockoutSubmitted = ROUND_ORDER.some(
    (r) => Array.isArray(simplePrediction?.knockoutPredictions?.[r])
      && simplePrediction.knockoutPredictions[r].length > 0,
  );
  return { groupSubmitted, bestThirdSubmitted, knockoutSubmitted };
}

/**
 * Full Simple Mode score calculation, including partial-submission handling.
 *
 * @param {Object} simplePrediction   /simplePredictions/{userId} document
 * @param {Object} actuals            { groupStandings, advancingThirds, knockoutResults }
 * @returns {Object}                  { totalScore, totalAccuracy, groupAccuracy,
 *                                       knockoutAccuracy, maxPossible, sections }
 */
export function calculateSimpleScore(simplePrediction, actuals) {
  const sections = detectSubmittedSections(simplePrediction);

  const groupScore = sections.groupSubmitted
    ? scoreGroupStage(simplePrediction.groupPredictions, actuals?.groupStandings)
    : 0;
  const bestThirdScore = sections.bestThirdSubmitted
    ? scoreBestThird(simplePrediction.bestThirdPicks, actuals?.advancingThirds)
    : 0;
  const knockoutScore = sections.knockoutSubmitted
    ? scoreKnockouts(simplePrediction.knockoutPredictions, actuals?.knockoutResults)
    : 0;

  const totalScore = groupScore + bestThirdScore + knockoutScore;

  // Denominator adjusts to whichever sections the user actually submitted,
  // so partial submitters still get a meaningful accuracy number.
  let maxPossible = 0;
  if (sections.groupSubmitted) maxPossible += GROUP_STAGE_MAX;
  if (sections.bestThirdSubmitted) maxPossible += BEST_THIRD_MAX;
  if (sections.knockoutSubmitted) maxPossible += KNOCKOUT_MAX;
  if (maxPossible === 0) maxPossible = TOTAL_MAX;

  const totalAccuracy = totalScore / maxPossible;

  const groupDenom = GROUP_STAGE_MAX + (sections.bestThirdSubmitted ? BEST_THIRD_MAX : 0);
  const groupAccuracy = sections.groupSubmitted && groupDenom > 0
    ? (groupScore + bestThirdScore) / groupDenom
    : 0;
  const knockoutAccuracy = sections.knockoutSubmitted
    ? knockoutScore / KNOCKOUT_MAX
    : 0;

  return {
    totalScore,
    totalAccuracy,
    groupAccuracy,
    knockoutAccuracy,
    maxPossible,
    sections,
    breakdown: { groupScore, bestThirdScore, knockoutScore },
  };
}

/**
 * Leaderboard sorter: accuracy desc, then earliest submission.
 */
export function sortSimpleLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    if ((b.totalAccuracy || 0) !== (a.totalAccuracy || 0)) {
      return (b.totalAccuracy || 0) - (a.totalAccuracy || 0);
    }
    const aTs = toMillis(a.submittedAt);
    const bTs = toMillis(b.submittedAt);
    if (aTs && bTs) return aTs - bTs;
    if (aTs) return -1;
    if (bTs) return 1;
    return 0;
  });
}

function toMillis(ts) {
  if (!ts) return null;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts.seconds) return ts.seconds * 1000;
  if (ts instanceof Date) return ts.getTime();
  return null;
}
