/**
 * thirdPlaceAllocation.js
 *
 * FIFA World Cup 26 — third-placed teams logic (Art. 12 & 13, Annexe C).
 * Shared by Classic and Quick Pick. See docs/rules for the source spec.
 *
 * Two systems, one bracket allocator:
 *   - Classic:   match predictions → standings → rank thirds via §3 → Annexe C
 *   - Quick Pick: user ranks groups 1–4 → user picks 8 of 12 thirds → Annexe C
 *
 * Both converge on allocateThirdsToBrackets().
 */

import annexeC from '../data/annexe-c.json';

export const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// Matches that receive a "Best 3rd" slot, with the group winner they face and
// the eligible pool for the 3rd-placed team (Art. 12.6).
export const THIRD_PLACE_MATCHES = ['M74', 'M77', 'M79', 'M80', 'M81', 'M82', 'M85', 'M87'];

export const THIRD_PLACE_POOLS = {
  M74: ['A', 'B', 'C', 'D', 'F'],
  M77: ['C', 'D', 'F', 'G', 'H'],
  M79: ['C', 'E', 'F', 'H', 'I'],
  M80: ['E', 'H', 'I', 'J', 'K'],
  M81: ['B', 'E', 'F', 'I', 'J'],
  M82: ['A', 'E', 'H', 'I', 'J'],
  M85: ['E', 'F', 'G', 'I', 'J'],
  M87: ['D', 'E', 'I', 'J', 'L'],
};

// Group winner each "Best 3rd" slot faces. Used by assertValidAllocation
// to enforce the no-same-group constraint (Art. 12.6).
export const THIRD_PLACE_WINNER_GROUP = {
  M74: 'E', M77: 'I', M79: 'A', M80: 'L',
  M81: 'D', M82: 'G', M85: 'B', M87: 'K',
};

// =============================================================================
// §3 — Classic cross-group third-place comparator (Art. 13)
// =============================================================================

/**
 * Ranks third-placed teams against each other. Head-to-head is NOT used —
 * these teams come from different groups. This comparator is intentionally
 * different from the within-group tiebreaker. Do not share code.
 */
export function compareThirdPlacedTeams(a, b) {
  if (a.points !== b.points) return b.points - a.points;
  if (a.goalDifference !== b.goalDifference) return b.goalDifference - a.goalDifference;
  if (a.goalsFor !== b.goalsFor) return b.goalsFor - a.goalsFor;
  if (a.fairPlayPoints !== b.fairPlayPoints) return b.fairPlayPoints - a.fairPlayPoints;
  if (a.fifaRanking !== b.fifaRanking) return a.fifaRanking - b.fifaRanking;
  // Preceding FIFA ranking editions (Art. 13 step 6) fall through to caller.
  return 0;
}

export function rankThirdPlacedTeamsClassic(allGroups) {
  const thirds = Object.values(allGroups).map((g) =>
    g.find((t) => t.groupPosition === 3),
  );
  if (thirds.some((t) => !t)) {
    throw new Error('Every group must have a 3rd-placed team');
  }
  if (thirds.length !== 12) {
    throw new Error(`Expected 12 third-placed teams, got ${thirds.length}`);
  }
  const sorted = [...thirds].sort(compareThirdPlacedTeams);
  return {
    top8: sorted.slice(0, 8),
    eliminated: sorted.slice(8, 12),
  };
}

// =============================================================================
// §5–7 — Quick Pick input validation + conversion
// =============================================================================

export function validateQuickPickInput(input) {
  if (!input || typeof input !== 'object') {
    throw new Error('QuickPickInput must be an object');
  }
  if (!input.groupRankings || typeof input.groupRankings !== 'object') {
    throw new Error('QuickPickInput.groupRankings is required');
  }

  for (const letter of GROUP_LETTERS) {
    const ranking = input.groupRankings[letter];
    if (!Array.isArray(ranking) || ranking.length !== 4) {
      throw new Error(`Group ${letter} must have exactly 4 ranked teams`);
    }
    if (ranking.some((t) => !t)) {
      throw new Error(`Group ${letter} ranking has empty slots`);
    }
    if (new Set(ranking).size !== 4) {
      throw new Error(`Group ${letter} has duplicate team picks`);
    }
  }

  if (!Array.isArray(input.advancingThirdGroups) || input.advancingThirdGroups.length !== 8) {
    throw new Error(
      `Must select exactly 8 third-placed teams, got ${input.advancingThirdGroups?.length ?? 0}`,
    );
  }
  if (new Set(input.advancingThirdGroups).size !== 8) {
    throw new Error('Third-placed team selections must be unique');
  }
  for (const g of input.advancingThirdGroups) {
    if (!GROUP_LETTERS.includes(g)) {
      throw new Error(`Invalid group letter in selection: ${g}`);
    }
  }
}

export function buildGroupsFromQuickPick(input) {
  const allGroups = {};
  for (const letter of GROUP_LETTERS) {
    const ranking = input.groupRankings[letter];
    allGroups[letter] = ranking.map((teamId, idx) => ({
      teamId,
      group: letter,
      groupPosition: idx + 1,
    }));
  }
  return allGroups;
}

export function pickTop8ThirdsQuickPick(allGroups, advancingThirdGroups) {
  const top8 = [];
  const eliminated = [];
  for (const letter of GROUP_LETTERS) {
    const third = allGroups[letter]?.find((t) => t.groupPosition === 3);
    if (!third) continue;
    if (advancingThirdGroups.includes(letter)) top8.push(third);
    else eliminated.push(third);
  }
  if (top8.length !== 8) {
    throw new Error(`Expected 8 advancing thirds, got ${top8.length}`);
  }
  return { top8, eliminated };
}

// =============================================================================
// §10 — Shared bracket allocation via Annexe C
// =============================================================================

/**
 * Build the Annexe C lookup key: 8 sorted uppercase group letters.
 */
export function buildLookupKey(top8) {
  return top8
    .map((t) => t.group)
    .sort()
    .join('');
}

/**
 * Allocates the top 8 third-placed teams to their R32 brackets.
 * Works identically for Classic and Quick Pick.
 *
 * @throws if no Annexe C entry exists for the given 8-group combination
 *         (must NEVER fall back to algorithmic derivation — FIFA doesn't publish one)
 */
export function allocateThirdsToBrackets(top8, allGroups) {
  if (!Array.isArray(top8) || top8.length !== 8) {
    throw new Error(`allocateThirdsToBrackets expects 8 thirds, got ${top8?.length ?? 0}`);
  }

  const key = buildLookupKey(top8);
  const routing = annexeC.lookup?.[key];
  if (!routing) {
    throw new Error(`No Annexe C routing for advancing groups: ${key}`);
  }

  const bracketAllocation = {};
  for (const [matchId, slot] of Object.entries(routing)) {
    // slot is "3X" — the 3rd-placed team from group X
    const groupLetter = slot[1];
    const thirdFromGroup = allGroups[groupLetter]?.find((t) => t.groupPosition === 3);
    if (!thirdFromGroup) {
      throw new Error(`Annexe C routed ${matchId} → 3${groupLetter} but group ${groupLetter} has no 3rd-placed team`);
    }
    bracketAllocation[matchId] = thirdFromGroup;
  }
  return bracketAllocation;
}

// =============================================================================
// §11–12 — End-to-end pipelines
// =============================================================================

export function resolveKnockoutThirdsClassic(allGroups) {
  const { top8, eliminated } = rankThirdPlacedTeamsClassic(allGroups);
  const bracketAllocation = allocateThirdsToBrackets(top8, allGroups);
  return { top8, eliminated, bracketAllocation };
}

export function resolveKnockoutThirdsQuickPick(input) {
  validateQuickPickInput(input);
  const allGroups = buildGroupsFromQuickPick(input);
  const { top8, eliminated } = pickTop8ThirdsQuickPick(allGroups, input.advancingThirdGroups);
  const bracketAllocation = allocateThirdsToBrackets(top8, allGroups);
  return { top8, eliminated, bracketAllocation };
}

// =============================================================================
// §13 — Post-allocation sanity checks
// =============================================================================

export function assertValidAllocation(allocation) {
  const expected = [...THIRD_PLACE_MATCHES].sort();
  const filled = Object.keys(allocation).sort();
  if (filled.length !== expected.length || filled.some((m, i) => m !== expected[i])) {
    throw new Error(`Expected matches ${expected.join(',')}, got ${filled.join(',')}`);
  }

  for (const [matchId, team] of Object.entries(allocation)) {
    if (team.groupPosition !== 3) {
      throw new Error(`${matchId}: team ${team.teamId} is not 3rd-placed (pos=${team.groupPosition})`);
    }
    if (team.group === THIRD_PLACE_WINNER_GROUP[matchId]) {
      throw new Error(`Same-group conflict at ${matchId}: 3${team.group} vs Winner ${team.group}`);
    }
    const pool = THIRD_PLACE_POOLS[matchId];
    if (!pool.includes(team.group)) {
      throw new Error(`${matchId} got 3${team.group} but pool is ${pool.join(',')}`);
    }
  }
}

// =============================================================================
// Introspection (useful for UI + debugging)
// =============================================================================

export function hasAnnexeCEntry(advancingGroupLetters) {
  const key = [...advancingGroupLetters].sort().join('');
  return Boolean(annexeC.lookup?.[key]);
}

export function annexeCEntryCount() {
  return Object.keys(annexeC.lookup || {}).length;
}
