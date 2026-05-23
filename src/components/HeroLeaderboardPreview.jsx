/**
 * HeroLeaderboardPreview
 *
 * Compact leaderboard ticker for the marketing hero, sitting alongside
 * the Next Match card. Pulls the full Quick Picks global leaderboard,
 * filters to entries that already have both a Champion and Runner-up
 * picked, and renders them as an auto-scrolling vertical ticker.
 *
 * Each row shows: rank, country flag, displayName, points, and on a
 * second line the user's predicted champion + runner-up (with team
 * flags). The list is duplicated below itself so the
 * translateY(-50%) animation loops seamlessly.
 */

import React, { useEffect, useState } from 'react';
import { Trophy, ChevronRight } from 'lucide-react';
import { getSimpleLeaderboard } from '../utils/db';
import { getTeamFlags } from '../utils/bracketUtils';

const COUNTRY_FLAG_FALLBACK = '🌐';
const TEAM_FLAG_FALLBACK = '🏳️';

function flagFromCountry(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return COUNTRY_FLAG_FALLBACK;
  const A = 0x1f1e6;
  const c = code.toUpperCase();
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65)) + String.fromCodePoint(A + (c.charCodeAt(1) - 65));
}

export default function HeroLeaderboardPreview({ onViewFull }) {
  const [entries, setEntries] = useState(null); // null = loading, [] = empty
  const [teamFlags, setTeamFlags] = useState({});
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getSimpleLeaderboard('global-simple');
        if (cancelled) return;
        const all = data?.leaderboard || [];
        // Only entries where the user has picked both a Champion and a
        // Runner-up — keeps the ticker honest (no blank predictions).
        const filtered = all.filter((e) => e.winner && e.runnerUp);
        setEntries(filtered);
        try {
          const flags = getTeamFlags();
          if (!cancelled) setTeamFlags(flags || {});
        } catch {
          /* fall back to TEAM_FLAG_FALLBACK in each row */
        }
      } catch {
        if (!cancelled) { setErr(true); setEntries([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="hero-lb-card">
      <div className="hero-lb-header">
        <span className="hero-lb-label">
          <Trophy size={12} aria-hidden="true" /> Global League
        </span>
        <button type="button" className="hero-lb-view" onClick={onViewFull}>
          View full <ChevronRight size={12} aria-hidden="true" />
        </button>
      </div>

      {entries === null ? (
        <div className="hero-lb-loading" aria-hidden="true">
          {[0, 1, 2, 3, 4].map((i) => <div key={i} className="hero-lb-skel" />)}
        </div>
      ) : entries.length === 0 || err ? (
        <div className="hero-lb-empty">
          <p>Be first to lock in a bracket.</p>
          <span>Predictions show up here once players pick a Champion and Runner-up.</span>
        </div>
      ) : (
        <Ticker entries={entries} teamFlags={teamFlags} />
      )}
    </div>
  );
}

function Ticker({ entries, teamFlags }) {
  // Duplicate the list so translateY(-50%) wraps seamlessly. Same data
  // referenced twice — React keys disambiguate with an "a-"/"b-" prefix.
  return (
    <div className="hero-lb-scroll-mask">
      <div className="hero-lb-scroller">
        {entries.map((e, i) => (
          <Row key={`a-${e.userId || i}`} entry={e} rank={i + 1} teamFlags={teamFlags} />
        ))}
        {entries.map((e, i) => (
          <Row key={`b-${e.userId || i}`} entry={e} rank={i + 1} teamFlags={teamFlags} aria-hidden="true" />
        ))}
      </div>
    </div>
  );
}

function Row({ entry, rank, teamFlags }) {
  const winnerFlag = teamFlags[entry.winner] || TEAM_FLAG_FALLBACK;
  const runnerFlag = teamFlags[entry.runnerUp] || TEAM_FLAG_FALLBACK;
  const points = entry.points || 0;
  const ptsClass = points === 0 ? 'hero-lb-pts hero-lb-pts-pending' : 'hero-lb-pts';
  const ptsLabel = points === 0 ? '— pts' : `${points} pts`;

  return (
    <div className="hero-lb-row hero-lb-row-2line">
      <span className="hero-lb-rank">#{rank}</span>
      <div className="hero-lb-main">
        <div className="hero-lb-top">
          <span className="hero-lb-flag">{flagFromCountry(entry.country)}</span>
          <span className="hero-lb-name">{entry.displayName}</span>
          <span className="hero-lb-pts-spacer" />
          <span className={ptsClass}>{ptsLabel}</span>
        </div>
        <div className="hero-lb-picks">
          <span className="hero-lb-pick">
            <span className="hero-lb-pick-tag" aria-hidden="true">🏆</span>
            <span className="hero-lb-pick-flag">{winnerFlag}</span>
            <span className="hero-lb-pick-name">{entry.winner}</span>
          </span>
          <span className="hero-lb-pick-sep" aria-hidden="true">·</span>
          <span className="hero-lb-pick">
            <span className="hero-lb-pick-tag" aria-hidden="true">🥈</span>
            <span className="hero-lb-pick-flag">{runnerFlag}</span>
            <span className="hero-lb-pick-name">{entry.runnerUp}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
