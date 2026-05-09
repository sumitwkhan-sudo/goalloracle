// Periodic cleanup for anti-Sybil bookkeeping. Vercel Cron triggers this
// daily; the schedule lives in vercel.json. The endpoint also accepts a
// superadmin Authorization header for manual runs.
//
// What it cleans:
//   1. /signupAttempts/{ipHash} — prunes history/codeHistory/feedbackHistory
//      arrays to entries within the last 24h and deletes empty docs.
//   2. /authCodes/{docId} — deletes expired code docs that the verify-code
//      flow never reached (user requested a code and abandoned).
//
// Auth: Vercel sets `Authorization: Bearer ${CRON_SECRET}` automatically when
// CRON_SECRET is configured in env. Manual calls must use that secret OR a
// superadmin Bearer token.

import { db, applyCors, verifyAuth } from '../_lib/firebase.js';

const ATTEMPT_KEEP_MS = 24 * 60 * 60 * 1000;

async function isAuthorized(req) {
  // Vercel Cron path
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  // Superadmin manual run
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
  const stats = { signupAttemptsPruned: 0, signupAttemptsDeleted: 0, authCodesDeleted: 0 };

  try {
    // ── /signupAttempts ──
    const attemptsSnap = await db.collection('signupAttempts').get();
    for (const d of attemptsSnap.docs) {
      const data = d.data() || {};
      const next = {};
      let changed = false;

      const filterArr = (key) => {
        const arr = Array.isArray(data[key]) ? data[key].filter(t => now - t < ATTEMPT_KEEP_MS) : null;
        if (arr === null) return;
        if (arr.length !== (data[key] || []).length) changed = true;
        next[key] = arr;
      };
      filterArr('history');
      filterArr('codeHistory');
      filterArr('feedbackHistory');

      const allEmpty =
        (next.history?.length || 0) === 0 &&
        (next.codeHistory?.length || 0) === 0 &&
        (next.feedbackHistory?.length || 0) === 0;

      if (allEmpty) {
        await d.ref.delete();
        stats.signupAttemptsDeleted += 1;
      } else if (changed) {
        await d.ref.update(next);
        stats.signupAttemptsPruned += 1;
      }
    }

    // ── /authCodes ──
    const codesSnap = await db.collection('authCodes').where('expiresAt', '<', now).get();
    let batch = db.batch();
    let inBatch = 0;
    for (const d of codesSnap.docs) {
      batch.delete(d.ref);
      inBatch += 1;
      stats.authCodesDeleted += 1;
      if (inBatch >= 450) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();

    return res.status(200).json({ success: true, stats, ranAt: new Date().toISOString() });
  } catch (e) {
    console.error('[cron/cleanup] error:', e);
    return res.status(500).json({ error: e.message, stats });
  }
}
