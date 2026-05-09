#!/usr/bin/env node
/**
 * smoke-test-oracle.mjs — verify our oracle parser can ingest a real
 * live football match using the same API key our deployed app uses.
 *
 * Why: the parser in api/_lib/oracleParsers.js is unit-tested against
 * mocked payloads, but only a real live response from football-data.org
 * confirms (a) our key is valid, (b) our parser covers the actual shape
 * currently being served (APIs do drift), and (c) the standings
 * endpoint also responds.
 *
 * Usage:
 *   FOOTBALL_DATA_API_KEY=xxx node scripts/smoke-test-oracle.mjs --competition PL
 *
 *   --competition PL    (default)  English Premier League
 *   --competition CL              UEFA Champions League
 *   --competition BL1             Bundesliga
 *   --competition WC              FIFA World Cup
 *   --no-standings                skip the standings probe
 *
 * Exits 0 on full success, 1 on any failure (so it composes with /loop or CI).
 */

import {
  parseFootballDataResponse,
} from '../api/_lib/oracleParsers.js';

const args = process.argv.slice(2);
function arg(flag, fallback) {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
function flag(name) { return args.includes(name); }

const COMPETITION = arg('--competition', 'PL').toUpperCase();
const SKIP_STANDINGS = flag('--no-standings');

const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;

const COMPETITION_MAP = {
  PL: { fdCode: 'PL', label: 'English Premier League' },
  CL: { fdCode: 'CL', label: 'UEFA Champions League' },
  BL1: { fdCode: 'BL1', label: 'Bundesliga' },
  PD: { fdCode: 'PD', label: 'La Liga' },
  SA: { fdCode: 'SA', label: 'Serie A' },
  WC: { fdCode: 'WC', label: 'FIFA World Cup' },
};
const config = COMPETITION_MAP[COMPETITION];
if (!config) {
  console.error(`Unknown competition ${COMPETITION}. Choose: ${Object.keys(COMPETITION_MAP).join(', ')}`);
  process.exit(2);
}

console.log('GoalOracle — live oracle smoke-test');
console.log('─'.repeat(60));
console.log(`Competition: ${config.label} (${COMPETITION})`);
console.log(`football-data.org key: ${FD_KEY ? 'SET' : 'MISSING'}`);
console.log('─'.repeat(60));

let failures = 0;
function ok(name, detail = '') {
  console.log(`  ✓ ${name}${detail ? '  — ' + detail : ''}`);
}
function fail(name, detail = '') {
  failures++;
  console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`);
}

// ───────────────────── 1. Recent finished match ─────────────────────
let fdMatch = null;
console.log('\n[1] Find a recent finished match');
if (!FD_KEY) {
  fail('FOOTBALL_DATA_API_KEY missing — skipping');
} else {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const url = `https://api.football-data.org/v4/competitions/${config.fdCode}/matches?dateFrom=${sevenDaysAgo}&dateTo=${today}`;
    const r = await fetch(url, { headers: { 'X-Auth-Token': FD_KEY } });
    if (!r.ok) {
      fail('list matches', `HTTP ${r.status}`);
    } else {
      const data = await r.json();
      const finished = (data.matches || []).filter((m) => m.status === 'FINISHED');
      if (finished.length === 0) {
        fail('list matches', 'no FINISHED matches in last 7 days');
      } else {
        finished.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
        fdMatch = finished[0];
        ok('list matches', `${finished.length} FINISHED in window; picked ${fdMatch.homeTeam?.name} vs ${fdMatch.awayTeam?.name} (${fdMatch.utcDate})`);
      }
    }
  } catch (e) {
    fail('list matches', e.message);
  }

  if (fdMatch) {
    try {
      const detail = await fetch(`https://api.football-data.org/v4/matches/${fdMatch.id}`, {
        headers: { 'X-Auth-Token': FD_KEY },
      }).then((r) => r.json());
      const parsed = parseFootballDataResponse(detail);
      ok('parse match detail', `${parsed.homeScore}-${parsed.awayScore} (ET=${parsed.extraTime}, PEN=${parsed.penalties})`);
    } catch (e) {
      fail('parse match detail', e.message);
    }
  }
}

// ───────────────────── 2. Standings probe ─────────────────────
if (!SKIP_STANDINGS) {
  console.log('\n[2] League standings probe');
  if (FD_KEY) {
    try {
      const r = await fetch(`https://api.football-data.org/v4/competitions/${config.fdCode}/standings`, {
        headers: { 'X-Auth-Token': FD_KEY },
      });
      if (!r.ok) {
        fail('standings', `HTTP ${r.status}`);
      } else {
        const data = await r.json();
        const table = data.standings?.find((s) => s.type === 'TOTAL')?.table || [];
        if (table.length === 0) {
          fail('standings', 'empty TOTAL table');
        } else {
          const top = table[0];
          ok('standings', `${table.length} teams; #1: ${top.team?.name} (${top.points} pts)`);
        }
      }
    } catch (e) {
      fail('standings', e.message);
    }
  } else {
    fail('standings', 'no key');
  }
}

console.log('\n' + '─'.repeat(60));
if (failures === 0) {
  console.log('SUCCESS — football-data.org reachable, parser ingests live data correctly.');
} else {
  console.log(`${failures} failure(s) — see above. Investigate before relying on the oracle for the tournament.`);
}
console.log('─'.repeat(60));
process.exit(failures === 0 ? 0 : 1);
