/**
 * Tests for the server-side bracket resolver. Verifies that as match
 * results accumulate, the resolver progressively fills in the real
 * teams playing each knockout match — group stage → R32 → R16 → QF
 * → SF → Final / 3rd-place.
 */

import { describe, test, expect } from 'vitest';
import { resolveActualBracket } from './bracketResolver.js';
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
