/**
 * useGroupPredictions
 *
 * Local state for the 12 group rankings + tracks which groups have been
 * "touched" (arranged intentionally). Hydrates from a Firestore snapshot
 * once on first load, and pushes changes to a save callback.
 */

import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { GROUPS, getTeamFlags } from '../utils/bracketUtils';
import WORLD_CUP_MATCHES from '../data/matches';

// Default ranking per group = alphabetical order of team names.
// Any user drag that changes this order flips touched[group] = true.
function computeDefaultRankings() {
  const byGroup = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) continue;
    const letter = m.stage.replace('Group ', '');
    if (!byGroup[letter]) byGroup[letter] = new Set();
    byGroup[letter].add(m.home);
    byGroup[letter].add(m.away);
  }
  const out = {};
  for (const g of GROUPS) {
    const teams = [...(byGroup[g] || [])].sort();
    out[g] = { ranking: teams };
  }
  return out;
}

function rankingsEqual(a, b) {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  return a.every((t, i) => t === b[i]);
}

export default function useGroupPredictions(initialData) {
  const defaults = useMemo(computeDefaultRankings, []);
  const [predictions, setPredictions] = useState(() => deepClone(defaults));
  const [touched, setTouched] = useState({});
  const hydratedRef = useRef(false);

  // Hydrate once from Firestore
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!initialData) return;
    const merged = deepClone(defaults);
    const nextTouched = {};
    for (const g of GROUPS) {
      const remote = initialData[g]?.ranking;
      if (Array.isArray(remote) && remote.length === 4 && remote.every(Boolean)) {
        merged[g] = { ranking: [...remote] };
        if (!rankingsEqual(remote, defaults[g].ranking)) nextTouched[g] = true;
      }
    }
    setPredictions(merged);
    setTouched(nextTouched);
    hydratedRef.current = true;
  }, [initialData, defaults]);

  const reorder = useCallback((group, fromIndex, toIndex) => {
    setPredictions((prev) => {
      const ranking = [...(prev[group]?.ranking || [])];
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= ranking.length || toIndex >= ranking.length) return prev;
      const [moved] = ranking.splice(fromIndex, 1);
      ranking.splice(toIndex, 0, moved);
      const next = { ...prev, [group]: { ranking } };
      const wasUntouched = rankingsEqual(ranking, defaults[group].ranking);
      setTouched((t) => (wasUntouched ? t : { ...t, [group]: true }));
      return next;
    });
  }, [defaults]);

  const setRanking = useCallback((group, newRanking) => {
    setPredictions((prev) => {
      const next = { ...prev, [group]: { ranking: [...newRanking] } };
      if (!rankingsEqual(newRanking, defaults[group].ranking)) {
        setTouched((t) => ({ ...t, [group]: true }));
      }
      return next;
    });
  }, [defaults]);

  const touchedCount = Object.values(touched).filter(Boolean).length;
  const allTouched = touchedCount === GROUPS.length;

  const flags = useMemo(getTeamFlags, []);

  return {
    predictions,     // { A: { ranking: [...] }, ... }
    touched,         // { A: true, B: true, ... }
    touchedCount,
    allTouched,
    reorder,
    setRanking,
    flags,
  };
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
