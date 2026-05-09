/**
 * MarketOddsCard
 *
 * Compares the user's predicted World Cup champion against bookmaker
 * market favorites. The numbers are hardcoded from publicly-available
 * pre-tournament odds for the top contenders — replace with a live
 * feed (The Odds API or similar) when an API key is provisioned by
 * setting it through a /api/market-odds endpoint.
 *
 * Hidden until we know the user's champion (no submit → no comparison
 * to draw). Same compact frame as the other insight cards so it sits
 * cleanly in the dashboard insights row.
 */

import React, { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { getSimplePrediction } from '../../utils/db';

// Snapshot of consensus pre-tournament market odds aggregated across
// major books, expressed as implied probability. Values are
// illustrative — see comment block above for the real-API path.
const MARKET_FAVORITES = [
  { team: 'Brazil',     flag: '🇧🇷', pct: 0.22 },
  { team: 'France',     flag: '🇫🇷', pct: 0.16 },
  { team: 'Argentina',  flag: '🇦🇷', pct: 0.14 },
  { team: 'Spain',      flag: '🇪🇸', pct: 0.11 },
  { team: 'England',    flag: '🏴',  pct: 0.09 },
  { team: 'Germany',    flag: '🇩🇪', pct: 0.07 },
  { team: 'Portugal',   flag: '🇵🇹', pct: 0.06 },
];

const TOP_N = 3;

export default function MarketOddsCard({ userId, leagueId = 'global-simple' }) {
  const [champion, setChampion] = useState(null);

  useEffect(() => {
    if (!userId || !leagueId) return;
    let cancelled = false;
    getSimplePrediction(userId, leagueId)
      .then((p) => {
        if (cancelled) return;
        const finalSlot = p?.knockoutPredictions?.final?.[0];
        setChampion(finalSlot?.winnerId || null);
      })
      .catch(() => { /* hidden if missing */ });
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  // Hide until the user has a champion to compare. No champion = no
  // comparison; we don't want to render market odds in isolation since
  // the value is the personal contrast.
  if (!champion) return null;

  const top = MARKET_FAVORITES.slice(0, TOP_N);
  const userInTop = top.some((f) => f.team === champion);
  const userMarket = MARKET_FAVORITES.find((f) => f.team === champion);

  return (
    <div className="market-odds-card insight-card" role="status">
      <div className="market-odds-head">
        <span className="market-odds-icon" aria-hidden="true"><Coins size={12} /></span>
        <span className="market-odds-label">Market favorites</span>
      </div>
      <ul className="market-odds-list">
        {top.map((f) => {
          const mine = f.team === champion;
          return (
            <li key={f.team} className={`market-odds-row ${mine ? 'is-mine' : ''}`}>
              <span className="market-odds-flag" aria-hidden="true">{f.flag}</span>
              <span className="market-odds-team">{f.team}</span>
              <span className="market-odds-pct">{Math.round(f.pct * 100)}%</span>
            </li>
          );
        })}
      </ul>
      <div className="market-odds-foot">
        {userInTop ? (
          <span><strong>Your pick aligns</strong> with the market.</span>
        ) : userMarket ? (
          <span>Your pick: <strong>{champion}</strong> ({Math.round(userMarket.pct * 100)}% market)</span>
        ) : (
          <span>Your pick: <strong>{champion}</strong> — long shot in the market</span>
        )}
      </div>
    </div>
  );
}
