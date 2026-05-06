/**
 * HeroLeaderboardPreview
 *
 * Compact top-5 leaderboard card for the marketing hero, sitting
 * alongside the Next Match card. Pulls from the global Quick Picks
 * leaderboard. Pre-tournament when nobody has scored, falls back to
 * an empty-state CTA so the card never reads as "broken."
 */

import React, { useEffect, useState } from 'react';
import { Trophy, ChevronRight } from 'lucide-react';
import { getSimpleLeaderboard } from '../utils/db';

const COUNTRY_FLAG_FALLBACK = '🌐';

function flagFromCountry(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return COUNTRY_FLAG_FALLBACK;
  const A = 0x1f1e6;
  const c = code.toUpperCase();
  return String.fromCodePoint(A + (c.charCodeAt(0) - 65)) + String.fromCodePoint(A + (c.charCodeAt(1) - 65));
}

export default function HeroLeaderboardPreview({ onViewFull }) {
  const [entries, setEntries] = useState(null); // null = loading, [] = empty
  const [err, setErr] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await getSimpleLeaderboard('global-simple');
        if (cancelled) return;
        const top = (data?.leaderboard || []).slice(0, 5);
        setEntries(top);
      } catch {
        if (!cancelled) { setErr(true); setEntries([]); }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const allZero = entries && entries.length > 0 && entries.every((e) => (e.points || 0) === 0);

  return (
    <div className="hero-lb-card">
      <div className="hero-lb-header">
        <span className="hero-lb-label">
          <Trophy size={12} aria-hidden="true" /> Global Quick Picks
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
          <p>Be first on the leaderboard.</p>
          <span>Lock in your bracket — points appear once matches start.</span>
        </div>
      ) : allZero ? (
        <div className="hero-lb-list">
          {entries.map((e, i) => (
            <div key={e.userId || i} className="hero-lb-row">
              <span className="hero-lb-rank">#{i + 1}</span>
              <span className="hero-lb-flag">{flagFromCountry(e.country)}</span>
              <span className="hero-lb-name">{e.displayName}</span>
              <span className="hero-lb-pts hero-lb-pts-pending">— pts</span>
            </div>
          ))}
          <p className="hero-lb-pretourney">Tournament hasn't started — points appear once matches go live.</p>
        </div>
      ) : (
        <div className="hero-lb-list">
          {entries.map((e, i) => (
            <div key={e.userId || i} className="hero-lb-row">
              <span className="hero-lb-rank">#{i + 1}</span>
              <span className="hero-lb-flag">{flagFromCountry(e.country)}</span>
              <span className="hero-lb-name">{e.displayName}</span>
              <span className="hero-lb-pts">{e.points || 0} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
