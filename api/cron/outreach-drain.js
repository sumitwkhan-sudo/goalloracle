/**
 * /api/cron/outreach-drain — drains scheduled outreach sends.
 *
 * Runs every 5 minutes. Finds /outreachScheduled docs where
 *   status === 'pending' AND scheduledFor <= now
 * For each one:
 *   1. Transactionally flips status from 'pending' -> 'sending' so
 *      concurrent invocations don't double-send. (Vercel cron runs
 *      single-instance per schedule, but an operator could manually
 *      trigger via the admin endpoint — defense in depth.)
 *   2. Runs the standard per-user send loop (same code path as
 *      outreachSendBatch — buildEmail + sendOutreachEmail + tags +
 *      per-user audit row to /outreachSent).
 *   3. Updates status to 'done' (or 'failed' if every send errored)
 *      with the final counts, and writes a /outreachRuns summary so
 *      the Recent Runs panel in the admin tab shows the send.
 *
 * Auth: same CRON_SECRET / x-vercel-cron pattern as the other crons.
 *
 * Throughput: the per-batch throttle inside sendOutreachEmail keeps
 * each scheduled send at ~10 emails/sec. A scheduled batch of 1000
 * takes ~100s — fine inside Vercel's 60s function limit AS LONG AS
 * the batch is sized down OR we accept tail batches finishing on a
 * later cron tick. For the realistic scale (<=200 recipients per
 * scheduled send) this isn't a problem.
 */

import { db, verifyAuth } from '../_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import {
  buildEmail,
  sendOutreachEmail,
  TEMPLATES,
  sleep,
  BATCH_DELAY_MS,
} from '../_lib/outreachEmail.js';

async function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers['x-vercel-cron'] === '1') return true;
  // Manual operator trigger (admin panel "drain now" button — future).
  const claims = await verifyAuth(req);
  if (!claims) return false;
  const userSnap = await db.collection('users').doc(claims.userId).get();
  return userSnap.exists && userSnap.data().role === 'superadmin';
}

async function claimNextPending() {
  // Atomically grab one pending doc whose scheduledFor is in the past.
  // Query by status only (single-field auto-index) and pick the earliest
  // due doc in memory — combining `status ==` with a `scheduledFor <=`
  // range + orderBy would need a composite index that isn't provisioned
  // (its absence was 500-ing this cron every run). outreachScheduled is
  // small (a handful of pending sends), so the in-memory scan is cheap.
  const nowMs = Date.now();
  const pendingSnap = await db.collection('outreachScheduled')
    .where('status', '==', 'pending')
    .get();
  const due = pendingSnap.docs
    .map((d) => {
      const ts = d.data().scheduledFor;
      const ms = ts?.toMillis ? ts.toMillis() : (ts?._seconds ? ts._seconds * 1000 : (ts instanceof Date ? ts.getTime() : null));
      return { ref: d.ref, ms };
    })
    .filter((x) => x.ms != null && x.ms <= nowMs)
    .sort((a, b) => a.ms - b.ms);
  if (due.length === 0) return null;

  const docRef = due[0].ref;
  try {
    return await db.runTransaction(async (txn) => {
      const cur = await txn.get(docRef);
      if (!cur.exists) return null;
      const data = cur.data();
      if (data.status !== 'pending') return null;
      txn.update(docRef, {
        status: 'sending',
        startedAt: FieldValue.serverTimestamp(),
      });
      return { id: cur.id, ref: docRef, ...data };
    });
  } catch (e) {
    console.warn('[outreach-drain] claim txn failed:', e?.message);
    return null;
  }
}

async function runScheduledSend(claimed) {
  const { id, ref, template, userIds, scheduledBy, userPayloads } = claimed;
  if (!TEMPLATES[template]) {
    await ref.update({
      status: 'failed',
      finishedAt: FieldValue.serverTimestamp(),
      lastError: `Unknown template: ${template}`,
    });
    return { sent: 0, skipped: 0, failed: userIds?.length || 0 };
  }

  const results = { sent: 0, skipped: 0, failed: 0, errors: [] };
  const list = Array.isArray(userIds) ? userIds : [];
  for (const uid of list) {
    try {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) { results.skipped++; continue; }
      const user = { id: userSnap.id, ...userSnap.data() };
      if (!user.email || user.emailOptOut === true) { results.skipped++; continue; }

      // Per-user context for personalized templates (e.g. rankDigest carries
      // each user's movement). Absent for the standard templates → ctx {} →
      // unchanged behavior.
      const ctx = (userPayloads && userPayloads[uid]) || {};
      const { subject, html, text } = buildEmail(template, { user, ctx });
      const r = await sendOutreachEmail({
        to: user.email,
        subject, html, text,
        tags: [
          { name: 'userId', value: uid },
          { name: 'template', value: template },
          { name: 'scheduledId', value: id },
        ],
      });

      await db.collection('outreachSent').doc(`${uid}__${template}`).set({
        userId: uid,
        template,
        sentAt: FieldValue.serverTimestamp(),
        sent: r.sent,
        error: r.error || null,
        sentBy: scheduledBy,
        viaScheduledId: id,
      }, { merge: true });

      if (r.sent) results.sent++;
      else { results.failed++; results.errors.push({ uid, error: r.error || 'unknown' }); }

      await sleep(BATCH_DELAY_MS);
    } catch (e) {
      results.failed++;
      results.errors.push({ uid, error: e?.message || 'crash' });
    }
  }

  await ref.update({
    status: results.sent > 0 ? 'done' : 'failed',
    finishedAt: FieldValue.serverTimestamp(),
    attempted: list.length,
    sent: results.sent,
    skipped: results.skipped,
    failed: results.failed,
  });

  // Mirror to /outreachRuns so the Recent Runs panel shows it.
  await db.collection('outreachRuns').add({
    template,
    triggeredBy: scheduledBy,
    triggeredAt: FieldValue.serverTimestamp(),
    attempted: list.length,
    sent: results.sent,
    skipped: results.skipped,
    failed: results.failed,
    scheduled: true,
    scheduledId: id,
  });

  return results;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (!await isAuthorized(req)) return res.status(403).json({ error: 'forbidden' });

  // Drain one scheduled send per tick. Multiple pending sends just take
  // multiple ticks — keeps each cron invocation well under the Vercel
  // function time limit even if a single batch is on the larger side.
  const claimed = await claimNextPending();
  if (!claimed) return res.status(200).json({ drained: 0 });

  try {
    const r = await runScheduledSend(claimed);
    return res.status(200).json({ drained: 1, id: claimed.id, ...r });
  } catch (e) {
    console.error('[outreach-drain] run failed:', e?.message);
    await claimed.ref.update({
      status: 'failed',
      finishedAt: FieldValue.serverTimestamp(),
      lastError: e?.message || 'crash',
    });
    return res.status(500).json({ error: 'drain failed', message: e?.message });
  }
}
