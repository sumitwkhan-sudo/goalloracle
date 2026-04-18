/**
 * bracketUtils.test.js
 *
 * Unit tests for Simple Mode bracket derivation and scoring.
 */

import { describe, it, expect } from 'vitest';
import {
  ROUND_OF_32_TEMPLATE,
  deriveRoundOf32,
  deriveNextRound,
  flattenPicks,
  getDownstreamMatchIds,
  getRoundForMatchId,
  getTeamByRef,
  areGroupRankingsComplete,
  ROUND_OF_16_TEMPLATE,
} from './bracketUtils';
import {
  scoreGroup,
  scoreBestThird,
  scoreKnockouts,
  calculateSimpleScore,
  GROUP_STAGE_MAX,
  BEST_THIRD_MAX,
  KNOCKOUT_MAX,
  TOTAL_MAX,
} from './scoringSimple';
import { resolveThirdPlaceSlots } from './fifaThirdPlaceRules';

// Helpers: build a plausible full set of group rankings for test inputs
function makeRanking(g) {
  return { ranking: [`${g}1`, `${g}2`, `${g}3`, `${g}4`] };
}
function makeAllGroupPredictions() {
  const result = {};
  for (const g of ['A','B','C','D','E','F','G','H','I','J','K','L']) result[g] = makeRanking(g);
  return result;
}

describe('bracketUtils — ROUND_OF_32_TEMPLATE', () => {
  it('defines exactly 16 matches', () => {
    expect(ROUND_OF_32_TEMPLATE).toHaveLength(16);
  });

  it('uses every group letter A-L as either a 1st or 2nd slot', () => {
    const slots = ROUND_OF_32_TEMPLATE.flatMap((m) => [m.home, m.away])
      .filter((s) => !s.startsWith('THIRD_'));
    const groups = new Set(slots.map((s) => s[0]));
    expect([...groups].sort().join('')).toBe('ABCDEFGHIJKL');
  });

  it('includes 8 third-place slots referencing the fifaThirdPlaceRules IDs', () => {
    const thirds = ROUND_OF_32_TEMPLATE.flatMap((m) => [m.home, m.away])
      .filter((s) => s.startsWith('THIRD_'));
    expect(thirds).toHaveLength(8);
    for (const ref of thirds) expect(ref).toMatch(/^THIRD_r32_\d+$/);
  });
});

describe('deriveRoundOf32', () => {
  it('resolves all 16 matchups to real team names when all 12 group rankings + 8 picks provided', () => {
    const gp = makeAllGroupPredictions();
    const picks = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']; // CDEFGHIJ — in THIRD_PLACE_ANNEX_C
    const matches = deriveRoundOf32(gp, picks);
    expect(matches).toHaveLength(16);
    for (const m of matches) {
      expect(m.home).toBeTruthy();
      expect(m.away).toBeTruthy();
    }
    // r32-01: A2 vs B2
    const m1 = matches.find((m) => m.matchId === 'r32-01');
    expect(m1.home).toBe('A2');
    expect(m1.away).toBe('B2');
    // r32-07: A1 vs 3rd place (should be C/E/F/H/I since THIRD_r32_07 eligibility = CEFHI)
    const m7 = matches.find((m) => m.matchId === 'r32-07');
    expect(m7.home).toBe('A1');
    expect(['C3','E3','F3','H3','I3']).toContain(m7.away);
  });

  it('leaves third-place slots null when fewer than 8 picks provided', () => {
    const gp = makeAllGroupPredictions();
    const matches = deriveRoundOf32(gp, ['C', 'D']);
    const m3 = matches.find((m) => m.matchId === 'r32-03'); // third-place slot
    expect(m3.away).toBeNull();
    // Fixed (non-third) slots should still resolve
    const m1 = matches.find((m) => m.matchId === 'r32-01');
    expect(m1.home).toBe('A2');
    expect(m1.away).toBe('B2');
  });

  it('returns null team names when a group has no ranking', () => {
    const gp = makeAllGroupPredictions();
    delete gp.A;
    const matches = deriveRoundOf32(gp, ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    const m1 = matches.find((m) => m.matchId === 'r32-01'); // needs A2
    expect(m1.home).toBeNull();
    expect(m1.away).toBe('B2');
  });
});

describe('deriveNextRound', () => {
  it('cascades R32 winners into R16 slots', () => {
    const r32Picks = {};
    for (const t of ROUND_OF_32_TEMPLATE) {
      r32Picks[t.matchId] = { matchId: t.matchId, winnerId: `winner-of-${t.matchId}`, loserId: `loser-of-${t.matchId}` };
    }
    const r16 = deriveNextRound(r32Picks, ROUND_OF_16_TEMPLATE);
    expect(r16).toHaveLength(8);
    // r16-02: home from r32-01 winner, away from r32-04 winner
    const m = r16.find((x) => x.matchId === 'r16-02');
    expect(m.home).toBe('winner-of-r32-01');
    expect(m.away).toBe('winner-of-r32-04');
  });

  it('leaves R16 slots null when upstream pick is missing', () => {
    const r32Picks = {
      'r32-01': { matchId: 'r32-01', winnerId: 'X', loserId: 'Y' },
      // r32-04 missing
    };
    const r16 = deriveNextRound(r32Picks, ROUND_OF_16_TEMPLATE);
    const m = r16.find((x) => x.matchId === 'r16-02');
    expect(m.home).toBe('X');
    expect(m.away).toBeNull();
  });
});

describe('getDownstreamMatchIds', () => {
  it('returns all matches whose outcome depends on a given match', () => {
    // Changing r32-01 should invalidate: r16-02, qf-01, sf-01, 3rd, final
    const downstream = new Set(getDownstreamMatchIds('r32-01'));
    expect(downstream.has('r16-02')).toBe(true);
    expect(downstream.has('qf-01')).toBe(true);
    expect(downstream.has('sf-01')).toBe(true);
    expect(downstream.has('3rd')).toBe(true);
    expect(downstream.has('final')).toBe(true);
    // Unrelated matches shouldn't be in downstream
    expect(downstream.has('r32-02')).toBe(false);
    expect(downstream.has('r16-05')).toBe(false);
  });
});

describe('helpers', () => {
  it('getRoundForMatchId maps IDs to round keys correctly', () => {
    expect(getRoundForMatchId('r32-07')).toBe('roundOf32');
    expect(getRoundForMatchId('r16-03')).toBe('roundOf16');
    expect(getRoundForMatchId('qf-02')).toBe('quarterFinals');
    expect(getRoundForMatchId('sf-01')).toBe('semiFinals');
    expect(getRoundForMatchId('3rd')).toBe('thirdPlace');
    expect(getRoundForMatchId('final')).toBe('final');
    expect(getRoundForMatchId('bogus')).toBe(null);
  });

  it('getTeamByRef reads the correct position from a group ranking', () => {
    const gp = makeAllGroupPredictions();
    expect(getTeamByRef(gp, 'A1')).toBe('A1');
    expect(getTeamByRef(gp, 'C3')).toBe('C3');
    expect(getTeamByRef(gp, 'Z1')).toBe(null);
  });

  it('areGroupRankingsComplete requires 4 teams per group, all 12 groups', () => {
    const gp = makeAllGroupPredictions();
    expect(areGroupRankingsComplete(gp)).toBe(true);
    const partial = { ...gp };
    partial.A = { ranking: ['a1', 'a2', 'a3', null] };
    expect(areGroupRankingsComplete(partial)).toBe(false);
  });

  it('flattenPicks collapses the nested knockoutPredictions into a lookup', () => {
    const flat = flattenPicks({
      roundOf32: [{ matchId: 'r32-01', winnerId: 'X', loserId: 'Y' }],
      roundOf16: [{ matchId: 'r16-02', winnerId: 'X', loserId: 'Z' }],
      quarterFinals: [],
      semiFinals: [],
      thirdPlace: [],
      final: [],
    });
    expect(flat['r32-01'].winnerId).toBe('X');
    expect(flat['r16-02'].loserId).toBe('Z');
  });
});

describe('resolveThirdPlaceSlots', () => {
  it('returns a direct match from the Annex C table', () => {
    const out = resolveThirdPlaceSlots(['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    expect(out.r32_07).toBe('C');
    expect(Object.keys(out)).toHaveLength(8);
  });

  it('falls back to greedy assignment for combinations not in the table', () => {
    const out = resolveThirdPlaceSlots(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(Object.keys(out)).toHaveLength(8);
    const assigned = Object.values(out).sort().join('');
    expect(assigned).toBe('ABCDEFGH');
  });

  it('throws when given anything other than 8 groups', () => {
    expect(() => resolveThirdPlaceSlots(['A'])).toThrow();
    expect(() => resolveThirdPlaceSlots(null)).toThrow();
  });
});

describe('scoringSimple — scoreGroup partial credit', () => {
  it('gives full 3 points for a perfect group ranking', () => {
    expect(scoreGroup(['a','b','c','d'], ['a','b','c','d'])).toBe(3);
  });

  it('scores 1st and 2nd at 1 point each, 3rd and 4th at 0.5 each', () => {
    // Only 1st correct: 1
    expect(scoreGroup(['a','x','x','x'], ['a','b','c','d'])).toBe(1);
    // Only 3rd correct: 0.5
    expect(scoreGroup(['x','x','c','x'], ['a','b','c','d'])).toBe(0.5);
    // 1st + 3rd correct: 1.5
    expect(scoreGroup(['a','x','c','x'], ['a','b','c','d'])).toBe(1.5);
  });

  it('returns 0 when inputs are missing or malformed', () => {
    expect(scoreGroup(null, ['a','b','c','d'])).toBe(0);
    expect(scoreGroup(['a','b','c','d'], null)).toBe(0);
  });
});

describe('scoringSimple — end-to-end calculateSimpleScore', () => {
  it('scores a perfect full submission as 76/76 = 1.0 accuracy', () => {
    const gp = makeAllGroupPredictions();
    const standings = {};
    for (const g of Object.keys(gp)) standings[g] = gp[g].ranking;

    const allAdvancing = ['C','D','E','F','G','H','I','J'];
    const r32Picks = ROUND_OF_32_TEMPLATE.map((t) => ({ matchId: t.matchId, winnerId: `W-${t.matchId}`, loserId: `L-${t.matchId}` }));
    const actualResults = {};
    for (const p of r32Picks) actualResults[p.matchId] = { winnerId: p.winnerId };
    // Create matching knockout rounds + results
    const allRounds = {
      roundOf32: r32Picks,
      roundOf16: Array.from({ length: 8 }, (_, i) => ({ matchId: `r16-${String(i+1).padStart(2,'0')}`, winnerId: `W-r16-${i+1}`, loserId: `L-r16-${i+1}` })),
      quarterFinals: Array.from({ length: 4 }, (_, i) => ({ matchId: `qf-${String(i+1).padStart(2,'0')}`, winnerId: `W-qf-${i+1}`, loserId: `L-qf-${i+1}` })),
      semiFinals: Array.from({ length: 2 }, (_, i) => ({ matchId: `sf-${String(i+1).padStart(2,'0')}`, winnerId: `W-sf-${i+1}`, loserId: `L-sf-${i+1}` })),
      thirdPlace: [{ matchId: '3rd', winnerId: 'W-3rd', loserId: 'L-3rd' }],
      final: [{ matchId: 'final', winnerId: 'W-final', loserId: 'L-final' }],
    };
    for (const round of Object.keys(allRounds)) {
      for (const p of allRounds[round]) actualResults[p.matchId] = { winnerId: p.winnerId };
    }

    const result = calculateSimpleScore(
      { groupPredictions: gp, bestThirdPicks: allAdvancing, knockoutPredictions: allRounds },
      { groupStandings: standings, advancingThirds: allAdvancing, knockoutResults: actualResults },
    );

    expect(result.totalScore).toBe(TOTAL_MAX);
    expect(result.maxPossible).toBe(TOTAL_MAX);
    expect(result.totalAccuracy).toBe(1);
  });

  it('partial submission (only group stage) uses a smaller denominator', () => {
    const gp = makeAllGroupPredictions();
    const standings = {};
    for (const g of Object.keys(gp)) standings[g] = gp[g].ranking;

    const result = calculateSimpleScore(
      { groupPredictions: gp, bestThirdPicks: [], knockoutPredictions: {} },
      { groupStandings: standings, advancingThirds: [], knockoutResults: {} },
    );

    expect(result.sections.groupSubmitted).toBe(true);
    expect(result.sections.knockoutSubmitted).toBe(false);
    expect(result.maxPossible).toBe(GROUP_STAGE_MAX); // 36, not 76
    expect(result.totalAccuracy).toBe(1);
  });

  it('scoreBestThird awards 1 point per correct group', () => {
    expect(scoreBestThird(['A','B','C','D','E','F','G','H'], ['A','B','C','D','E','F','G','H'])).toBe(8);
    expect(scoreBestThird(['A','B'], ['A','X'])).toBe(1);
    expect(scoreBestThird([], ['A'])).toBe(0);
  });

  it('exposes sensible constants', () => {
    expect(GROUP_STAGE_MAX).toBe(36);
    expect(BEST_THIRD_MAX).toBe(8);
    expect(KNOCKOUT_MAX).toBe(32);
    expect(TOTAL_MAX).toBe(76);
  });
});
