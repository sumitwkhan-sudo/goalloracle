/**
 * /api/cron/poll-results.js — auto-ingest finished match results.
 *
 * Walks WORLD_CUP_MATCHES, finds every match whose kickoff was at least
 * 3 hours ago and which doesn't yet have a stored matchResult, then
 * fetches both oracle sources and ingests if they agree. Same comparison
 * + dispute logic as /api/oracle, just driven by the schedule rather
 * than an admin click.
 *
 * Triggered by Vercel Cron (see vercel.json). Runs every 2 minutes
 * during the tournament so a user sees their score within ~2 minutes of
 * full-time. Each run only fetches matches that finished since the last
 * ingest (completed ones are marked and skipped), so in steady state a
 * run makes very few requests — well within football-data.org's free-tier
 * 10 req/min. Score recompute only fires on runs that actually ingest a
 * result (see below), so quiet polls are cheap.
 *
 * Auth: Vercel sets `Authorization: Bearer ${CRON_SECRET}` automatically.
 * Manual triggers (during dev) accept a superadmin Bearer token.
 */

import { db, applyCors, verifyAuth } from '../_lib/firebase.js';
import { parseFootballDataResponse } from '../_lib/oracleParsers.js';
import { sendOperatorAlert } from '../_lib/alerts.js';
import { resolveActualBracket, buildSimpleActuals } from '../_lib/bracketResolver.js';
import { recomputeSimpleScores } from '../_lib/computeSimpleScores.js';
import { teamNameMatches } from '../_lib/teamMatch.js';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';
import { FieldValue } from 'firebase-admin/firestore';

// Earliest a match could be final: 90' + halftime + stoppage ≈ 105 min after
// kickoff. We start checking then and let the provider's FINISHED status gate
// ingestion (so we never store a mid-game score) — results land within one
// poll (~2 min) of full time instead of waiting a fixed 3 hours. Knockouts
// that go to extra time / penalties simply stay "pending" until FINISHED.
const FT_GRACE_MS = 105 * 60 * 1000;

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

// Fetch the WC match list for a date range in ONE request, shared across all
// candidates in a run (instead of one list call per game) so the lower grace
// can't blow football-data's free-tier 10 req/min limit on busy days. The
// list items carry status + teams, enough to match + gate on FINISHED.
async function fetchWcMatches({ dateFrom, dateTo }) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY not set');
  // World Cup competition code is 'WC' in football-data.org v4. Date range,
  // not a single day: our matches.js dates are local (ET) but football-data
  // indexes by UTC kickoff date, so a late-ET game lands on the next UTC day.
  const r = await fetch(`https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
    headers: { 'X-Auth-Token': apiKey },
  });
  if (!r.ok) throw new Error(`football-data.org list: HTTP ${r.status}`);
  const data = await r.json();
  return data.matches || [];
}

// Pull the per-match detail (full score breakdown incl. extra-time/penalties)
// for a FINISHED game. parseFootballDataResponse throws unless status is
// FINISHED, so this only ingests final results.
async function fetchFootballDataDetail(matchId) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY not set');
  const detail = await fetch(`https://api.football-data.org/v4/matches/${matchId}`, {
    headers: { 'X-Auth-Token': apiKey },
  }).then((r) => r.json());
  return parseFootballDataResponse(detail);
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
    skipped: 0,
    errors: [],
  };

  try {
    // Existing results in one shot.
    const resultsSnap = await db.collection('matchResults').get();
    const existing = {};
    resultsSnap.docs.forEach((d) => { existing[d.id] = d.data(); });

    // Resolve as much of the bracket as the accumulated results allow.
    // Knockout matches whose teams are now known get their actual home/
    // away substituted for the placeholder strings ("W R32-01", "1st
    // Group A", "3rd ABCDF") so the team-name lookup against the upstream
    // can succeed. Matches still pending earlier results stay placeholder
    // and are skipped.
    const { resolved: resolvedKnockouts, allGroupsComplete, errors: bracketErrors } = resolveActualBracket(existing);
    bracketErrors.forEach((e) => summary.errors.push({ source: 'bracket-resolver', error: e }));

    // Candidates: matches that finished long enough ago and aren't already
    // marked completed: true. For knockouts, also need teams resolved.
    const candidates = WORLD_CUP_MATCHES.filter((m) => {
      const k = kickoffUtcMs(m);
      if (k > now - FT_GRACE_MS) return false; // still in progress
      const cur = existing[m.id];
      if (cur && cur.completed === true && cur.verified === true) return false; // already done
      // Knockout match without resolved teams: skip until predecessors finish.
      if (m.isKnockout && /^(W |L |1st |2nd |3rd )/.test(m.home || '')) {
        return !!resolvedKnockouts[m.id];
      }
      return true;
    });
    summary.candidates = candidates.length;
    summary.knockoutsResolved = Object.keys(resolvedKnockouts).length;
    summary.allGroupsComplete = allGroupsComplete;
    summary.pending = []; // candidates found upstream but not yet FINISHED

    // Fetch the WC match list ONCE per run, over a date range covering every
    // candidate (ET date is the earliest possible UTC date; the UTC kickoff
    // date the latest). One request even when many games are in their post-
    // kickoff window — keeps us well under the free-tier rate limit.
    let wcMatches = [];
    let listError = null;
    if (candidates.length > 0) {
      let dateFrom = null;
      let dateTo = null;
      for (const m of candidates) {
        const et = m.date;
        const utc = new Date(kickoffUtcMs(m)).toISOString().slice(0, 10);
        if (!dateFrom || et < dateFrom) dateFrom = et;
        if (!dateTo || utc > dateTo) dateTo = utc;
      }
      try {
        wcMatches = await fetchWcMatches({ dateFrom, dateTo });
      } catch (e) {
        listError = e.message;
        summary.errors.push({ source: 'football-data.org-list', error: e.message });
      }
    }

    for (const m of candidates) {
      if (listError) { summary.skipped += 1; continue; } // retry next run
      try {
        // For knockout matches, swap placeholder team names for the
        // actually-resolved team names. For group matches, m.home/m.away
        // already are the real names.
        const resolvedTeams = m.isKnockout ? resolvedKnockouts[m.id] : null;
        const lookupHome = resolvedTeams?.home || m.home;
        const lookupAway = resolvedTeams?.away || m.away;

        // Alias + accent-aware match against the shared list (teamMatch.js):
        // handles "Korea Republic" for South Korea, "Côte d'Ivoire", etc.
        const provider = wcMatches.find((pm) =>
          teamNameMatches(lookupHome, pm.homeTeam?.name) && teamNameMatches(lookupAway, pm.awayTeam?.name));
        if (!provider) {
          summary.errors.push({ matchId: m.id, source: 'football-data.org', error: `no match for ${lookupHome} vs ${lookupAway}` });
          summary.skipped += 1;
          continue;
        }
        if (provider.status !== 'FINISHED') {
          // Final whistle isn't in yet (IN_PLAY / PAUSED / TIMED). This is a
          // normal transient state, NOT a pipeline error — record it quietly
          // so a game that's mid-broadcast doesn't trip the no-results alert.
          summary.pending.push({ matchId: m.id, status: provider.status });
          summary.skipped += 1;
          continue;
        }

        // FINISHED → pull the detail for the full score breakdown and ingest.
        const s = await fetchFootballDataDetail(provider.id);

        // Single-source ingestion: football-data.org is the source of
        // truth. Operator can override via /api/admin → updateResult and
        // users can dispute via support@goaloracle.io.
        await db.collection('matchResults').doc(m.id).set({
          matchId: m.id,
          homeScore: s.homeScore,
          awayScore: s.awayScore,
          extraTime: s.extraTime || false,
          penalties: s.penalties || false,
          penHome: s.penHome || 0,
          penAway: s.penAway || 0,
          completed: true,
          verified: true,
          status: 'verified',
          verifiedAt: new Date().toISOString(),
          sources: ['football-data.org'],
          confirmations: 1,
          updatedBy: 'cron/poll-results',
          updatedAt: FieldValue.serverTimestamp(),
        });
        summary.ingested += 1;
      } catch (e) {
        summary.errors.push({ matchId: m.id, error: e.message });
      }
    }

    // Recompute every Quick Picks player's score from the latest results
    // (R2). A player's score only changes when a match result changes, so
    // we ONLY recompute when this run actually ingested something — at the
    // 2-minute poll cadence that keeps the common "nothing finished" run
    // cheap (one fetch, zero writes) while still updating scores within ~2
    // min of a result landing. Manual admin result edits trigger their own
    // recompute (see api/admin.js updateResult), so corrections don't wait
    // for the next poll. Wrapped in try/catch: a scoring bug must NEVER
    // abort result ingestion — results are the source of truth, scores are
    // derived and self-heal on the next ingest.
    if (summary.ingested > 0) {
      try {
        const freshSnap = await db.collection('matchResults').get();
        const fresh = {};
        freshSnap.docs.forEach((d) => { fresh[d.id] = d.data(); });
        const actuals = buildSimpleActuals(fresh);
        const scoreSummary = await recomputeSimpleScores(db, actuals);
        summary.scoring = scoreSummary;
      } catch (e) {
        summary.errors.push({ source: 'score-recompute', error: e.message });
      }
    } else {
      summary.scoring = { skipped: 'no new results this run' };
    }

    // One-line console summary on EVERY run so the operator can see results
    // flowing (or not) in Vercel runtime logs without reading /adminLogs.
    // Counts + a sample of skip reasons make a silent "ingests nothing" run
    // diagnosable at a glance (e.g. candidates=0 → clock/schedule; errors>0 →
    // upstream/parse failures with the reason inline).
    console.log('[cron/poll-results] summary', JSON.stringify({
      candidates: summary.candidates,
      ingested: summary.ingested,
      pending: (summary.pending || []).length,    // found, awaiting full time
      skipped: summary.skipped,
      errorCount: summary.errors.length,
      firstErrors: summary.errors.slice(0, 5),
      pendingSample: (summary.pending || []).slice(0, 5),
      knockoutsResolved: summary.knockoutsResolved,
      allGroupsComplete: summary.allGroupsComplete,
      nowUtc: summary.runAt,
    }));

    await db.collection('adminLogs').add({
      action: 'cron_poll_results',
      timestamp: FieldValue.serverTimestamp(),
      summary,
    });

    // Specific alerts — only fire when a candidate match exists, so we
    // don't spam pre-tournament when there's nothing to ingest anyway.
    if (summary.candidates > 0) {
      if (!process.env.FOOTBALL_DATA_API_KEY) {
        await sendOperatorAlert(
          `Oracle API key missing — ${summary.candidates} match(es) cannot be ingested`,
          {
            what: `The auto-poll cron found ${summary.candidates} finished match(es) waiting to be ingested but FOOTBALL_DATA_API_KEY is not set. Until you add it, results will not appear on leaderboards.`,
            why: ['FOOTBALL_DATA_API_KEY is not set in Vercel env'],
            resolution: [
              'Open Vercel → your project → Settings → Environment Variables.',
              'Add FOOTBALL_DATA_API_KEY (get one free at https://www.football-data.org/client/register — emailed instantly).',
              'Redeploy is NOT needed — Vercel picks up env changes for the next cron run (within ~2 minutes).',
            ],
            context: {
              candidates: summary.candidates,
              firstFewIds: WORLD_CUP_MATCHES.filter((m) => kickoffUtcMs(m) < now - FT_GRACE_MS).slice(0, 5).map((m) => m.id).join(', '),
            },
          },
        );
      } else if (summary.errors.length > summary.ingested && summary.ingested === 0) {
        // Key is set but nothing got through — likely an API outage,
        // rate limit, or schema drift. football-data.org free tier:
        // 10 requests / minute, plenty of headroom for our use.
        await sendOperatorAlert(
          `Oracle pipeline producing no results — ${summary.errors.length} error(s) on ${summary.candidates} candidate(s)`,
          {
            what: 'The auto-poll cron found finished matches but every fetch attempt is failing. Either football-data.org is down or the response shape has drifted from what our parser expects.',
            why: [
              'football-data.org is temporarily unavailable',
              'Free-tier rate limit reached (10 req/min)',
              'Schema drift — the upstream changed a response field name or type',
            ],
            resolution: [
              'Check https://status.football-data.org for incidents.',
              'Wait until the next cron run (~2 min) — most outages self-recover.',
              'If it persists past tomorrow morning, the daily report will show the same red flags. Reply to that email and I can investigate the parser errors.',
            ],
            context: {
              firstFewErrors: JSON.stringify(summary.errors.slice(0, 3)),
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
        what: 'The /api/cron/poll-results endpoint threw an uncaught error. No match results were ingested on this run. The cron will retry on its normal 2-minute schedule.',
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
