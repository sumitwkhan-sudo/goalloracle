/**
 * oracleParsers.js — pure parsers for the two upstream match-result APIs.
 *
 * Extracted from api/oracle.js so the response → standardized-result mapping
 * can be unit-tested without having to mock fetch. The HTTP layer in
 * oracle.js is a thin wrapper; everything that interprets a payload lives
 * here.
 *
 * Standardized result shape (what both parsers must return):
 *   {
 *     source:     'football-data.org' | 'api-sports.io',
 *     homeScore:  number,
 *     awayScore:  number,
 *     extraTime:  boolean,
 *     penalties:  boolean,
 *     penHome:    number,
 *     penAway:    number,
 *   }
 *
 * Parsers throw on any input that should NOT be ingested as a final result
 * (match in progress, missing fields, schema drift). The caller treats a
 * throw as "this source isn't ready yet" and waits for the next pull.
 */

// ────────────────────────── football-data.org ──────────────────────────

export function parseFootballDataResponse(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('football-data.org: empty or non-object response');
  }
  if (data.status !== 'FINISHED') {
    throw new Error(`football-data.org: not finished (status=${data.status ?? 'undefined'})`);
  }
  const score = data.score;
  if (!score || typeof score !== 'object') {
    throw new Error('football-data.org: missing score object');
  }
  const ft = score.fullTime;
  if (!ft || typeof ft.home !== 'number' || typeof ft.away !== 'number') {
    throw new Error('football-data.org: missing or non-numeric score.fullTime');
  }
  const duration = score.duration;
  const pen = score.penalties || {};
  const extraTime = duration === 'EXTRA_TIME' || duration === 'PENALTY_SHOOTOUT';
  const penalties = duration === 'PENALTY_SHOOTOUT';

  return {
    source: 'football-data.org',
    homeScore: ft.home,
    awayScore: ft.away,
    extraTime,
    penalties,
    penHome: typeof pen.home === 'number' ? pen.home : 0,
    penAway: typeof pen.away === 'number' ? pen.away : 0,
  };
}

// ─────────────────────────── api-sports.io ─────────────────────────────

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN']);

export function parseApiSportsResponse(data, { fixtureId, homeTeam, awayTeam } = {}) {
  if (!data || typeof data !== 'object') {
    throw new Error('api-sports.io: empty or non-object response');
  }
  const fixtures = data.response;
  if (!Array.isArray(fixtures) || fixtures.length === 0) {
    throw new Error('api-sports.io: no fixtures returned');
  }

  let fixture;
  if (fixtureId) {
    fixture = fixtures[0];
  } else {
    // Search by team name with substring tolerance — upstream sometimes
    // returns "Korea Republic" where we know "South Korea", etc.
    const ht = (homeTeam || '').toLowerCase();
    const at = (awayTeam || '').toLowerCase();
    fixture = fixtures.find((f) => {
      const h = f.teams?.home?.name?.toLowerCase() || '';
      const a = f.teams?.away?.name?.toLowerCase() || '';
      return (h.includes(ht) || ht.includes(h)) && (a.includes(at) || at.includes(a));
    });
  }
  if (!fixture) {
    throw new Error(`api-sports.io: match not found for ${homeTeam} vs ${awayTeam}`);
  }

  const status = fixture.fixture?.status?.short;
  if (!FINISHED_STATUSES.has(status)) {
    throw new Error(`api-sports.io: not finished (status=${status ?? 'undefined'})`);
  }

  const goals = fixture.goals || {};
  if (typeof goals.home !== 'number' || typeof goals.away !== 'number') {
    throw new Error('api-sports.io: missing or non-numeric goals');
  }
  const score = fixture.score || {};
  const penScore = score.penalty || {};
  const etScore = score.extratime || {};

  const hasET =
    status === 'AET' ||
    status === 'PEN' ||
    (typeof etScore.home === 'number' && (etScore.home > 0 || etScore.away > 0));
  const hasPen =
    status === 'PEN' ||
    (typeof penScore.home === 'number' && (penScore.home > 0 || penScore.away > 0));

  return {
    source: 'api-sports.io',
    homeScore: goals.home,
    awayScore: goals.away,
    extraTime: hasET,
    penalties: hasPen,
    penHome: typeof penScore.home === 'number' ? penScore.home : 0,
    penAway: typeof penScore.away === 'number' ? penScore.away : 0,
  };
}

// ────────────────────────── compare ────────────────────────────────

export function compareResults(s1, s2) {
  const checks = [
    { field: 'homeScore', a: s1.homeScore, b: s2.homeScore },
    { field: 'awayScore', a: s1.awayScore, b: s2.awayScore },
    { field: 'extraTime', a: s1.extraTime, b: s2.extraTime },
    { field: 'penalties', a: s1.penalties, b: s2.penalties },
  ];
  if (s1.penalties || s2.penalties) {
    checks.push({ field: 'penHome', a: s1.penHome, b: s2.penHome });
    checks.push({ field: 'penAway', a: s1.penAway, b: s2.penAway });
  }
  const failures = checks.filter((c) => c.a !== c.b);
  if (failures.length === 0) return { match: true };
  return {
    match: false,
    details: failures.map((f) => `${f.field}: src1=${f.a}, src2=${f.b}`).join('; '),
  };
}

// ───────────────────────── STANDINGS PARSERS ─────────────────────────
//
// Both football-data.org v4 and api-football v3 expose group standings
// for tournament-style competitions. We normalise into a common shape so
// the daily email and bracket resolver don't care which source fed them:
//
//   {
//     source: 'api-sports.io' | 'football-data.org',
//     groups: {
//       'A': [
//         { rank, teamName, played, won, drawn, lost,
//           goalsFor, goalsAgainst, goalDiff, points, form? },
//         ... (one entry per team in the group, sorted by rank)
//       ],
//       'B': [...],
//       ...
//     }
//   }
//
// Group letters are extracted from the upstream's group label
// ("Group A", "GROUP_A", "Group A - 1") and normalised to single
// uppercase letters A–L.

function extractGroupLetter(raw) {
  if (typeof raw !== 'string') return null;
  // Tolerates "Group A", "GROUP_A", "Group A - 1", "A", etc.
  const m = raw.match(/^(?:GROUP[_\s]+)?([A-L])(?:\b|\s|$|[-_])/i);
  return m ? m[1].toUpperCase() : null;
}

// ─── api-football v3 ───
// GET /v3/standings?league={id}&season={s}
// Response shape (for tournaments with groups):
//   { response: [{ league: { standings: [ [groupA rows], [groupB rows], ... ] } }] }
// Each row: { rank, team: { id, name }, points, goalsDiff, all: { played,
//             win, draw, lose, goals: { for, against } }, form, group }
export function parseApiSportsStandings(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('api-sports.io standings: empty or non-object response');
  }
  const league = data.response?.[0]?.league;
  if (!league || !Array.isArray(league.standings)) {
    throw new Error('api-sports.io standings: missing league.standings');
  }
  // For tournaments with groups, league.standings is an array-of-arrays
  // (one per group). For league competitions it's [[...allTeams]] with
  // a single entry. We treat single-array case as "no groups".
  const groups = {};
  for (const groupRows of league.standings) {
    if (!Array.isArray(groupRows) || groupRows.length === 0) continue;
    // The group letter lives on each row (`row.group` = "Group A").
    const letter = extractGroupLetter(groupRows[0]?.group) || extractGroupLetter(groupRows[0]?.team?.name);
    if (!letter) continue;
    groups[letter] = groupRows.map((row) => ({
      rank: row.rank,
      teamName: row.team?.name || '',
      played: row.all?.played ?? 0,
      won: row.all?.win ?? 0,
      drawn: row.all?.draw ?? 0,
      lost: row.all?.lose ?? 0,
      goalsFor: row.all?.goals?.for ?? 0,
      goalsAgainst: row.all?.goals?.against ?? 0,
      goalDiff: row.goalsDiff ?? ((row.all?.goals?.for ?? 0) - (row.all?.goals?.against ?? 0)),
      points: row.points ?? 0,
      form: row.form || null,
    }));
  }
  if (Object.keys(groups).length === 0) {
    throw new Error('api-sports.io standings: no group data extracted');
  }
  return { source: 'api-sports.io', groups };
}

// ─── football-data.org v4 ───
// GET /v4/competitions/{code}/standings
// Response shape (tournaments emit one standings entry per group):
//   { standings: [
//       { stage: 'GROUP_STAGE', type: 'TOTAL', group: 'GROUP_A',
//         table: [{ position, team: {name}, playedGames, won, draw, lost,
//                   points, goalsFor, goalsAgainst, goalDifference }, ...] },
//       ... (one per group)
//     ] }
export function parseFootballDataStandings(data) {
  if (!data || typeof data !== 'object') {
    throw new Error('football-data.org standings: empty or non-object response');
  }
  const all = data.standings;
  if (!Array.isArray(all)) {
    throw new Error('football-data.org standings: missing standings array');
  }
  const groups = {};
  for (const s of all) {
    if (s.type !== 'TOTAL') continue; // skip HOME / AWAY breakdowns
    const letter = extractGroupLetter(s.group);
    if (!letter) continue;
    if (!Array.isArray(s.table)) continue;
    groups[letter] = s.table.map((row) => ({
      rank: row.position,
      teamName: row.team?.name || '',
      played: row.playedGames ?? 0,
      won: row.won ?? 0,
      drawn: row.draw ?? 0,
      lost: row.lost ?? 0,
      goalsFor: row.goalsFor ?? 0,
      goalsAgainst: row.goalsAgainst ?? 0,
      goalDiff: row.goalDifference ?? 0,
      points: row.points ?? 0,
      form: row.form || null,
    }));
  }
  if (Object.keys(groups).length === 0) {
    throw new Error('football-data.org standings: no group data extracted');
  }
  return { source: 'football-data.org', groups };
}

// ─── Cross-group third-place ranking (FIFA Article 13) ───
//
// FIFA WC 2026: top 2 from each group + best 8 of 12 third-placed teams.
// This helper takes a parsed standings object and returns the third-placed
// teams ordered by FIFA tiebreaker: points → GD → goals scored → fair-play
// (we don't have card data so this collapses to FIFA ranking input, which
// we don't fetch either — so for now it falls through to a stable order
// by group letter for ties below GF).
//
// Returns an array of { groupLetter, team } sorted top-to-bottom. The first
// 8 entries are the qualifiers; the rest are eliminated.
export function rankThirdPlacedTeamsFromStandings(standings) {
  const thirds = [];
  for (const [letter, rows] of Object.entries(standings.groups || {})) {
    const third = rows.find((r) => r.rank === 3) || rows[2];
    if (third) thirds.push({ groupLetter: letter, ...third });
  }
  thirds.sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points;
    if (b.goalDiff !== a.goalDiff) return b.goalDiff - a.goalDiff;
    if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
    return a.groupLetter.localeCompare(b.groupLetter); // deterministic tiebreaker
  });
  return thirds;
}

// ─── Determine knockout fixture winner ───
//
// Given a standardized result object (the shape both parsers above
// produce), returns 'home' or 'away' or null if the match wasn't decided.
// For penalty shootouts, uses penHome/penAway. For ET-decided matches,
// uses homeScore/awayScore (which already reflect ET goals — both
// parsers fold ET into homeScore/awayScore in our standardized shape).
export function determineWinnerFromResult(result) {
  if (!result) return null;
  // Penalty shootout: shootout score is the tiebreaker.
  if (result.penalties === true) {
    if (typeof result.penHome === 'number' && typeof result.penAway === 'number') {
      if (result.penHome > result.penAway) return 'home';
      if (result.penAway > result.penHome) return 'away';
    }
    return null;
  }
  // Regular or ET — homeScore/awayScore already include ET goals.
  if (typeof result.homeScore === 'number' && typeof result.awayScore === 'number') {
    if (result.homeScore > result.awayScore) return 'home';
    if (result.awayScore > result.homeScore) return 'away';
  }
  return null;
}
