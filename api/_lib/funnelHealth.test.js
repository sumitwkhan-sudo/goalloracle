/**
 * Pure-logic coverage for the funnel-health monitoring helpers (item C).
 * Firebase-free, so the date bucketing + status thresholds are testable
 * without Firestore. The endpoints (admin.js / migrate-anon-picks.js /
 * client-log.js) do the actual counter I/O with these helpers.
 */
import { describe, test, expect } from 'vitest';
import {
  dayId,
  recentDayIds,
  blankDay,
  computeHealthStatus,
  sumOutcomes,
  normalizeAuthCode,
  normalizeStep,
  WATCH_THRESHOLDS,
  MIGRATION_OUTCOMES,
} from './funnelHealth.js';

describe('dayId / recentDayIds', () => {
  test('dayId is the UTC YYYY-MM-DD bucket', () => {
    expect(dayId(new Date('2026-06-07T23:30:00Z'))).toBe('2026-06-07');
    expect(dayId(new Date('2026-06-07T00:00:00Z'))).toBe('2026-06-07');
  });
  test('recentDayIds returns N ids newest-first, contiguous', () => {
    const ids = recentDayIds(3, new Date('2026-06-07T12:00:00Z'));
    expect(ids).toEqual(['2026-06-07', '2026-06-06', '2026-06-05']);
  });
});

describe('blankDay', () => {
  test('zeroes every migration outcome', () => {
    const d = blankDay('2026-06-07');
    for (const k of MIGRATION_OUTCOMES) expect(d.migration[k]).toBe(0);
    expect(d.authCustomToken.total).toBe(0);
  });
});

describe('computeHealthStatus', () => {
  const day = (over = {}) => ({ ...blankDay('2026-06-07'), ...over });

  test('all-zero today → ok', () => {
    expect(computeHealthStatus([blankDay('2026-06-07')])).toEqual({ status: 'ok', reasons: [] });
  });

  test('a migration error today → watch', () => {
    const r = computeHealthStatus([day({ migration: { ...blankDay('').migration, error: 1 } })]);
    expect(r.status).toBe('watch');
    expect(r.reasons[0]).toMatch(/migration error/i);
  });

  test('target_has_picks alone does NOT raise status (expected edge case)', () => {
    const r = computeHealthStatus([day({ migration: { ...blankDay('').migration, target_has_picks: 5 } })]);
    expect(r.status).toBe('ok');
    expect(r.reasons).toEqual([]);
  });

  test('custom-token errors at threshold → watch', () => {
    const at = WATCH_THRESHOLDS.authCustomTokenPerDay;
    expect(computeHealthStatus([day({ authCustomToken: { total: at } })]).status).toBe('watch');
    expect(computeHealthStatus([day({ authCustomToken: { total: at - 1 } })]).status).toBe('ok');
  });

  test('only TODAY (days[0]) drives status, not older days', () => {
    const older = day({ migration: { ...blankDay('').migration, error: 9 } });
    const today = blankDay('2026-06-07');
    expect(computeHealthStatus([today, older]).status).toBe('ok');
  });

  test('empty input is safe → ok', () => {
    expect(computeHealthStatus([]).status).toBe('ok');
    expect(computeHealthStatus(undefined).status).toBe('ok');
  });
});

describe('normalizeAuthCode / normalizeStep (bound the unauth keyspace)', () => {
  test('keeps known Firebase codes verbatim', () => {
    expect(normalizeAuthCode('auth/network-request-failed')).toBe('auth/network-request-failed');
  });
  test('buckets unknown / spoofed codes under "other"', () => {
    expect(normalizeAuthCode('auth/totally-made-up')).toBe('other');
    expect(normalizeAuthCode('x'.repeat(500))).toBe('other');
    expect(normalizeAuthCode(null)).toBe('other');
    expect(normalizeAuthCode({})).toBe('other');
  });
  test('step is limited to email/google else other', () => {
    expect(normalizeStep('email')).toBe('email');
    expect(normalizeStep('GOOGLE')).toBe('google');
    expect(normalizeStep('inject')).toBe('other');
    expect(normalizeStep(undefined)).toBe('other');
  });
});

describe('sumOutcomes', () => {
  test('sums migration + auth across days', () => {
    const days = [
      { migration: { migrated: 2, error: 1, target_has_picks: 0, no_anon_picks: 1, same_uid: 0 }, authCustomToken: { total: 3 } },
      { migration: { migrated: 1, error: 0, target_has_picks: 2, no_anon_picks: 0, same_uid: 1 }, authCustomToken: { total: 4 } },
    ];
    const t = sumOutcomes(days);
    expect(t.migration.migrated).toBe(3);
    expect(t.migration.error).toBe(1);
    expect(t.migration.target_has_picks).toBe(2);
    expect(t.authCustomToken.total).toBe(7);
  });
  test('handles empty / missing fields', () => {
    expect(sumOutcomes([]).migration.migrated).toBe(0);
    expect(sumOutcomes([{}]).authCustomToken.total).toBe(0);
  });
});
