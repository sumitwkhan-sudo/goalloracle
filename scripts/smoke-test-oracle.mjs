#!/usr/bin/env node
/**
 * smoke-test-oracle.mjs — verify our oracle parsers can ingest a real
 * live football match using the same API keys our deployed app uses.
 *
 * Why: the parsers in api/_lib/oracleParsers.js are unit-tested against
 * mocked payloads, but only a real live response from football-data.org
 * + api-sports.io confirms (a) our keys are valid, (b) our parsers cover
 * the actual shape currently being served (APIs do drift), and (c) the
 * two sources agree on a known fixture.
 *
 * Usage:
 *   FOOTBALL_DATA_API_KEY=xxx APISPORTS_API_KEY=yyy \
 *     node scripts/smoke-test-oracle.mjs --competition PL
 *
 *   --competition PL    (default)  English Premier League
 *   --competition CL              UEFA Champions League
 *   --competition BL1             Bundesliga
 *   --competition WC              FIFA World Cup
 *   --date YYYY-MM-DD             override (default: pull today's window)
 *   --no-standings                skip the standings probe
 *
 * Exits 0 on full success, 1 on any failure (so it composes with /loop or CI).
 */

import {
  parseFootballDataResponse,
  parseApiSportsResponse,
  compareResults,
} from '../api/_lib/oracleParsers.js';

const args = process.argv.slice(2);
function arg(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function flag(name) { return args.includes(name); }

const COMPETITION = arg('--competition', 'PL').toUpperCase();
const DATE_OVERRIDE = arg('--date', null);
const SKIP_STANDINGS = flag('--no-standings');

const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;
const AS_KEY = process.env.APISPORTS_API_KEY;

// European league seasons run Aug → May, named by the START year. So
// "season 2025" on api-sports.io = the 2025-26 season. Auto-compute
// from today so we don't query stale data after the calendar flips.
function currentEuropeanSeason() {
  const now = new Date();
  return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
const SEASON = currentEuropeanSeason();

// football-data.org uses 2-letter codes; api-sports.io uses numeric league IDs.
const COMPETITION_MAP = {
  PL: { fdCode: 'PL', asLeague: 39, asSeason: SEASON, label: 'English Premier League' },
  CL: { fdCode: 'CL', asLeague: 2, asSeason: SEASON, label: 'UEFA Champions League' },
  BL1: { fdCode: 'BL1', asLeague: 78, asSeason: SEASON, label: 'Bundesliga' },
  PD: { fdCode: 'PD', asLeague: 140, asSeason: SEASON, label: 'La Liga' },
  SA: { fdCode: 'SA', asLeague: 135, asSeason: SEASON, label: 'Serie A' },
  WC: { fdCode: 'WC', asLeague: 1, asSeason: 2026, label: 'FIFA World Cup' },
};
const config = COMPETITION_MAP[COMPETITION];
if (!config) {
  console.error(`Unknown competition ${COMPETITION}. Choose: ${Object.keys(COMPETITION_MAP).join(', ')}`);
  process.exit(2);
}

console.log('GoalOracle — live oracle smoke-test');
console.log('─'.repeat(60));
console.log(`Competition: ${config.label} (${COMPETITION})`);
console.log(`Date filter: ${DATE_OVERRIDE || 'today / yesterday'}`);
console.log(`football-data.org key: ${FD_KEY ? 'SET' : 'MISSING'}`);
console.log(`api-sports.io key: ${AS_KEY ? 'SET' : 'MISSING'}`);
console.log('─'.repeat(60));

let failures = 0;
function ok(name, detail = '') {
  console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`);
}
function fail(name, detail = '') {
  failures++;
  console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`);
}

// ───────────────────── 1. football-data.org ─────────────────────
let fdMatch = null;
console.log('\n[1] football-data.org — find a recent finished match');
if (!FD_KEY) {
  fail('FOOTBALL_DATA_API_KEY missing — skipping');
} else {
  try {
    // List recent matches in this competition. v4 supports dateFrom/dateTo
    // for the matches endpoint.
    const today = DATE_OVERRIDE || new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.football-data.org/v4/competitions/${config.fdCode}/matches?dateFrom=${sevenDaysAgo}&dateTo=${today}`;
    const r = await fetch(url, { headers: { 'X-Auth-Token': FD_KEY } });
    if (!r.ok) {
      fail('list matches', `HTTP ${r.status}`);
    } else {
      const data = await r.json();
      const finished = (data.matches || []).filter(m => m.status === 'FINISHED');
      if (finished.length === 0) {
        fail('list matches', 'no FINISHED matches in last 7 days');
      } else {
        // Pick the most recent finished match.
        finished.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
        fdMatch = finished[0];
        ok('list matches', `${finished.length} FINISHED in window; picked ${fdMatch.homeTeam?.name} vs ${fdMatch.awayTeam?.name} (${fdMatch.utcDate})`);
      }
    }
  } catch (e) {
    fail('list matches', e.message);
  }

  // Now fetch the match detail and parse it
  if (fdMatch) {
    try {
      const detail = await fetch(`https://api.football-data.org/v4/matches/${fdMatch.id}`, {
        headers: { 'X-Auth-Token': FD_KEY },
      }).then(r => r.json());
      const parsed = parseFootballDataResponse(detail);
      ok('parse match detail', `${parsed.homeScore}-${parsed.awayScore} (ET=${parsed.extraTime}, PEN=${parsed.penalties})`);
      fdMatch._parsed = parsed;
      fdMatch._detail = detail;
    } catch (e) {
      fail('parse match detail', e.message);
    }
  }
}

// ───────────────────── 2. api-sports.io ──────────────────────
let asParsed = null;
console.log('\n[2] api-sports.io — fetch the SAME match (cross-check)');
if (!AS_KEY) {
  fail('APISPORTS_API_KEY missing — skipping');
} else if (!fdMatch) {
  fail('no anchor match from football-data.org — skipping cross-check');
} else {
  try {
    const matchDate = fdMatch.utcDate.slice(0, 10);
    const url = `https://v3.football.api-sports.io/fixtures?league=${config.asLeague}&season=${config.asSeason}&date=${matchDate}`;
    const r = await fetch(url, { headers: { 'x-apisports-key': AS_KEY } });
    if (!r.ok) {
      fail('list fixtures by date', `HTTP ${r.status}`);
    } else {
      const data = await r.json();
      ok('list fixtures by date', `${data.results || data.response?.length || 0} fixture(s)`);
      try {
        asParsed = parseApiSportsResponse(data, {
          homeTeam: fdMatch.homeTeam?.name,
          awayTeam: fdMatch.awayTeam?.name,
        });
        ok('parse + match by team name', `${asParsed.homeScore}-${asParsed.awayScore} (ET=${asParsed.extraTime}, PEN=${asParsed.penalties})`);
      } catch (e) {
        fail('parse + match by team name', e.message);
      }
    }
  } catch (e) {
    fail('list fixtures by date', e.message);
  }
}

// ───────────────────── 3. cross-source agreement ─────────────────────
console.log('\n[3] cross-source agreement');
if (fdMatch?._parsed && asParsed) {
  const out = compareResults(fdMatch._parsed, asParsed);
  if (out.match) {
    ok('two sources agree', `${fdMatch._parsed.homeScore}-${fdMatch._parsed.awayScore}`);
  } else {
    fail('two sources DISAGREE', out.details);
  }
} else {
  fail('cannot cross-check', 'one or both sources failed above');
}

// ───────────────────── 4. league standings ─────────────────────
if (!SKIP_STANDINGS) {
  console.log('\n[4] league standings probe');
  if (FD_KEY) {
    try {
      const r = await fetch(`https://api.football-data.org/v4/competitions/${config.fdCode}/standings`, {
        headers: { 'X-Auth-Token': FD_KEY },
      });
      if (!r.ok) {
        fail('football-data.org standings', `HTTP ${r.status}`);
      } else {
        const data = await r.json();
        const table = data.standings?.find(s => s.type === 'TOTAL')?.table || [];
        if (table.length === 0) {
          fail('football-data.org standings', 'empty TOTAL table');
        } else {
          const top = table[0];
          ok('football-data.org standings', `${table.length} teams; #1: ${top.team?.name} (${top.points} pts)`);
        }
      }
    } catch (e) {
      fail('football-data.org standings', e.message);
    }
  } else {
    fail('football-data.org standings', 'no key');
  }

  if (AS_KEY) {
    try {
      const r = await fetch(`https://v3.football.api-sports.io/standings?league=${config.asLeague}&season=${config.asSeason}`, {
        headers: { 'x-apisports-key': AS_KEY },
      });
      if (!r.ok) {
        fail('api-sports.io standings', `HTTP ${r.status}`);
      } else {
        const data = await r.json();
        const table = data.response?.[0]?.league?.standings?.[0] || [];
        if (table.length === 0) {
          fail('api-sports.io standings', 'empty standings');
        } else {
          const top = table[0];
          ok('api-sports.io standings', `${table.length} teams; #1: ${top.team?.name} (${top.points} pts)`);
        }
      }
    } catch (e) {
      fail('api-sports.io standings', e.message);
    }
  } else {
    fail('api-sports.io standings', 'no key');
  }
}

console.log('\n' + '─'.repeat(60));
if (failures === 0) {
  console.log('SUCCESS — both sources reachable and parsers ingest live data correctly.');
} else {
  console.log(`${failures} failure(s) — see above. Investigate before relying on the oracle for prizes.`);
}
console.log('─'.repeat(60));
process.exit(failures === 0 ? 0 : 1);
