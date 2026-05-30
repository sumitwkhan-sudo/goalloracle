/**
 * Tests for the pure decision logic in copyToGlobal.js (evaluateCopy +
 * sourceHasPicks). The I/O wrapper copyUserPicksToGlobalLeague touches
 * Firestore and isn't exercised here — the repo has no Firestore mock
 * harness — but all the branching that decides create/overwrite/skip/
 * ineligible lives in the pure evaluator, which we cover fully.
 */

import { describe, test, expect } from 'vitest';
import { evaluateCopy, sourceHasPicks } from './copyToGlobalLogic.js';

// A fully-picked-ish source doc. Group stage locks at the 2026 group
// opener (11 Jun 2026); pick a "now" well before that so nothing is
// locked unless a test overrides it.
const NOW_UNLOCKED = Date.UTC(2026, 4, 1); // May 1, 2026
const NOW_LOCKED = Date.UTC(2026, 6, 1);   // Jul 1, 2026 (group stage long locked)

const fullSource = () => ({
  groupPredictions: { A: { ranking: ['x', 'y', 'z', 'w'] } },
  bestThirdPicks: ['x'],
  knockoutPredictions: { roundOf32: [{ matchId: 'r32_01', winnerId: 'x' }] },
  isComplete: true,
});

describe('sourceHasPicks', () => {
  test('false for null / empty', () => {
    expect(sourceHasPicks(null)).toBe(false);
    expect(sourceHasPicks({})).toBe(false);
    expect(sourceHasPicks({ groupPredictions: {}, bestThirdPicks: [], knockoutPredictions: {} })).toBe(false);
  });
  test('true when any section has content', () => {
    expect(sourceHasPicks({ bestThirdPicks: ['x'] })).toBe(true);
    expect(sourceHasPicks({ groupPredictions: { A: { ranking: ['a', 'b', 'c', 'd'] } } })).toBe(true);
    expect(sourceHasPicks({ knockoutPredictions: { final: [{ winnerId: 'x' }] } })).toBe(true);
  });
});

describe('evaluateCopy', () => {
  test('no source picks → ineligible', () => {
    expect(evaluateCopy({ sourceDoc: null, now: NOW_UNLOCKED })).toEqual({ action: 'ineligible', reason: 'no_source_picks' });
    expect(evaluateCopy({ sourceDoc: {}, now: NOW_UNLOCKED }).reason).toBe('no_source_picks');
  });

  test('classic source league → incompatible_format', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), sourceLeague: { predictionMode: 'classic' }, now: NOW_UNLOCKED });
    expect(r).toEqual({ action: 'ineligible', reason: 'incompatible_format' });
  });

  test('no target entry, nothing locked → create', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), sourceLeague: { predictionMode: 'simple' }, targetDoc: null, now: NOW_UNLOCKED });
    expect(r).toEqual({ action: 'create' });
  });

  test('existing global entry, skip mode → skip', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), targetDoc: { bestThirdPicks: ['q'] }, mode: 'skip', now: NOW_UNLOCKED });
    expect(r).toEqual({ action: 'skip', reason: 'existing_global_entry' });
  });

  test('existing global entry detected via submittedAt alone → skip', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), targetDoc: { submittedAt: { _seconds: 1 } }, mode: 'skip', now: NOW_UNLOCKED });
    expect(r.action).toBe('skip');
  });

  test('existing global entry, overwrite mode, nothing locked → overwrite', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), targetDoc: { bestThirdPicks: ['q'] }, mode: 'overwrite', now: NOW_UNLOCKED });
    expect(r).toEqual({ action: 'overwrite' });
  });

  test('group stage locked → ineligible stage_locked with sections', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), sourceLeague: { predictionMode: 'simple' }, targetDoc: null, now: NOW_LOCKED });
    expect(r.action).toBe('ineligible');
    expect(r.reason).toBe('stage_locked');
    expect(Array.isArray(r.lockedSections)).toBe(true);
    expect(r.lockedSections).toContain('groupPredictions');
  });

  test('skip takes precedence over a lock check (no write attempted)', () => {
    // Even post-lock, if they already have a global entry and mode=skip,
    // we short-circuit to skip rather than evaluating locks.
    const r = evaluateCopy({ sourceDoc: fullSource(), targetDoc: { bestThirdPicks: ['q'] }, mode: 'skip', now: NOW_LOCKED });
    expect(r.action).toBe('skip');
  });
});

// Reverse direction (admin "apply global picks to a league"): source =
// global bracket, target = the chosen league, mode always 'skip'. These
// pin the exact decisions the admin action maps to applied/skipped+reason.
describe('apply-global-picks-to-league decisions', () => {
  test('member has NO league picks + has global picks → create (applied)', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), sourceLeague: { predictionMode: 'simple' }, targetDoc: null, mode: 'skip', now: NOW_UNLOCKED });
    expect(r.action).toBe('create');
  });

  test('member ALREADY has league picks → skip (never overwrite)', () => {
    const r = evaluateCopy({ sourceDoc: fullSource(), sourceLeague: { predictionMode: 'simple' }, targetDoc: { bestThirdPicks: ['q'] }, mode: 'skip', now: NOW_UNLOCKED });
    expect(r.action).toBe('skip');
    expect(r.reason).toBe('existing_global_entry'); // → 'already_has_picks'
  });

  test('member has NO global picks to copy → ineligible (skip + flag)', () => {
    const r = evaluateCopy({ sourceDoc: null, sourceLeague: { predictionMode: 'simple' }, targetDoc: null, mode: 'skip', now: NOW_UNLOCKED });
    expect(r.action).toBe('ineligible');
    expect(r.reason).toBe('no_source_picks'); // → 'no_global_picks'
  });
});
