#!/usr/bin/env node
/**
 * verify-results.mjs — Daily WC verification script.
 *
 * Run:
 *   node scripts/verify-results.mjs              # local-only checks
 *   API_BASE=https://goaloracle.io \
 *     ADMIN_TOKEN=<firebase-id-token> \
 *     node scripts/verify-results.mjs --live    # also hits prod admin endpoints
 *
 * Local-only mode (no env): runs the test suite + structural checks against
 * the schedule + Annexe C. Always safe.
 *
 * Live mode: additionally fetches matchResults from /api/admin and verifies
 * every match that has already kicked off has been ingested with the
 * required fields. Requires a Firebase ID token from a superadmin user.
 *
 * Output is a checklist with ✓ / ✗ rows. Exit code 0 if everything is
 * green, 1 otherwise — wrap in /loop or cron for daily runs.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const LIVE = argv.includes('--live');
const API_BASE = process.env.API_BASE || 'https://goaloracle.io';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  const mark = ok ? '✓' : '✗';
  const line = `${mark} ${name}${detail ? '  — ' + detail : ''}`;
  console.log(line);
}

console.log('GoalOracle — daily WC verification');
console.log('─'.repeat(60));
console.log(`Mode: ${LIVE ? 'LIVE (' + API_BASE + ')' : 'LOCAL ONLY'}`);
console.log('Time:', new Date().toISOString());
console.log('─'.repeat(60));

// ───────────────────────────── 1. TEST SUITE ─────────────────────────────
console.log('\n[1] Running npm test…');
{
  const r = spawnSync('npm', ['test', '--silent'], { cwd: ROOT, encoding: 'utf8' });
  const passed = (r.stdout.match(/Tests\s+(\d+)\s+passed/i) || [])[1];
  const failed = (r.stdout.match(/(\d+)\s+failed/i) || [])[1];
  const ok = r.status === 0;
  check(
    'Test suite passes',
    ok,
    ok ? `${passed} passed` : `${failed || '?'} failed — see npm test output`
  );
  if (!ok) {
    console.log('\n--- npm test stderr ---');
    console.log(r.stderr.slice(0, 2000));
  }
}

// ───────────────────────── 2. SCHEDULE STRUCTURE ─────────────────────────
console.log('\n[2] Schedule integrity…');
{
  const matchesRaw = readFileSync(path.join(ROOT, 'src/data/matches.js'), 'utf8');
  const ids = [...matchesRaw.matchAll(/id:\s*'([^']+)'/g)].map((m) => m[1]);
  check('104 matches in schedule', ids.length === 104, `got ${ids.length}`);
  check('all match IDs unique', new Set(ids).size === ids.length, `${ids.length - new Set(ids).size} dup(s)`);
}

// ─────────────────────── 3. ANNEXE C STRUCTURE ───────────────────────────
console.log('\n[3] Annexe C…');
{
  const annexe = JSON.parse(readFileSync(path.join(ROOT, 'src/data/annexe-c.json'), 'utf8'));
  const keys = Object.keys(annexe.lookup);
  check('495 Annexe C lookup entries', keys.length === 495, `got ${keys.length}`);
  let badRouting = 0;
  for (const [k, routing] of Object.entries(annexe.lookup)) {
    const want = ['M74', 'M77', 'M79', 'M80', 'M81', 'M82', 'M85', 'M87'].sort().join(',');
    const got = Object.keys(routing).sort().join(',');
    if (want !== got) badRouting++;
  }
  check('every routing covers all 8 M-IDs', badRouting === 0, badRouting > 0 ? `${badRouting} bad routings` : '');
}

// ───────────────── 4. LIVE: match results ingested on time ─────────────────
if (LIVE) {
  console.log('\n[4] Live result ingestion (vs deployed API)…');
  if (!ADMIN_TOKEN) {
    check('ADMIN_TOKEN provided', false, 'skipping live checks — set ADMIN_TOKEN env var');
  } else {
    let liveOk = true;
    let resultsByMatchId = {};
    try {
      const r = await fetch(`${API_BASE}/api/admin?type=results`, {
        headers: { authorization: `Bearer ${ADMIN_TOKEN}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const json = await r.json();
      resultsByMatchId = json.results || {};
      check('admin?type=results endpoint reachable', true, `${Object.keys(resultsByMatchId).length} stored result(s)`);
    } catch (e) {
      check('admin?type=results endpoint reachable', false, e.message);
      liveOk = false;
    }

    if (liveOk) {
      const matchesRaw = readFileSync(path.join(ROOT, 'src/data/matches.js'), 'utf8');
      const matchEntries = [...matchesRaw.matchAll(
        /\{\s*id:\s*'([^']+)'[^}]*?date:\s*'([^']+)'[^}]*?time:\s*'([^']+)'/g,
      )].map(([, id, date, time]) => ({ id, date, time }));
      const now = Date.now();
      const completedExpected = matchEntries.filter((m) => {
        const [hh, mm] = m.time.split(':').map(Number);
        const d = new Date(`${m.date}T00:00:00Z`);
        d.setUTCHours(hh + 4, mm, 0, 0);
        // Match has finished if kickoff was more than ~3h ago (typical match
        // length incl. ET + pens + buffer). Tighten if you want stricter alerts.
        return d.getTime() < now - 3 * 60 * 60 * 1000;
      });

      const missing = completedExpected.filter((m) => !resultsByMatchId[m.id]);
      check(
        'every completed match has a stored result',
        missing.length === 0,
        missing.length > 0
          ? `MISSING: ${missing.map((m) => m.id).slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`
          : `${completedExpected.length} completed matches checked`,
      );

      const incomplete = completedExpected.filter((m) => {
        const r = resultsByMatchId[m.id];
        if (!r) return false; // already counted above
        if (r.completed !== true) return true;
        if (typeof r.homeScore !== 'number' || typeof r.awayScore !== 'number') return true;
        return false;
      });
      check(
        'every stored result has completed=true and numeric scores',
        incomplete.length === 0,
        incomplete.length > 0 ? `BAD: ${incomplete.map((m) => m.id).join(', ')}` : '',
      );

      const disputed = Object.entries(resultsByMatchId).filter(([, r]) => r.status === 'disputed');
      check(
        'no results in `disputed` status (oracle disagreement)',
        disputed.length === 0,
        disputed.length > 0 ? `disputed: ${disputed.map(([id]) => id).join(', ')}` : '',
      );

      const partial = Object.entries(resultsByMatchId).filter(([, r]) => r.status === 'partial');
      check(
        'no results in `partial` status (only one source returned)',
        partial.length === 0,
        partial.length > 0 ? `partial: ${partial.map(([id]) => id).join(', ')}` : '',
      );
    }
  }
} else {
  console.log('\n[4] Live result ingestion — skipped (run with --live and ADMIN_TOKEN set)');
}

// ─────────────────── 5. ORACLE SMOKE TEST (optional) ───────────────────
if (process.env.FOOTBALL_DATA_API_KEY) {
  console.log('\n[5] Oracle smoke-test against a live league (--no-standings to keep it short)…');
  const r = spawnSync('node', ['scripts/smoke-test-oracle.mjs', '--competition', 'PL', '--no-standings'], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  const ok = r.status === 0;
  check(
    'oracle smoke-test (PL, --no-standings)',
    ok,
    ok ? 'parsers ingested live data + sources agree' : 'see failures above',
  );
  if (!ok) {
    console.log('\n--- smoke-test stderr ---');
    console.log(r.stderr.slice(0, 1000));
    console.log('--- smoke-test stdout (last 30 lines) ---');
    console.log(r.stdout.split('\n').slice(-30).join('\n'));
  }
} else {
  console.log('\n[5] Oracle smoke-test — skipped (set FOOTBALL_DATA_API_KEY to enable)');
}

// ─────────────────────────── SUMMARY ───────────────────────────
const failed = checks.filter((c) => !c.ok);
console.log('\n' + '─'.repeat(60));
console.log(`SUMMARY: ${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length > 0) {
  console.log('\nFailures to investigate:');
  for (const c of failed) console.log(`  ✗ ${c.name}${c.detail ? ' — ' + c.detail : ''}`);
}
console.log('─'.repeat(60));
process.exit(failed.length === 0 ? 0 : 1);
