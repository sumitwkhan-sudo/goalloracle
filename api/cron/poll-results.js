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

    return res.status(200).json(summary);
  } catch (e) {
    console.error('[cron/poll-results] fatal:', e);
    return res.status(500).json({ error: e.message, summary });
  }
}
