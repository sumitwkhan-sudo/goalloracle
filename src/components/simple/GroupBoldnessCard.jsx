/**
 * GroupBoldnessCard
 *
 * Group-stage insight: shows the user's top three biggest upsets
 * from their group rankings relative to FIFA seeding. For each of
 * the 12 groups we read the user's #1 pick, find the highest-FIFA-
 * ranked team in the same group (the "favorite"), and rank by
 * largest delta — i.e. the lowest-ranked team they picked to top
 * a group is the boldest call.
 *
 * Doesn't depend on crowd consensus, so it renders even with a
 * tiny league. Hidden only when the user hasn't ranked any groups
 * yet OR when every #1 pick matches the FIFA favorite (chalk
 * picks all the way down).
 */

import React, { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { getSimplePrediction } from '../../utils/db';
import { getRank } from '../../data/fifaRankings';
import { teamFlags } from '../../utils/flags';

const TOP_N = 3;

export default function GroupBoldnessCard({ userId, leagueId }) {
  const [upsets, setUpsets] = useState(null); // null = loading; [] = no upsets

  useEffect(() => {
    if (!userId || !leagueId) return;
    let cancelled = false;
    getSimplePrediction(userId, leagueId)
      .then((pred) => {
        if (cancelled || !pred) return;
        const groups = pred.groupPredictions || {};
        const candidates = [];
        let groupCount = 0;

        for (const [groupKey, gData] of Object.entries(groups)) {
          const ranking = Array.isArray(gData?.ranking) ? gData.ranking : [];
          if (ranking.length !== 4 || !ranking.every(Boolean)) continue;
          groupCount++;

          const userTop = ranking[0];
          const userTopRank = getRank(userTop) ?? 999;

          // FIFA favorite = lowest rank number among the four ranked teams
          let favRank = Infinity;
          let favTeam = null;
          for (const t of ranking) {
            const r = getRank(t);
            if (r != null && r < favRank) { favRank = r; favTeam = t; }
          }

          if (favTeam && userTop !== favTeam) {
            candidates.push({
              team: userTop,
              rank: userTopRank,
              group: groupKey.replace(/^[Gg]roup\s*/, ''),
            });
          }
        }

        if (groupCount === 0) return;
        // Bigger rank number = lower FIFA ranking = bigger upset.
        candidates.sort((a, b) => b.rank - a.rank);
        setUpsets(candidates.slice(0, TOP_N));
      })
      .catch(() => { /* hidden if missing */ });
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  if (!upsets || upsets.length === 0) return null;

  return (
    <div className="group-boldness-card insight-card" role="status">
      <div className="group-boldness-head">
        <span className="group-boldness-icon" aria-hidden="true"><Flag size={11} /></span>
        <span className="group-boldness-label">Group upsets</span>
      </div>
      <ul className="group-boldness-list">
        {upsets.map((u) => (
          <li key={`${u.group}-${u.team}`} className="group-boldness-row">
            <span className="group-boldness-flag" aria-hidden="true">{teamFlags[u.team] || '🏳️'}</span>
            <span className="group-boldness-team">{u.team}</span>
            <span className="group-boldness-group">Grp {u.group}</span>
            <span className="group-boldness-rank">#{u.rank}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
