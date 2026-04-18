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
export default function useBracketState({ groupPredictions, bestThirdPicks, knockoutPredictions, onChange }) {
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
    if (!dirtyRef.current) { return; }
    dirtyRef.current = false;
    console.log('[bracket] onChange firing, rounds with picks:', Object.entries(picks).filter(([,v]) => v.length > 0).map(([k,v]) => `${k}:${v.length}`).join(', '));
    onChangeRef.current && onChangeRef.current(picks);
  }, [picks]);

  // Flat lookup by matchId for cascade math
  const flatPicks = useMemo(() => flattenPicks(picks), [picks]);

  // Derive each round's match slots (with actual team names)
  const bracket = useMemo(() => {
    const r32 = deriveRoundOf32(groupPredictions, bestThirdPicks);
    const hydrate = (round, template) => {
      const derived = round === 'roundOf32'
        ? r32
        : deriveNextRound(flatPicks, template);
      return derived.map((m) => {
        const existing = flatPicks[m.matchId];
        return {
          ...m,
          pick: existing ? { winnerId: existing.winnerId, loserId: existing.loserId } : null,
        };
      });
    };
    const out = {};
    for (const r of ROUND_ORDER) out[r] = hydrate(r, ROUND_TEMPLATE_BY_KEY[r]);
    return out;
  }, [groupPredictions, bestThirdPicks, flatPicks]);

  const pickWinner = useCallback((matchId, winnerTeam) => {
    const round = getRoundForMatchId(matchId);
    if (!round) return;
    const roundSlots = bracket[round];
    const slot = roundSlots?.find((s) => s.matchId === matchId);
    if (!slot || !slot.home || !slot.away) return;
    if (winnerTeam !== slot.home && winnerTeam !== slot.away) return;
    const loser = winnerTeam === slot.home ? slot.away : slot.home;

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
    isRoundComplete,
    isRoundUnlocked,
    picksByMatchId: flatPicks,
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
