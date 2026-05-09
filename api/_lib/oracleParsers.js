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

// ────────────────────────────── compare ────────────────────────────────

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
