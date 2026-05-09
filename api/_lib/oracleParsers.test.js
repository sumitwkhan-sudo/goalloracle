/**
 * Tests for the upstream-API parsers. Uses the published response shapes
 * for football-data.org v4 and api-sports.io v3 to verify our parsers
 * handle every real-world variation the oracle pipeline must survive:
 * regular-time finishes, extra-time, penalty shootouts, in-progress
 * matches (must throw), schema drift (missing fields → throw), and
 * disagreement between the two sources.
 */

import { describe, test, expect } from 'vitest';
import {
  parseFootballDataResponse,
  parseApiSportsResponse,
  compareResults,
  parseApiSportsStandings,
  parseFootballDataStandings,
  rankThirdPlacedTeamsFromStandings,
  determineWinnerFromResult,
} from './oracleParsers.js';

// ────────────────────────── football-data.org ──────────────────────────

describe('football-data.org parser', () => {
  function fdFinished({ home, away, duration = 'REGULAR', penHome = null, penAway = null } = {}) {
    return {
      id: 12345,
      status: 'FINISHED',
      homeTeam: { name: 'Brazil' },
      awayTeam: { name: 'Spain' },
      score: {
        winner: home > away ? 'HOME_TEAM' : away > home ? 'AWAY_TEAM' : 'DRAW',
        duration,
        fullTime: { home, away },
        halfTime: { home: 0, away: 0 },
        extraTime: { home: null, away: null },
        penalties: { home: penHome, away: penAway },
      },
    };
  }

  test('regulation-time win parses cleanly', () => {
    const r = parseFootballDataResponse(fdFinished({ home: 2, away: 1 }));
    expect(r).toEqual({
      source: 'football-data.org',
      homeScore: 2,
      awayScore: 1,
      extraTime: false,
      penalties: false,
      penHome: 0,
      penAway: 0,
    });
  });

  test('0-0 regulation draw parses cleanly', () => {
    const r = parseFootballDataResponse(fdFinished({ home: 0, away: 0 }));
    expect(r.homeScore).toBe(0);
    expect(r.awayScore).toBe(0);
    expect(r.extraTime).toBe(false);
  });

  test('extra-time win sets extraTime=true, penalties=false', () => {
    const r = parseFootballDataResponse(fdFinished({ home: 2, away: 1, duration: 'EXTRA_TIME' }));
    expect(r.extraTime).toBe(true);
    expect(r.penalties).toBe(false);
  });

  test('penalty shootout sets both extraTime and penalties true with shootout scores', () => {
    const r = parseFootballDataResponse(
      fdFinished({ home: 1, away: 1, duration: 'PENALTY_SHOOTOUT', penHome: 4, penAway: 3 }),
    );
    expect(r.extraTime).toBe(true);
    expect(r.penalties).toBe(true);
    expect(r.penHome).toBe(4);
    expect(r.penAway).toBe(3);
  });

  test('throws when status is not FINISHED', () => {
    expect(() => parseFootballDataResponse({ ...fdFinished({ home: 1, away: 0 }), status: 'IN_PLAY' }))
      .toThrow(/not finished/i);
    expect(() => parseFootballDataResponse({ ...fdFinished({ home: 1, away: 0 }), status: 'PAUSED' }))
      .toThrow(/not finished/i);
    expect(() => parseFootballDataResponse({ ...fdFinished({ home: 1, away: 0 }), status: 'TIMED' }))
      .toThrow(/not finished/i);
  });

  test('throws on null / non-object input', () => {
    expect(() => parseFootballDataResponse(null)).toThrow();
    expect(() => parseFootballDataResponse(undefined)).toThrow();
    expect(() => parseFootballDataResponse('not json')).toThrow();
  });

  test('throws when score object is missing entirely (schema drift)', () => {
    expect(() => parseFootballDataResponse({ status: 'FINISHED', homeTeam: {}, awayTeam: {} }))
      .toThrow(/missing score/i);
  });

  test('throws when fullTime scores are not numbers (incomplete API response)', () => {
    expect(() => parseFootballDataResponse({
      status: 'FINISHED',
      score: { duration: 'REGULAR', fullTime: { home: null, away: null } },
    })).toThrow(/non-numeric|missing/i);
    expect(() => parseFootballDataResponse({
      status: 'FINISHED',
      score: { duration: 'REGULAR', fullTime: {} },
    })).toThrow();
  });

  test('handles missing duration field as REGULAR (defensive)', () => {
    const r = parseFootballDataResponse({
      status: 'FINISHED',
      score: { fullTime: { home: 1, away: 0 } },
    });
    expect(r.extraTime).toBe(false);
    expect(r.penalties).toBe(false);
  });

  test('penalties=null in score.penalties is treated as 0', () => {
    const r = parseFootballDataResponse(fdFinished({ home: 2, away: 1 })); // pen home/away null
    expect(r.penHome).toBe(0);
    expect(r.penAway).toBe(0);
  });
});

// ─────────────────────────── api-sports.io ─────────────────────────────

describe('api-sports.io parser', () => {
  function asFixture({ id = 1, status = 'FT', homeName = 'Brazil', awayName = 'Spain', home, away, etHome = null, etAway = null, penHome = null, penAway = null } = {}) {
    return {
      fixture: { id, status: { short: status, long: 'Match Finished' } },
      teams: {
        home: { id: 6, name: homeName, winner: home > away },
        away: { id: 9, name: awayName, winner: away > home },
      },
      goals: { home, away },
      score: {
        halftime: { home: 0, away: 0 },
        fulltime: { home, away },
        extratime: { home: etHome, away: etAway },
        penalty: { home: penHome, away: penAway },
      },
    };
  }

  function asResponse(fixtures) {
    return { get: 'fixtures', parameters: {}, errors: [], results: fixtures.length, paging: { current: 1, total: 1 }, response: fixtures };
  }

  test('regulation-time fixture by ID parses cleanly', () => {
    const r = parseApiSportsResponse(asResponse([asFixture({ id: 100, status: 'FT', home: 2, away: 1 })]), { fixtureId: 100 });
    expect(r).toEqual({
      source: 'api-sports.io',
      homeScore: 2,
      awayScore: 1,
      extraTime: false,
      penalties: false,
      penHome: 0,
      penAway: 0,
    });
  });

  test('AET status sets extraTime=true', () => {
    const r = parseApiSportsResponse(asResponse([asFixture({ status: 'AET', home: 2, away: 1, etHome: 1, etAway: 0 })]), { fixtureId: 1 });
    expect(r.extraTime).toBe(true);
    expect(r.penalties).toBe(false);
  });

  test('PEN status sets both flags + records shootout scores', () => {
    const r = parseApiSportsResponse(asResponse([asFixture({ status: 'PEN', home: 1, away: 1, etHome: 0, etAway: 0, penHome: 4, penAway: 3 })]), { fixtureId: 1 });
    expect(r.extraTime).toBe(true);
    expect(r.penalties).toBe(true);
    expect(r.penHome).toBe(4);
    expect(r.penAway).toBe(3);
  });

  test('throws on in-progress statuses (1H, HT, 2H, NS)', () => {
    for (const status of ['1H', 'HT', '2H', 'NS', 'LIVE']) {
      expect(() => parseApiSportsResponse(asResponse([asFixture({ status, home: 1, away: 0 })]), { fixtureId: 1 }))
        .toThrow(/not finished/i);
    }
  });

  test('throws when response array is empty', () => {
    expect(() => parseApiSportsResponse(asResponse([]), { fixtureId: 1 })).toThrow(/no fixtures/i);
    expect(() => parseApiSportsResponse({ response: null }, { fixtureId: 1 })).toThrow(/no fixtures/i);
  });

  test('throws on null / non-object input', () => {
    expect(() => parseApiSportsResponse(null, {})).toThrow();
    expect(() => parseApiSportsResponse('garbage', {})).toThrow();
  });

  test('lookup by team name finds the right fixture (substring tolerant)', () => {
    const fixtures = [
      asFixture({ id: 1, status: 'FT', home: 1, away: 0, homeName: 'Mexico', awayName: 'South Africa' }),
      asFixture({ id: 2, status: 'FT', home: 0, away: 1, homeName: 'Brazil', awayName: 'Spain' }),
    ];
    const r = parseApiSportsResponse(asResponse(fixtures), { homeTeam: 'Brazil', awayTeam: 'Spain' });
    expect(r.homeScore).toBe(0);
    expect(r.awayScore).toBe(1);
  });

  test('lookup by team name handles upstream variants (Korea Republic vs South Korea)', () => {
    const fixtures = [asFixture({ status: 'FT', home: 1, away: 0, homeName: 'Korea Republic', awayName: 'Czech Republic' })];
    const r = parseApiSportsResponse(asResponse(fixtures), { homeTeam: 'Korea', awayTeam: 'Czech' });
    expect(r.homeScore).toBe(1);
  });

  test('throws when team-name search yields no match', () => {
    const fixtures = [asFixture({ status: 'FT', home: 1, away: 0, homeName: 'Brazil', awayName: 'Spain' })];
    expect(() => parseApiSportsResponse(asResponse(fixtures), { homeTeam: 'Mexico', awayTeam: 'South Korea' }))
      .toThrow(/match not found/i);
  });

  test('throws when goals are missing or non-numeric (mid-API-call schema drift)', () => {
    const fixture = asFixture({ status: 'FT', home: null, away: null });
    expect(() => parseApiSportsResponse(asResponse([fixture]), { fixtureId: 1 })).toThrow(/non-numeric|missing/i);
    const fixture2 = { ...asFixture({ status: 'FT', home: 1, away: 0 }), goals: {} };
    expect(() => parseApiSportsResponse(asResponse([fixture2]), { fixtureId: 1 })).toThrow();
  });

  test('extraTime inferred from non-zero etScore even if status is FT (rare data inconsistency)', () => {
    const r = parseApiSportsResponse(asResponse([asFixture({ status: 'FT', home: 2, away: 1, etHome: 1, etAway: 0 })]), { fixtureId: 1 });
    expect(r.extraTime).toBe(true);
  });
});

// ────────────────────────────── compare ────────────────────────────────

describe('compareResults', () => {
  function r({ home = 0, away = 0, et = false, pen = false, ph = 0, pa = 0 } = {}) {
    return { homeScore: home, awayScore: away, extraTime: et, penalties: pen, penHome: ph, penAway: pa };
  }

  test('identical results match', () => {
    const a = r({ home: 2, away: 1 });
    const b = r({ home: 2, away: 1 });
    expect(compareResults(a, b)).toEqual({ match: true });
  });

  test('different scores fail with details', () => {
    const out = compareResults(r({ home: 2, away: 1 }), r({ home: 1, away: 2 }));
    expect(out.match).toBe(false);
    expect(out.details).toMatch(/homeScore: src1=2, src2=1/);
    expect(out.details).toMatch(/awayScore/);
  });

  test('different ET flag fails', () => {
    const out = compareResults(r({ home: 2, away: 1, et: false }), r({ home: 2, away: 1, et: true }));
    expect(out.match).toBe(false);
    expect(out.details).toMatch(/extraTime/);
  });

  test('penalty score mismatch only checked when penalties=true on either side', () => {
    // Both penalties=false → penHome/penAway not compared even if different
    const a = r({ home: 1, away: 0, ph: 0, pa: 0 });
    const b = r({ home: 1, away: 0, ph: 5, pa: 5 }); // garbage in pen fields
    expect(compareResults(a, b).match).toBe(true);

    // One side has penalties=true → compare
    const c = r({ home: 1, away: 1, et: true, pen: true, ph: 4, pa: 3 });
    const d = r({ home: 1, away: 1, et: true, pen: true, ph: 5, pa: 4 });
    const out = compareResults(c, d);
    expect(out.match).toBe(false);
    expect(out.details).toMatch(/penHome/);
  });
});

// ──────────────────── cross-parser equivalence ────────────────────────

describe('cross-parser equivalence — both parsers agree on the same match', () => {
  test('regulation 2-1 from both APIs produces identical standardized result (modulo source)', () => {
    const fd = parseFootballDataResponse({
      status: 'FINISHED',
      score: { duration: 'REGULAR', fullTime: { home: 2, away: 1 }, penalties: { home: null, away: null } },
    });
    const as = parseApiSportsResponse(
      { response: [{
        fixture: { id: 1, status: { short: 'FT' } },
        teams: { home: { name: 'X' }, away: { name: 'Y' } },
        goals: { home: 2, away: 1 },
        score: { fulltime: { home: 2, away: 1 }, extratime: { home: null, away: null }, penalty: { home: null, away: null } },
      }] },
      { fixtureId: 1 },
    );
    const { source: _s1, ...fdNoSource } = fd;
    const { source: _s2, ...asNoSource } = as;
    expect(fdNoSource).toEqual(asNoSource);
    expect(compareResults(fd, as)).toEqual({ match: true });
  });

  test('PEN shootout 1-1 (4-3) from both APIs agree', () => {
    const fd = parseFootballDataResponse({
      status: 'FINISHED',
      score: {
        duration: 'PENALTY_SHOOTOUT',
        fullTime: { home: 1, away: 1 },
        penalties: { home: 4, away: 3 },
      },
    });
    const as = parseApiSportsResponse(
      { response: [{
        fixture: { id: 2, status: { short: 'PEN' } },
        teams: { home: { name: 'X' }, away: { name: 'Y' } },
        goals: { home: 1, away: 1 },
        score: { fulltime: { home: 1, away: 1 }, extratime: { home: 0, away: 0 }, penalty: { home: 4, away: 3 } },
      }] },
      { fixtureId: 2 },
    );
    expect(compareResults(fd, as)).toEqual({ match: true });
  });
});

// ────────────────────────── STANDINGS PARSERS ──────────────────────────

describe('api-sports.io standings parser', () => {
  function asStandings(groups) {
    // groups: { 'A': [{rank, name, played, won, drawn, lost, gf, ga, gd, pts}, ...] }
    const arr = [];
    for (const [letter, rows] of Object.entries(groups)) {
      arr.push(rows.map((r) => ({
        rank: r.rank,
        team: { id: 100 + letter.charCodeAt(0), name: r.name },
        points: r.pts,
        goalsDiff: r.gd,
        group: `Group ${letter}`,
        form: r.form || 'WDL',
        all: {
          played: r.played,
          win: r.won,
          draw: r.drawn,
          lose: r.lost,
          goals: { for: r.gf, against: r.ga },
        },
      })));
    }
    return { response: [{ league: { id: 1, name: 'World Cup', season: 2026, standings: arr } }] };
  }

  test('extracts groups A & B with normalised fields', () => {
    const data = asStandings({
      A: [
        { rank: 1, name: 'Mexico', played: 3, won: 3, drawn: 0, lost: 0, gf: 7, ga: 1, gd: 6, pts: 9 },
        { rank: 2, name: 'South Korea', played: 3, won: 2, drawn: 0, lost: 1, gf: 5, ga: 3, gd: 2, pts: 6 },
        { rank: 3, name: 'Czechia', played: 3, won: 1, drawn: 0, lost: 2, gf: 2, ga: 4, gd: -2, pts: 3 },
        { rank: 4, name: 'South Africa', played: 3, won: 0, drawn: 0, lost: 3, gf: 1, ga: 7, gd: -6, pts: 0 },
      ],
      B: [
        { rank: 1, name: 'Switzerland', played: 3, won: 3, drawn: 0, lost: 0, gf: 6, ga: 2, gd: 4, pts: 9 },
        { rank: 2, name: 'Canada', played: 3, won: 2, drawn: 0, lost: 1, gf: 5, ga: 3, gd: 2, pts: 6 },
        { rank: 3, name: 'Bosnia and Herzegovina', played: 3, won: 1, drawn: 0, lost: 2, gf: 4, ga: 4, gd: 0, pts: 3 },
        { rank: 4, name: 'Qatar', played: 3, won: 0, drawn: 0, lost: 3, gf: 1, ga: 7, gd: -6, pts: 0 },
      ],
    });
    const out = parseApiSportsStandings(data);
    expect(out.source).toBe('api-sports.io');
    expect(Object.keys(out.groups).sort()).toEqual(['A', 'B']);
    expect(out.groups.A).toHaveLength(4);
    expect(out.groups.A[0]).toMatchObject({
      rank: 1, teamName: 'Mexico', points: 9, goalDiff: 6, goalsFor: 7, goalsAgainst: 1,
      played: 3, won: 3, drawn: 0, lost: 0,
    });
  });

  test('throws on missing response', () => {
    expect(() => parseApiSportsStandings({})).toThrow();
    expect(() => parseApiSportsStandings(null)).toThrow();
    expect(() => parseApiSportsStandings({ response: [{}] })).toThrow();
  });

  test('throws when no group letter can be extracted', () => {
    const bogus = {
      response: [{
        league: {
          standings: [[{
            rank: 1, team: { name: 'X' }, points: 0, goalsDiff: 0,
            all: { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } },
            group: 'Some Random Label',
          }]],
        },
      }],
    };
    expect(() => parseApiSportsStandings(bogus)).toThrow(/no group/i);
  });
});

describe('football-data.org standings parser', () => {
  test('extracts GROUP_STAGE TOTAL standings, ignores HOME/AWAY breakdowns', () => {
    const data = {
      standings: [
        {
          stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_A',
          table: [
            { position: 1, team: { name: 'Mexico' }, playedGames: 3, won: 3, draw: 0, lost: 0, goalsFor: 7, goalsAgainst: 1, goalDifference: 6, points: 9 },
            { position: 2, team: { name: 'South Korea' }, playedGames: 3, won: 2, draw: 0, lost: 1, goalsFor: 5, goalsAgainst: 3, goalDifference: 2, points: 6 },
            { position: 3, team: { name: 'Czechia' }, playedGames: 3, won: 1, draw: 0, lost: 2, goalsFor: 2, goalsAgainst: 4, goalDifference: -2, points: 3 },
            { position: 4, team: { name: 'South Africa' }, playedGames: 3, won: 0, draw: 0, lost: 3, goalsFor: 1, goalsAgainst: 7, goalDifference: -6, points: 0 },
          ],
        },
        // HOME/AWAY breakdowns must be ignored.
        { stage: 'GROUP_STAGE', type: 'HOME', group: 'GROUP_A', table: [{ position: 1, team: { name: 'IGNORED' }, points: 99 }] },
        {
          stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_B',
          table: [{ position: 1, team: { name: 'Switzerland' }, playedGames: 3, won: 3, draw: 0, lost: 0, goalsFor: 6, goalsAgainst: 2, goalDifference: 4, points: 9 }],
        },
      ],
    };
    const out = parseFootballDataStandings(data);
    expect(out.source).toBe('football-data.org');
    expect(Object.keys(out.groups).sort()).toEqual(['A', 'B']);
    expect(out.groups.A[0].teamName).toBe('Mexico');
    expect(out.groups.A[0].rank).toBe(1);
    expect(out.groups.A[0].points).toBe(9);
    expect(out.groups.B).toHaveLength(1);
  });

  test('throws on missing standings array', () => {
    expect(() => parseFootballDataStandings({})).toThrow();
    expect(() => parseFootballDataStandings(null)).toThrow();
    expect(() => parseFootballDataStandings({ standings: 'not array' })).toThrow();
  });

  test('throws when no GROUP_STAGE TOTAL entries exist', () => {
    expect(() => parseFootballDataStandings({
      standings: [{ stage: 'GROUP_STAGE', type: 'HOME', group: 'GROUP_A', table: [] }],
    })).toThrow(/no group/i);
  });
});

// ─────────── third-place ranking (FIFA Article 13 cross-group) ───────────

describe('rankThirdPlacedTeamsFromStandings', () => {
  function makeStandings(thirds) {
    // thirds: [{ letter, pts, gd, gf, name }]
    const groups = {};
    for (const t of thirds) {
      groups[t.letter] = [
        { rank: 1, teamName: 'top-' + t.letter, points: 9, goalDiff: 5, goalsFor: 7, goalsAgainst: 2, played: 3 },
        { rank: 2, teamName: 'mid-' + t.letter, points: 6, goalDiff: 2, goalsFor: 5, goalsAgainst: 3, played: 3 },
        { rank: 3, teamName: t.name, points: t.pts, goalDiff: t.gd, goalsFor: t.gf, goalsAgainst: 0, played: 3 },
        { rank: 4, teamName: 'bot-' + t.letter, points: 0, goalDiff: -7, goalsFor: 0, goalsAgainst: 7, played: 3 },
      ];
    }
    return { source: 'test', groups };
  }

  test('orders thirds by points → GD → GF', () => {
    const standings = makeStandings([
      { letter: 'A', name: 'A3', pts: 4, gd: 1, gf: 2 },
      { letter: 'B', name: 'B3', pts: 4, gd: 2, gf: 3 }, // higher GD wins
      { letter: 'C', name: 'C3', pts: 3, gd: 5, gf: 5 },
      { letter: 'D', name: 'D3', pts: 6, gd: 0, gf: 1 }, // higher pts wins overall
    ]);
    const sorted = rankThirdPlacedTeamsFromStandings(standings);
    expect(sorted.map((t) => t.teamName)).toEqual(['D3', 'B3', 'A3', 'C3']);
  });

  test('ties resolve to alphabetical group letter (deterministic)', () => {
    const standings = makeStandings([
      { letter: 'B', name: 'B3', pts: 4, gd: 2, gf: 3 },
      { letter: 'A', name: 'A3', pts: 4, gd: 2, gf: 3 }, // identical to B3 — A wins
    ]);
    const sorted = rankThirdPlacedTeamsFromStandings(standings);
    expect(sorted[0].groupLetter).toBe('A');
    expect(sorted[1].groupLetter).toBe('B');
  });

  test('returns one entry per group', () => {
    const standings = makeStandings([
      { letter: 'A', name: 'A3', pts: 4, gd: 1, gf: 2 },
      { letter: 'B', name: 'B3', pts: 3, gd: 0, gf: 1 },
      { letter: 'C', name: 'C3', pts: 5, gd: 3, gf: 4 },
    ]);
    const sorted = rankThirdPlacedTeamsFromStandings(standings);
    expect(sorted).toHaveLength(3);
  });
});

// ─────────────── determineWinnerFromResult ───────────────

describe('determineWinnerFromResult', () => {
  test('home wins regulation', () => {
    expect(determineWinnerFromResult({ homeScore: 2, awayScore: 1, extraTime: false, penalties: false }))
      .toBe('home');
  });
  test('away wins regulation', () => {
    expect(determineWinnerFromResult({ homeScore: 0, awayScore: 1, extraTime: false, penalties: false }))
      .toBe('away');
  });
  test('regulation draw without penalties returns null (impossible in knockout)', () => {
    expect(determineWinnerFromResult({ homeScore: 1, awayScore: 1, extraTime: false, penalties: false }))
      .toBeNull();
  });
  test('extra-time winner determined by score', () => {
    expect(determineWinnerFromResult({ homeScore: 2, awayScore: 1, extraTime: true, penalties: false }))
      .toBe('home');
  });
  test('penalty shootout: home wins on pens', () => {
    expect(determineWinnerFromResult({
      homeScore: 1, awayScore: 1, extraTime: true, penalties: true, penHome: 4, penAway: 3,
    })).toBe('home');
  });
  test('penalty shootout: away wins on pens', () => {
    expect(determineWinnerFromResult({
      homeScore: 1, awayScore: 1, extraTime: true, penalties: true, penHome: 3, penAway: 5,
    })).toBe('away');
  });
  test('null/undefined safe', () => {
    expect(determineWinnerFromResult(null)).toBeNull();
    expect(determineWinnerFromResult(undefined)).toBeNull();
    expect(determineWinnerFromResult({})).toBeNull();
  });
});
