/**
 * useKnockoutHitCount
 *
 * Given the user's Quick Picks summary (with groupPredictions + bestThirdPicks),
 * returns how many of the teams they predicted to reach the knockouts actually
 * advanced into the real Round of 32 — i.e. |predictedR32TeamSet ∩ realR32|.
 * Mirrors the wizard's reseed "earned" semantics so the number on the home
 * card matches which teams are advanceable in the bracket.
 *
 * Returns { hit, total } once the real bracket has resolved teams, else null
 * (so callers render nothing pre-results / while loading).
 */

import { useEffect, useState } from 'react';
import { fetchActualBracket } from '../utils/db';
import { predictedR32TeamSet } from '../utils/bracketUtils';

export default function useKnockoutHitCount(quickPicks) {
  const [realR32, setRealR32] = useState(null);
  useEffect(() => {
    let cancelled = false;
    fetchActualBracket()
      .then((d) => { if (!cancelled) setRealR32(d?.r32 || null); })
      .catch(() => { if (!cancelled) setRealR32(null); });
    return () => { cancelled = true; };
  }, []);

  if (!realR32 || !quickPicks?.groupPredictions) return null;

  const realTeams = new Set();
  for (const s of Object.values(realR32)) {
    if (s?.homeReal && s.home) realTeams.add(s.home);
    if (s?.awayReal && s.away) realTeams.add(s.away);
  }
  if (realTeams.size === 0) return null;

  const predicted = predictedR32TeamSet(quickPicks.groupPredictions, quickPicks.bestThirdPicks || []);
  let hit = 0;
  for (const t of realTeams) if (predicted.has(t)) hit += 1;
  return { hit, total: realTeams.size };
}
