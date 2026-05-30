/**
 * Tests for the automation cron's filtering logic (B2d-2) — the high-risk
 * part: who actually gets emailed. We mirror the cron's eligibility pipeline
 * (cooldown guardrail + per-rule dedup + cap) and assert it against fixtures,
 * since the handler itself is I/O-bound on Firestore.
 *
 * Keep in sync with api/cron/outreach-automation.js.
 */

import { describe, test, expect } from 'vitest';

const DAY = 86400000;

// Mirror of the cron's per-rule eligibility computation.
function eligibleTargets({ segmentUserIds, lastSentByUser, alreadyByRule, cooldownDays, maxPerRun, globalBudget, now }) {
  const cutoff = now - Math.max(1, cooldownDays) * DAY;
  const eligible = segmentUserIds.filter((uid) =>
    !alreadyByRule.has(uid) && !(lastSentByUser[uid] && lastSentByUser[uid] >= cutoff));
  const cap = Math.max(1, Math.min(1000, maxPerRun || 200));
  return eligible.slice(0, Math.min(cap, globalBudget));
}

const now = 1_700_000_000_000;

describe('automation cron eligibility (B2d-2)', () => {
  test('excludes users emailed within the cooldown window', () => {
    const targets = eligibleTargets({
      segmentUserIds: ['fresh', 'recent', 'old'],
      lastSentByUser: { recent: now - 1 * DAY, old: now - 10 * DAY },
      alreadyByRule: new Set(),
      cooldownDays: 3, maxPerRun: 100, globalBudget: 100, now,
    });
    // 'recent' (1 day ago) excluded; 'old' (10 days) + 'fresh' (never) ok.
    expect(targets.sort()).toEqual(['fresh', 'old']);
  });

  test('excludes users this rule already emailed (per-rule dedup)', () => {
    const targets = eligibleTargets({
      segmentUserIds: ['a', 'b', 'c'],
      lastSentByUser: {},
      alreadyByRule: new Set(['b']),
      cooldownDays: 3, maxPerRun: 100, globalBudget: 100, now,
    });
    expect(targets.sort()).toEqual(['a', 'c']);
  });

  test('caps at maxPerRun', () => {
    const seg = Array.from({ length: 50 }, (_, i) => `u${i}`);
    const targets = eligibleTargets({
      segmentUserIds: seg, lastSentByUser: {}, alreadyByRule: new Set(),
      cooldownDays: 3, maxPerRun: 10, globalBudget: 100, now,
    });
    expect(targets.length).toBe(10);
  });

  test('respects the global per-invocation budget below the rule cap', () => {
    const seg = Array.from({ length: 50 }, (_, i) => `u${i}`);
    const targets = eligibleTargets({
      segmentUserIds: seg, lastSentByUser: {}, alreadyByRule: new Set(),
      cooldownDays: 3, maxPerRun: 40, globalBudget: 5, now,
    });
    expect(targets.length).toBe(5);
  });

  test('cooldown boundary: exactly at the cutoff is still excluded', () => {
    const targets = eligibleTargets({
      segmentUserIds: ['edge'],
      lastSentByUser: { edge: now - 3 * DAY }, // exactly 3 days
      alreadyByRule: new Set(),
      cooldownDays: 3, maxPerRun: 100, globalBudget: 100, now,
    });
    // >= cutoff is excluded (defensive — don't re-email on the boundary).
    expect(targets).toEqual([]);
  });
});
