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
  sendOutreachBatch,
  RESEND_BATCH_SIZE,
  TEMPLATES,
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
  const list = Array.from(new Set(Array.isArray(userIds) ? userIds : []));
  const noteError = (uid, error) => { results.failed++; if (results.errors.length < 25) results.errors.push({ uid, error }); };

  // Batch-fetch users (getAll in chunks) so a large scheduled send doesn't do
  // hundreds of sequential reads.
  const userDocs = {};
  for (let i = 0; i < list.length; i += 300) {
    const refs = list.slice(i, i + 300).map((uid) => db.collection('users').doc(uid));
    const snaps = await db.getAll(...refs);
    for (const s of snaps) if (s.exists) userDocs[s.id] = { id: s.id, ...s.data() };
  }

  // Build a personalized email per eligible recipient (per-user ctx from
  // userPayloads, e.g. rankDigest movement; absent → ctx {} → unchanged).
  const toSend = [];
  for (const uid of list) {
    const user = userDocs[uid];
    if (!user || !user.email || user.emailOptOut === true) { results.skipped++; continue; }
    try {
      const ctx = (userPayloads && userPayloads[uid]) || {};
      const { subject, html, text } = buildEmail(template, { user, ctx });
      toSend.push({ uid, to: user.email, subject, html, text });
    } catch (e) {
      noteError(uid, e?.message || 'build-failed');
    }
  }

  // Send via Resend's batch endpoint (100/call) so even a 1000-recipient
  // scheduled send completes inside the cron's time budget.
  const sentStatus = {};
  for (let i = 0; i < toSend.length; i += RESEND_BATCH_SIZE) {
    const chunk = toSend.slice(i, i + RESEND_BATCH_SIZE);
    const r = await sendOutreachBatch(chunk.map((e) => ({
      to: e.to, subject: e.subject, html: e.html, text: e.text,
      tags: [
        { name: 'userId', value: e.uid },
        { name: 'template', value: template },
        { name: 'scheduledId', value: id },
      ],
    })));
    chunk.forEach((e, j) => { sentStatus[e.uid] = r.results[j] || { sent: false, error: r.error || 'unknown' }; });
  }

  // Per-user audit rows in Firestore batches (≤500/commit).
  let writeBatch = db.batch();
  let pending = 0;
  for (const e of toSend) {
    const st = sentStatus[e.uid] || { sent: false, error: 'unknown' };
    writeBatch.set(db.collection('outreachSent').doc(`${e.uid}__${template}`), {
      userId: e.uid, template, sentAt: FieldValue.serverTimestamp(),
      sent: st.sent, error: st.error || null, sentBy: scheduledBy, viaScheduledId: id,
    }, { merge: true });
    if (st.sent) results.sent++;
    else noteError(e.uid, st.error || 'unknown');
    if (++pending >= 450) { await writeBatch.commit(); writeBatch = db.batch(); pending = 0; }
  }
  if (pending > 0) await writeBatch.commit();

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
