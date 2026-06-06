/**
 * /api/simple-predictions — server-authoritative writes for Quick Picks.
 *
 * The client used to call setDoc directly on /simplePredictions/{userId}__{leagueId}.
 * That meant a user with devtools could edit a stage's picks AFTER its first
 * match had kicked off. Firestore rules now deny direct writes; everything
 * flows through this endpoint so the server can validate stage locks.
 *
 * Body: { leagueId, partial }
 *   partial: subset of { groupPredictions, bestThirdPicks, knockoutPredictions, isComplete }
 *
 * 403 with { lockedSections: [...] } if any section in the diff has already
 * crossed its stage lock. UI shows the user which stages are frozen.
 */

import { db, applyCors, verifyAuth } from './_lib/firebase.js';
import { lockedSectionsInUpdate } from '../src/utils/stageLock.js';
import { computeIsComplete, wasComplete } from './_lib/quickPicksComplete.js';
import { FieldValue } from 'firebase-admin/firestore';

const SEPARATOR = '__';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const userId = claims.userId;

  if (req.method === 'DELETE') {
    return await handleReset(req, res, userId);
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { leagueId, partial } = req.body || {};
  if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) {
    return res.status(400).json({ error: 'Missing or invalid partial payload' });
  }

  // Cap the payload so a malformed client can't write a 1MB blob.
  const knownKeys = ['groupPredictions', 'bestThirdPicks', 'knockoutPredictions', 'isComplete'];
  for (const k of Object.keys(partial)) {
    if (!knownKeys.includes(k)) return res.status(400).json({ error: `Unknown field: ${k}` });
  }

  const docId = `${userId}${SEPARATOR}${leagueId}`;
  const ref = db.collection('simplePredictions').doc(docId);

  try {
    const snap = await ref.get();
    let mergedOld = snap.exists ? snap.data() : null;
    // Backwards compat with the legacy /simplePredictions/{userId} doc.
    if (!mergedOld && leagueId === 'global-simple') {
      const legacy = await db.collection('simplePredictions').doc(userId).get();
      if (legacy.exists) mergedOld = legacy.data();
    }

    const locked = lockedSectionsInUpdate(partial, mergedOld);
    if (locked.length > 0) {
      return res.status(403).json({
        error: 'Some Quick Picks sections have already locked and cannot be changed.',
        lockedSections: locked,
      });
    }

    const writePayload = {
      userId,
      leagueId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if ('groupPredictions' in partial) writePayload.groupPredictions = partial.groupPredictions;
    if ('bestThirdPicks' in partial) writePayload.bestThirdPicks = partial.bestThirdPicks;
    if ('knockoutPredictions' in partial) writePayload.knockoutPredictions = partial.knockoutPredictions;

    // isComplete is SERVER-AUTHORITATIVE — computed from the merged bracket
    // via the shared canonical rule (see ./_lib/quickPicksComplete.js), not
    // trusted from the client. This means a finished bracket can never be
    // stored as isComplete:false — the bug where copying a Global bracket
    // (whose stored flag was stale-false) into a league left the user marked
    // "not submitted" until they re-edited.
    const computedComplete = computeIsComplete(partial, mergedOld);
    writePayload.isComplete = computedComplete;

    // submittedAt is the leaderboard tiebreaker — set once on first save,
    // never overwritten. Same invariant the client-side rule used to enforce.
    if (!mergedOld?.submittedAt) {
      writePayload.submittedAt = FieldValue.serverTimestamp();
    }

    await ref.set(writePayload, { merge: true });

    // Auto-submit to the Global League the moment a user COMPLETES a
    // bracket in a non-global league. Fires on the false→true completion
    // transition (computed, so it also fires for brackets that became
    // complete without an explicit isComplete flag). Uses the shared copy
    // util in 'skip' mode so an existing global entry is never clobbered;
    // format + stage-lock eligibility live in the util, which also writes
    // the globalSubmitLog audit row (actor 'system:auto-submit').
    // Awaited-with-catch: a copy failure must NEVER fail the user's own
    // submission, so we swallow errors and just log them.
    const justCompleted = computedComplete && !wasComplete(mergedOld);
    if (justCompleted && leagueId !== 'global-simple' && leagueId !== 'global') {
      try {
        const { copyUserPicksToGlobalLeague } = await import('./_lib/copyToGlobal.js');
        await copyUserPicksToGlobalLeague(userId, leagueId, { actor: 'system:auto-submit', mode: 'skip' });
      } catch (e) {
        console.error('[simple-predictions] auto-submit to global failed:', e?.message);
      }
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[simple-predictions] error:', e);
    return res.status(500).json({ error: e.message });
  }
}

async function handleReset(req, res, userId) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const { leagueId } = body;
  if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });

  const docId = `${userId}${SEPARATOR}${leagueId}`;
  const ref = db.collection('simplePredictions').doc(docId);

  try {
    // Reset is equivalent to "clear all sections" — only allowed if no
    // stage has locked yet. Once any stage locks, that section is frozen
    // and a full reset would erase locked picks (cheating vector).
    const snap = await ref.get();
    const mergedOld = snap.exists ? snap.data() : null;
    const locked = lockedSectionsInUpdate(
      {
        groupPredictions: {},
        bestThirdPicks: [],
        knockoutPredictions: { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: [], final: [] },
      },
      mergedOld,
    );
    if (locked.length > 0) {
      return res.status(403).json({
        error: 'Cannot reset Quick Picks — some stages have already locked.',
        lockedSections: locked,
      });
    }

    await ref.set({
      userId,
      leagueId,
      groupPredictions: {},
      bestThirdPicks: [],
      knockoutPredictions: { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: [], final: [] },
      isComplete: false,
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[simple-predictions] reset error:', e);
    return res.status(500).json({ error: e.message });
  }
}
