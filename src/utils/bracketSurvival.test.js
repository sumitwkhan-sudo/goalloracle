import { describe, it, expect } from 'vitest';
import { getEliminatedTeams, computeSurvival, isPreTournament } from './bracketSurvival';

const FIXTURE_LOOKUP = {
  'r32-01': { home: 'Brazil',    away: 'Mexico'   },
  'r32-02': { home: 'Argentina', away: 'Saudi Arabia' },
  'r16-01': { home: 'Brazil',    away: 'Argentina' }, // assumes both win their R32
  'qf-01':  { home: 'Brazil',    away: 'Spain'   },
};

const FULL_PRED = {
  knockoutPredictions: {
    roundOf32: [
      { matchId: 'r32-01', winnerId: 'Brazil',    loserId: 'Mexico'   },
      { matchId: 'r32-02', winnerId: 'Argentina', loserId: 'Saudi Arabia' },
    ],
    roundOf16: [
      { matchId: 'r16-01', winnerId: 'Brazil',    loserId: 'Argentina' },
    ],
    quarterFinals: [
      { matchId: 'qf-01',  winnerId: 'Brazil',    loserId: 'Spain'    },
    ],
    semiFinals: [],
    thirdPlace: [],
    final: [],
  },
};

describe('getEliminatedTeams', () => {
  it('returns empty set when no results recorded', () => {
    expect(getEliminatedTeams({}, FIXTURE_LOOKUP).size).toBe(0);
  });

  it('marks the losing side from a completed result', () => {
    const results = {
      'r32-01': { completed: true, homeScore: 2, awayScore: 1 }, // Brazil beats Mexico
    };
    const elim = getEliminatedTeams(results, FIXTURE_LOOKUP);
    expect(elim.has('Mexico')).toBe(true);
    expect(elim.has('Brazil')).toBe(false);
  });

  it('ignores incomplete results', () => {
    const results = {
      'r32-01': { completed: false, homeScore: 2, awayScore: 1 },
    };
    expect(getEliminatedTeams(results, FIXTURE_LOOKUP).size).toBe(0);
  });

  it('treats tied scores without a recorded penalty winner as no-elimination', () => {
    const results = {
      'r32-01': { completed: true, homeScore: 1, awayScore: 1 },
    };
    expect(getEliminatedTeams(results, FIXTURE_LOOKUP).size).toBe(0);
  });

  it('handles unknown matchIds gracefully', () => {
    const results = {
      'unknown-match': { completed: true, homeScore: 2, awayScore: 0 },
    };
    expect(getEliminatedTeams(results, FIXTURE_LOOKUP).size).toBe(0);
  });
});

describe('computeSurvival', () => {
  it('reports full counts before the tournament starts', () => {
    const out = computeSurvival(FULL_PRED.knockoutPredictions, {}, FIXTURE_LOOKUP);
    expect(out.roundOf32).toEqual({ alive: 2, total: 2 });
    expect(out.roundOf16).toEqual({ alive: 1, total: 1 });
    expect(out.quarterFinals).toEqual({ alive: 1, total: 1 });
    expect(out.semiFinals).toEqual({ alive: 0, total: 0 });
  });

  it('keeps a round alive when the user picked the actual winner', () => {
    const results = {
      'r32-01': { completed: true, homeScore: 2, awayScore: 0 }, // Brazil wins
    };
    const out = computeSurvival(FULL_PRED.knockoutPredictions, results, FIXTURE_LOOKUP);
    expect(out.roundOf32.alive).toBe(2); // both picks still alive
  });

  it('decrements every downstream round when a picked team is eliminated', () => {
    const results = {
      // Brazil loses in R32 — affects R32, R16, QF picks for Brazil
      'r32-01': { completed: true, homeScore: 0, awayScore: 1 },
    };
    const out = computeSurvival(FULL_PRED.knockoutPredictions, results, FIXTURE_LOOKUP);
    expect(out.roundOf32).toEqual({ alive: 1, total: 2 });   // Brazil pick dead, Argentina pick alive
    expect(out.roundOf16).toEqual({ alive: 0, total: 1 });   // Brazil dead → R16 pick dead
    expect(out.quarterFinals).toEqual({ alive: 0, total: 1 }); // Brazil dead → QF pick dead
  });

  it('handles missing knockoutPredictions gracefully', () => {
    const out = computeSurvival(null, {}, FIXTURE_LOOKUP);
    for (const r of ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final']) {
      expect(out[r]).toEqual({ alive: 0, total: 0 });
    }
  });

  it('skips slots without a winnerId from totals', () => {
    const partial = {
      knockoutPredictions: {
        roundOf32: [
          { matchId: 'r32-01', winnerId: 'Brazil' },
          { matchId: 'r32-02' }, // no winnerId picked
        ],
      },
    };
    const out = computeSurvival(partial.knockoutPredictions, {}, FIXTURE_LOOKUP);
    expect(out.roundOf32).toEqual({ alive: 1, total: 1 });
  });
});

describe('isPreTournament', () => {
  it('is true when no matches are completed', () => {
    expect(isPreTournament({})).toBe(true);
    expect(isPreTournament({ 'r32-01': { completed: false, homeScore: 0, awayScore: 0 } })).toBe(true);
  });

  it('is false when at least one match is completed', () => {
    expect(isPreTournament({ 'r32-01': { completed: true, homeScore: 1, awayScore: 0 } })).toBe(false);
  });

  it('is true for null or undefined input', () => {
    expect(isPreTournament(null)).toBe(true);
    expect(isPreTournament(undefined)).toBe(true);
  });
});
