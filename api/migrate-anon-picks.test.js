/**
 * Unit coverage for the no-login funnel's anon→real picks migration
 * (roadmap item C, phase iv). This is the highest-risk surface in the
 * feature: a wrong branch here loses the bracket a user made before signing
 * up, on a real-money prize path.
 *
 * The Firestore/auth I/O isn't mocked (repo convention), but the migration
 * DECISION — which determines migrate / skip / which-reason and the derived
 * isComplete — is extracted as a pure function and exercised exhaustively
 * here. These assertions are load-bearing: drift in the source branch logic
 * trips them.
 */
import { describe, test, expect } from 'vitest';
import { hasPicks, migrationDecision } from './_lib/anonMigration.js';

const WINNER = { knockoutPredictions: { final: [{ winnerId: 'ARG' }] } };
const GROUPS_ONLY = { groupPredictions: { A: { ranking: ['a', 'b', 'c', 'd'] } } };
const THIRDS_ONLY = { bestThirdPicks: ['x', 'y'] };
const EMPTY = { groupPredictions: {}, bestThirdPicks: [], knockoutPredictions: {} };

const ANON = 'anonUid123';
const REAL = 'realUid456';
const decide = (srcData, tgtData) =>
  migrationDecision({ anonUid: ANON, newUid: REAL, srcData, tgtData });

describe('hasPicks', () => {
  test('detects ranked groups', () => {
    expect(hasPicks(GROUPS_ONLY)).toBe(true);
  });
  test('ignores a group whose ranking is all blanks', () => {
    expect(hasPicks({ groupPredictions: { A: { ranking: [null, null, null, null] } } })).toBe(false);
  });
  test('detects best-third picks', () => {
    expect(hasPicks(THIRDS_ONLY)).toBe(true);
  });
  test('detects a non-empty knockout round', () => {
    expect(hasPicks(WINNER)).toBe(true);
  });
  test('empty / null docs have no picks', () => {
    expect(hasPicks(EMPTY)).toBe(false);
    expect(hasPicks({})).toBe(false);
    expect(hasPicks(null)).toBe(false);
  });
});

describe('migrationDecision', () => {
  test('same UID (already on the account) → skip, same_uid', () => {
    const d = migrationDecision({ anonUid: REAL, newUid: REAL, srcData: WINNER, tgtData: null });
    expect(d).toEqual({ migrate: false, reason: 'same_uid' });
  });

  test('anon session never made picks → skip, no_anon_picks', () => {
    expect(decide(EMPTY, null)).toEqual({ migrate: false, reason: 'no_anon_picks' });
    expect(decide(null, null)).toEqual({ migrate: false, reason: 'no_anon_picks' });
  });

  test('REQUIRED edge case: target account already has a bracket → skip, target_has_picks (never clobber)', () => {
    // The credential-already-in-use analog: guest made picks, then signed in
    // to an existing account that already has a Global bracket. We must NOT
    // overwrite it — and the caller surfaces this reason to the user.
    expect(decide(GROUPS_ONLY, WINNER)).toEqual({ migrate: false, reason: 'target_has_picks' });
  });

  test('target has only a submittedAt (no pick fields) → still protected', () => {
    expect(decide(GROUPS_ONLY, { submittedAt: 12345 })).toEqual({
      migrate: false,
      reason: 'target_has_picks',
    });
  });

  test('happy path: anon has picks, target empty → migrate', () => {
    const d = decide(GROUPS_ONLY, null);
    expect(d.migrate).toBe(true);
  });

  test('happy path: target exists but is blank → migrate (blank is not "has picks")', () => {
    const d = decide(WINNER, EMPTY);
    expect(d.migrate).toBe(true);
  });

  test('isComplete derives TRUE from a Final winner', () => {
    expect(decide(WINNER, null).isComplete).toBe(true);
  });

  test('isComplete derives TRUE from an explicit flag even without a winner', () => {
    expect(decide({ ...GROUPS_ONLY, isComplete: true }, null).isComplete).toBe(true);
  });

  test('isComplete is FALSE for an in-progress anon bracket (no winner, no flag)', () => {
    expect(decide(GROUPS_ONLY, null).isComplete).toBe(false);
  });
});
