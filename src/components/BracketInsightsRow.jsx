/**
 * BracketInsightsRow
 *
 * Shared inline insights strip — used by HomeHeroCard and the
 * Dashboard. Surfaces three quick stats:
 *   - Leagues the user is in
 *   - Biggest upset called (lowest-ranked team picked to advance furthest)
 *   - Crowd alignment (% of players who agree with the user's champion)
 *
 * Plus a small Share button that opens whatever share flow the host
 * passes via `onShare` (typically the BracketShareModal). Hidden
 * altogether when the user hasn't picked a champion yet — there's
 * nothing meaningful to summarise pre-bracket.
 */

import React, { useMemo } from 'react';
import { Layers, Flame, Users, Share2 } from 'lucide-react';
import { teamFlags } from '../utils/flags';
import { biggestUpset, ROUND_LABELS as ROUND_LABEL } from '../utils/bracketInsights';

export default function BracketInsightsRow({
  quickPicks,        // { winner, runnerUp, knockoutPredictions } | null
  consensus,         // { champion: {Team: pct}, ... } | null
  leagueCount,       // number
  onShare,           // () => void — opens share flow
  variant = 'home',  // 'home' | 'dashboard' — minor styling hook
}) {
  const winner = quickPicks?.winner;
  const runnerUp = quickPicks?.runnerUp;
  const finalsKnown = !!winner && !!runnerUp;

  const insights = useMemo(() => {
    if (!finalsKnown) return null;
    const upset = biggestUpset(quickPicks?.knockoutPredictions);
    let crowdAlignment = null;
    if (consensus?.champion?.[winner] != null) {
      crowdAlignment = Math.round(consensus.champion[winner] * 100);
    }
    return {
      leagues: typeof leagueCount === 'number' ? leagueCount : null,
      upset,
      crowdAlignment,
    };
  }, [finalsKnown, quickPicks?.knockoutPredictions, consensus, winner, leagueCount]);

  if (!insights || (insights.leagues == null && !insights.upset && insights.crowdAlignment == null)) {
    return null;
  }

  return (
    <div className={`bracket-insights bracket-insights-${variant}`} role="group" aria-label="Bracket insights">
      {insights.leagues != null && (
        <div className="bracket-insight">
          <span className="bracket-insight-icon"><Layers size={13} aria-hidden="true" /></span>
          <span className="bracket-insight-label">Leagues</span>
          <span className="bracket-insight-value">{insights.leagues}</span>
        </div>
      )}
      {insights.upset && (
        <div
          className="bracket-insight"
          title={`Picked ${insights.upset.team} (FIFA #${insights.upset.rank}) to reach ${ROUND_LABEL[insights.upset.round]}`}
        >
          <span className="bracket-insight-icon"><Flame size={13} aria-hidden="true" /></span>
          <span className="bracket-insight-label">Biggest upset</span>
          <span className="bracket-insight-value bracket-insight-value-team">
            {teamFlags[insights.upset.team] || '🏳️'} {insights.upset.team}
            <span className="bracket-insight-sub">→ {ROUND_LABEL[insights.upset.round]}</span>
          </span>
        </div>
      )}
      {insights.crowdAlignment != null && (
        <div
          className="bracket-insight"
          title={`${insights.crowdAlignment}% of players agree your champion (${winner}) will win`}
        >
          <span className="bracket-insight-icon"><Users size={13} aria-hidden="true" /></span>
          <span className="bracket-insight-label">Crowd alignment</span>
          <span className="bracket-insight-value">{insights.crowdAlignment}%</span>
        </div>
      )}
      {onShare && (
        <button
          type="button"
          className="bracket-insight-share"
          onClick={onShare}
          aria-label="Share my bracket and insights"
          data-tooltip="Share my bracket"
        >
          <Share2 size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
