/**
 * Regression tests for the Quick Picks leaderboard ranking order (R3).
 *
 * The leaderboard ranks by TOTAL POINTS (highest wins), then time of
 * submission (earliest wins), then alphabetical. This guards the prize
 * contest ordering, so the comparator is mirrored here and asserted
 * directly — including the equal-points/equal-time case where a bare
 * `a-b` subtraction would short-circuit before the alphabetical fallback.
 *
 * Keep this in sync with the sort in api/simple-leaderboard.js.
 */

import { describe, test, expect } from 'vitest';

function leaderboardCmp(a, b) {
  if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
  if (a.hasSubmitted !== b.hasSubmitted) return b.hasSubmitted ? 1 : -1;
  if (a.submittedAt && b.submittedAt && a.submittedAt !== b.submittedAt) {
    return a.submittedAt - b.submittedAt;
  }
  if (a.submittedAt && !b.submittedAt) return -1;
  if (b.submittedAt && !a.submittedAt) return 1;
  return a.displayName.localeCompare(b.displayName);
}

const row = (displayName, totalScore, submittedAt, hasSubmitted = true) =>
  ({ displayName, totalScore, submittedAt, hasSubmitted });
const order = (rows) => [...rows].sort(leaderboardCmp).map((r) => r.displayName);

describe('simple-leaderboard ranking (R3)', () => {
  test('highest points wins', () => {
    expect(order([row('Lo', 100, 5), row('Hi', 150, 9)])).toEqual(['Hi', 'Lo']);
  });

  test('equal points → earliest submission wins', () => {
    expect(order([row('Late', 120, 900), row('Early', 120, 100)])).toEqual(['Early', 'Late']);
  });

  test('equal points + equal submission time → alphabetical', () => {
    expect(order([row('Zoe', 120, 100), row('Ann', 120, 100), row('Mia', 120, 100)]))
      .toEqual(['Ann', 'Mia', 'Zoe']);
  });

  test('points outweigh submission time (late but higher still wins)', () => {
    expect(order([row('HiLate', 200, 999), row('LoEarly', 50, 1)])).toEqual(['HiLate', 'LoEarly']);
  });

  test('pre-results (all 0 points): submitted before unsubmitted, then earliest', () => {
    expect(order([
      row('NoSub', 0, null, false),
      row('SubLate', 0, 900),
      row('SubEarly', 0, 100),
    ])).toEqual(['SubEarly', 'SubLate', 'NoSub']);
  });

  test('comparator is symmetric for the equal-points/equal-time pair', () => {
    expect(leaderboardCmp(row('Bob', 120, 100), row('Ann', 120, 100))).toBeGreaterThan(0);
    expect(leaderboardCmp(row('Ann', 120, 100), row('Bob', 120, 100))).toBeLessThan(0);
  });
});
