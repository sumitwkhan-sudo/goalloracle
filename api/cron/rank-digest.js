/**
 * /api/cron/rank-digest — daily "you moved on the leaderboard" emails.
 *
 * Runs hourly. Reads /config/rankDigest (operator-configurable; OFF by
 * default). At `sendHourUtc - 2` it computes the day's movers and emails the
 * operator a PREVIEW (the actual email + recipient counts) so there's a 2h
 * window to cancel/adjust. At `sendHourUtc` it recomputes and QUEUES the sends
 * into /outreachScheduled, which the existing outreach-drain cron sends
 * (throttled, resumable, opt-out-aware, logged to /outreachSent).
 *
 * Movement is measured on the GLOBAL Quick Picks League only, day-over-day:
 * today's rank vs the previous stored snapshot. Up >= upThreshold (default 20)
 * → upbeat email; down >= downThreshold (default 30) → encouraging email.
 * Only users who have actually submitted picks are eligible (no nagging
 * never-players). Nothing sends on days with no movers (rest days).
 *
 * SAFE BY DEFAULT: enabled=false until the operator turns it on in Admin →
 * Settings, and the operator gets the 2h preview + can skip/pause/customize.
 */

import { db, verifyAuth } from '../_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { buildEmail, sendOutreachEmail } from '../_lib/outreachEmail.js';
import { RANK_DIGEST_DEFAULTS, computeMovers, ctxFor } from '../_lib/rankDigest.js';

const PROD_ORIGIN = 'https://goaloracle.io';
const LEAGUE = 'global-simple';
const CHUNK = 150; // recipients per scheduled-send doc (drain handles one/tick)

function operatorEmail() {
  return process.env.REPORT_EMAIL || process.env.FEEDBACK_EMAIL || 'sumitwkhan@gmail.com';
}

async function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers['x-vercel-cron'] === '1') return true;
  const claims = await verifyAuth(req);
  if (!claims) return false;
  const userSnap = await db.collection('users').doc(claims.userId).get();
  return userSnap.exists && userSnap.data().role === 'superadmin';
}

async function loadConfig() {
  const snap = await db.collection('config').doc('rankDigest').get();
  return { ...RANK_DIGEST_DEFAULTS, ...(snap.exists ? snap.data() : {}) };
}

// Current Global-League order via the live leaderboard endpoint (single source
// of truth for the ranking rule). Cache-busted so we read fresh. Returns
// { ranks: {uid: rank}, names: {uid: displayName}, submitted: Set<uid>, total }.
async function fetchCurrentRanks() {
  const r = await fetch(`${PROD_ORIGIN}/api/simple-leaderboard?leagueId=${LEAGUE}&_ts=${Date.now()}`);
  if (!r.ok) throw new Error(`leaderboard fetch HTTP ${r.status}`);
  const data = await r.json();
  const lb = Array.isArray(data.leaderboard) ? data.leaderboard : [];
  const ranks = {};
  const names = {};
  const submitted = new Set();
  lb.forEach((e, i) => {
    if (!e.userId) return;
    ranks[e.userId] = i + 1;
    names[e.userId] = e.displayName || e.userId.slice(0, 8);
    if (e.hasSubmitted) submitted.add(e.userId);
  });
  return { ranks, names, submitted, total: lb.length };
}

// Most recent stored snapshot (the day-over-day baseline), or null.
async function loadPreviousSnapshot() {
  const snap = await db.collection('leaderboardSnapshots')
    .where('league', '==', LEAGUE)
    .get();
  if (snap.empty) return null;
  let best = null;
  snap.docs.forEach((d) => {
    const data = d.data();
    const ms = data.takenAt?.toMillis ? data.takenAt.toMillis() : (data.takenAtMs || 0);
    if (!best || ms > best.ms) best = { ms, data };
  });
  return best ? best.data : null;
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

// ── PREVIEW: email the operator the real email + counts, stash for admin ──
async function runPreview(cfg) {
  const current = await fetchCurrentRanks();
  const prev = await loadPreviousSnapshot();
  const movers = computeMovers(current, prev?.ranks, cfg);
  const upCount = movers.filter((m) => m.direction === 'up').length;
  const downCount = movers.filter((m) => m.direction === 'down').length;

  const pendingPreview = {
    computedAt: FieldValue.serverTimestamp(),
    computedAtMs: Date.now(),
    forSendDate: todayUtc(),
    sendHourUtc: cfg.sendHourUtc,
    upCount,
    downCount,
    total: movers.length,
    hasBaseline: !!prev,
    topMovers: movers.slice(0, 25).map((m) => ({ name: m.name, direction: m.direction, places: m.places, newRank: m.newRank })),
  };
  await db.collection('config').doc('rankDigest').set({ pendingPreview }, { merge: true });

  // Operator preview email = the ACTUAL email a representative mover will get
  // (operator sees exactly what ships), with counts + cancel note in the
  // subject. Skip the email if there's nothing to send.
  if (movers.length > 0) {
    const sample = movers[0];
    const opUser = { id: 'operator-preview', displayName: 'Sumit', email: operatorEmail() };
    const built = buildEmail('rankDigest', { user: opUser, ctx: ctxFor(sample, cfg, current.total) });
    const hh = String(cfg.sendHourUtc).padStart(2, '0');
    await sendOutreachEmail({
      to: operatorEmail(),
      subject: `[PREVIEW · ${movers.length} recipients (${upCount}↑ ${downCount}↓) · sends ${hh}:00 UTC · skip in Admin] ${built.subject}`,
      html: built.html,
      text: `Leaderboard movement digest preview — ${movers.length} recipients (${upCount} up, ${downCount} down). Sends at ${hh}:00 UTC. Cancel or customize in Admin → Settings → Leaderboard emails.\n\n--- Sample email below ---\n\n${built.text}`,
      tags: [{ name: 'template', value: 'rankDigestPreview' }],
    });
  } else {
    await sendOutreachEmail({
      to: operatorEmail(),
      subject: `[PREVIEW] No leaderboard-movement emails today (0 movers)`,
      html: `<p>No users moved up ≥${cfg.upThreshold} or down ≥${cfg.downThreshold} on the Global League ${prev ? 'since the last digest' : '(no baseline snapshot yet — first run)'}. Nothing will send today.</p>`,
      text: `No movers today. Nothing will send.`,
      tags: [{ name: 'template', value: 'rankDigestPreview' }],
    });
  }

  return { phase: 'preview', upCount, downCount, total: movers.length };
}

// ── SEND: queue the personalized emails into the drain, advance the baseline ──
async function runSend(cfg) {
  const cfgRef = db.collection('config').doc('rankDigest');

  // Operator override: skip today's send (one-shot).
  if (cfg.skipNext) {
    await cfgRef.set({ skipNext: false, lastSendDate: todayUtc(), lastSkippedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { phase: 'send', skipped: 'operator skipNext' };
  }
  // Once per day.
  if (cfg.lastSendDate === todayUtc()) {
    return { phase: 'send', skipped: 'already ran today' };
  }

  const current = await fetchCurrentRanks();
  const prev = await loadPreviousSnapshot();
  const movers = computeMovers(current, prev?.ranks, cfg);
  const upCount = movers.filter((m) => m.direction === 'up').length;
  const downCount = movers.filter((m) => m.direction === 'down').length;

  // Always advance the baseline so tomorrow compares to today.
  await db.collection('leaderboardSnapshots').doc(`${LEAGUE}__${todayUtc()}`).set({
    league: LEAGUE,
    date: todayUtc(),
    takenAt: FieldValue.serverTimestamp(),
    takenAtMs: Date.now(),
    total: current.total,
    ranks: current.ranks,
  });

  let queued = 0;
  if (movers.length > 0) {
    // Chunk into scheduled-send docs the existing drain processes one/tick,
    // so a big group-stage shake-up can't time a single send out.
    for (let i = 0; i < movers.length; i += CHUNK) {
      const slice = movers.slice(i, i + CHUNK);
      const userIds = slice.map((m) => m.uid);
      const userPayloads = {};
      slice.forEach((m) => { userPayloads[m.uid] = ctxFor(m, cfg, current.total); });
      await db.collection('outreachScheduled').add({
        template: 'rankDigest',
        userIds,
        userPayloads,
        recipientCount: userIds.length,
        scheduledFor: FieldValue.serverTimestamp(),
        scheduledAt: FieldValue.serverTimestamp(),
        scheduledBy: 'cron/rank-digest',
        status: 'pending',
      });
      queued += userIds.length;
    }
  }

  await cfgRef.set({
    lastSendDate: todayUtc(),
    lastSendAt: FieldValue.serverTimestamp(),
    lastSendCounts: { up: upCount, down: downCount, total: movers.length, queued },
    pendingPreview: FieldValue.delete(),
  }, { merge: true });

  await db.collection('adminLogs').add({
    action: 'rank_digest_send',
    timestamp: FieldValue.serverTimestamp(),
    summary: { upCount, downCount, total: movers.length, queued, hadBaseline: !!prev },
  }).catch(() => {});

  return { phase: 'send', upCount, downCount, total: movers.length, queued };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (!await isAuthorized(req)) return res.status(403).json({ error: 'forbidden' });

  try {
    const cfg = await loadConfig();
    // Manual operator trigger: POST { force:'preview' } runs the preview now.
    const force = req.method === 'POST' ? (req.body?.force || null) : null;

    if (!cfg.enabled && !force) {
      return res.status(200).json({ skipped: 'disabled' });
    }

    if (force === 'preview') {
      const out = await runPreview(cfg);
      return res.status(200).json({ forced: true, ...out });
    }

    const nowHour = new Date().getUTCHours();
    const previewHour = (((cfg.sendHourUtc - 2) % 24) + 24) % 24;
    if (nowHour === previewHour) {
      const out = await runPreview(cfg);
      return res.status(200).json(out);
    }
    if (nowHour === cfg.sendHourUtc) {
      const out = await runSend(cfg);
      return res.status(200).json(out);
    }
    return res.status(200).json({ skipped: `nothing to do at hour ${nowHour} (preview=${previewHour}, send=${cfg.sendHourUtc})` });
  } catch (e) {
    console.error('[cron/rank-digest] error:', e?.message);
    return res.status(500).json({ error: e?.message });
  }
}
