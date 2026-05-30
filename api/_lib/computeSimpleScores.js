/**
 * computeSimpleScores.js — recompute + store every Quick Picks player's
 * score from the current match results (R2).
 *
 * Called by the poll-results cron after it ingests new results. For each
 * Quick Picks league (the global league + any private/public league that
 * holds Quick Picks predictions), it scores every member's bracket via
 * calculateSimpleScore and writes the result to
 *   /simplePredictions/{userId}__{leagueId}/scores/{leagueId}
 * which the client already reads via subscribeToSimpleScore, and which the
 * leaderboard endpoint (R3) ranks by.
 *
 * Design (per founder direction, ~1000 users):
 *  - Full recompute of every prediction doc on each run. Scores are derived
 *    and idempotent — a bad run self-heals on the next one. Simple + correct
 *    at this scale; revisit with incremental recompute only if it grows.
 *  - Reads /simplePredictions in one collection scan, groups by leagueId from
 *    the composite doc id (or the legacy single-id global doc), and writes
 *    scores in batched commits (Firestore caps a batch at 500 ops).
 *  - Pure-ish: all the scoring math lives in calculateSimpleScore +
 *    buildSimpleActuals; this module is just the data plumbing, so it's the
 *    only part that needs a live db.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { calculateSimpleScore } from '../../src/utils/scoringSimple.js';

const SEPARATOR = '__';
const GLOBAL_SIMPLE = 'global-simple';
const BATCH_LIMIT = 450; // under Firestore's 500-op ceiling, leaves headroom

// Parse a /simplePredictions doc id into { userId, leagueId }. New docs are
// `${userId}__${leagueId}`; legacy global docs are just `${userId}`.
function parseDocId(id, data) {
  const sep = id.indexOf(SEPARATOR);
  let userId;
  let leagueId;
  if (sep >= 0) {
    userId = id.slice(0, sep);
    leagueId = id.slice(sep + SEPARATOR.length);
  } else {
    userId = id;
    leagueId = GLOBAL_SIMPLE;
  }
  // The stored fields win if present (defends against odd ids).
  return {
    userId: data?.userId || userId,
    leagueId: data?.leagueId || leagueId,
  };
}

/**
 * Recompute + persist scores for every Quick Picks prediction doc.
 *
 * @param {FirebaseFirestore.Firestore} db
 * @param {Object} actuals  output of buildSimpleActuals(matchResults)
 * @returns {Promise<{ scored: number, written: number, errors: number }>}
 */
export async function recomputeSimpleScores(db, actuals) {
  const out = { scored: 0, written: 0, errors: 0 };
  const snap = await db.collection('simplePredictions').get();

  let batch = db.batch();
  let ops = 0;
  const commits = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    if (!data) continue;
    const { userId, leagueId } = parseDocId(doc.id, data);
    try {
      const { totalScore, totalAccuracy, breakdown } = calculateSimpleScore(data, actuals);
      out.scored += 1;
      // Score doc lives in a subcollection under the prediction doc, keyed
      // by leagueId — the exact path subscribeToSimpleScore reads.
      const ref = db
        .collection('simplePredictions').doc(doc.id)
        .collection('scores').doc(leagueId);
      batch.set(ref, {
        userId,
        leagueId,
        totalScore,
        totalAccuracy,
        breakdown,
        computedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
      ops += 1;
      out.written += 1;
      if (ops >= BATCH_LIMIT) {
        commits.push(batch.commit());
        batch = db.batch();
        ops = 0;
      }
    } catch (e) {
      out.errors += 1;
    }
  }
  if (ops > 0) commits.push(batch.commit());
  await Promise.all(commits);
  return out;
}
