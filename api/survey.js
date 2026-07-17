/**
 * /api/survey — records "what should GoalOracle do next?" votes from the
 * Wrapped email (and optional freeform feedback) from the /next thank-you
 * page. Unauthenticated by design: the email link opens in a browser where
 * the user may not have a session, and losing votes to a login wall defeats
 * the survey. Admin SDK writes bypass Firestore rules, so no rules change.
 *
 * POST { vote?, comment?, uid? }
 *  - vote: one of VOTE_OPTIONS. With a uid, stored at vote__{uid} so a user
 *    voting twice just updates their vote (counts stay one-per-user);
 *    without a uid, an anonymous auto-id vote doc.
 *  - comment: freeform ≤2000 chars, stored as its own doc.
 *  - at least one of vote/comment required.
 *
 * Votes are read back by the operator via admin?type=surveyVotes.
 */

import { db, applyCors } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

const VOTE_OPTIONS = new Set(['cl', 'epl', 'cricket', 'wc2030']);

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const vote = typeof body.vote === 'string' && VOTE_OPTIONS.has(body.vote) ? body.vote : null;
    const comment = typeof body.comment === 'string' ? body.comment.trim().slice(0, 2000) : '';
    const uid = typeof body.uid === 'string' && body.uid.length > 0 && body.uid.length < 128 ? body.uid : null;
    if (!vote && !comment) return res.status(400).json({ error: 'Nothing to record' });

    const writes = [];
    if (vote) {
      const ref = uid
        ? db.collection('surveyVotes').doc(`vote__${uid}`)
        : db.collection('surveyVotes').doc();
      writes.push(ref.set({
        type: 'vote',
        vote,
        uid,
        createdAt: FieldValue.serverTimestamp(),
      }, { merge: true }));
    }
    if (comment) {
      writes.push(db.collection('surveyVotes').add({
        type: 'comment',
        comment,
        vote: vote || null,
        uid,
        createdAt: FieldValue.serverTimestamp(),
      }));
    }
    await Promise.all(writes);
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[survey] error:', e?.message);
    return res.status(500).json({ error: 'Could not record' });
  }
}
