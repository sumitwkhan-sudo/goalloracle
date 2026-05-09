import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  STAGES,
  STAGE_FIRST_KICKOFF_UTC,
  stageLockTimeUtc,
  isStageLocked,
  lockedSectionsInUpdate,
  stageLockState,
  stageForMatchId,
  isMatchStageLocked,
} from './stageLock';

const FIVE_MIN_MS = 5 * 60 * 1000;

// Real kickoffs computed from the matches.js schedule. If any of these
// shift, the schedule has changed and stage locks need re-checking.
const EXPECTED_KICKOFFS_UTC = {
  groupStage: Date.UTC(2026, 5, 11, 19, 0, 0),    // 2026-06-11 15:00 ET
  roundOf32: Date.UTC(2026, 5, 28, 19, 0, 0),     // 2026-06-28 15:00 ET
  roundOf16: Date.UTC(2026, 6, 4, 17, 0, 0),      // 2026-07-04 13:00 ET
  quarterFinals: Date.UTC(2026, 6, 9, 20, 0, 0),  // 2026-07-09 16:00 ET
  semiFinals: Date.UTC(2026, 6, 14, 19, 0, 0),    // 2026-07-14 15:00 ET
  thirdPlace: Date.UTC(2026, 6, 18, 21, 0, 0),    // 2026-07-18 17:00 ET
  final: Date.UTC(2026, 6, 19, 19, 0, 0),         // 2026-07-19 15:00 ET
};

describe('stageLock — kickoffs match schedule', () => {
  test.each(STAGES)('%s first-kickoff matches expected UTC', (stage) => {
    expect(STAGE_FIRST_KICKOFF_UTC[stage]).toBe(EXPECTED_KICKOFFS_UTC[stage]);
  });

  test('lock is exactly 5 minutes before first kickoff for every stage', () => {
    for (const stage of STAGES) {
      expect(stageLockTimeUtc(stage)).toBe(STAGE_FIRST_KICKOFF_UTC[stage] - FIVE_MIN_MS);
    }
  });

  test('stage lock times are in chronological order (later stages lock later)', () => {
    let prev = -Infinity;
    for (const stage of STAGES) {
      const t = stageLockTimeUtc(stage);
      expect(t, `${stage} lock should be after previous`).toBeGreaterThan(prev);
      prev = t;
    }
  });
});

describe('stageLock — isStageLocked time boundaries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('all stages unlocked 1 hour before group-stage opener', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage - 60 * 60 * 1000);
    for (const stage of STAGES) {
      expect(isStageLocked(stage), stage).toBe(false);
    }
  });

  test('groupStage locks 5 minutes before opener — not at 6 minutes', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage - 6 * 60 * 1000);
    expect(isStageLocked('groupStage')).toBe(false);
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage - 5 * 60 * 1000);
    expect(isStageLocked('groupStage')).toBe(true);
  });

  test('R32 unlocked while groupStage is locked, locks at its own time', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage + 60 * 1000);
    expect(isStageLocked('groupStage')).toBe(true);
    expect(isStageLocked('roundOf32')).toBe(false);
    expect(isStageLocked('roundOf16')).toBe(false);
  });

  test('Final stage unlocked until 5 minutes before final kickoff', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.final - 6 * 60 * 1000);
    expect(isStageLocked('final')).toBe(false);
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.final - 5 * 60 * 1000);
    expect(isStageLocked('final')).toBe(true);
  });

  test('all stages locked after final has kicked off', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.final + 60 * 60 * 1000);
    for (const stage of STAGES) {
      expect(isStageLocked(stage), stage).toBe(true);
    }
  });
});

describe('stageLock — match-id → stage mapping', () => {
  test('group-stage match IDs map to groupStage', () => {
    expect(stageForMatchId('gs01')).toBe('groupStage');
    expect(stageForMatchId('gs72')).toBe('groupStage');
  });

  test('R32 / R16 / QF / SF map to their stages', () => {
    expect(stageForMatchId('r32-01')).toBe('roundOf32');
    expect(stageForMatchId('r32-16')).toBe('roundOf32');
    expect(stageForMatchId('r16-08')).toBe('roundOf16');
    expect(stageForMatchId('qf-04')).toBe('quarterFinals');
    expect(stageForMatchId('sf-02')).toBe('semiFinals');
  });

  test('special IDs map to their own stages', () => {
    expect(stageForMatchId('3rd')).toBe('thirdPlace');
    expect(stageForMatchId('final')).toBe('final');
  });

  test('unknown IDs return null and are never locked', () => {
    expect(stageForMatchId('garbage')).toBeNull();
    expect(isMatchStageLocked('garbage')).toBe(false);
  });
});

describe('stageLock — lockedSectionsInUpdate (server enforcement)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const newDoc = null; // first save
  const filledDoc = {
    groupPredictions: { A: { ranking: ['Mexico', 'South Africa', 'South Korea', 'Czechia'] } },
    bestThirdPicks: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    knockoutPredictions: {
      roundOf32: [{ winnerId: 'Mexico' }],
      roundOf16: [{ winnerId: 'Brazil' }],
      quarterFinals: [{ winnerId: 'France' }],
      semiFinals: [{ winnerId: 'Argentina' }],
      thirdPlace: [{ winnerId: 'Spain' }],
      final: [{ winnerId: 'Brazil' }],
    },
  };

  test('first save before any stage locks: nothing is locked', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage - 60 * 60 * 1000);
    const partial = filledDoc;
    expect(lockedSectionsInUpdate(partial, newDoc)).toEqual([]);
  });

  test('updating groupPredictions AFTER opener kickoff is rejected', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage + 60 * 1000);
    const partial = {
      groupPredictions: { A: { ranking: ['Mexico', 'Czechia', 'South Africa', 'South Korea'] } },
    };
    expect(lockedSectionsInUpdate(partial, filledDoc)).toEqual(['groupPredictions']);
  });

  test('updating bestThirdPicks AFTER opener is rejected', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage + 60 * 1000);
    const partial = { bestThirdPicks: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'I'] };
    expect(lockedSectionsInUpdate(partial, filledDoc)).toEqual(['bestThirdPicks']);
  });

  test('updating R32 picks AFTER groupStage but BEFORE R32 is allowed', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.roundOf32 - 60 * 60 * 1000);
    const partial = {
      knockoutPredictions: { roundOf32: [{ winnerId: 'Argentina' }] },
    };
    expect(lockedSectionsInUpdate(partial, filledDoc)).toEqual([]);
  });

  test('updating R32 picks AFTER R32 kickoff is rejected', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.roundOf32 + 60 * 1000);
    const partial = {
      knockoutPredictions: { roundOf32: [{ winnerId: 'Argentina' }] },
    };
    expect(lockedSectionsInUpdate(partial, filledDoc)).toEqual(['knockoutPredictions.roundOf32']);
  });

  test('updating Final picks AFTER R32 (but before SF/Final) is allowed', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.roundOf32 + 60 * 1000);
    const partial = {
      knockoutPredictions: { final: [{ winnerId: 'France' }] },
    };
    expect(lockedSectionsInUpdate(partial, filledDoc)).toEqual([]);
  });

  test('mixed update touching both locked and unlocked stages flags only the locked one', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.roundOf32 + 60 * 1000);
    const partial = {
      knockoutPredictions: {
        roundOf32: [{ winnerId: 'Argentina' }], // locked
        final: [{ winnerId: 'France' }],         // unlocked
      },
    };
    expect(lockedSectionsInUpdate(partial, filledDoc)).toEqual(['knockoutPredictions.roundOf32']);
  });

  test('updating a section to the SAME value is not rejected even when locked', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.groupStage + 60 * 60 * 1000);
    const partial = {
      groupPredictions: { A: { ranking: ['Mexico', 'South Africa', 'South Korea', 'Czechia'] } },
    };
    // Same as filledDoc.groupPredictions — no-op write
    expect(lockedSectionsInUpdate(partial, filledDoc)).toEqual([]);
  });

  test('after Final stage locks, every section is frozen', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.final + 60 * 1000);
    const partial = {
      groupPredictions: { A: { ranking: ['X', 'Y', 'Z', 'W'] } },
      bestThirdPicks: ['A', 'B'],
      knockoutPredictions: {
        roundOf32: [{ winnerId: 'A' }],
        roundOf16: [{ winnerId: 'B' }],
        quarterFinals: [{ winnerId: 'C' }],
        semiFinals: [{ winnerId: 'D' }],
        thirdPlace: [{ winnerId: 'E' }],
        final: [{ winnerId: 'F' }],
      },
    };
    expect(lockedSectionsInUpdate(partial, filledDoc).sort()).toEqual([
      'bestThirdPicks',
      'groupPredictions',
      'knockoutPredictions.final',
      'knockoutPredictions.quarterFinals',
      'knockoutPredictions.roundOf16',
      'knockoutPredictions.roundOf32',
      'knockoutPredictions.semiFinals',
      'knockoutPredictions.thirdPlace',
    ]);
  });
});

describe('stageLock — stageLockState UI helper', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('returns lockedAt + lockedNow per stage', () => {
    vi.setSystemTime(EXPECTED_KICKOFFS_UTC.roundOf32 + 60 * 1000);
    const state = stageLockState();
    expect(state.groupStage.lockedNow).toBe(true);
    expect(state.roundOf32.lockedNow).toBe(true);
    expect(state.roundOf16.lockedNow).toBe(false);
    expect(state.final.lockedNow).toBe(false);
    expect(state.groupStage.lockedAt).toBe(EXPECTED_KICKOFFS_UTC.groupStage - FIVE_MIN_MS);
  });
});
