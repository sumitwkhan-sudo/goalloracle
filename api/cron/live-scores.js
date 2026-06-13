/**
 * /api/cron/live-scores.js — near-real-time in-progress scores.
 *
 * Runs every minute. Fetches the WC match list once, and for any match that
 * is currently IN_PLAY / PAUSED writes its running score to /liveMatchScores.
 * This is a SEPARATE, provisional feed — it is NEVER written to /matchResults
 * and never feeds final scoring. It powers the live group tables + the
 * leaderboard's "Live" column so they reflect a game while it's being played
 * (e.g. USA 2–0 Paraguay). Once a game is FINISHED, poll-results ingests the
 * official result into /matchResults, which takes precedence on merge.
 *
 * Cheap by design: skips the upstream call entirely when no match is in its
 * live window, so it costs nothing the vast majority of the day. One list
 * request when games are on — well under football-data's 10 req/min.
 *
 * Auth: Vercel sets `Authorization: Bearer ${CRON_SECRET}`. Manual triggers
 * accept a superadmin Bearer token.
 */

import { db, applyCors, verifyAuth } from '../_lib/firebase.js';
import { teamNameMatches } from '../_lib/teamMatch.js';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';
import { FieldValue } from 'firebase-admin/firestore';

const LIVE_STATUSES = new Set(['IN_PLAY', 'PAUSED']);
// kickoff … kickoff + 2h50 covers 90' + halftime + stoppage + extra time +
// penalties, so a match is "plausibly live now" within this window.
const LIVE_WINDOW_MS = 170 * 60 * 1000;

function kickoffUtcMs(match) {
  const [hh, mm] = match.time.split(':').map(Number);
  const date = new Date(`${match.date}T00:00:00Z`);
  date.setUTCHours(hh + 4, mm, 0, 0); // EDT during Jun/Jul
  return date.getTime();
}

async function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const claims = await verifyAuth(req);
  if (!claims) return false;
  const userSnap = await db.collection('users').doc(claims.userId).get();
  return userSnap.exists && userSnap.data().role === 'superadmin';
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (!(await isAuthorized(req))) return res.status(401).json({ error: 'Unauthorized' });

  const now = Date.now();
  // Only spend an upstream call when a match is plausibly in play right now.
  const inWindow = WORLD_CUP_MATCHES.filter((m) => {
    const k = kickoffUtcMs(m);
    return now >= k && now <= k + LIVE_WINDOW_MS;
  });
  if (inWindow.length === 0) {
    return res.status(200).json({ inWindow: 0, written: 0, skipped: 'no match in live window' });
  }

  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) return res.status(200).json({ error: 'FOOTBALL_DATA_API_KEY not set', inWindow: inWindow.length });

  // One list call over the date range covering every in-window match (ET date
  // is the earliest possible UTC date; UTC kickoff date the latest).
  let dateFrom = null;
  let dateTo = null;
  for (const m of inWindow) {
    const et = m.date;
    const utc = new Date(kickoffUtcMs(m)).toISOString().slice(0, 10);
    if (!dateFrom || et < dateFrom) dateFrom = et;
    if (!dateTo || utc > dateTo) dateTo = utc;
  }

  let providerMatches = [];
  try {
    const r = await fetch(`https://api.football-data.org/v4/competitions/WC/matches?dateFrom=${dateFrom}&dateTo=${dateTo}`, {
      headers: { 'X-Auth-Token': apiKey },
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    providerMatches = (await r.json()).matches || [];
  } catch (e) {
    console.warn('[cron/live-scores] list fetch failed:', e.message);
    return res.status(200).json({ inWindow: inWindow.length, written: 0, error: e.message });
  }

  let written = 0;
  const liveIds = [];
  const batch = db.batch();
  for (const m of inWindow) {
    const provider = providerMatches.find((pm) =>
      teamNameMatches(m.home, pm.homeTeam?.name) && teamNameMatches(m.away, pm.awayTeam?.name));
    if (!provider || !LIVE_STATUSES.has(provider.status)) continue;
    const ft = provider.score?.fullTime || {};
    const hs = typeof ft.home === 'number' ? ft.home : 0;
    const as = typeof ft.away === 'number' ? ft.away : 0;
    batch.set(db.collection('liveMatchScores').doc(m.id), {
      matchId: m.id,
      homeScore: hs,
      awayScore: as,
      status: provider.status,
      minute: typeof provider.minute === 'number' ? provider.minute : null,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
    written += 1;
    liveIds.push(m.id);
  }
  if (written > 0) await batch.commit();

  console.log('[cron/live-scores]', JSON.stringify({ inWindow: inWindow.length, written, liveIds }));
  return res.status(200).json({ inWindow: inWindow.length, written, liveIds });
}
