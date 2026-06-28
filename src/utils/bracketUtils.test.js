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
  predictedR32TeamSet,
  mergeRealRoundOf32,
  koMatchNumber,
  koSlotLabel,
} from './bracketUtils';
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

  it('throws loudly for a combination missing from the lookup (no greedy fallback)', () => {
    // Any combo absent from both annexe-c.json and the legacy 45-entry table
    // must throw. This prevents silently producing an approximate bracket that
    // disagrees with FIFA's official routing in edge cases.
    let threw = false;
    try {
      resolveThirdPlaceSlots(['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z']);
    } catch (e) {
      threw = /No Annexe C routing/i.test(e.message);
    }
    expect(threw).toBe(true);
  });

  it('throws when given anything other than 8 groups', () => {
    expect(() => resolveThirdPlaceSlots(['A'])).toThrow();
    expect(() => resolveThirdPlaceSlots(null)).toThrow();
  });
});


// ─── Knockout-real-reseed ──────────────────────────────────────────
describe('predictedR32TeamSet', () => {
  it('returns all 32 predicted R32 teams', () => {
    const set = predictedR32TeamSet(makeAllGroupPredictions(), ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']);
    expect(set.size).toBe(32);
    expect(set.has('A1')).toBe(true); // r32-07 home (Group A winner)
    expect(set.has('B2')).toBe(true); // r32-01 away (Group B runner-up)
  });
  it('is empty for an unfinished bracket', () => {
    expect(predictedR32TeamSet({}, []).size).toBe(0);
  });
});

describe('mergeRealRoundOf32', () => {
  const groups = makeAllGroupPredictions();
  const thirds = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const predicted = deriveRoundOf32(groups, thirds);
  const teamSet = predictedR32TeamSet(groups, thirds);
  const slot = (merged, id) => merged.find((m) => m.matchId === id);

  it('an undecided side goes to null (TBD), never the predicted team', () => {
    const merged = mergeRealRoundOf32(predicted, {}, teamSet);
    const r1 = slot(merged, 'r32-01');
    expect(r1.home).toBeNull();        // no real result yet → TBD, not "A2"
    expect(r1.homeReal).toBe(false);
    expect(r1.away).toBeNull();
    expect(r1.awayReal).toBe(false);
  });

  it('shows the real team on a decided side; earned ONLY if the user predicted it', () => {
    const realR32 = {
      // home decided, real team the user did NOT predict → won't score
      'r32-01': { home: 'Narnia', away: null, homeReal: true, awayReal: false },
      // home decided, real team the user DID predict → earned/scores
      'r32-02': { home: 'C1', away: null, homeReal: true, awayReal: false },
    };
    const merged = mergeRealRoundOf32(predicted, realR32, teamSet);

    const r1 = slot(merged, 'r32-01');
    expect(r1.home).toBe('Narnia');
    expect(r1.homeReal).toBe(true);
    expect(r1.homeEarned).toBe(false); // not on their picks → won't score
    expect(r1.away).toBeNull();        // away undecided → TBD, not predicted
    expect(r1.awayReal).toBe(false);

    const r2 = slot(merged, 'r32-02');
    expect(r2.home).toBe('C1');
    expect(r2.homeReal).toBe(true);
    expect(r2.homeEarned).toBe(true);  // predicted this team → earned
  });

  it('a third-place side stays TBD (null) until it resolves', () => {
    // r32-03 away is a THIRD slot; with no real result it is TBD, not predicted.
    const merged = mergeRealRoundOf32(predicted, {}, teamSet);
    const r3 = slot(merged, 'r32-03');
    expect(r3.awayReal).toBe(false);
    expect(r3.away).toBeNull();
  });
});

describe('koMatchNumber + koSlotLabel', () => {
  it('numbers the 32 knockout fixtures M73–M104 by round', () => {
    expect(koMatchNumber('r32-01')).toBe(73);
    // R32 = 73–88, R16 = 89–96, QF = 97–100, SF = 101–102, 3rd/final = 103/104.
    expect(koMatchNumber('3rd')).toBe(103);
    expect(koMatchNumber('final')).toBe(104);
    const nums = ['r32-01','r16-01','qf-01','sf-01','3rd','final'].map(koMatchNumber);
    expect(nums.every((n) => n >= 73 && n <= 104)).toBe(true);
    expect(koMatchNumber('gs01')).toBeNull(); // group match → no KO number
  });

  it('humanizes slot placeholders (group position, 3rd place, feeder→match number)', () => {
    expect(koSlotLabel('r32-01').home).toBe('2nd Group A');
    expect(koSlotLabel('r32-03').home).toBe('1st Group E');
    expect(koSlotLabel('r32-03').away).toBe('3rd place (A/B/C/D/F)');
    // R16 feeder "W R32-03" → "Winner of M<num of r32-03>".
    expect(koSlotLabel('r16-01').home).toBe(`Winner of M${koMatchNumber('r32-03')}`);
    expect(koSlotLabel('3rd').home).toBe(`Loser of M${koMatchNumber('sf-01')}`);
  });
});
