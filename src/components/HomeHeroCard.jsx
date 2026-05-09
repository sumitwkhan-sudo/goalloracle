/**
 * HomeHeroCard
 *
 * Single hero card on the logged-in landing page. Combines what
 * used to be three competing focal points:
 *   - the yellow countdown banner
 *   - the "Welcome back" greeting
 *   - the "Your bracket" status card
 *
 * Layout, top → bottom:
 *   [⏱ World Cup kicks off in 33d 15h 28m]    ← caption strip
 *   Welcome back, {name}                       ← display heading
 *   🏆 Champion · 🥈 Runner-up                  ← inline picks
 *   Your rank: #1,247 of 12,500                ← rank line
 *   [Insights row: leagues · biggest upset · crowd alignment]
 *   [View my bracket]  [Edit picks]            ← primary + secondary CTA
 *
 * One card, two clear actions: View (default) and Edit (secondary).
 * Insights row only appears when the user has a complete bracket.
 */

import React, { useEffect, useState } from 'react';
import { Clock, Trophy, Award, Target, Eye } from 'lucide-react';
import { teamFlags } from '../utils/flags';
import BracketInsightsRow from './BracketInsightsRow';

const KICKOFF_MS = Date.UTC(2026, 5, 11, 19, 0, 0);

function computeCountdown() {
  const diff = KICKOFF_MS - Date.now();
  if (diff <= 0) return null;
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  return { days, hours, minutes };
}

function useCountdown() {
  const [t, setT] = useState(computeCountdown);
  useEffect(() => {
    const id = setInterval(() => setT(computeCountdown()), 30000);
    return () => clearInterval(id);
  }, []);
  return t;
}

export default function HomeHeroCard({
  displayName,    // string — user's display name
  quickPicks,     // null = loading | { isComplete, totalRemaining, winner, runnerUp, knockoutPredictions }
  rank,           // { rank, total } | undefined
  leagueCount,    // number — leagues the user is in
  consensus,      // null | { champion: {Team: pct}, runnerUp: {Team: pct}, ... }
  onView,         // () => void — open read-only viewer (primary CTA)
  onEdit,         // () => void — open the wizard (secondary CTA)
  onShare,        // () => void — share the bracket / insights
}) {
  const countdown = useCountdown();
  const isPreTournament = !!countdown;

  const winner = quickPicks?.winner;
  const runnerUp = quickPicks?.runnerUp;
  const finalsKnown = !!winner && !!runnerUp;

  // Adapt the pair of CTAs to bracket completeness:
  //  - In progress → "Continue picks" primary, no view (nothing to view yet)
  //  - Complete    → "View my bracket" primary, "Edit picks" secondary
  const inProgress = quickPicks && !quickPicks.isComplete;
  const continueLabel = quickPicks?.totalRemaining === 52
    ? 'Make my first picks'
    : `Continue — ${quickPicks?.totalRemaining || 0} left`;

  return (
    <div className="home-card home-hero" role="region" aria-label="Your bracket">
      {countdown && (
        <div className="home-hero-meta">
          <span className="home-hero-meta-dot" aria-hidden="true" />
          <Clock size={12} aria-hidden="true" />
          <span>
            World Cup kicks off in <strong>{countdown.days}d</strong> <strong>{countdown.hours}h</strong> <strong>{countdown.minutes}m</strong>
          </span>
        </div>
      )}

      <h1 className="home-hero-greeting">
        Welcome back{displayName ? <>, <span className="home-hero-greeting-name">{displayName}</span></> : null}
      </h1>

      <div className="home-hero-picks">
        <span className="home-hero-pick">
          <Trophy size={14} aria-hidden="true" />
          <span className="home-hero-pick-label">Champion</span>
          {finalsKnown ? (
            <>
              <span className="home-hero-pick-flag">{teamFlags[winner] || '🏳️'}</span>
              <span className="home-hero-pick-team">{winner}</span>
            </>
          ) : (
            <span className="home-hero-pick-empty">— not picked yet</span>
          )}
        </span>
        <span className="home-hero-pick">
          <Award size={14} aria-hidden="true" />
          <span className="home-hero-pick-label">Runner-up</span>
          {finalsKnown ? (
            <>
              <span className="home-hero-pick-flag">{teamFlags[runnerUp] || '🏳️'}</span>
              <span className="home-hero-pick-team">{runnerUp}</span>
            </>
          ) : (
            <span className="home-hero-pick-empty">—</span>
          )}
        </span>
      </div>

      <div className="home-hero-rank">
        {isPreTournament ? (
          <>
            <strong>Unranked</strong>
            <span>— rank locks in once matches go live</span>
          </>
        ) : rank?.rank ? (
          <>
            <strong>#{rank.rank.toLocaleString()}</strong>
            {typeof rank.total === 'number' && rank.total > 0 && (
              <span>of {rank.total.toLocaleString()}</span>
            )}
          </>
        ) : (
          <strong>Unranked</strong>
        )}
      </div>

      <BracketInsightsRow
        quickPicks={quickPicks}
        consensus={consensus}
        leagueCount={leagueCount}
        onShare={onShare}
        variant="home"
      />

      <div className="home-hero-cta-row">
        {inProgress || !onView ? (
          <button type="button" className="home-hero-primary" onClick={onEdit}>
            <Target size={16} aria-hidden="true" />
            {continueLabel}
          </button>
        ) : (
          <>
            <button type="button" className="home-hero-primary" onClick={onView}>
              <Eye size={16} aria-hidden="true" />
              View my bracket
            </button>
            <button type="button" className="home-hero-secondary" onClick={onEdit}>
              <Target size={14} aria-hidden="true" />
              Edit picks
            </button>
          </>
        )}
      </div>
    </div>
  );
}
