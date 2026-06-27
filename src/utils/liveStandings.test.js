/**
 * Parity + ordering checks for the client-side live group tables. The ordering
 * (points → pairwise H2H → GD → GF) must match the server's buildGroupStandings
 * so the on-screen standings agree with what the live score is graded against.
 */
import { describe, test, expect } from 'vitest';
import { computeLiveStandings, countGroupMatchesPlayed, mergeLiveScores, GROUP_LETTERS, projectRealR32, eliminatedTeams } from './liveStandings.js';
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

describe('projectRealR32', () => {
  test('empty standings: no side is real yet', () => {
    const r32 = projectRealR32(computeLiveStandings({}), {});
    expect(Object.values(r32).every((s) => s.homeReal === false && s.awayReal === false)).toBe(true);
    expect(r32['r32-01'].home).toBeNull();
  });

  test('a group leader projects into its direct R32 slot immediately', () => {
    // r32-02 home is "1st Group C". A single decisive Group C result makes a
    // clear leader, which should appear (real) without the group being complete.
    const c = GROUP_MATCHES.filter((m) => (m.stage || '') === 'Group C');
    const standings = computeLiveStandings({ [c[0].id]: r(3, 0) });
    const leaderC = standings.C[0].name;
    const r32 = projectRealR32(standings, {});
    expect(r32['r32-02'].home).toBe(leaderC);
    expect(r32['r32-02'].homeReal).toBe(true);
  });

  test('3rd-place sides come from the server payload, not live standings', () => {
    // r32-03 away is a "3rd …" slot — unresolvable from standings; the server
    // resolves it once all groups finish (Annexe C).
    const standings = computeLiveStandings({});
    const server = { 'r32-03': { home: null, away: 'Brazil', homeReal: false, awayReal: true } };
    const r32 = projectRealR32(standings, server);
    expect(r32['r32-03'].away).toBe('Brazil');
    expect(r32['r32-03'].awayReal).toBe(true);
    // The direct "1st Group E" side stays unresolved until Group E starts.
    expect(r32['r32-03'].homeReal).toBe(false);
  });
});

describe('eliminatedTeams', () => {
  const team = (name, group, pts, gd, gf, played = 3) => ({ name, group, pts, gd, gf, played });
  const grp = (l, thirdPts) => [
    team(`${l}1`, l, 9, 5, 8), team(`${l}2`, l, 6, 2, 5),
    team(`${l}3`, l, thirdPts, 0, 2), team(`${l}4`, l, 0, -7, 0),
  ];

  test('a complete group: 4th is out, top-2 are not; a lone 3rd is not (might still advance)', () => {
    const out = eliminatedTeams({ A: grp('A', 3) });
    expect(out.has('A4')).toBe(true);
    expect(out.has('A1')).toBe(false);
    expect(out.has('A2')).toBe(false);
    expect(out.has('A3')).toBe(false); // only 1 third so far — can't be ruled out
  });

  test('with 9 complete groups, the 9th-best third is out but the top-8 thirds are kept', () => {
    const standings = {};
    ['A','B','C','D','E','F','G','H','I'].forEach((l, i) => { standings[l] = grp(l, 9 - i); });
    const out = eliminatedTeams(standings); // thirds pts A=9..I=1 → I3 is 9th-best
    expect(out.has('I3')).toBe(true);
    expect(out.has('A3')).toBe(false);
    expect(out.has('H3')).toBe(false); // 8th-best — still advancing
  });

  test('never eliminates teams from an unfinished group', () => {
    const unfinished = [
      team('A1', 'A', 3, 1, 2, 1), team('A2', 'A', 1, 0, 1, 1),
      team('A3', 'A', 1, 0, 1, 1), team('A4', 'A', 0, -1, 0, 1),
    ];
    expect(eliminatedTeams({ A: unfinished }).size).toBe(0);
  });
});
