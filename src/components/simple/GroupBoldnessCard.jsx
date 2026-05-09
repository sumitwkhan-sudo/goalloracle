/**
 * GroupBoldnessCard
 *
 * Group-stage insight: how often the user picked an underdog to top
 * their group instead of the highest-FIFA-ranked team in that group.
 *
 * For each of the 12 groups we read the user's #1 pick, find the
 * highest-FIFA-ranked team in the same group, and count a "boldness
 * point" if those don't match. The card surfaces:
 *   - The total upset count (X / 12)
 *   - The single biggest upset — lowest-ranked team the user has
 *     winning a group, with its FIFA rank
 *
 * Doesn't depend on crowd consensus, so it renders even with a tiny
 * league. Hidden only when the user hasn't ranked any groups yet.
 */

import React, { useEffect, useState } from 'react';
import { Flag } from 'lucide-react';
import { getSimplePrediction } from '../../utils/db';
import { getRank } from '../../data/fifaRankings';

export default function GroupBoldnessCard({ userId, leagueId }) {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!userId || !leagueId) return;
    let cancelled = false;
    getSimplePrediction(userId, leagueId)
      .then((pred) => {
        if (cancelled || !pred) return;
        const groups = pred.groupPredictions || {};
        let upsetCount = 0;
        let groupCount = 0;
        let biggest = null; // { team, rank, group }

        for (const [groupKey, gData] of Object.entries(groups)) {
          const ranking = Array.isArray(gData?.ranking) ? gData.ranking : [];
          if (ranking.length !== 4 || !ranking.every(Boolean)) continue;
          groupCount++;

          const userTop = ranking[0];
          const userTopRank = getRank(userTop) ?? 999;

          // FIFA's "favorite" in this group = lowest rank number
          // among the four teams the user ranked.
          let favRank = Infinity;
          let favTeam = null;
          for (const t of ranking) {
            const r = getRank(t);
            if (r != null && r < favRank) { favRank = r; favTeam = t; }
          }

          // Upset = user picked someone other than the FIFA favorite.
          if (favTeam && userTop !== favTeam) {
            upsetCount++;
            if (!biggest || userTopRank > biggest.rank) {
              biggest = { team: userTop, rank: userTopRank, group: groupKey };
            }
          }
        }

        if (groupCount === 0) return;
        setStats({ upsetCount, groupCount, biggest });
      })
      .catch(() => { /* hidden if missing */ });
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  if (!stats) return null;

  const tone = stats.upsetCount === 0
    ? 'safe'
    : stats.upsetCount <= 3 ? 'measured' : 'wild';
  const verdict = tone === 'safe'
    ? 'Chalk picks'
    : tone === 'wild' ? 'Group-stage anarchist' : 'A few brave calls';

  return (
    <div className={`group-boldness-card insight-card group-boldness-${tone}`} role="status">
      <div className="group-boldness-head">
        <span className="group-boldness-icon" aria-hidden="true"><Flag size={11} /></span>
        <span className="group-boldness-label">Group upsets</span>
      </div>
      <div className="group-boldness-body">
        <span className="group-boldness-pct">
          <strong>{stats.upsetCount}</strong> of {stats.groupCount} groups won by an underdog
        </span>
        {stats.biggest ? (
          <span className="group-boldness-meta">
            Biggest: <strong>{stats.biggest.team}</strong> (FIFA #{stats.biggest.rank})
          </span>
        ) : (
          <span className="group-boldness-meta">{verdict}</span>
        )}
      </div>
    </div>
  );
}
