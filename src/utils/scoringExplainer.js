/**
 * scoringExplainer.js
 *
 * Single source of truth for HUMAN-READABLE scoring copy. Every number is
 * derived from the live engine constants in scoringSimple.js, so the FAQ
 * (item D), the /how-it-works page, and the leaderboard explainer (item E)
 * can never drift from how scoring actually works.
 *
 * Classic Predictions is currently OFF (featureFlags.classicEnabled === false,
 * see src/utils/db.js). The active product surface is the guided bracket
 * scored by scoringSimple.js, so this module describes only that. If Classic
 * is ever re-enabled, add its rows here rather than hardcoding copy elsewhere.
 *
 * Naming: user-facing copy must NOT use the phrase "Simple Picks" (or
 * "Simple Mode"). The mode is described plainly as "the guided bracket".
 */

import { GROUPS } from './bracketUtils';
import {
  GROUP_STAGE_POINTS_PER_POSITION,
  GROUP_STAGE_MAX_PER_GROUP,
  GROUP_STAGE_MAX,
  BEST_THIRD_POINTS_PER_PICK,
  BEST_THIRD_MAX,
  KNOCKOUT_POINTS_PER_PICK,
  KNOCKOUT_MAX_PER_ROUND,
  KNOCKOUT_MAX,
  TOTAL_MAX,
} from './scoringSimple';

const GROUP_COUNT = GROUPS.length; // 12

// Per-position group points, e.g. "3 / 2 / 1 / 1".
export const GROUP_POSITION_POINTS = [1, 2, 3, 4].map(
  (pos) => GROUP_STAGE_POINTS_PER_POSITION[pos] ?? 0,
);

// Human labels + per-pick weights + max for each knockout round, in play order.
// Drives both the prose list and the at-a-glance table so they always agree.
export const KNOCKOUT_ROUND_ROWS = [
  { key: 'roundOf32', label: 'Round of 32', matches: 16 },
  { key: 'roundOf16', label: 'Round of 16', matches: 8 },
  { key: 'quarterFinals', label: 'Quarterfinals', matches: 4 },
  { key: 'semiFinals', label: 'Semifinals', matches: 2 },
  { key: 'thirdPlace', label: 'Third-Place match', matches: 1 },
  { key: 'final', label: 'Final', matches: 1 },
].map((r) => ({
  ...r,
  perPick: KNOCKOUT_POINTS_PER_PICK[r.key],
  max: KNOCKOUT_MAX_PER_ROUND[r.key],
}));

// The numbers the copy leans on, all engine-derived.
export const SCORING_FACTS = {
  groupCount: GROUP_COUNT,
  groupPositionPoints: GROUP_POSITION_POINTS, // [3,2,1,1]
  groupMaxPerGroup: GROUP_STAGE_MAX_PER_GROUP, // 7
  groupStageMax: GROUP_STAGE_MAX, // 84
  bestThirdPerPick: BEST_THIRD_POINTS_PER_PICK, // 2
  bestThirdCount: 8,
  bestThirdMax: BEST_THIRD_MAX, // 16
  knockoutRounds: KNOCKOUT_ROUND_ROWS,
  knockoutMax: KNOCKOUT_MAX, // 109
  totalMax: TOTAL_MAX, // 209
};

/**
 * Scoring explainer content used by the leaderboard panel (item E) and the
 * FAQ pages (item D). Returns an array of bullets — { label, detail } — that
 * each consumer renders as a list. Kept short and scannable on purpose: what
 * you do, and what it's worth. Numbers are engine-derived (see SCORING_FACTS).
 *
 * NOTE on ranking: the leaderboard ranks by TOTAL POINTS (most points wins);
 * accuracy is shown as a secondary stat, it is not the ranking key. Do not
 * reintroduce "ranked by accuracy" copy.
 */
export function getScoringBullets() {
  const f = SCORING_FACTS;
  const [p1, p2, p3, p4] = f.groupPositionPoints;
  return [
    {
      label: `Rank each group — up to ${f.groupStageMax} pts`,
      detail: `${p1}/${p2}/${p3}/${p4} pts per team placed in the right spot, across all ${f.groupCount} groups.`,
    },
    {
      label: `Pick the 8 best third-placed teams — up to ${f.bestThirdMax} pts`,
      detail: `${f.bestThirdPerPick} pts for each of the ${f.bestThirdCount} you get right.`,
    },
    {
      label: `Fill the knockout bracket — up to ${f.knockoutMax} pts`,
      detail: `Later rounds pay more: ${f.knockoutRounds.map((r) => `${r.label} ${r.perPick}`).join(', ')} pts per correct winner.`,
    },
    {
      label: `Most points wins (max ${f.totalMax})`,
      detail: `Accuracy — your share of available points — is shown too, but ranking is by total points. Picks lock 5 min before kickoff and auto-save until then.`,
    },
  ];
}
