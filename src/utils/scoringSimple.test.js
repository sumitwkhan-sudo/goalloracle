import { describe, it, expect } from 'vitest';
import {
  scoreGroup,
  scoreGroupStage,
  scoreBestThird,
  scoreKnockoutRound,
  scoreKnockouts,
  calculateSimpleScore,
  predictedAdvancers,
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

  it('restrictTo: a correct winner not in the set scores 0', () => {
    const picks = [{ matchId: 'm0', winnerId: 'A' }, { matchId: 'm1', winnerId: 'B' }];
    const results = { m0: { winnerId: 'A' }, m1: { winnerId: 'B' } };
    // Only 'A' was predicted to advance → only that correct pick scores.
    expect(scoreKnockoutRound(picks, results, 'roundOf32', new Set(['A']))).toBe(2);
    // Both predicted → both score.
    expect(scoreKnockoutRound(picks, results, 'roundOf32', new Set(['A', 'B']))).toBe(4);
    // null → unrestricted (every correct pick scores).
    expect(scoreKnockoutRound(picks, results, 'roundOf32', null)).toBe(4);
  });
});

describe('predictedAdvancers', () => {
  const groupPredictions = {
    A: { ranking: ['A1', 'A2', 'A3', 'A4'] },
    B: { ranking: ['B1', 'B2', 'B3', 'B4'] },
    C: { ranking: ['C1', 'C2', 'C3', 'C4'] },
  };

  it('includes every group 1st + 2nd and only the picked thirds', () => {
    const set = predictedAdvancers(groupPredictions, ['A', 'C']);
    // 1st/2nd of all groups present.
    expect(set.has('A1')).toBe(true);
    expect(set.has('A2')).toBe(true);
    expect(set.has('B1')).toBe(true);
    expect(set.has('B2')).toBe(true);
    // Picked thirds present.
    expect(set.has('A3')).toBe(true);
    expect(set.has('C3')).toBe(true);
    // Unpicked third (B) absent; 4th-place never advances.
    expect(set.has('B3')).toBe(false);
    expect(set.has('A4')).toBe(false);
    expect(set.size).toBe(8); // 6 (1st/2nd ×3) + 2 picked thirds
  });

  it('is empty for no group predictions (knockout-only)', () => {
    expect(predictedAdvancers(undefined, undefined).size).toBe(0);
    expect(predictedAdvancers({}, []).size).toBe(0);
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
  // Build a coherent perfect bracket: every knockout winner is a team the user
  // predicted to advance (1st/2nd of every group + their 8 best-thirds), so the
  // predicted-advancers restriction never trims a correct pick.
  const GROUPS_12 = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  function perfectFixture() {
    const groupPredictions = Object.fromEntries(GROUPS_12.map((g) => [g, { ranking: [`${g}1`, `${g}2`, `${g}3`, `${g}4`] }]));
    const groupStandings = Object.fromEntries(GROUPS_12.map((g) => [g, [`${g}1`, `${g}2`, `${g}3`, `${g}4`]]));
    const bestThirdPicks = ['A','B','C','D','E','F','G','H'];
    const advancingThirds = ['A','B','C','D','E','F','G','H'];
    // 32 distinct winners, all inside predictedAdvancers (24 group 1st/2nd + 8
    // picked thirds A3..H3).
    const koWinners = [
      'A1','A2','B1','B2','C1','C2','D1','D2','E1','E2','F1','F2','G1','G2','H1','H2', // R32 (16)
      'I1','I2','J1','J2','K1','K2','L1','L2',                                         // R16 (8)
      'A3','B3','C3','D3',                                                             // QF (4)
      'E3','F3',                                                                       // SF (2)
      'G3',                                                                            // 3rd (1)
      'H3',                                                                            // Final (1)
    ];
    let idx = 0;
    const round = (n, prefix) => Array.from({ length: n }, (_, i) => ({ matchId: `${prefix}${i}`, winnerId: koWinners[idx++] }));
    const knockoutPredictions = {
      roundOf32: round(16, 'a'),
      roundOf16: round(8, 'b'),
      quarterFinals: round(4, 'c'),
      semiFinals: round(2, 'd'),
      thirdPlace: round(1, 'e'),
      final: round(1, 'f'),
    };
    const knockoutResults = {};
    for (const r of Object.values(knockoutPredictions)) for (const p of r) knockoutResults[p.matchId] = { winnerId: p.winnerId };
    return { groupPredictions, groupStandings, bestThirdPicks, advancingThirds, knockoutPredictions, knockoutResults };
  }

  it('a perfect submission scores 209 / 209', () => {
    const f = perfectFixture();
    const result = calculateSimpleScore(
      { groupPredictions: f.groupPredictions, bestThirdPicks: f.bestThirdPicks, knockoutPredictions: f.knockoutPredictions },
      { groupStandings: f.groupStandings, advancingThirds: f.advancingThirds, knockoutResults: f.knockoutResults },
    );
    expect(result.totalScore).toBe(209);
    expect(result.maxPossible).toBe(209);
    expect(result.totalAccuracy).toBe(1);
    expect(result.breakdown).toEqual({ groupScore: 84, bestThirdScore: 16, knockoutScore: 109 });
  });

  it('a CORRECT knockout pick of a team the user did NOT predict to advance scores 0', () => {
    const f = perfectFixture();
    // Swap one R32 winner to a team that actually won but was never predicted
    // to reach the knockouts (not a 1st/2nd or picked-third anywhere).
    f.knockoutPredictions.roundOf32[0] = { matchId: 'a0', winnerId: 'Outsider' };
    f.knockoutResults['a0'] = { winnerId: 'Outsider' };
    const result = calculateSimpleScore(
      { groupPredictions: f.groupPredictions, bestThirdPicks: f.bestThirdPicks, knockoutPredictions: f.knockoutPredictions },
      { groupStandings: f.groupStandings, advancingThirds: f.advancingThirds, knockoutResults: f.knockoutResults },
    );
    // Group + best-thirds untouched (84 + 16). Knockout loses exactly the 2 pts
    // for that R32 match — the correct-but-unpredicted winner scores nothing.
    expect(result.breakdown).toEqual({ groupScore: 84, bestThirdScore: 16, knockoutScore: 107 });
  });

  it('knockout-only (no group predictions) is unrestricted — every correct pick scores', () => {
    const f = perfectFixture();
    // A knockout-only league has no group/best-third predictions, so there is
    // no predicted-advancers set → no restriction. Use winners that would NOT
    // be in any predicted set to prove the filter is off.
    const koPred = {
      roundOf32: Array.from({ length: 16 }, (_, i) => ({ matchId: `a${i}`, winnerId: `Real${i}` })),
    };
    const koRes = Object.fromEntries(Object.values(koPred).flat().map((p) => [p.matchId, { winnerId: p.winnerId }]));
    const result = calculateSimpleScore(
      { knockoutPredictions: koPred },
      { knockoutResults: koRes },
    );
    expect(result.breakdown.knockoutScore).toBe(32); // 16 × 2, none trimmed
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
