/**
 * /api/cron/daily-report.js — daily health email to the operator.
 *
 * Runs once a day. Computes:
 *   1. Pipeline: are both oracles reachable right now?
 *   2. Match results: every match that should be done — does it have a
 *      verified result? Anything stuck in disputed / partial / missing?
 *   3. Per-league participation: total members, submitted, complete.
 *   4. Anti-Sybil bookkeeping: signups in last 24h, banned IPs.
 *
 * Sends an HTML email via Resend to REPORT_EMAIL (or FEEDBACK_EMAIL as
 * fallback). Subject line tells you at a glance whether anything needs
 * attention. If everything's green, the email is a 1-paragraph "all
 * good" — easy to skim and ignore. If something's broken, it's loud.
 *
 * Schedule lives in vercel.json. Auth is the same CRON_SECRET as the
 * other crons.
 */

import { db, admin, applyCors, verifyAuth } from '../_lib/firebase.js';
import {
  parseFootballDataResponse, parseApiSportsResponse,
  parseApiSportsStandings, parseFootballDataStandings,
  rankThirdPlacedTeamsFromStandings,
} from '../_lib/oracleParsers.js';
import { escapeHtml } from '../_lib/security.js';
import { sendOperatorAlert } from '../_lib/alerts.js';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';
import { FieldValue } from 'firebase-admin/firestore';

async function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const claims = await verifyAuth(req);
  if (!claims) return false;
  const userSnap = await db.collection('users').doc(claims.userId).get();
  return userSnap.exists && userSnap.data().role === 'superadmin';
}

function kickoffUtcMs(match) {
  const [hh, mm] = match.time.split(':').map(Number);
  const date = new Date(`${match.date}T00:00:00Z`);
  date.setUTCHours(hh + 4, mm, 0, 0);
  return date.getTime();
}

async function probeOracle1() {
  const key = process.env.FOOTBALL_DATA_API_KEY;
  if (!key) return { ok: false, error: 'no key' };
  try {
    const r = await fetch('https://api.football-data.org/v4/competitions/WC', {
      headers: { 'X-Auth-Token': key },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function probeOracle2() {
  const key = process.env.APISPORTS_API_KEY;
  if (!key) return { ok: false, error: 'no key' };
  try {
    const r = await fetch('https://v3.football.api-sports.io/status', {
      headers: { 'x-apisports-key': key },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { ok: false, error: `HTTP ${r.status}` };
    return { ok: true };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Pulls live group standings. Tries api-sports.io first (better group
// structure for tournament standings), falls back to football-data.org.
// Either source's failure surfaces as `null` so the email still ships.
async function fetchStandings() {
  const asKey = process.env.APISPORTS_API_KEY;
  if (asKey) {
    try {
      const r = await fetch('https://v3.football.api-sports.io/standings?league=1&season=2026', {
        headers: { 'x-apisports-key': asKey },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        return parseApiSportsStandings(data);
      }
    } catch { /* fall through */ }
  }
  const fdKey = process.env.FOOTBALL_DATA_API_KEY;
  if (fdKey) {
    try {
      const r = await fetch('https://api.football-data.org/v4/competitions/WC/standings', {
        headers: { 'X-Auth-Token': fdKey },
        signal: AbortSignal.timeout(8000),
      });
      if (r.ok) {
        const data = await r.json();
        return parseFootballDataStandings(data);
      }
    } catch { /* fall through */ }
  }
  return null;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  if (!(await isAuthorized(req))) return res.status(401).json({ error: 'Unauthorized' });

  try {
    return await runReport(req, res);
  } catch (e) {
    console.error('[cron/daily-report] fatal:', e);
    await sendOperatorAlert(
      'Daily health report crashed — no email today',
      {
        what: 'The /api/cron/daily-report endpoint threw an uncaught error before it could send the daily summary. You did not receive the normal daily-health email. The cron will run again tomorrow at 08:00 UTC.',
        why: [
          'Database read failure (Firestore admin SDK timeout or quota)',
          'Resend API issue',
          'Code bug in the report generator',
        ],
        resolution: [
          'Check Vercel → Functions → Logs for /api/cron/daily-report.',
          'If it crashes a second day in a row, reply to this email and I can investigate.',
          'Meanwhile, open the admin → Oracle tab and click "Run Health Check" + "Test EPL" to do the same checks manually.',
        ],
        context: { error: e.message, stack: (e.stack || '').slice(0, 500) },
      },
    );
    return res.status(500).json({ error: e.message });
  }
}

async function runReport(req, res) {
  const now = Date.now();
  const FT_GRACE_MS = 3 * 60 * 60 * 1000;

  // ── 1. Oracle health ──
  const [o1, o2, standings] = await Promise.all([probeOracle1(), probeOracle2(), fetchStandings()]);
  const top3rds = standings ? rankThirdPlacedTeamsFromStandings(standings) : [];

  // ── 2. Match results ──
  const resultsSnap = await db.collection('matchResults').get();
  const results = {};
  resultsSnap.docs.forEach((d) => { results[d.id] = d.data(); });

  const completedExpected = WORLD_CUP_MATCHES.filter((m) => kickoffUtcMs(m) < now - FT_GRACE_MS);
  const missing = completedExpected.filter((m) => !results[m.id] || results[m.id].completed !== true).map((m) => m.id);
  const disputed = Object.entries(results).filter(([, r]) => r.status === 'disputed').map(([id]) => id);
  const partial = Object.entries(results).filter(([, r]) => r.status === 'partial').map(([id]) => id);

  // Matches scored in the last 24h (verifiedAt within window) — recent activity.
  const recentlyVerified = Object.entries(results).filter(([, r]) => {
    if (!r.verifiedAt) return false;
    const t = new Date(r.verifiedAt).getTime();
    return now - t < 24 * 60 * 60 * 1000;
  });

  // ── 3. Per-league participation ──
  const leaguesSnap = await db.collection('leagues').get();
  const leagueStats = [];
  for (const ld of leaguesSnap.docs) {
    const league = ld.data();
    if (league.predictionMode !== 'simple') continue; // only Quick Picks — Classic disabled
    const members = league.members || [];
    if (members.length === 0) continue;
    // Count predictions docs for this league via composite key.
    let submitted = 0;
    let complete = 0;
    const compositeIds = members.map((uid) => `${uid}__${ld.id}`);
    for (let i = 0; i < compositeIds.length; i += 30) {
      const batch = compositeIds.slice(i, i + 30);
      const snap = await db.collection('simplePredictions')
        .where(admin.firestore.FieldPath.documentId(), 'in', batch)
        .get().catch(() => ({ docs: [] }));
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data?.userId) {
          submitted++;
          if (data.isComplete || data.knockoutPredictions?.final?.[0]?.winnerId) complete++;
        }
      });
    }
    leagueStats.push({ id: ld.id, name: league.name || ld.id, members: members.length, submitted, complete });
  }
  leagueStats.sort((a, b) => b.members - a.members);

  // ── 4. Anti-Sybil ──
  const bansSnap = await db.collection('bannedIps').get();
  const bansCount = bansSnap.size;
  const usersSnap = await db.collection('users').get();
  const totalUsers = usersSnap.size;
  const newUsersDay = usersSnap.docs.filter((d) => {
    const t = d.data().createdAt;
    if (!t) return false;
    const ms = t.toMillis ? t.toMillis() : (t._seconds ? t._seconds * 1000 : new Date(t).getTime());
    return now - ms < 24 * 60 * 60 * 1000;
  }).length;

  // ── Aggregate health ──
  const issues = [];
  if (!o1.ok) issues.push(`football-data.org unreachable (${o1.error})`);
  if (!o2.ok) issues.push(`api-sports.io unreachable (${o2.error})`);
  if (missing.length > 0) issues.push(`${missing.length} completed match(es) missing results`);
  if (disputed.length > 0) issues.push(`${disputed.length} disputed result(s) need admin review`);
  if (partial.length > 0) issues.push(`${partial.length} partial result(s) — only one source returned`);

  const allGreen = issues.length === 0;
  const subject = allGreen
    ? `[GoalOracle] Daily — all green (${recentlyVerified.length} matches verified in 24h)`
    : `[GoalOracle] Daily — ${issues.length} issue(s) need attention`;

  // ── HTML body ──
  const html = `<div style="font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;color:#111">
  <div style="background:${allGreen ? '#0d4a2c' : '#7a1d1d'};color:#fff;padding:18px 24px;border-radius:10px 10px 0 0">
    <div style="font-size:13px;opacity:0.7">GoalOracle daily health report</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${escapeHtml(allGreen ? 'All green' : `${issues.length} issue(s) to investigate`)}</div>
    <div style="font-size:13px;opacity:0.7;margin-top:6px">${escapeHtml(new Date().toUTCString())}</div>
  </div>
  <div style="background:#fff;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 10px 10px;padding:18px 24px">
    ${issues.length > 0 ? `<div style="background:#fff5f5;border:1px solid #f5b5b5;border-radius:8px;padding:12px 16px;margin:0 0 18px"><strong>Action needed:</strong><ul style="margin:8px 0 0;padding-left:20px">${issues.map((i) => `<li>${escapeHtml(i)}</li>`).join('')}</ul></div>` : ''}

    <h3 style="font-size:14px;color:#444;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.5px">Result-feed APIs</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#666">football-data.org</td><td style="padding:6px 0;text-align:right;color:${o1.ok ? '#0d4a2c' : '#7a1d1d'};font-weight:600">${o1.ok ? 'Connected' : escapeHtml(o1.error)}</td></tr>
      <tr><td style="padding:6px 0;color:#666">api-sports.io</td><td style="padding:6px 0;text-align:right;color:${o2.ok ? '#0d4a2c' : '#7a1d1d'};font-weight:600">${o2.ok ? 'Connected' : escapeHtml(o2.error)}</td></tr>
    </table>

    <h3 style="font-size:14px;color:#444;margin:18px 0 8px;text-transform:uppercase;letter-spacing:0.5px">Match results</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#666">Verified in last 24 hours</td><td style="padding:6px 0;text-align:right;font-weight:600">${recentlyVerified.length}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Total matches with verified result</td><td style="padding:6px 0;text-align:right;font-weight:600">${Object.values(results).filter((r) => r.completed).length} / ${WORLD_CUP_MATCHES.length}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Missing (match finished, no result)</td><td style="padding:6px 0;text-align:right;color:${missing.length === 0 ? '#0d4a2c' : '#7a1d1d'};font-weight:600">${missing.length}${missing.length > 0 ? ' — ' + escapeHtml(missing.slice(0, 5).join(', ')) + (missing.length > 5 ? '…' : '') : ''}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Disputed (oracles disagree)</td><td style="padding:6px 0;text-align:right;color:${disputed.length === 0 ? '#0d4a2c' : '#7a1d1d'};font-weight:600">${disputed.length}${disputed.length > 0 ? ' — ' + escapeHtml(disputed.join(', ')) : ''}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Partial (only one source returned)</td><td style="padding:6px 0;text-align:right;color:${partial.length === 0 ? '#0d4a2c' : '#7a1d1d'};font-weight:600">${partial.length}${partial.length > 0 ? ' — ' + escapeHtml(partial.join(', ')) : ''}</td></tr>
    </table>

    ${standings && Object.keys(standings.groups).length > 0 ? `
    <h3 style="font-size:14px;color:#444;margin:18px 0 8px;text-transform:uppercase;letter-spacing:0.5px">Group standings (live from upstream)</h3>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      ${Object.entries(standings.groups).sort(([a], [b]) => a.localeCompare(b)).map(([letter, rows]) => `
        <div style="border:1px solid #eee;border-radius:6px;padding:8px 10px">
          <div style="font-weight:600;font-size:13px;color:#333;margin-bottom:4px">Group ${escapeHtml(letter)}</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            ${rows.slice(0, 4).map((r) => `<tr style="${r.rank === 3 ? 'color:#a05a00;font-style:italic' : ''}"><td style="padding:2px 0;width:14px">${r.rank}</td><td style="padding:2px 4px">${escapeHtml(r.teamName)}</td><td style="padding:2px 0;text-align:right">${r.played}</td><td style="padding:2px 0;text-align:right">${r.points}</td></tr>`).join('')}
          </table>
        </div>
      `).join('')}
    </div>
    <p style="color:#888;font-size:11px;margin:6px 0 0">Italic = 3rd place. Top 2 from each group + best 8 of 12 third-placed teams advance to R32.</p>
    ` : `<p style="color:#888;font-size:13px;margin:18px 0 0;font-style:italic">Group standings unavailable — both upstream APIs returned an error or no group data is published yet.</p>`}

    ${top3rds.length === 12 ? `
    <h3 style="font-size:14px;color:#444;margin:18px 0 8px;text-transform:uppercase;letter-spacing:0.5px">Third-placed teams (FIFA Article 13 ranking)</h3>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr style="border-bottom:1px solid #eee"><th style="text-align:left;padding:6px 4px;color:#666;font-weight:600">#</th><th style="text-align:left;padding:6px 4px;color:#666;font-weight:600">Group</th><th style="text-align:left;padding:6px 4px;color:#666;font-weight:600">Team</th><th style="text-align:right;padding:6px 4px;color:#666;font-weight:600">Pts</th><th style="text-align:right;padding:6px 4px;color:#666;font-weight:600">GD</th><th style="text-align:right;padding:6px 4px;color:#666;font-weight:600">GF</th><th style="text-align:left;padding:6px 4px;color:#666;font-weight:600">Status</th></tr>
      ${top3rds.map((t, i) => `<tr style="${i === 7 ? 'border-bottom:2px solid #888' : ''}"><td style="padding:4px;${i < 8 ? 'font-weight:600' : 'color:#999'}">${i + 1}</td><td style="padding:4px">${escapeHtml(t.groupLetter)}</td><td style="padding:4px;${i < 8 ? 'font-weight:600' : 'color:#999'}">${escapeHtml(t.teamName)}</td><td style="padding:4px;text-align:right">${t.points}</td><td style="padding:4px;text-align:right">${t.goalDiff > 0 ? '+' : ''}${t.goalDiff}</td><td style="padding:4px;text-align:right">${t.goalsFor}</td><td style="padding:4px;color:${i < 8 ? '#0d4a2c' : '#a0a0a0'}">${i < 8 ? 'Advances to R32' : 'Eliminated'}</td></tr>`).join('')}
    </table>
    <p style="color:#888;font-size:11px;margin:6px 0 0">The line between row 8 and row 9 is the qualification cutoff. Tiebreakers: points → goal difference → goals scored → group letter (deterministic).</p>
    ` : ''}

    <h3 style="font-size:14px;color:#444;margin:18px 0 8px;text-transform:uppercase;letter-spacing:0.5px">Quick Picks leagues — top 5 by size</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr style="border-bottom:1px solid #eee"><th style="text-align:left;padding:6px 0;color:#666;font-weight:600">League</th><th style="text-align:right;padding:6px 0;color:#666;font-weight:600">Members</th><th style="text-align:right;padding:6px 0;color:#666;font-weight:600">Submitted</th><th style="text-align:right;padding:6px 0;color:#666;font-weight:600">Complete</th></tr>
      ${leagueStats.slice(0, 5).map((l) => `<tr><td style="padding:6px 0">${escapeHtml(l.name)}</td><td style="padding:6px 0;text-align:right">${l.members}</td><td style="padding:6px 0;text-align:right">${l.submitted}</td><td style="padding:6px 0;text-align:right">${l.complete}</td></tr>`).join('')}
    </table>

    <h3 style="font-size:14px;color:#444;margin:18px 0 8px;text-transform:uppercase;letter-spacing:0.5px">Users</h3>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      <tr><td style="padding:6px 0;color:#666">Total users</td><td style="padding:6px 0;text-align:right;font-weight:600">${totalUsers}</td></tr>
      <tr><td style="padding:6px 0;color:#666">New users (last 24h)</td><td style="padding:6px 0;text-align:right;font-weight:600">${newUsersDay}</td></tr>
      <tr><td style="padding:6px 0;color:#666">Banned IPs</td><td style="padding:6px 0;text-align:right;font-weight:600">${bansCount}</td></tr>
    </table>

    <p style="color:#999;font-size:12px;margin:24px 0 0;border-top:1px solid #eee;padding-top:12px">
      This report runs daily via Vercel Cron. Schedule and recipient configurable in vercel.json + REPORT_EMAIL env var.
    </p>
  </div>
</div>`;

  // ── Send via Resend ──
  const resendKey = process.env.RESEND_API_KEY;
  const to = process.env.REPORT_EMAIL || process.env.FEEDBACK_EMAIL || 'sumitwkhan@gmail.com';
  let emailed = false;
  let emailError = null;
  if (resendKey) {
    try {
      const senders = ['GoalOracle <reports@goaloracle.io>', 'GoalOracle <onboarding@resend.dev>'];
      for (const from of senders) {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({ from, to: [to], subject, html }),
        });
        if (r.ok) { emailed = true; break; }
        if (r.status !== 403 && r.status !== 422) { emailError = `HTTP ${r.status}`; break; }
      }
    } catch (e) { emailError = e.message; }
  } else {
    emailError = 'RESEND_API_KEY not set';
  }

  await db.collection('adminLogs').add({
    action: 'cron_daily_report',
    timestamp: FieldValue.serverTimestamp(),
    summary: {
      allGreen,
      issuesCount: issues.length,
      missingResults: missing.length,
      disputed: disputed.length,
      partial: partial.length,
      recentlyVerified: recentlyVerified.length,
      newUsersDay,
      emailed,
    },
  });

  return res.status(200).json({
    runAt: new Date().toISOString(),
    allGreen,
    issues,
    emailed,
    emailError,
    missing,
    disputed,
    partial,
    leaguesReported: leagueStats.length,
    standingsAvailable: !!standings,
    standingsSource: standings?.source || null,
    groupCount: standings ? Object.keys(standings.groups).length : 0,
    thirdPlaceQualifiers: top3rds.length === 12 ? top3rds.slice(0, 8).map((t) => ({ group: t.groupLetter, team: t.teamName, points: t.points, goalDiff: t.goalDiff })) : null,
  });
}
