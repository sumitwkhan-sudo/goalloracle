/**
 * MyPicksCard
 *
 * Logged-in landing-page card that surfaces the user's personal
 * Quick Picks state at a glance: their global rank, their predicted
 * Champion + Runner-up, and a CTA when the bracket isn't yet
 * complete. Designed to sit above the HeroLeaderboardPreview in the
 * hero right-column so the home page reads as "Your status →
 * Global context" instead of generic marketing.
 *
 * Three render states are handled inline:
 *   - "ready"      → bracket complete: rank row + finals podium
 *   - "in-progress"→ some picks made: completion CTA + how-many-left
 *   - "empty"      → no picks at all: "make your first picks" CTA
 * `null` quickPicks renders a skeleton so the card doesn't pop in
 * abruptly when the parent fetch resolves.
 */

import React from 'react';
import { Trophy, Award, ChevronRight, Target } from 'lucide-react';
import { teamFlags } from '../utils/flags';

// Tournament kickoff — same constant the BracketSurvivalCard uses
// for the "Starts in Nd" pre-tournament label. Kept inline rather
// than imported so the card has no cross-component dep.
const KICKOFF_MS = Date.UTC(2026, 5, 11, 19, 0, 0);

function daysUntilKickoff() {
  const diff = KICKOFF_MS - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function MyPicksCard({
  quickPicks,         // null = loading; { isComplete, totalRemaining, winner, runnerUp }
  rank,               // { rank, total } | undefined
  isPreTournament,    // bool — disables rank rendering
  onComplete,         // jump to predictions tab
  onViewLeaderboard,  // jump to leaderboard
}) {
  // ── Loading skeleton ───────────────────────────────────────
  if (quickPicks === null) {
    return (
      <div className="my-picks-card my-picks-card-loading" aria-hidden="true">
        <div className="my-picks-head"><span className="mp-skel mp-skel-label" /></div>
        <div className="mp-skel mp-skel-line" />
        <div className="mp-skel mp-skel-line" />
      </div>
    );
  }

  const finalsKnown = !!quickPicks.winner && !!quickPicks.runnerUp;
  const stateClass = quickPicks.isComplete
    ? 'my-picks-card-ready'
    : finalsKnown
      ? 'my-picks-card-progress'
      : 'my-picks-card-empty';

  // ── Rank row helper ────────────────────────────────────────
  const renderRank = () => {
    if (isPreTournament) {
      const days = daysUntilKickoff();
      return (
        <span className="my-picks-rank">
          <strong>Tournament starts in {days}d</strong>
          <span className="my-picks-rank-sub">Rank locks in once matches go live</span>
        </span>
      );
    }
    if (!rank?.rank) {
      return <span className="my-picks-rank"><strong>Unranked</strong></span>;
    }
    return (
      <span className="my-picks-rank">
        <strong>#{rank.rank.toLocaleString()}</strong>
        {typeof rank.total === 'number' && rank.total > 0 && (
          <span className="my-picks-rank-sub">of {rank.total.toLocaleString()}</span>
        )}
      </span>
    );
  };

  return (
    <div className={`my-picks-card ${stateClass}`} role="region" aria-label="Your bracket">
      <div className="my-picks-head">
        <span className="my-picks-label">Your bracket</span>
        {rank?.rank != null && !isPreTournament && (
          <button
            type="button"
            className="my-picks-leaderboard"
            onClick={onViewLeaderboard}
            aria-label="View global leaderboard"
          >
            Leaderboard <ChevronRight size={11} aria-hidden="true" />
          </button>
        )}
      </div>

      <div className="my-picks-rank-row">
        {renderRank()}
      </div>

      {finalsKnown ? (
        <div className="my-picks-podium">
          <div className="my-picks-podium-row">
            <span className="my-picks-podium-icon"><Trophy size={13} aria-hidden="true" /></span>
            <span className="my-picks-podium-label">Champion</span>
            <span className="my-picks-podium-team">
              <span className="my-picks-podium-flag">{teamFlags[quickPicks.winner] || '🏳️'}</span>
              <span>{quickPicks.winner}</span>
            </span>
          </div>
          <div className="my-picks-podium-row">
            <span className="my-picks-podium-icon"><Award size={13} aria-hidden="true" /></span>
            <span className="my-picks-podium-label">Runner-up</span>
            <span className="my-picks-podium-team">
              <span className="my-picks-podium-flag">{teamFlags[quickPicks.runnerUp] || '🏳️'}</span>
              <span>{quickPicks.runnerUp}</span>
            </span>
          </div>
          {!quickPicks.isComplete && (
            <button type="button" className="my-picks-cta my-picks-cta-warn" onClick={onComplete}>
              <Target size={12} aria-hidden="true" />
              Complete your bracket — {quickPicks.totalRemaining} left
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="my-picks-cta" onClick={onComplete}>
          <Target size={13} aria-hidden="true" />
          {quickPicks.totalRemaining === 52
            ? 'Make your first picks to lock in a prediction'
            : `Complete your bracket — ${quickPicks.totalRemaining} left`}
          <ChevronRight size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
