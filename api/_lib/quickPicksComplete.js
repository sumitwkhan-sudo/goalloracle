/**
 * quickPicksComplete.js — the canonical Quick Picks "is this bracket
 * complete?" rule, shared by the save endpoint (api/simple-predictions.js)
 * and its unit test so the test is load-bearing: a drift in the real
 * expression trips it.
 *
 * Mirrors the leaderboard (api/simple-leaderboard.js): a bracket is
 * "complete" once the Final winner is picked. Computing this server-side on
 * every write means the stored isComplete flag can never lag a finished
 * bracket — the bug where copying a Global bracket carried over a stale
 * isComplete:false and left the user marked "not submitted".
 */

export function hasFinalWinner(doc) {
  return !!(doc?.knockoutPredictions?.final?.[0]?.winnerId);
}

/**
 * The isComplete value to STORE for a write, derived from the merged doc:
 *   1. a Final winner in the merged knockout ⇒ complete (canonical rule), OR
 *   2. the client explicitly asserts isComplete:true (e.g. a user who submits
 *      with the 3rd-place game deliberately left blank — no Final-round
 *      winner is the same match, but this covers any future "submit without
 *      the very last pick" path), OR
 *   3. the doc was already stored complete AND this write touches neither the
 *      flag nor the knockout section — preserve an explicit completion across
 *      an unrelated edit (e.g. a groups-only re-save). Without this, such a
 *      doc would silently flip back to incomplete on the next partial save.
 *
 * @param {object} partial   the incoming partial payload
 * @param {object|null} mergedOld  the existing stored doc (or null)
 */
export function computeIsComplete(partial, mergedOld) {
  const mergedKnockout = ('knockoutPredictions' in partial)
    ? partial.knockoutPredictions
    : mergedOld?.knockoutPredictions;
  if (mergedKnockout?.final?.[0]?.winnerId) return true;
  if (partial.isComplete === true) return true;
  if (!('isComplete' in partial) && !('knockoutPredictions' in partial) && mergedOld?.isComplete === true) {
    return true;
  }
  return false;
}

/**
 * Was the doc already complete BEFORE this write? Used to gate the
 * auto-submit-to-Global transition so it fires once on false→true, never on
 * a re-save of an already-complete bracket. Inspects the stored winner too,
 * so a doc carrying the legacy stale isComplete:false (but a real winner)
 * does not spuriously re-trigger.
 */
export function wasComplete(mergedOld) {
  return !!(mergedOld?.isComplete === true || hasFinalWinner(mergedOld));
}
