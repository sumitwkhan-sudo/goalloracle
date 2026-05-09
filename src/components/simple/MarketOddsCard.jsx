/**
 * MarketOddsCard
 *
 * Compares the user's predicted World Cup champion against current
 * prediction-market favorites. The numbers below are an approximation
 * of Polymarket's "FIFA World Cup 2026 winner" market implied
 * probabilities — share prices on Polymarket trade in cents and read
 * directly as % to win. Replace with a live Polymarket Gamma API
 * feed (e.g. /events/fifa-world-cup-2026-winner) when an API
 * integration lands; the file is the single source of truth.
 *
 * Hidden until we know the user's champion (no submit → no
 * comparison to draw). Same compact frame as the other insight
 * cards so it sits cleanly in the dashboard insights row.
 */

import React, { useEffect, useState } from 'react';
import { Coins } from 'lucide-react';
import { getSimplePrediction } from '../../utils/db';

// Polymarket WC 2026 winner market — approximate implied % from
// recent share prices on Polymarket's "FIFA World Cup 2026 winner"
// market. France and Spain currently lead the market, with
// Argentina and Brazil close behind. Replace with a live Polymarket
// Gamma API call when an integration lands.
const MARKET_FAVORITES = [
  { team: 'France',     flag: '🇫🇷', pct: 0.20 },
  { team: 'Spain',      flag: '🇪🇸', pct: 0.17 },
  { team: 'Argentina',  flag: '🇦🇷', pct: 0.14 },
  { team: 'Brazil',     flag: '🇧🇷', pct: 0.12 },
  { team: 'England',    flag: '🏴',  pct: 0.09 },
  { team: 'Germany',    flag: '🇩🇪', pct: 0.07 },
  { team: 'Portugal',   flag: '🇵🇹', pct: 0.06 },
  { team: 'Netherlands',flag: '🇳🇱', pct: 0.05 },
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
