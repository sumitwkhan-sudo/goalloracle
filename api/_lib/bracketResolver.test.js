/**
 * Tests for the server-side bracket resolver. Verifies that as match
 * results accumulate, the resolver progressively fills in the real
 * teams playing each knockout match — group stage → R32 → R16 → QF
 * → SF → Final / 3rd-place.
 */

import { describe, test, expect } from 'vitest';
import { resolveActualBracket, buildSimpleActuals, buildLiveGroupStandings, resolveActualR32 } from './bracketResolver.js';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';

const GROUP_MATCHES = WORLD_CUP_MATCHES.filter((m) => !m.isKnockout);

// ── helpers ──

function makeResult(home, away, opts = {}) {
  return {
    homeScore: home,
    awayScore: away,
    completed: true,
    verified: opts.verified !== false,
    extraTime: opts.extraTime || false,
    penalties: opts.penalties || false,
    penHome: opts.penHome || 0,
    penAway: opts.penAway || 0,
  };
}

// Build a deterministic "all groups complete" result set where the home team
// always wins the group match. Picks a unique winner per group so 1st/2nd/3rd
// are well-defined.
function buildAllGroupsCompleteResults() {
  const results = {};
  for (const m of GROUP_MATCHES) {
    results[m.id] = makeResult(2, 1);
  }
  return results;
}

// ── tests ──

describe('bracketResolver', () => {
  test('empty matchResults: nothing resolved', () => {
    const out = resolveActualBracket({});
    expect(out.allGroupsComplete).toBe(false);
    expect(out.resolved).toEqual({});
    expect(out.errors).toEqual([]);
  });

  test('partial group-stage results: groups incomplete, no R32 resolved', () => {
    const partial = {};
    GROUP_MATCHES.slice(0, 5).forEach((m) => { partial[m.id] = makeResult(1, 0); });
    const out = resolveActualBracket(partial);
    expect(out.allGroupsComplete).toBe(false);
    // No R32 match should be resolved while groups are incomplete.
    const r32Resolved = Object.keys(out.resolved).filter((k) => k.startsWith('r32-'));
    expect(r32Resolved.length).toBe(0);
  });

  test('all groups complete: every R32 match has resolved home + away', () => {
    const results = buildAllGroupsCompleteResults();
    const out = resolveActualBracket(results);
    expect(out.allGroupsComplete).toBe(true);
    expect(out.errors).toEqual([]);
    // All 16 R32 matches should now have teams.
    const r32Resolved = WORLD_CUP_MATCHES
      .filter((m) => m.id.startsWith('r32-'))
      .every((m) => {
        const r = out.resolved[m.id];
        return r && typeof r.home === 'string' && r.home.length > 0 && typeof r.away === 'string' && r.away.length > 0;
      });
    expect(r32Resolved).toBe(true);
  });

  test('group-stage complete but no R32 results: R16/QF/SF/Final stay unresolved', () => {
    const results = buildAllGroupsCompleteResults();
    const out = resolveActualBracket(results);
    const laterStages = WORLD_CUP_MATCHES.filter((m) => m.isKnockout && !m.id.startsWith('r32-'));
    for (const m of laterStages) {
      expect(out.resolved[m.id], `${m.id} should not be resolved without R32 results`).toBeUndefined();
    }
  });

  test('R32 results filled in: R16 now resolvable for matches whose R32 predecessors are done', () => {
    const results = buildAllGroupsCompleteResults();
    // Score every R32 with home wins so the home team progresses.
    for (let i = 1; i <= 16; i++) {
      const id = `r32-${String(i).padStart(2, '0')}`;
      results[id] = makeResult(1, 0);
    }
    const out = resolveActualBracket(results);
    // Each R16 match references two R32 winners — both must be present
    // for it to resolve. With every R32 done, all 8 R16 matches resolve.
    const r16Matches = WORLD_CUP_MATCHES.filter((m) => m.id.startsWith('r16-'));
    for (const m of r16Matches) {
      expect(out.resolved[m.id], `${m.id}`).toBeTruthy();
      expect(out.resolved[m.id].home, `${m.id} home`).toBeTruthy();
      expect(out.resolved[m.id].away, `${m.id} away`).toBeTruthy();
    }
  });

  test('penalty shootout in knockout: away wins on pens propagates to next round', () => {
    const results = buildAllGroupsCompleteResults();
    // R32-01 goes to penalties, away wins.
    results['r32-01'] = makeResult(1, 1, { extraTime: true, penalties: true, penHome: 3, penAway: 4 });
    // Other R32-1..4 win normally so r16-02 (which feeds from r32-01 + r32-04) can resolve.
    for (let i = 2; i <= 16; i++) {
      results[`r32-${String(i).padStart(2, '0')}`] = makeResult(2, 0);
    }
    const out = resolveActualBracket(results);
    const r32_01 = out.resolved['r32-01'];
    // r16-02's home is "W R32-01" → away of r32-01 (penalty winner)
    expect(out.resolved['r16-02']).toBeDefined();
    expect(out.resolved['r16-02'].home).toBe(r32_01.away);
  });

  test('Final and 3rd-place resolve correctly from SF results', () => {
    const results = buildAllGroupsCompleteResults();
    // Score all R32, R16, QF, SF — every match home wins.
    const knockoutIds = WORLD_CUP_MATCHES.filter((m) => m.isKnockout && m.id !== 'final' && m.id !== '3rd').map((m) => m.id);
    for (const id of knockoutIds) {
      results[id] = makeResult(1, 0);
    }
    const out = resolveActualBracket(results);
    expect(out.resolved['final']).toBeDefined();
    expect(out.resolved['3rd']).toBeDefined();
    // Final: home = W SF-01, away = W SF-02
    // Both SFs had home win, so home of each SF advances to Final.
    expect(out.resolved['final'].home).toBe(out.resolved['sf-01'].home);
    expect(out.resolved['final'].away).toBe(out.resolved['sf-02'].home);
    // 3rd: home = L SF-01, away = L SF-02
    expect(out.resolved['3rd'].home).toBe(out.resolved['sf-01'].away);
    expect(out.resolved['3rd'].away).toBe(out.resolved['sf-02'].away);
  });

  test('does not overwrite or skip already-verified matches', () => {
    const results = buildAllGroupsCompleteResults();
    const out = resolveActualBracket(results);
    // Calling twice with the same input is idempotent.
    const out2 = resolveActualBracket(results);
    expect(out.resolved).toEqual(out2.resolved);
  });

  test('every R32 placeholder pattern is handled (1st/2nd/3rd of group)', () => {
    const results = buildAllGroupsCompleteResults();
    const out = resolveActualBracket(results);
    // None of the R32 resolved teams should still look like a placeholder.
    for (const [id, teams] of Object.entries(out.resolved)) {
      if (!id.startsWith('r32-')) continue;
      expect(teams.home).not.toMatch(/^(1st|2nd|3rd)/);
      expect(teams.away).not.toMatch(/^(1st|2nd|3rd|W |L )/);
    }
  });
});

describe('buildSimpleActuals (R1 — Quick Picks scoring inputs)', () => {
  test('empty results: empty actuals, no throw', () => {
    const a = buildSimpleActuals({});
    expect(a.groupStandings).toEqual({});
    expect(a.advancingThirds).toEqual([]);
    expect(a.knockoutResults).toEqual({});
  });

  test('partial group stage: only fully-played groups appear, no thirds yet', () => {
    // Play only Group A's three matches (gs01, gs25, gs26 per matches.js).
    const partial = {};
    const groupAMatches = GROUP_MATCHES.filter((m) => (m.stage || '') === 'Group A');
    groupAMatches.forEach((m) => { partial[m.id] = makeResult(2, 1); });
    const a = buildSimpleActuals(partial);
    // Group A complete (3 each) → present and ordered (4 names).
    if (groupAMatches.length === 3) {
      expect(a.groupStandings.A).toBeDefined();
      expect(a.groupStandings.A).toHaveLength(4);
      expect(a.groupStandings.A.every((n) => typeof n === 'string')).toBe(true);
    }
    // Other groups absent; thirds require ALL groups complete.
    expect(a.groupStandings.B).toBeUndefined();
    expect(a.advancingThirds).toEqual([]);
  });

  test('all groups complete: 12 ordered standings + exactly 8 advancing thirds', () => {
    const results = buildAllGroupsCompleteResults();
    const a = buildSimpleActuals(results);
    expect(Object.keys(a.groupStandings).sort()).toEqual(
      ['A','B','C','D','E','F','G','H','I','J','K','L'],
    );
    for (const letter of Object.keys(a.groupStandings)) {
      expect(a.groupStandings[letter]).toHaveLength(4);
    }
    expect(a.advancingThirds).toHaveLength(8);
    // Advancing thirds are group LETTERS, each valid and unique.
    const set = new Set(a.advancingThirds);
    expect(set.size).toBe(8);
    a.advancingThirds.forEach((g) => expect('ABCDEFGHIJKL').toContain(g));
  });

  test('knockoutResults carry the winning TEAM NAME keyed by matches.js id', () => {
    const results = buildAllGroupsCompleteResults();
    // Decide every knockout with a home win.
    const koIds = WORLD_CUP_MATCHES.filter((m) => m.isKnockout).map((m) => m.id);
    for (const id of koIds) results[id] = makeResult(1, 0);
    const a = buildSimpleActuals(results);
    const { resolved } = resolveActualBracket(results);
    // Every decided knockout match should have a winnerId equal to the
    // resolved HOME team (since home won each).
    for (const id of koIds) {
      if (!resolved[id]) continue;
      expect(a.knockoutResults[id]).toBeDefined();
      expect(a.knockoutResults[id].winnerId).toBe(resolved[id].home);
    }
    // Final winner present.
    expect(a.knockoutResults.final?.winnerId).toBe(resolved.final.home);
  });

  test('penalty shootout: away winner is the recorded knockout winnerId', () => {
    const results = buildAllGroupsCompleteResults();
    for (let i = 1; i <= 16; i++) {
      results[`r32-${String(i).padStart(2, '0')}`] = makeResult(0, 0, { extraTime: true, penalties: true, penHome: 2, penAway: 4 });
    }
    const a = buildSimpleActuals(results);
    const { resolved } = resolveActualBracket(results);
    // Away won on pens → winnerId is the away team.
    expect(a.knockoutResults['r32-01'].winnerId).toBe(resolved['r32-01'].away);
  });

  test('feeds calculateSimpleScore: a perfect bracket scores the max', async () => {
    const { calculateSimpleScore } = await import('../../src/utils/scoringSimple.js');
    const results = buildAllGroupsCompleteResults();
    const koIds = WORLD_CUP_MATCHES.filter((m) => m.isKnockout).map((m) => m.id);
    for (const id of koIds) results[id] = makeResult(1, 0);
    const a = buildSimpleActuals(results);

    // Build a prediction that exactly matches the actuals.
    const groupPredictions = {};
    for (const [g, order] of Object.entries(a.groupStandings)) {
      groupPredictions[g] = { ranking: [...order] };
    }
    const bestThirdPicks = [...a.advancingThirds];
    const ROUND_BY_PREFIX = [
      ['roundOf32', 'r32-'], ['roundOf16', 'r16-'], ['quarterFinals', 'qf-'],
      ['semiFinals', 'sf-'], ['thirdPlace', '3rd'], ['final', 'final'],
    ];
    const knockoutPredictions = {};
    for (const [round, prefix] of ROUND_BY_PREFIX) {
      knockoutPredictions[round] = Object.entries(a.knockoutResults)
        .filter(([mId]) => mId.startsWith(prefix) || mId === prefix)
        .map(([mId, r]) => ({ matchId: mId, winnerId: r.winnerId }));
    }
    const score = calculateSimpleScore(
      { groupPredictions, bestThirdPicks, knockoutPredictions },
      a,
    );
    // A bracket that perfectly matches every actual result earns the max.
    expect(score.totalScore).toBe(209);
    expect(score.totalAccuracy).toBeCloseTo(1, 5);
  });
});

describe('buildLiveGroupStandings (live/provisional group score input)', () => {
  test('empty results → no standings, zero matches played', () => {
    const { standings, matchesPlayed } = buildLiveGroupStandings({});
    expect(standings).toEqual({});
    expect(matchesPlayed).toBe(0);
  });

  test('a single completed match makes that PARTIAL group appear (unlike buildSimpleActuals)', () => {
    // gs01: Mexico 2–0 South Africa (Group A). Only one match played.
    const results = { gs01: makeResult(2, 0) };

    // The official actuals OMIT Group A (not all 3 played)…
    expect(buildSimpleActuals(results).groupStandings.A).toBeUndefined();

    // …but the LIVE standings include it, ranked by the current table.
    const { standings, matchesPlayed } = buildLiveGroupStandings(results);
    expect(Object.keys(standings)).toEqual(['A']);
    expect(standings.A).toHaveLength(4);
    expect(standings.A[0]).toBe('Mexico'); // winner currently on top
    expect(matchesPlayed).toBe(1);
  });

  test('groups with no completed match are omitted', () => {
    const results = { gs01: makeResult(1, 0) }; // only Group A has a result
    const { standings } = buildLiveGroupStandings(results);
    expect(standings.B).toBeUndefined();
    expect(standings.L).toBeUndefined();
  });

  test('live group score rewards a correct current-leader pick', async () => {
    const { scoreGroupStage } = await import('../../src/utils/scoringSimple.js');
    const { standings } = buildLiveGroupStandings({ gs01: makeResult(2, 0) });
    // User predicted Mexico 1st in Group A → 3 pts against the live table.
    const preds = { A: { ranking: ['Mexico', 'South Africa', 'South Korea', 'Czechia'] } };
    expect(scoreGroupStage(preds, standings)).toBe(3);
  });
});

describe('resolveActualR32 (per-side progressive reseed input)', () => {
  test('empty results: 16 slots, nothing resolved', () => {
    const out = resolveActualR32({});
    expect(out.allGroupsComplete).toBe(false);
    expect(out.groupsComplete).toEqual([]);
    expect(Object.keys(out.r32)).toHaveLength(16);
    expect(out.r32['r32-01']).toEqual({ home: null, away: null, homeReal: false, awayReal: false });
  });

  test('one finished group resolves ITS direct-position sides only; thirds stay pending', () => {
    const results = {};
    GROUP_MATCHES.filter((m) => (m.stage || '') === 'Group A').forEach((m) => { results[m.id] = makeResult(2, 1); });
    const out = resolveActualR32(results);
    expect(out.groupsComplete).toContain('A');
    expect(out.allGroupsComplete).toBe(false);
    // r32-01 home = A2 (Group A done → real); away = B2 (Group B not done → pending)
    expect(out.r32['r32-01'].homeReal).toBe(true);
    expect(out.r32['r32-01'].home).toBeTruthy();
    expect(out.r32['r32-01'].awayReal).toBe(false);
    expect(out.r32['r32-01'].away).toBeNull();
    // r32-07 home = A1 (real); away = a third-place slot → pending until ALL groups done
    expect(out.r32['r32-07'].homeReal).toBe(true);
    expect(out.r32['r32-07'].awayReal).toBe(false);
  });

  test('all groups complete: every side resolves (incl. thirds via Annexe C)', () => {
    const results = buildAllGroupsCompleteResults();
    const out = resolveActualR32(results);
    expect(out.allGroupsComplete).toBe(true);
    for (const id of Object.keys(out.r32)) {
      expect(out.r32[id].homeReal).toBe(true);
      expect(out.r32[id].awayReal).toBe(true);
      expect(out.r32[id].home).toBeTruthy();
      expect(out.r32[id].away).toBeTruthy();
    }
  });
});
