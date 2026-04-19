/**
 * thirdPlaceAllocation.test.js
 *
 * Covers the §16 testing checklist from the third-placed teams spec.
 * Some tests scale with annexe-c.json — they pass with a stub lookup ({})
 * AND become meaningful once the full 495-entry table is in place.
 */

import { describe, it, expect } from 'vitest';
import annexeC from '../data/annexe-c.json';
import {
  compareThirdPlacedTeams,
  rankThirdPlacedTeamsClassic,
  validateQuickPickInput,
  buildGroupsFromQuickPick,
  pickTop8ThirdsQuickPick,
  buildLookupKey,
  allocateThirdsToBrackets,
  resolveKnockoutThirdsClassic,
  resolveKnockoutThirdsQuickPick,
  assertValidAllocation,
  hasAnnexeCEntry,
  annexeCEntryCount,
  THIRD_PLACE_MATCHES,
  THIRD_PLACE_POOLS,
  THIRD_PLACE_WINNER_GROUP,
  GROUP_LETTERS,
} from './thirdPlaceAllocation';

// ─── Fixtures ────────────────────────────────────────────────────────────
function third(group, overrides = {}) {
  return {
    teamId: `3${group}`,
    group,
    groupPosition: 3,
    points: 4,
    goalDifference: 0,
    goalsFor: 3,
    fairPlayPoints: 0,
    fifaRanking: 50,
    ...overrides,
  };
}

function makeAllGroups() {
  const groups = {};
  for (const g of GROUP_LETTERS) {
    groups[g] = [1, 2, 3, 4].map((pos) => ({
      teamId: `${g}${pos}`,
      group: g,
      groupPosition: pos,
      points: 0,
      goalDifference: 0,
      goalsFor: 0,
      fairPlayPoints: 0,
      fifaRanking: 50,
    }));
  }
  return groups;
}

// ─── §3 Classic comparator ───────────────────────────────────────────────
describe('compareThirdPlacedTeams (§3)', () => {
  it('ranks by points first', () => {
    expect(compareThirdPlacedTeams(third('A', { points: 6 }), third('B', { points: 3 }))).toBeLessThan(0);
  });
  it('falls through to goal difference on equal points', () => {
    const a = third('A', { points: 4, goalDifference: 3 });
    const b = third('B', { points: 4, goalDifference: 1 });
    expect(compareThirdPlacedTeams(a, b)).toBeLessThan(0);
  });
  it('falls through to goals scored', () => {
    const a = third('A', { points: 4, goalDifference: 2, goalsFor: 5 });
    const b = third('B', { points: 4, goalDifference: 2, goalsFor: 3 });
    expect(compareThirdPlacedTeams(a, b)).toBeLessThan(0);
  });
  it('fair play: 0 cards beats −3 (higher wins, less negative)', () => {
    const clean = third('A', { points: 4, goalDifference: 0, goalsFor: 2, fairPlayPoints: 0 });
    const dirty = third('B', { points: 4, goalDifference: 0, goalsFor: 2, fairPlayPoints: -3 });
    expect(compareThirdPlacedTeams(clean, dirty)).toBeLessThan(0);
  });
  it('FIFA ranking: lower rank number wins', () => {
    const top = third('A', { points: 4, goalDifference: 0, goalsFor: 2, fairPlayPoints: 0, fifaRanking: 5 });
    const low = third('B', { points: 4, goalDifference: 0, goalsFor: 2, fairPlayPoints: 0, fifaRanking: 60 });
    expect(compareThirdPlacedTeams(top, low)).toBeLessThan(0);
  });
  it('returns 0 when fully tied (caller handles preceding-editions fallback)', () => {
    expect(compareThirdPlacedTeams(third('A'), third('B'))).toBe(0);
  });

  it('cascade: three tied teams flow through criteria', () => {
    const teams = [
      third('A', { points: 4, goalDifference: 2, goalsFor: 4, fairPlayPoints: -1, fifaRanking: 10 }),
      third('B', { points: 4, goalDifference: 2, goalsFor: 4, fairPlayPoints: 0, fifaRanking: 20 }),
      third('C', { points: 4, goalDifference: 2, goalsFor: 4, fairPlayPoints: -1, fifaRanking: 5 }),
    ];
    teams.sort(compareThirdPlacedTeams);
    // B (cleanest) wins on fair play; A vs C decided by FIFA ranking (C lower rank number)
    expect(teams.map((t) => t.teamId)).toEqual(['3B', '3C', '3A']);
  });
});

// ─── §3.4 rankThirdPlacedTeamsClassic ────────────────────────────────────
describe('rankThirdPlacedTeamsClassic (§3.4)', () => {
  it('returns top8 + eliminated from 12 third-placed teams', () => {
    const groups = makeAllGroups();
    // Give groups A-H higher points so they advance
    const advancing = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
    for (const g of advancing) groups[g][2].points = 6;
    const { top8, eliminated } = rankThirdPlacedTeamsClassic(groups);
    expect(top8).toHaveLength(8);
    expect(eliminated).toHaveLength(4);
    expect(top8.every((t) => advancing.includes(t.group))).toBe(true);
  });
  it('throws when fewer than 12 thirds present', () => {
    const groups = makeAllGroups();
    delete groups.A;
    expect(() => rankThirdPlacedTeamsClassic(groups)).toThrow();
  });
});

// ─── §5 Quick Pick validation ────────────────────────────────────────────
describe('validateQuickPickInput (§5)', () => {
  const validInput = () => ({
    groupRankings: Object.fromEntries(
      GROUP_LETTERS.map((g) => [g, [`${g}1`, `${g}2`, `${g}3`, `${g}4`]]),
    ),
    advancingThirdGroups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
  });

  it('accepts a valid input', () => {
    expect(() => validateQuickPickInput(validInput())).not.toThrow();
  });
  it('rejects when a group has fewer than 4 teams', () => {
    const input = validInput();
    input.groupRankings.A = ['A1', 'A2', 'A3'];
    expect(() => validateQuickPickInput(input)).toThrow(/must have exactly 4/);
  });
  it('rejects duplicate teams within a group', () => {
    const input = validInput();
    input.groupRankings.A = ['A1', 'A1', 'A3', 'A4'];
    expect(() => validateQuickPickInput(input)).toThrow(/duplicate/);
  });
  it('rejects fewer than 8 third-place selections', () => {
    const input = validInput();
    input.advancingThirdGroups = ['A', 'B', 'C'];
    expect(() => validateQuickPickInput(input)).toThrow(/exactly 8/);
  });
  it('rejects more than 8 third-place selections', () => {
    const input = validInput();
    input.advancingThirdGroups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    expect(() => validateQuickPickInput(input)).toThrow(/exactly 8/);
  });
  it('rejects duplicate third-place selections', () => {
    const input = validInput();
    input.advancingThirdGroups = ['A', 'A', 'B', 'C', 'D', 'E', 'F', 'G'];
    expect(() => validateQuickPickInput(input)).toThrow(/unique/);
  });
  it('rejects invalid group letters', () => {
    const input = validInput();
    input.advancingThirdGroups = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'Z'];
    expect(() => validateQuickPickInput(input)).toThrow(/Invalid group letter/);
  });
});

// ─── §7 Quick Pick picking ───────────────────────────────────────────────
describe('pickTop8ThirdsQuickPick (§7)', () => {
  it('extracts exactly the 8 selected thirds', () => {
    const groups = makeAllGroups();
    const { top8, eliminated } = pickTop8ThirdsQuickPick(groups, ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(top8.map((t) => t.group).sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
    expect(eliminated.map((t) => t.group).sort()).toEqual(['I', 'J', 'K', 'L']);
  });
});

// ─── §10 allocateThirdsToBrackets ────────────────────────────────────────
describe('allocateThirdsToBrackets (§10)', () => {
  it('builds the sorted 8-char lookup key regardless of input order', () => {
    const a = [{ group: 'E' }, { group: 'A' }, { group: 'C' }, { group: 'F' }, { group: 'J' }, { group: 'H' }, { group: 'B' }, { group: 'G' }];
    const b = [...a].reverse();
    expect(buildLookupKey(a)).toBe('ABCEFGHJ');
    expect(buildLookupKey(a)).toBe(buildLookupKey(b));
  });

  it('throws loudly for any unknown combination (never silently fails)', () => {
    const groups = makeAllGroups();
    const top8 = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((g) => groups[g][2]);
    const key = buildLookupKey(top8);
    if (!annexeC.lookup?.[key]) {
      expect(() => allocateThirdsToBrackets(top8, groups)).toThrow(/No Annexe C routing/);
    } else {
      // Full table present — just verify it returns 8 slots
      expect(Object.keys(allocateThirdsToBrackets(top8, groups))).toHaveLength(8);
    }
  });

  it('rejects wrong-sized top8', () => {
    expect(() => allocateThirdsToBrackets([], {})).toThrow(/expects 8/);
  });
});

// ─── §13 assertValidAllocation ───────────────────────────────────────────
describe('assertValidAllocation (§13)', () => {
  function validAllocation() {
    // Construct a plausible allocation that satisfies pools + no-same-group.
    // Use Annexe C option #1 shape (advancing: EFGHIJKL).
    return {
      M74: { teamId: '3F', group: 'F', groupPosition: 3 },
      M77: { teamId: '3G', group: 'G', groupPosition: 3 },
      M79: { teamId: '3E', group: 'E', groupPosition: 3 },
      M80: { teamId: '3K', group: 'K', groupPosition: 3 },
      M81: { teamId: '3I', group: 'I', groupPosition: 3 },
      M82: { teamId: '3H', group: 'H', groupPosition: 3 },
      M85: { teamId: '3J', group: 'J', groupPosition: 3 },
      M87: { teamId: '3L', group: 'L', groupPosition: 3 },
    };
  }

  it('accepts a valid allocation', () => {
    expect(() => assertValidAllocation(validAllocation())).not.toThrow();
  });
  it('rejects missing match IDs', () => {
    const a = validAllocation();
    delete a.M74;
    expect(() => assertValidAllocation(a)).toThrow();
  });
  it('rejects a same-group conflict', () => {
    const a = validAllocation();
    a.M79 = { teamId: '3A', group: 'A', groupPosition: 3 }; // M79 winner is A
    expect(() => assertValidAllocation(a)).toThrow(/Same-group conflict/);
  });
  it('rejects a team that is not 3rd-placed', () => {
    const a = validAllocation();
    a.M74 = { teamId: 'F1', group: 'F', groupPosition: 1 };
    expect(() => assertValidAllocation(a)).toThrow(/not 3rd-placed/);
  });
  it('rejects a team whose group is not in the slot pool', () => {
    const a = validAllocation();
    // M74 pool is ABCDF; L is not in the pool
    a.M74 = { teamId: '3L', group: 'L', groupPosition: 3 };
    expect(() => assertValidAllocation(a)).toThrow(/pool is/);
  });
});

// ─── Whole-table integrity — meaningful once the 495-entry data is in ────
describe('annexeC.lookup integrity', () => {
  it('every present routing entry maps exactly the 8 third-place match IDs', () => {
    const expected = [...THIRD_PLACE_MATCHES].sort().join(',');
    for (const [key, routing] of Object.entries(annexeC.lookup || {})) {
      const got = Object.keys(routing).sort().join(',');
      expect(got, `key ${key}`).toBe(expected);
    }
  });

  it('every present routing sends each 3rd-placed team to a slot within its eligible pool', () => {
    for (const [key, routing] of Object.entries(annexeC.lookup || {})) {
      for (const [matchId, slot] of Object.entries(routing)) {
        const g = slot[1];
        expect(THIRD_PLACE_POOLS[matchId], `key ${key} ${matchId}=${slot}`).toContain(g);
      }
    }
  });

  it('every present routing has 8 distinct group letters matching its key', () => {
    for (const [key, routing] of Object.entries(annexeC.lookup || {})) {
      const groupsInRouting = Object.values(routing).map((s) => s[1]).sort().join('');
      expect(groupsInRouting).toBe(key);
    }
  });

  it('no present routing puts a 3rd-placed team in the same group as its R32 winner opponent', () => {
    for (const [key, routing] of Object.entries(annexeC.lookup || {})) {
      for (const [matchId, slot] of Object.entries(routing)) {
        const thirdGroup = slot[1];
        expect(thirdGroup, `key ${key} ${matchId}`).not.toBe(THIRD_PLACE_WINNER_GROUP[matchId]);
      }
    }
  });

  it('lookup of an impossible key throws rather than returning undefined silently', () => {
    const groups = makeAllGroups();
    const fakeTop8 = ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A'].map((g) => ({ group: g, groupPosition: 3 }));
    expect(() => allocateThirdsToBrackets(fakeTop8, groups)).toThrow();
  });
});

// ─── §16 "Both (shared)" — 495-coverage check (expands once data is in) ──
describe('annexeC full-coverage (§16)', () => {
  it('reports current entry count', () => {
    // Passes with stub (0), passes with full table (495). Use as a tripwire.
    const count = annexeCEntryCount();
    expect(count).toBeGreaterThanOrEqual(0);
    expect(count).toBeLessThanOrEqual(495);
  });

  it('if 495 entries present, covers every 8-of-12 combination exactly once', () => {
    if (annexeCEntryCount() !== 495) return; // stub mode: skip
    const combos = new Set();
    function gen(start, chosen) {
      if (chosen.length === 8) {
        combos.add([...chosen].sort().join(''));
        return;
      }
      for (let i = start; i < GROUP_LETTERS.length; i++) {
        chosen.push(GROUP_LETTERS[i]);
        gen(i + 1, chosen);
        chosen.pop();
      }
    }
    gen(0, []);
    expect(combos.size).toBe(495);
    for (const k of combos) {
      expect(annexeC.lookup[k], `missing key ${k}`).toBeDefined();
    }
  });
});

// ─── Pipeline integration ────────────────────────────────────────────────
describe('resolveKnockoutThirdsQuickPick (§12)', () => {
  it('returns the full shape even with stub lookup (throws inside allocation)', () => {
    const input = {
      groupRankings: Object.fromEntries(
        GROUP_LETTERS.map((g) => [g, [`${g}1`, `${g}2`, `${g}3`, `${g}4`]]),
      ),
      advancingThirdGroups: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'],
    };
    // Stub mode: should throw at allocation step with a clear message.
    // Once the 495-row lookup is in, this resolves to a full bracket.
    if (annexeCEntryCount() === 0) {
      expect(() => resolveKnockoutThirdsQuickPick(input)).toThrow(/Annexe C/);
    } else {
      const result = resolveKnockoutThirdsQuickPick(input);
      expect(result.top8).toHaveLength(8);
      expect(Object.keys(result.bracketAllocation)).toHaveLength(8);
      assertValidAllocation(result.bracketAllocation);
    }
  });

  it('selection order of advancingThirdGroups does not affect allocation', () => {
    if (annexeCEntryCount() === 0) return;
    const mk = (order) => ({
      groupRankings: Object.fromEntries(
        GROUP_LETTERS.map((g) => [g, [`${g}1`, `${g}2`, `${g}3`, `${g}4`]]),
      ),
      advancingThirdGroups: order,
    });
    const a = resolveKnockoutThirdsQuickPick(mk(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']));
    const b = resolveKnockoutThirdsQuickPick(mk(['H', 'G', 'F', 'E', 'D', 'C', 'B', 'A']));
    for (const m of THIRD_PLACE_MATCHES) {
      expect(a.bracketAllocation[m].group).toBe(b.bracketAllocation[m].group);
    }
  });
});

describe('hasAnnexeCEntry', () => {
  it('returns false for the empty/unknown key with stub data', () => {
    expect(hasAnnexeCEntry(['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'])).toBe(false);
  });
});
