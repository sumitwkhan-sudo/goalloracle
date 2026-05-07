/**
 * MostContestedCard
 *
 * Dashboard card surfacing the bracket match where the global crowd
 * is most evenly split — the "tightest" call across the tournament.
 * Defined as the (round, matchId) pair where the top-picked team has
 * the lowest agreement %, with the second-place team rendered as the
 * runner-up. Rotates as more users submit so it stays fresh through
 * the prediction window.
 *
 * Hidden when not enough users have submitted to make the split
 * meaningful, or when the consensus payload doesn't have any
 * knockout data yet (very early in the league lifecycle).
 */

import React, { useEffect, useState } from 'react';
import { Flame } from 'lucide-react';
import { getSimpleConsensus } from '../../utils/db';

const ROUND_LABEL = {
  roundOf32: 'R32',
  roundOf16: 'R16',
  quarterFinals: 'QF',
  semiFinals: 'SF',
  thirdPlace: '3rd Place',
  final: 'Final',
};

// Same threshold as the Boldest-call card — fewer than 10 submissions
// makes "consensus" a coin flip.
const MIN_USER_THRESHOLD = 10;

export default function MostContestedCard({ leagueId = 'global-simple' }) {
  const [contested, setContested] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const c = await getSimpleConsensus(leagueId);
        if (cancelled) return;
        if (!c || (c.totalUsers || 0) < MIN_USER_THRESHOLD) return;

        let best = null; // { round, matchId, top, second }
        for (const round of Object.keys(c.knockout || {})) {
          for (const matchId of Object.keys(c.knockout[round] || {})) {
            const teams = c.knockout[round][matchId];
            const sorted = Object.entries(teams).sort(([, a], [, b]) => b - a);
            if (sorted.length < 2) continue;
            const [topTeam, topPct] = sorted[0];
            const [secondTeam, secondPct] = sorted[1];
            // Skip noise: a match where one team has <30% and another
            // has <30% is just a flat distribution, not a "contested
            // pair" — require the top two to capture at least 60%
            // combined so the headline reads as a real split.
            if (topPct + secondPct < 0.6) continue;
            if (!best || topPct < best.top.pct) {
              best = {
                round,
                matchId,
                top: { team: topTeam, pct: topPct },
                second: { team: secondTeam, pct: secondPct },
              };
            }
          }
        }
        if (best) setContested(best);
      } catch {
        // non-fatal — widget just won't render
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId]);

  if (!contested) return null;

  const topPct = Math.round(contested.top.pct * 100);
  const secondPct = Math.round(contested.second.pct * 100);
  const roundLabel = ROUND_LABEL[contested.round] || contested.round;

  return (
    <div className="contested-card" role="status">
      <span className="contested-card-icon" aria-hidden="true"><Flame size={14} /></span>
      <div className="contested-card-text">
        <span className="contested-card-label">Most contested {roundLabel} pick</span>
        <span className="contested-card-body">
          <strong>{contested.top.team}</strong> ({topPct}%) vs{' '}
          <strong>{contested.second.team}</strong> ({secondPct}%)
        </span>
      </div>
    </div>
  );
}
