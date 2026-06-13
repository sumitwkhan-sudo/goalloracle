/**
 * Parity + ordering checks for the client-side live group tables. The ordering
 * (points → pairwise H2H → GD → GF) must match the server's buildGroupStandings
 * so the on-screen standings agree with what the live score is graded against.
 */
import { describe, test, expect } from 'vitest';
import { computeLiveStandings, countGroupMatchesPlayed, mergeLiveScores, GROUP_LETTERS } from './liveStandings.js';
import WORLD_CUP_MATCHES from '../data/matches';

const GROUP_MATCHES = WORLD_CUP_MATCHES.filter((m) => !m.isKnockout);
const r = (h, a) => ({ homeScore: h, awayScore: a, completed: true });

describe('computeLiveStandings', () => {
  test('empty results: 12 groups, 4 teams each, all zeroed', () => {
    const s = computeLiveStandings({});
    expect(Object.keys(s).sort()).toEqual([...GROUP_LETTERS].sort());
    for (const g of GROUP_LETTERS) {
      expect(s[g]).toHaveLength(4);
      expect(s[g].every((t) => t.played === 0 && t.pts === 0)).toBe(true);
    }
    expect(countGroupMatchesPlayed({})).toBe(0);
  });

  test('a completed match moves the winner up and counts as played', () => {
    // gs01: Mexico 2–0 South Africa (Group A).
    const s = computeLiveStandings({ gs01: r(2, 0) });
    expect(s.A[0].name).toBe('Mexico');
    expect(s.A[0].pts).toBe(3);
    expect(s.A[0].gd).toBe(2);
    expect(countGroupMatchesPlayed({ gs01: r(2, 0) })).toBe(1);
  });

  test('head-to-head breaks a points tie before goal difference', () => {
    // Two Group A pairs; engineer equal points but a decisive H2H.
    const a = GROUP_MATCHES.filter((m) => (m.stage || '') === 'Group A');
    // Find the direct match between the first two teams to set H2H.
    const teams = [...new Set(a.flatMap((m) => [m.home, m.away]))];
    const [t1, t2] = teams;
    const direct = a.find((m) => (m.home === t1 && m.away === t2) || (m.home === t2 && m.away === t1));
    const results = { [direct.id]: direct.home === t1 ? r(1, 0) : r(0, 1) }; // t1 beats t2
    const s = computeLiveStandings(results);
    const i1 = s.A.findIndex((t) => t.name === t1);
    const i2 = s.A.findIndex((t) => t.name === t2);
    expect(i1).toBeLessThan(i2); // winner of the H2H ranks higher
  });

  test('ignores non-completed / malformed results', () => {
    const s = computeLiveStandings({ gs01: { homeScore: 2, awayScore: 0, completed: false } });
    expect(s.A.every((t) => t.played === 0)).toBe(true);
  });
});

describe('mergeLiveScores', () => {
  test('live score fills a match with no official result, flagged live', () => {
    const m = mergeLiveScores({}, { gs05: { homeScore: 2, awayScore: 0, status: 'IN_PLAY', minute: 73 } });
    expect(m.gs05).toMatchObject({ homeScore: 2, awayScore: 0, completed: true, live: true });
    // counts toward the live standings (completed:true)
    expect(countGroupMatchesPlayed(m)).toBe(1);
  });
  test('a FINISHED official result wins over a live score', () => {
    const official = { gs05: { homeScore: 1, awayScore: 1, completed: true } };
    const m = mergeLiveScores(official, { gs05: { homeScore: 2, awayScore: 0, status: 'IN_PLAY' } });
    expect(m.gs05).toEqual({ homeScore: 1, awayScore: 1, completed: true });
    expect(m.gs05.live).toBeUndefined();
  });
  test('malformed live entries are ignored', () => {
    const m = mergeLiveScores({}, { gs05: { status: 'IN_PLAY' }, gs06: { homeScore: 'x', awayScore: 1 } });
    expect(m.gs05).toBeUndefined();
    expect(m.gs06).toBeUndefined();
  });
});
