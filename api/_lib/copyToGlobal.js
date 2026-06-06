/**
 * copyToGlobal.js — server-side utility to copy a user's Quick Picks
 * bracket from a source league into the Global Quick Picks League
 * (`global-simple`, the prize contest).
 *
 * Why this exists separately from the client `copySimplePrediction`:
 * that one writes as the *authenticated* user and can only touch the
 * caller's own docs. Both callers of THIS function operate on behalf
 * of someone else or the system:
 *   - superadmin bulk/single copy (admin endpoint) — acts on any user
 *   - auto-submit on private-league completion — actor 'system:auto-submit'
 * so it runs under the Admin SDK and is keyed by an explicit userId.
 *
 * Scope: Quick Picks only. Every QP league shares the same tournament
 * data + Annexe C matrix + fixed scoring, so a simple-mode source is
 * always format-compatible with global-simple; a classic source is
 * rejected as incompatible.
 *
 * Eligibility (stage-lock-only, per product decision):
 *   - source must have picks
 *   - source league must not be classic mode
 *   - the would-be write must not touch a stage that has already locked
 *     (you can't write group picks once the group stage has kicked off)
 *
 * Existing global entry handling:
 *   - mode 'skip' (default): if the user already has ANY global entry
 *     (picks or a submittedAt stamp), no-op and return it
 *   - mode 'overwrite': replace the global picks
 *
 * Every call — success, skip, or ineligible — writes one row to
 * /globalSubmitLog for audit.
 */

import { db } from './firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { evaluateCopy, sourceHasPicks, GLOBAL_SIMPLE_LEAGUE_ID } from './copyToGlobalLogic.js';

const SEPARATOR = '__';

// Re-export the pure helpers so callers can import everything from here.
export { evaluateCopy, sourceHasPicks, GLOBAL_SIMPLE_LEAGUE_ID };

async function writeAudit(entry) {
  const {
    actor, userId, sourceLeagueId, targetLeagueId, mode, outcome,
    reason = null, lockedSections = null, picksId = null,
  } = entry;
  try {
    await db.collection('globalSubmitLog').add({
      actor: actor || 'unknown',
      userId,
      sourceLeagueId,
      targetLeagueId,
      mode,
      outcome,
      reason,
      lockedSections,
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (e) {
    // Never let an audit-write failure mask the real outcome.
    console.error('[copyToGlobal] audit write failed:', e?.message);
  }
  return {
    ok: outcome === 'created' || outcome === 'overwritten' || outcome === 'skipped_existing',
    outcome,
    ...(reason ? { reason } : {}),
    ...(picksId ? { picksId } : {}),
    ...(lockedSections ? { lockedSections } : {}),
  };
}

/**
 * @param {string} userId
 * @param {string} sourceLeagueId
 * @param {{ actor?: string, mode?: 'skip'|'overwrite' }} opts
 * @returns {Promise<{ ok: boolean, outcome: string, reason?: string, picksId?: string, lockedSections?: string[] }>}
 */
export async function copyUserPicksToGlobalLeague(userId, sourceLeagueId, opts = {}) {
  const { actor = 'unknown', mode = 'skip' } = opts;
  const targetLeagueId = GLOBAL_SIMPLE_LEAGUE_ID;

  if (!userId || !sourceLeagueId) {
    return writeAudit({ actor, userId: userId || null, sourceLeagueId: sourceLeagueId || null, targetLeagueId, mode, outcome: 'error', reason: 'bad_input' });
  }
  if (sourceLeagueId === targetLeagueId) {
    return writeAudit({ actor, userId, sourceLeagueId, targetLeagueId, mode, outcome: 'ineligible', reason: 'source_is_target' });
  }

  try {
    const srcRef = db.collection('simplePredictions').doc(`${userId}${SEPARATOR}${sourceLeagueId}`);
    const tgtRef = db.collection('simplePredictions').doc(`${userId}${SEPARATOR}${targetLeagueId}`);
    const [srcSnap, tgtSnap, leagueSnap] = await Promise.all([
      srcRef.get(),
      tgtRef.get(),
      db.collection('leagues').doc(sourceLeagueId).get(),
    ]);

    const sourceDoc = srcSnap.exists ? srcSnap.data() : null;
    let targetDoc = tgtSnap.exists ? tgtSnap.data() : null;
    // Legacy single-doc global-simple path (pre-composite-key users).
    if (!targetDoc) {
      const legacy = await db.collection('simplePredictions').doc(userId).get();
      if (legacy.exists) targetDoc = legacy.data();
    }
    const sourceLeague = leagueSnap.exists ? leagueSnap.data() : null;

    const decision = evaluateCopy({ sourceDoc, sourceLeague, targetDoc, mode });

    if (decision.action === 'skip') {
      return writeAudit({ actor, userId, sourceLeagueId, targetLeagueId, mode, outcome: 'skipped_existing', reason: decision.reason, picksId: tgtRef.id });
    }
    if (decision.action === 'ineligible') {
      return writeAudit({ actor, userId, sourceLeagueId, targetLeagueId, mode, outcome: 'ineligible', reason: decision.reason, lockedSections: decision.lockedSections });
    }

    const writePayload = {
      userId,
      leagueId: targetLeagueId,
      groupPredictions: sourceDoc.groupPredictions || {},
      bestThirdPicks: sourceDoc.bestThirdPicks || [],
      knockoutPredictions: sourceDoc.knockoutPredictions || {},
      // Derive from the bracket (Final winner) not the source's stored flag,
      // which can be a stale false on a finished bracket. Mirrors the
      // leaderboard's completion rule.
      isComplete: !!(sourceDoc.isComplete || sourceDoc.knockoutPredictions?.final?.[0]?.winnerId),
      updatedAt: FieldValue.serverTimestamp(),
    };
    // submittedAt is the leaderboard tiebreaker — set once, never reset.
    if (!targetDoc?.submittedAt) writePayload.submittedAt = FieldValue.serverTimestamp();

    await tgtRef.set(writePayload, { merge: true });

    return writeAudit({
      actor, userId, sourceLeagueId, targetLeagueId, mode,
      outcome: decision.action === 'overwrite' ? 'overwritten' : 'created',
      picksId: tgtRef.id,
    });
  } catch (e) {
    return writeAudit({ actor, userId, sourceLeagueId, targetLeagueId, mode, outcome: 'error', reason: e?.message || 'crash' });
  }
}
