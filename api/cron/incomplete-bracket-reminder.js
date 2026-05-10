/**
 * /api/cron/incomplete-bracket-reminder.js
 *
 * Sends a branded reminder email to users whose Quick Picks bracket
 * isn't finished, at two windows before kickoff:
 *
 *   - 24h before (kickoff −24h, ±90 minutes window)
 *   - 1h before  (kickoff −1h,  ±30 minutes window)
 *
 * Cron runs hourly during the days leading up to kickoff. Each user
 * gets at most one email per window (deduped via reminders.{kind}SentAt
 * on the user doc). Users with `unsubscribedFromReminders === true`
 * are skipped.
 *
 * Auth is identical to the other crons: CRON_SECRET (Vercel cron) or
 * a superadmin Bearer token (admin "Send now" button). Body responses
 * mirror the daily-report shape so the admin UI can show summary toast.
 */

import { db, applyCors, verifyAuth } from '../_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { buildReminderEmail } from '../_lib/reminderEmail.js';

// Same kickoff constant used everywhere else.
const KICKOFF_MS = Date.UTC(2026, 5, 11, 19, 0, 0);

// Window margins, in minutes.
const WINDOW_24H_MIN = 90;
const WINDOW_1H_MIN  = 30;

async function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  const claims = await verifyAuth(req);
  if (!claims) return false;
  const userSnap = await db.collection('users').doc(claims.userId).get();
  return userSnap.exists && userSnap.data().role === 'superadmin';
}

function pickKind(now, force) {
  if (force === '24h' || force === '1h') return force;
  const remainingMin = (KICKOFF_MS - now) / 60000;
  if (Math.abs(remainingMin - 24 * 60) <= WINDOW_24H_MIN) return '24h';
  if (Math.abs(remainingMin - 60) <= WINDOW_1H_MIN) return '1h';
  return null;
}

async function sendOne({ user, kind, appUrl, cronSecret, resendKey }) {
  const email = user.email;
  if (!email) return { ok: false, reason: 'no-email' };

  const { subject, html, text } = buildReminderEmail({
    userId: user.id,
    displayName: user.displayName,
    picksMade: user.picksMade || 0,
    kickoffMs: KICKOFF_MS,
    appUrl,
    cronSecret,
    kind,
  });

  // Try the verified domain first, then the Resend default sandbox so
  // local/preview deploys still get a delivery — same fallback chain
  // the daily-report cron uses.
  const senders = ['GoalOracle <reminders@goaloracle.io>', 'GoalOracle <onboarding@resend.dev>'];
  for (const from of senders) {
    try {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify({ from, to: [email], subject, html, text }),
      });
      if (r.ok) return { ok: true };
      if (r.status !== 403 && r.status !== 422) return { ok: false, reason: `HTTP ${r.status}` };
    } catch (e) {
      return { ok: false, reason: e.message };
    }
  }
  return { ok: false, reason: 'all-senders-rejected' };
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authorized = await isAuthorized(req);
  if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

  const now = Date.now();
  // ?kind=24h|1h forces a window for admin-triggered runs (lets the
  // operator preview either email after deploy without waiting for the
  // exact window to roll around).
  const force = (req.query?.kind || '').toString();
  const kind = pickKind(now, force);

  // Dry-run: list eligible users without sending.
  const dryRun = req.query?.dryRun === '1';

  if (!kind) {
    return res.status(200).json({
      ok: true,
      skipped: true,
      reason: 'outside-window',
      hoursToKickoff: ((KICKOFF_MS - now) / 3600000).toFixed(2),
    });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey && !dryRun) {
    return res.status(500).json({ ok: false, error: 'RESEND_API_KEY not set' });
  }

  const appUrl = process.env.APP_URL || 'https://goaloracle.io';
  const cronSecret = process.env.CRON_SECRET;

  // Pull all simplePredictions and filter incomplete. The collection is
  // small (one doc per user-league); this scales fine into the tens of
  // thousands. If we ever cross that threshold we can add a status
  // index and query by it.
  const usersSnap = await db.collection('users').get();
  const usersById = new Map();
  usersSnap.forEach((d) => usersById.set(d.id, { id: d.id, ...d.data() }));

  const predsSnap = await db.collection('simplePredictions').get();
  // We only nag for the global league bracket — that's the one everyone
  // gets nudged about during onboarding and the one tied to the prize
  // giveaway. League-specific brackets are user-managed.
  const incompleteByUserId = new Map();
  predsSnap.forEach((d) => {
    const data = d.data() || {};
    if (!data.userId) return;
    if (data.leagueId && data.leagueId !== 'global-simple') return;
    if (data.isComplete === true) return;
    const groupCount = Object.keys(data.groupPredictions || {}).length;
    const thirdCount = (data.bestThirdPicks || []).length;
    const koCount = Object.values(data.knockoutPredictions || {})
      .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.filter((p) => p?.winnerId).length : 0), 0);
    const picksMade = Math.min(52, groupCount + thirdCount + koCount);
    incompleteByUserId.set(data.userId, picksMade);
  });

  const targets = [];
  for (const [userId, picksMade] of incompleteByUserId.entries()) {
    const user = usersById.get(userId);
    if (!user) continue;
    if (user.unsubscribedFromReminders === true) continue;
    if (!user.email) continue;

    // Dedup: skip if we've already sent this kind to this user.
    const sentAt = user.reminders?.[kind]?.sentAt;
    if (sentAt) continue;

    targets.push({ ...user, picksMade });
  }

  if (dryRun) {
    return res.status(200).json({
      ok: true, dryRun: true, kind, targetsCount: targets.length,
      sample: targets.slice(0, 5).map((t) => ({ id: t.id, picksMade: t.picksMade, email: t.email })),
    });
  }

  let sent = 0; let failed = 0; const errors = [];
  for (const user of targets) {
    const result = await sendOne({ user, kind, appUrl, cronSecret, resendKey });
    if (result.ok) {
      sent++;
      try {
        await db.collection('users').doc(user.id).set(
          { reminders: { [kind]: { sentAt: FieldValue.serverTimestamp() } } },
          { merge: true },
        );
      } catch (e) {
        // Logging the dedup write failure but don't fail the whole run —
        // worst case the user gets a duplicate next hour, which is much
        // less bad than the cron crashing.
        errors.push({ userId: user.id, stage: 'dedup-write', error: e.message });
      }
    } else {
      failed++;
      errors.push({ userId: user.id, stage: 'send', error: result.reason });
    }
  }

  await db.collection('adminLogs').add({
    action: 'cron_incomplete_bracket_reminder',
    kind,
    timestamp: FieldValue.serverTimestamp(),
    targets: targets.length,
    sent,
    failed,
    errors: errors.slice(0, 20),
  }).catch(() => {});

  return res.status(200).json({
    ok: true, kind,
    targets: targets.length,
    sent, failed,
    errors: errors.slice(0, 10),
  });
}
