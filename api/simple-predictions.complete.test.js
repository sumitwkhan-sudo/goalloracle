/**
 * Pure-logic verification for the server-authoritative `isComplete`
 * derivation in api/simple-predictions.js, plus the copy-path derivation
 * shared by db.js / copyToGlobal.js / admin.js applyGlobalPicksToLeague.
 *
 * These replicate the exact boolean expressions in the source (the handler
 * itself needs Firestore + auth, which the repo intentionally doesn't mock).
 * They lock in the completion rule so a future edit that drifts from the
 * leaderboard's canonical rule (api/simple-leaderboard.js:138) trips a test.
 */
import { describe, test, expect } from 'vitest';
// Import the REAL completion rule the handler uses, so this test is
// load-bearing: a drift in the source expression trips these assertions.
import { computeIsComplete, wasComplete } from './_lib/quickPicksComplete.js';

// Mirrors the handler: writePayload.isComplete = computeIsComplete(...);
// justCompleted = computedComplete && !wasComplete(mergedOld).
function computeWrite(partial, mergedOld) {
  const computedComplete = computeIsComplete(partial, mergedOld);
  const justCompleted = computedComplete && !wasComplete(mergedOld);
  return { computedComplete, justCompleted };
}

// Auto-submit gate from the handler: justCompleted && non-global league.
function fires(leagueId, justCompleted) {
  return justCompleted && leagueId !== 'global-simple' && leagueId !== 'global';
}

// db.js / copyToGlobal.js / admin.js copy-path derivation.
const copyComplete = (source) =>
  !!(source.isComplete || source.knockoutPredictions?.final?.[0]?.winnerId);

// admin repairQpComplete needsRepair guard.
const needsRepair = (data) =>
  !!(data?.knockoutPredictions?.final?.[0]?.winnerId) && data?.isComplete !== true;

const WINNER = { knockoutPredictions: { final: [{ winnerId: 'ARG' }] } };
const NO_WINNER = { knockoutPredictions: { roundOf32: [{ winnerId: 'x' }] } };

describe('server isComplete computation (POST handler)', () => {
  test('new doc, full bracket w/ final winner, no explicit flag → complete + justCompleted', () => {
    const { computedComplete, justCompleted } = computeWrite(
      { groupPredictions: {}, bestThirdPicks: [], knockoutPredictions: { final: [{ winnerId: 'ARG' }] } },
      null,
    );
    expect(computedComplete).toBe(true);
    expect(justCompleted).toBe(true);
    expect(fires('lg_friends', justCompleted)).toBe(true); // non-global auto-submits
  });

  test('new doc, copy-from-global w/ winner + isComplete:true → complete', () => {
    const { computedComplete, justCompleted } = computeWrite(
      { ...WINNER, isComplete: true },
      null,
    );
    expect(computedComplete).toBe(true);
    expect(justCompleted).toBe(true);
  });

  test('existing complete doc, partial = groupPredictions only (no knockout key) → STAYS complete, no re-trigger', () => {
    const { computedComplete, justCompleted } = computeWrite(
      { groupPredictions: { A: { ranking: ['a', 'b', 'c', 'd'] } } },
      { ...WINNER, isComplete: true },
    );
    expect(computedComplete).toBe(true);   // falls back to old knockout
    expect(justCompleted).toBe(false);     // was already complete
  });

  test('existing complete doc, partial clears final winner (knockout w/o final, isComplete:false) → incomplete', () => {
    const { computedComplete, justCompleted } = computeWrite(
      { knockoutPredictions: { roundOf32: [{ winnerId: 'x' }], final: [] }, isComplete: false },
      { ...WINNER, isComplete: true },
    );
    expect(computedComplete).toBe(false);
    expect(justCompleted).toBe(false);
  });

  test('in-progress doc, partial = groups only, never a winner → incomplete', () => {
    const { computedComplete, justCompleted } = computeWrite(
      { groupPredictions: { A: { ranking: ['a', 'b', 'c', 'd'] } } },
      { groupPredictions: {} },
    );
    expect(computedComplete).toBe(false);
    expect(justCompleted).toBe(false);
  });

  test('re-saving an already-complete bracket (winner before and after) → NO re-trigger', () => {
    const { computedComplete, justCompleted } = computeWrite(
      { ...WINNER },
      { ...WINNER, isComplete: true },
    );
    expect(computedComplete).toBe(true);
    expect(justCompleted).toBe(false);     // critical: no duplicate auto-submit
    expect(fires('lg_friends', justCompleted)).toBe(false);
  });

  test('old doc complete via winner only (stale isComplete:false) → re-save does not re-trigger', () => {
    // The exact bug class: a finished bracket stored isComplete:false.
    const { justCompleted } = computeWrite(
      { ...WINNER },
      { ...WINNER, isComplete: false }, // stale flag, but winner present
    );
    expect(justCompleted).toBe(false);     // wasComplete picks up the winner
  });

  test('global league completion does NOT auto-submit even when justCompleted', () => {
    const { justCompleted } = computeWrite({ ...WINNER }, { groupPredictions: {} });
    expect(justCompleted).toBe(true);
    expect(fires('global-simple', justCompleted)).toBe(false);
    expect(fires('global', justCompleted)).toBe(false);
  });

  test('explicit isComplete:true with no winner (3rd-place left blank) → complete', () => {
    const { computedComplete } = computeWrite(
      { knockoutPredictions: { semiFinals: [{ winnerId: 'x' }] }, isComplete: true },
      null,
    );
    expect(computedComplete).toBe(true);
  });

  test('stored isComplete:true WITHOUT a winner, unrelated edit (groups only) → STAYS complete', () => {
    // The latent case the reviewer flagged: a doc explicitly marked complete
    // but with no Final winner must not silently flip back to incomplete on a
    // later partial that touches neither the flag nor the knockout.
    const stored = { knockoutPredictions: { semiFinals: [{ winnerId: 'x' }] }, isComplete: true };
    const { computedComplete, justCompleted } = computeWrite(
      { groupPredictions: { A: { ranking: ['a', 'b', 'c', 'd'] } } },
      stored,
    );
    expect(computedComplete).toBe(true);
    expect(justCompleted).toBe(false); // was already complete
  });

  test('stored isComplete:true WITHOUT a winner, but the edit changes the knockout → re-derives', () => {
    // If the partial DOES touch the knockout, completion is re-derived from
    // it (an explicit bracket edit), not preserved.
    const stored = { knockoutPredictions: { semiFinals: [{ winnerId: 'x' }] }, isComplete: true };
    const { computedComplete } = computeWrite(
      { knockoutPredictions: { semiFinals: [] } }, // cleared, no final winner, no flag
      stored,
    );
    expect(computedComplete).toBe(false);
  });
});

describe('copy-path isComplete derivation (db.js / copyToGlobal.js / admin.js)', () => {
  test('source has winner but stale isComplete:false → derives TRUE', () => {
    expect(copyComplete({ ...WINNER, isComplete: false })).toBe(true);
  });
  test('source has explicit isComplete:true, no winner → TRUE', () => {
    expect(copyComplete({ ...NO_WINNER, isComplete: true })).toBe(true);
  });
  test('source incomplete, no winner, no flag → FALSE', () => {
    expect(copyComplete({ ...NO_WINNER })).toBe(false);
    expect(copyComplete({})).toBe(false);
  });
});

describe('repairQpComplete needsRepair guard', () => {
  test('winner present + isComplete !== true → repair', () => {
    expect(needsRepair({ ...WINNER, isComplete: false })).toBe(true);
    expect(needsRepair({ ...WINNER })).toBe(true); // undefined flag
  });
  test('never repairs an incomplete bracket (no final winner)', () => {
    expect(needsRepair({ ...NO_WINNER, isComplete: false })).toBe(false);
    expect(needsRepair({})).toBe(false);
    expect(needsRepair({ knockoutPredictions: { final: [{ loserId: 'x' }] } })).toBe(false);
  });
  test('idempotent: already-correct doc (winner + isComplete:true) is skipped', () => {
    expect(needsRepair({ ...WINNER, isComplete: true })).toBe(false);
  });
});
