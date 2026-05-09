/**
 * /api/cron/poll-results.js — auto-ingest finished match results.
 *
 * Walks WORLD_CUP_MATCHES, finds every match whose kickoff was at least
 * 3 hours ago and which doesn't yet have a stored matchResult, then
 * fetches both oracle sources and ingests if they agree. Same comparison
 * + dispute logic as /api/oracle, just driven by the schedule rather
 * than an admin click.
 *
 * Triggered by Vercel Cron (see vercel.json). Runs every 30 minutes
 * during the tournament — short enough that a user sees their score
 * within ~half an hour of full-time, long enough to keep oracle
 * quotas healthy (football-data.org free tier = 10 req/min).
 *
 * Auth: Vercel sets `Authorization: Bearer ${CRON_SECRET}` automatically.
 * Manual triggers (during dev) accept a superadmin Bearer token.
 */

import { db, applyCors, verifyAuth } from '../_lib/firebase.js';
import { parseFootballDataResponse, parseApiSportsResponse, compareResults } from '../_lib/oracleParsers.js';
import { sendOperatorAlert } from '../_lib/alerts.js';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';
import { FieldValue } from 'firebase-admin/firestore';

const FT_GRACE_MS = 3 * 60 * 60 * 1000; // wait 3h after kickoff before trying

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
  date.setUTCHours(hh + 4, mm, 0, 0); // EDT during Jun/Jul
  return date.getTime();
}

async function fetchFootballDataByDateAndTeams({ date, homeTeam, awayTeam }) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY not set');
  // World Cup competition code is 'WC' in football-data.org v4.
  const r = await fetch(`https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${date}&dateTo=${date}`, {
    headers: { 'X-Auth-Token': apiKey },
  });
  if (!r.ok) throw new Error(`football-data.org list: HTTP ${r.status}`);
  const data = await r.json();
  const ht = (homeTeam || '').toLowerCase();
  const at = (awayTeam || '').toLowerCase();
  const match = (data.matches || []).find((m) => {
    const h = (m.homeTeam?.name || '').toLowerCase();
    const a = (m.awayTeam?.name || '').toLowerCase();
    return (h.includes(ht) || ht.includes(h)) && (a.includes(at) || at.includes(a));
  });
  if (!match) throw new Error(`football-data.org: no match for ${homeTeam} vs ${awayTeam} on ${date}`);
  // Fetch detail (status FINISHED + score breakdown).
  const detail = await fetch(`https://api.football-data.org/v4/matches/${match.id}`, {
    headers: { 'X-Auth-Token': apiKey },
  }).then((r) => r.json());
  return parseFootballDataResponse(detail);
}

async function fetchApiSportsByDateAndTeams({ date, homeTeam, awayTeam }) {
  const apiKey = process.env.APISPORTS_API_KEY;
  if (!apiKey) throw new Error('APISPORTS_API_KEY not set');
  const r = await fetch(`https://v3.football.api-sports.io/fixtures?league=1&season=2026&date=${date}`, {
    headers: { 'x-apisports-key': apiKey },
  });
  if (!r.ok) throw new Error(`api-sports.io: HTTP ${r.status}`);
  const data = await r.json();
  return parseApiSportsResponse(data, { homeTeam, awayTeam });
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  if (!(await isAuthorized(req))) return res.status(401).json({ error: 'Unauthorized' });

  const now = Date.now();
  const summary = {
    runAt: new Date().toISOString(),
    candidates: 0,
    ingested: 0,
    disputed: 0,
    partial: 0,
    skipped: 0,
    errors: [],
  };

  try {
    // Existing results in one shot.
    const resultsSnap = await db.collection('matchResults').get();
    const existing = {};
    resultsSnap.docs.forEach((d) => { existing[d.id] = d.data(); });

    // Candidates: matches that finished long enough ago and aren't already
    // marked completed: true.
    const candidates = WORLD_CUP_MATCHES.filter((m) => {
      const k = kickoffUtcMs(m);
      if (k > now - FT_GRACE_MS) return false; // still in progress
      const cur = existing[m.id];
      if (cur && cur.completed === true && cur.verified === true) return false; // already done
      // Knockout match without resolved teams (home/away starts with 'W ' or '1st ' etc.)
      // can't be looked up by team name. Skip those — admin still has the
      // manual override for resolved knockout matches.
      if (m.isKnockout && /^(W |L |1st |2nd |3rd )/.test(m.home || '')) return false;
      return true;
    });
    summary.candidates = candidates.length;

    for (const m of candidates) {
      try {
        const date = m.date;
        let s1 = null, s2 = null;
        try { s1 = await fetchFootballDataByDateAndTeams({ date, homeTeam: m.home, awayTeam: m.away }); }
        catch (e) { summary.errors.push({ matchId: m.id, source: 'football-data.org', error: e.message }); }
        try { s2 = await fetchApiSportsByDateAndTeams({ date, homeTeam: m.home, awayTeam: m.away }); }
        catch (e) { summary.errors.push({ matchId: m.id, source: 'api-sports.io', error: e.message }); }

        if (!s1 && !s2) { summary.skipped += 1; continue; }
        if (!s1 || !s2) {
          // Only one source — record as partial; manual admin can finalize.
          await db.collection('matchResults').doc(m.id).set({
            matchId: m.id,
            status: 'partial',
            availableSource: s1 || s2,
            missingSource: !s1 ? 'football-data.org' : 'api-sports.io',
            checkedAt: new Date().toISOString(),
            updatedBy: 'cron/poll-results',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          summary.partial += 1;
          continue;
        }

        const cmp = compareResults(s1, s2);
        if (!cmp.match) {
          await db.collection('matchResults').doc(m.id).set({
            matchId: m.id,
            status: 'disputed',
            source1: s1,
            source2: s2,
            disagreement: cmp.details,
            checkedAt: new Date().toISOString(),
            updatedBy: 'cron/poll-results',
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
          summary.disputed += 1;
          continue;
        }

        // Agreement — write the verified result.
        await db.collection('matchResults').doc(m.id).set({
          matchId: m.id,
          homeScore: s1.homeScore,
          awayScore: s1.awayScore,
          extraTime: s1.extraTime || false,
          penalties: s1.penalties || false,
          penHome: s1.penHome || 0,
          penAway: s1.penAway || 0,
          completed: true,
          verified: true,
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          sources: ['football-data.org', 'api-sports.io'],
          confirmations: 2,
          updatedBy: 'cron/poll-results',
          updatedAt: FieldValue.serverTimestamp(),
        });
        summary.ingested += 1;
      } catch (e) {
        summary.errors.push({ matchId: m.id, error: e.message });
      }
    }

    await db.collection('adminLogs').add({
      action: 'cron_poll_results',
      timestamp: FieldValue.serverTimestamp(),
      summary,
    });

    // Specific alerts — only fire when a candidate match exists, so we
    // don't spam pre-tournament when there's nothing to ingest anyway.
    if (summary.candidates > 0) {
      const fdMissing = !process.env.FOOTBALL_DATA_API_KEY;
      const asMissing = !process.env.APISPORTS_API_KEY;
      if (fdMissing || asMissing) {
        await sendOperatorAlert(
          `Oracle API key missing — ${summary.candidates} match(es) cannot be ingested`,
          {
            what: `The auto-poll cron found ${summary.candidates} finished match(es) waiting to be ingested but is missing required API key(s). Until you set the missing key, results will not appear on leaderboards.`,
            why: [
              fdMissing ? 'FOOTBALL_DATA_API_KEY is not set in Vercel env' : null,
              asMissing ? 'APISPORTS_API_KEY is not set in Vercel env' : null,
            ].filter(Boolean),
            resolution: [
              'Open Vercel → your project → Settings → Environment Variables.',
              fdMissing ? 'Add FOOTBALL_DATA_API_KEY (get one free at https://www.football-data.org/client/register).' : 'FOOTBALL_DATA_API_KEY is fine.',
              asMissing ? 'Add APISPORTS_API_KEY (get one free at https://dashboard.api-football.com).' : 'APISPORTS_API_KEY is fine.',
              'Redeploy is NOT needed — Vercel picks up env changes for the next cron run (within 30 minutes).',
            ],
            context: {
              candidates: summary.candidates,
              firstFewIds: WORLD_CUP_MATCHES.filter((m) => kickoffUtcMs(m) < now - FT_GRACE_MS).slice(0, 5).map((m) => m.id).join(', '),
            },
          },
        );
      } else if (summary.errors.length > summary.ingested && summary.ingested === 0) {
        // Both keys are set but nothing got through — likely an API outage
        // or schema drift.
        await sendOperatorAlert(
          `Oracle pipeline producing no results — ${summary.errors.length} error(s) on ${summary.candidates} candidate(s)`,
          {
            what: 'The auto-poll cron found finished matches but every fetch attempt is failing. Either an upstream API is down or the response shape has drifted from what our parsers expect.',
            why: [
              'football-data.org or api-sports.io is temporarily unavailable',
              'Free-tier rate limit reached (football-data.org: 10/min; api-sports.io: 100/day)',
              'Schema drift — the upstream changed a response field name or type',
            ],
            resolution: [
              'Check https://status.football-data.org and api-sports.io status page.',
              'Wait until the next cron run (30 min) — most outages self-recover.',
              'If it persists past tomorrow morning, the daily report will show the same red flags. Reply to that email and I can investigate the parser errors.',
            ],
            context: {
              firstFewErrors: JSON.stringify(summary.errors.slice(0, 3)),
            },
          },
        );
      }

      // Disputed result alert — needs human review every time it happens.
      if (summary.disputed > 0) {
        await sendOperatorAlert(
          `${summary.disputed} match result(s) in dispute — both sources disagree`,
          {
            what: `Both oracle APIs returned a result for ${summary.disputed} match(es), but they disagreed on the score (or ET / penalty status). Until resolved, these matches won't be scored on user leaderboards.`,
            why: [
              'One source already reflects a VAR review the other hasn\'t picked up yet (usually self-resolves within 30 min)',
              'A penalty shootout was reported with different shootout scores',
              'Schema mismatch in how one source reports extra-time vs regulation',
            ],
            resolution: [
              'Wait one cron cycle (30 min). Most disputes auto-resolve when the lagging source updates.',
              'If still disputed: open admin → Matches → click Edit Result for the disputed match and enter the score manually. This overrides both sources.',
              'Cross-check with FIFA\'s official site if both APIs persistently disagree.',
            ],
            context: {
              disputedCount: summary.disputed,
              partialCount: summary.partial,
            },
          },
        );
      }
    }

    return res.status(200).json(summary);
  } catch (e) {
    console.error('[cron/poll-results] fatal:', e);
    await sendOperatorAlert(
      'Auto-poll cron crashed unexpectedly',
      {
        what: 'The /api/cron/poll-results endpoint threw an uncaught error. No match results were ingested on this run. The cron will retry on its normal 30-minute schedule.',
        why: [
          'Database connectivity issue (Firestore admin SDK)',
          'Code bug in the cron itself',
          'Out-of-memory in the Vercel function',
        ],
        resolution: [
          'Check Vercel → Functions → Logs for /api/cron/poll-results.',
          'If the error repeats on the next run, reply to this email and I can investigate.',
          'Manual fallback: open admin → Oracle tab → Run Health Check + Test EPL to verify upstream connectivity.',
        ],
        context: { error: e.message, stack: (e.stack || '').slice(0, 500) },
      },
    );
    return res.status(500).json({ error: e.message, summary });
  }
}
