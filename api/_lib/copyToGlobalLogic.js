/**
 * Pure decision logic for copy-to-global — no Firebase, no I/O, so it's
 * unit-testable in isolation. The I/O wrapper lives in copyToGlobal.js.
 */

import { lockedSectionsInUpdate } from '../../src/utils/stageLock.js';

export const GLOBAL_SIMPLE_LEAGUE_ID = 'global-simple';

// True iff the doc has at least one non-empty picks section.
export function sourceHasPicks(d) {
  if (!d || typeof d !== 'object') return false;
  const g = d.groupPredictions || {};
  if (Object.values(g).some(v => Array.isArray(v?.ranking) && v.ranking.filter(Boolean).length > 0)) return true;
  if (Array.isArray(d.bestThirdPicks) && d.bestThirdPicks.length > 0) return true;
  const ko = d.knockoutPredictions || {};
  if (Object.values(ko).some(a => Array.isArray(a) && a.length > 0)) return true;
  return false;
}

/**
 * Decide what a copy should do given the source/target docs + mode.
 * Returns { action, reason?, lockedSections? } where action is one of
 * 'create' | 'overwrite' | 'skip' | 'ineligible'.
 *
 * Eligibility is stage-lock-only (per product decision): we don't gate
 * on prize consent here — that stays handled by the consent banner.
 */
export function evaluateCopy({ sourceDoc, sourceLeague, targetDoc, mode = 'skip', now = Date.now() }) {
  if (!sourceHasPicks(sourceDoc)) {
    return { action: 'ineligible', reason: 'no_source_picks' };
  }
  // QP-only: a classic source can't map onto the simple global bracket.
  if (sourceLeague && sourceLeague.predictionMode === 'classic') {
    return { action: 'ineligible', reason: 'incompatible_format' };
  }
  const targetHasEntry = !!targetDoc && (sourceHasPicks(targetDoc) || !!targetDoc.submittedAt);
  if (targetHasEntry && mode !== 'overwrite') {
    return { action: 'skip', reason: 'existing_global_entry' };
  }
  // Stage-lock: would copying these sections change anything already
  // frozen? Compare the would-be write against the current target.
  const partial = {
    groupPredictions: sourceDoc.groupPredictions || {},
    bestThirdPicks: sourceDoc.bestThirdPicks || [],
    knockoutPredictions: sourceDoc.knockoutPredictions || {},
  };
  const locked = lockedSectionsInUpdate(partial, targetDoc || {}, now);
  if (locked.length > 0) {
    return { action: 'ineligible', reason: 'stage_locked', lockedSections: locked };
  }
  return { action: targetHasEntry ? 'overwrite' : 'create' };
}
