/**
 * useBracketState
 *
 * Manages knockout bracket state for Simple Mode. Consumes group rankings
 * + best-third picks + the user's current knockout predictions, and produces
 * round-by-round match slots with resolved team names + cascading winners.
 *
 * Both BracketMobile and BracketDesktop consume the same hook.
 *
 * Returns:
 *   bracket               { roundOf32: [...], roundOf16: [...], ... }
 *                         where each entry has { matchId, home, away, flags, pick }
 *   pickWinner(id, team)  selects the winner, auto-resets downstream picks
 *   resetMatch(id)        clears a match's pick (and downstream)
 *   isRoundComplete(key)  boolean — all matches in that round have a winner
 *   isRoundUnlocked(key)  boolean — previous round is complete
 *   picksByMatchId        flat { matchId -> { winnerId, loserId } }
 */

import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import {
  ROUND_ORDER,
  ROUND_TEMPLATE_BY_KEY,
  deriveRoundOf32,
  deriveNextRound,
  mergeRealRoundOf32,
  flattenPicks,
  getDownstreamMatchIds,
  getRoundForMatchId,
  emptyKnockoutPredictions,
} from '../utils/bracketUtils';

/**
 * @param {Object} args
 * @param {Object} args.groupPredictions
 * @param {string[]} args.bestThirdPicks
 * @param {Object} args.knockoutPredictions   initial/hydrated picks
 * @param {Function} args.onChange             called with new knockoutPredictions after every pick
 */
export default function useBracketState({ groupPredictions, bestThirdPicks, knockoutPredictions, onChange, realR32 = null, predictedTeamSet = null }) {
  const [picks, setPicks] = useState(() => normalize(knockoutPredictions));
  const hydratedRef = useRef(false);
  const dirtyRef = useRef(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (hydratedRef.current) return;
    if (knockoutPredictions) {
      setPicks(normalize(knockoutPredictions));
      hydratedRef.current = true;
    }
  }, [knockoutPredictions]);

  useEffect(() => {
    if (!dirtyRef.current) return;
    dirtyRef.current = false;
    onChangeRef.current && onChangeRef.current(picks);
  }, [picks]);

  // Flat lookup by matchId for cascade math
  const flatPicks = useMemo(() => flattenPicks(picks), [picks]);

  // Derive each round's match slots (with actual team names). When `realR32`
  // is supplied (knockout-real-reseed), the R32 round shows real teams per
  // side (earned-tagged) instead of the user's predicted teams.
  //
  // Picks are hydrated round-by-round with a MEMBERSHIP CHECK: a stored pick
  // is kept only if its winner is one of that slot's two CURRENT teams — so an
  // orphaned pick (its predicted team is no longer in the slot after reseed)
  // is dropped and not cascaded downstream, and a kept pick's loserId is
  // recomputed from the current slot. The validated picks (`prunedFlat`) feed
  // the next round's derivation, so the prune cascades correctly.
  const bracket = useMemo(() => {
    const predictedR32 = deriveRoundOf32(groupPredictions, bestThirdPicks);
    const r32 = realR32
      ? mergeRealRoundOf32(predictedR32, realR32, predictedTeamSet || new Set())
      : predictedR32;
    const prunedFlat = {};
    const out = {};
    for (const round of ROUND_ORDER) {
      const template = ROUND_TEMPLATE_BY_KEY[round];
      const derivedRaw = round === 'roundOf32' ? r32 : deriveNextRound(prunedFlat, template);
      // Score-eligibility marking: R32 is already tagged by mergeRealRoundOf32.
      // Extend the same "won't score" flag to LATER rounds so a team the user
      // didn't predict to advance stays marked all the way through the bracket
      // (the scoring restriction applies to every round, not just R32). Only
      // when a predicted-team set is supplied (reseed mode); otherwise leave
      // earned undefined (= treated as scoring) so nothing is marked.
      const derived = (predictedTeamSet && round !== 'roundOf32')
        ? derivedRaw.map((m) => ({
            ...m,
            homeEarned: m.home ? predictedTeamSet.has(m.home) : true,
            awayEarned: m.away ? predictedTeamSet.has(m.away) : true,
          }))
        : derivedRaw;
      out[round] = derived.map((m) => {
        const existing = flatPicks[m.matchId];
        const valid = !!(existing && existing.winnerId
          && (existing.winnerId === m.home || existing.winnerId === m.away));
        if (!valid) return { ...m, pick: null };
        // Recompute loserId from the current slot (stale after a reseed).
        const loserId = existing.winnerId === m.home ? m.away : m.home;
        prunedFlat[m.matchId] = { matchId: m.matchId, winnerId: existing.winnerId, loserId };
        return { ...m, pick: { winnerId: existing.winnerId, loserId } };
      });
    }
    return out;
  }, [groupPredictions, bestThirdPicks, flatPicks, realR32, predictedTeamSet]);

  const pickWinner = useCallback((matchId, winnerTeam) => {
    const round = getRoundForMatchId(matchId);
    if (!round) return { cleared: 0 };
    const roundSlots = bracket[round];
    const slot = roundSlots?.find((s) => s.matchId === matchId);
    if (!slot || !slot.home || !slot.away) return { cleared: 0 };
    if (winnerTeam !== slot.home && winnerTeam !== slot.away) return { cleared: 0 };
    // No input gate: any real team in the slot can be advanced (the user can
    // re-pick freely from the actual bracket). Whether a pick *scores* is
    // decided at scoring time — only teams the user originally predicted to
    // reach the knockouts earn points (see predictedAdvancers in
    // scoringSimple.js). The `*Earned` flags now drive a "won't score" marker
    // in the UI, not a block.
    const loser = winnerTeam === slot.home ? slot.away : slot.home;

    // If the user is *changing* a previously-set winner, count how many
    // already-picked downstream matches will be wiped so the caller can
    // surface a "N picks reset" toast. Picking the same team again is a
    // no-op for downstream so cleared stays 0.
    let cleared = 0;
    const previousWinner = slot.pick?.winnerId;
    if (previousWinner && previousWinner !== winnerTeam) {
      const downstream = getDownstreamMatchIds(matchId);
      for (const dsId of downstream) {
        const dsRound = getRoundForMatchId(dsId);
        if (!dsRound) continue;
        const dsSlot = bracket[dsRound]?.find((s) => s.matchId === dsId);
        if (dsSlot?.pick?.winnerId) cleared++;
      }
    }

    dirtyRef.current = true;
    setPicks((prev) => {
      const next = cloneRounds(prev);
      const arr = next[round];
      const idx = arr.findIndex((p) => p.matchId === matchId);
      const entry = { matchId, winnerId: winnerTeam, loserId: loser };
      if (idx >= 0) arr[idx] = entry; else arr.push(entry);

      const downstream = getDownstreamMatchIds(matchId);
      for (const dsId of downstream) {
        const dsRound = getRoundForMatchId(dsId);
        if (!dsRound) continue;
        next[dsRound] = next[dsRound].filter((p) => p.matchId !== dsId);
      }

      return next;
    });
    return { cleared };
  }, [bracket]);

  const resetMatch = useCallback((matchId) => {
    const round = getRoundForMatchId(matchId);
    if (!round) return;
    dirtyRef.current = true;
    setPicks((prev) => {
      const next = cloneRounds(prev);
      next[round] = next[round].filter((p) => p.matchId !== matchId);
      for (const dsId of getDownstreamMatchIds(matchId)) {
        const dsRound = getRoundForMatchId(dsId);
        if (dsRound) next[dsRound] = next[dsRound].filter((p) => p.matchId !== dsId);
      }
      return next;
    });
  }, []);

  const resetAll = useCallback(() => {
    dirtyRef.current = true;
    setPicks(emptyKnockoutPredictions());
  }, []);

  // Clear only picks for matches that AREN'T locked yet, keeping any pick whose
  // game has already kicked off (per-game lock). Mirrors the server's per-match
  // revert so the client doesn't briefly drop a locked pick on reset. `isLocked`
  // is a (matchId) => boolean predicate.
  const resetUnlocked = useCallback((isLocked) => {
    dirtyRef.current = true;
    setPicks((prev) => {
      const next = emptyKnockoutPredictions();
      for (const r of ROUND_ORDER) {
        next[r] = (prev[r] || []).filter((p) => p && p.matchId && isLocked && isLocked(p.matchId));
      }
      return next;
    });
  }, []);

  const isRoundComplete = useCallback((roundKey) => {
    const slots = bracket[roundKey] || [];
    if (slots.length === 0) return false;
    return slots.every((s) => s.pick && s.pick.winnerId);
  }, [bracket]);

  const isRoundUnlocked = useCallback((roundKey) => {
    const idx = ROUND_ORDER.indexOf(roundKey);
    if (idx === 0) return true;
    // Third-place match unlocks once semifinals done
    if (roundKey === 'thirdPlace' || roundKey === 'final') return isRoundComplete('semiFinals');
    const prev = ROUND_ORDER[idx - 1];
    return isRoundComplete(prev);
  }, [isRoundComplete]);

  return {
    bracket,
    pickWinner,
    resetMatch,
    resetAll,
    resetUnlocked,
    isRoundComplete,
    isRoundUnlocked,
    picksByMatchId: flatPicks,
    // Raw round-keyed picks in the stored shape ({ roundOf32: [...], ... }) —
    // the same payload the per-pick onChange saves. Exposed so the submit
    // handler can re-persist the full bracket, not just the isComplete flag.
    knockoutPredictions: picks,
  };
}

function normalize(knockoutPredictions) {
  const base = emptyKnockoutPredictions();
  if (!knockoutPredictions) return base;
  for (const r of ROUND_ORDER) {
    if (Array.isArray(knockoutPredictions[r])) base[r] = [...knockoutPredictions[r]];
  }
  return base;
}

function cloneRounds(picks) {
  const out = {};
  for (const r of ROUND_ORDER) out[r] = [...(picks[r] || [])];
  return out;
}
