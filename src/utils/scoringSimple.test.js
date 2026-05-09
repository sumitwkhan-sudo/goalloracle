import { describe, it, expect } from 'vitest';
import {
  scoreGroup,
  scoreGroupStage,
  scoreBestThird,
  scoreKnockoutRound,
  scoreKnockouts,
  calculateSimpleScore,
  GROUP_STAGE_POINTS_PER_POSITION,
  GROUP_STAGE_MAX,
  BEST_THIRD_MAX,
  KNOCKOUT_POINTS_PER_PICK,
  KNOCKOUT_MAX_PER_ROUND,
  KNOCKOUT_MAX,
  TOTAL_MAX,
} from './scoringSimple';

describe('scoringSimple constants', () => {
  it('has the integer-clean ladder', () => {
    expect(GROUP_STAGE_POINTS_PER_POSITION).toEqual({ 1: 3, 2: 2, 3: 1, 4: 1 });
    expect(GROUP_STAGE_MAX).toBe(84);
    expect(BEST_THIRD_MAX).toBe(16);
    expect(KNOCKOUT_POINTS_PER_PICK).toEqual({
      roundOf32: 2, roundOf16: 3, quarterFinals: 5, semiFinals: 8, thirdPlace: 5, final: 12,
    });
    expect(KNOCKOUT_MAX_PER_ROUND).toEqual({
      roundOf32: 32, roundOf16: 24, quarterFinals: 20, semiFinals: 16, thirdPlace: 5, final: 12,
    });
    expect(KNOCKOUT_MAX).toBe(109);
    expect(TOTAL_MAX).toBe(209);
  });
});

describe('scoreGroup', () => {
  const actual = ['Brazil', 'Spain', 'Japan', 'Cameroon'];

  it('full match returns 7', () => {
    expect(scoreGroup(['Brazil', 'Spain', 'Japan', 'Cameroon'], actual)).toBe(7);
  });

  it('all wrong returns 0', () => {
    expect(scoreGroup(['Cameroon', 'Japan', 'Spain', 'Brazil'], actual)).toBe(0);
  });

  it('only 1st correct returns 3', () => {
    expect(scoreGroup(['Brazil', 'Cameroon', 'Spain', 'Japan'], actual)).toBe(3);
  });

  it('only 2nd correct returns 2', () => {
    expect(scoreGroup(['Cameroon', 'Spain', 'Brazil', 'Japan'], actual)).toBe(2);
  });

  it('3rd and 4th both correct returns 2', () => {
    expect(scoreGroup(['Spain', 'Brazil', 'Japan', 'Cameroon'], actual)).toBe(2);
  });

  it('1st + 4th correct returns 4', () => {
    expect(scoreGroup(['Brazil', 'Japan', 'Spain', 'Cameroon'], actual)).toBe(4);
  });

  it('returns 0 for malformed input', () => {
    expect(scoreGroup(null, actual)).toBe(0);
    expect(scoreGroup(['Brazil'], null)).toBe(0);
  });
});

describe('scoreBestThird', () => {
  it('all 8 correct returns 16', () => {
    expect(scoreBestThird(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toBe(16);
  });

  it('half correct returns 8', () => {
    expect(scoreBestThird(['A', 'B', 'C', 'D'], ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])).toBe(8);
  });

  it('none correct returns 0', () => {
    expect(scoreBestThird(['X', 'Y'], ['A', 'B', 'C'])).toBe(0);
  });

  it('handles malformed input', () => {
    expect(scoreBestThird(null, ['A'])).toBe(0);
    expect(scoreBestThird(['A'], null)).toBe(0);
  });
});

describe('scoreKnockoutRound', () => {
  const winners = (n) => Array.from({ length: n }, (_, i) => ({ matchId: `m${i}`, winnerId: `t${i}` }));
  const actuals = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, { winnerId: `t${i}` }]));

  it('all 16 R32 correct → 32', () => {
    expect(scoreKnockoutRound(winners(16), actuals(16), 'roundOf32')).toBe(32);
  });

  it('all 4 QF correct → 20', () => {
    expect(scoreKnockoutRound(winners(4), actuals(4), 'quarterFinals')).toBe(20);
  });

  it('final correct → 12', () => {
    expect(scoreKnockoutRound([{ matchId: 'final', winnerId: 'Brazil' }], { final: { winnerId: 'Brazil' } }, 'final')).toBe(12);
  });

  it('SF half correct → 8', () => {
    const picks = [{ matchId: 's1', winnerId: 'A' }, { matchId: 's2', winnerId: 'X' }];
    const results = { s1: { winnerId: 'A' }, s2: { winnerId: 'B' } };
    expect(scoreKnockoutRound(picks, results, 'semiFinals')).toBe(8);
  });

  it('unknown round key returns 0', () => {
    expect(scoreKnockoutRound([{ matchId: 'm0', winnerId: 't0' }], { m0: { winnerId: 't0' } }, 'finals')).toBe(0);
  });
});

describe('scoreKnockouts', () => {
  it('a perfect knockout submission totals 109', () => {
    const mk = (n, prefix) => Array.from({ length: n }, (_, i) => ({ matchId: `${prefix}${i}`, winnerId: `t${prefix}${i}` }));
    const actual = (n, prefix) => Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`${prefix}${i}`, { winnerId: `t${prefix}${i}` }]),
    );
    const knockoutPredictions = {
      roundOf32: mk(16, 'a'),
      roundOf16: mk(8, 'b'),
      quarterFinals: mk(4, 'c'),
      semiFinals: mk(2, 'd'),
      thirdPlace: mk(1, 'e'),
      final: mk(1, 'f'),
    };
    const allActuals = {
      ...actual(16, 'a'),
      ...actual(8, 'b'),
      ...actual(4, 'c'),
      ...actual(2, 'd'),
      ...actual(1, 'e'),
      ...actual(1, 'f'),
    };
    expect(scoreKnockouts(knockoutPredictions, allActuals)).toBe(109);
  });
});

describe('calculateSimpleScore', () => {
  it('a perfect submission scores 209 / 209', () => {
    const groups = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const groupPredictions = Object.fromEntries(groups.map((g) => [g, { ranking: ['t1', 't2', 't3', 't4'] }]));
    const groupStandings = Object.fromEntries(groups.map((g) => [g, ['t1', 't2', 't3', 't4']]));

    const bestThirdPicks = ['A','B','C','D','E','F','G','H'];
    const advancingThirds = ['A','B','C','D','E','F','G','H'];

    const mk = (n, prefix) => Array.from({ length: n }, (_, i) => ({ matchId: `${prefix}${i}`, winnerId: `t${prefix}${i}` }));
    const actual = (n, prefix) => Object.fromEntries(
      Array.from({ length: n }, (_, i) => [`${prefix}${i}`, { winnerId: `t${prefix}${i}` }]),
    );
    const knockoutPredictions = {
      roundOf32: mk(16, 'a'),
      roundOf16: mk(8, 'b'),
      quarterFinals: mk(4, 'c'),
      semiFinals: mk(2, 'd'),
      thirdPlace: mk(1, 'e'),
      final: mk(1, 'f'),
    };
    const knockoutResults = {
      ...actual(16, 'a'), ...actual(8, 'b'), ...actual(4, 'c'),
      ...actual(2, 'd'), ...actual(1, 'e'), ...actual(1, 'f'),
    };

    const result = calculateSimpleScore(
      { groupPredictions, bestThirdPicks, knockoutPredictions },
      { groupStandings, advancingThirds, knockoutResults },
    );
    expect(result.totalScore).toBe(209);
    expect(result.maxPossible).toBe(209);
    expect(result.totalAccuracy).toBe(1);
    expect(result.breakdown).toEqual({ groupScore: 84, bestThirdScore: 16, knockoutScore: 109 });
  });

  it('partial submission (only group stage) totals out of 84', () => {
    const groups = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const groupPredictions = Object.fromEntries(groups.map((g) => [g, { ranking: ['t1', 't2', 't3', 't4'] }]));
    const groupStandings = Object.fromEntries(groups.map((g) => [g, ['t1', 't2', 't3', 't4']]));

    const result = calculateSimpleScore(
      { groupPredictions },
      { groupStandings },
    );
    expect(result.totalScore).toBe(84);
    expect(result.maxPossible).toBe(84);
    expect(result.totalAccuracy).toBe(1);
  });
});

describe('scoreGroupStage', () => {
  it('sums correctly across multiple groups', () => {
    const predictions = {
      A: { ranking: ['Brazil', 'Spain', 'Japan', 'Cameroon'] }, // 7
      B: { ranking: ['France', 'Wrong', 'Wrong', 'Wrong'] },    // 3
    };
    const actuals = {
      A: ['Brazil', 'Spain', 'Japan', 'Cameroon'],
      B: ['France', 'Germany', 'Mexico', 'Argentina'],
    };
    expect(scoreGroupStage(predictions, actuals)).toBe(10);
  });
});
