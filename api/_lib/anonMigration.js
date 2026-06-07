/**
 * Pure decision logic for the no-login funnel's anon→real picks migration
 * (roadmap item C, phase iv). Kept free of any Firebase/admin import so it's
 * unit-testable in isolation — the migration handler (api/migrate-anon-picks.js)
 * does the Firestore I/O and delegates the branch decision here.
 *
 * This is the highest-risk surface in item C: a wrong branch loses the bracket
 * a visitor made before signing up, on a real-money prize path.
 */

const SEP = '__';
export const GLOBAL_SIMPLE = 'global-simple';
export const anonDocId = (uid) => `${uid}${SEP}${GLOBAL_SIMPLE}`;

export function hasPicks(d) {
  if (!d) return false;
  const g = d.groupPredictions || {};
  if (Object.values(g).some(v => Array.isArray(v?.ranking) && v.ranking.filter(Boolean).length > 0)) return true;
  if (Array.isArray(d.bestThirdPicks) && d.bestThirdPicks.length > 0) return true;
  const ko = d.knockoutPredictions || {};
  if (Object.values(ko).some(a => Array.isArray(a) && a.length > 0)) return true;
  return false;
}

// Given the two UIDs and the source/target doc data, decide whether to
// migrate. `migrate:false` carries the reason the caller surfaces to the user
// (notably `target_has_picks`, the existing-account edge case the roadmap
// mandates we communicate rather than drop silently). When migrating, also
// returns the derived isComplete flag (mirrors the server-authoritative rule).
export function migrationDecision({ anonUid, newUid, srcData, tgtData }) {
  if (anonUid === newUid) return { migrate: false, reason: 'same_uid' };
  if (!hasPicks(srcData)) return { migrate: false, reason: 'no_anon_picks' };
  if (tgtData && (hasPicks(tgtData) || tgtData.submittedAt)) {
    return { migrate: false, reason: 'target_has_picks' };
  }
  return {
    migrate: true,
    isComplete: !!(srcData.isComplete || srcData.knockoutPredictions?.final?.[0]?.winnerId),
  };
}
