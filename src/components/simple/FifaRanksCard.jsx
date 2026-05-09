/**
 * FifaRanksCard
 *
 * Compares the user's predicted World Cup champion to the top of the
 * FIFA Men's World Ranking (stored internally — see
 * src/data/fifaRankings.js). Three rows of top FIFA-ranked teams,
 * with the user's pick highlighted if it appears, and a footer line
 * indicating where their pick sits in the ranking otherwise.
 *
 * Self-sufficient: no crowd-consensus dependency, so the card always
 * has data to render once the user has picked a champion.
 */

import React, { useEffect, useState } from 'react';
import { Award } from 'lucide-react';
import { getSimplePrediction } from '../../utils/db';
import { getRank, getTopRanked, FIFA_RANK } from '../../data/fifaRankings';

const FLAGS = (() => {
  // Build once from the matches fixture so we don't duplicate flag
  // strings here. Fall back to the 🏳️ glyph for any unmapped team.
  // Lazy-loaded so static evaluation order in the bundler doesn't
  // care which file lands first.
  return {
    'Argentina': '🇦🇷', 'France': '🇫🇷', 'Spain': '🇪🇸', 'England': '🏴',
    'Brazil': '🇧🇷', 'Portugal': '🇵🇹', 'Netherlands': '🇳🇱', 'Belgium': '🇧🇪',
    'Croatia': '🇭🇷', 'Germany': '🇩🇪',
  };
})();

const TOP_N = 3;
const TOP = getTopRanked(TOP_N);

export default function FifaRanksCard({ userId, leagueId = 'global-simple' }) {
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
      .catch(() => { /* fall through; the card still renders the top list */ });
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  const champRank = getRank(champion);
  const championInTop = champion && TOP.some((t) => t.team === champion);

  return (
    <div className="fifa-ranks-card insight-card" role="status">
      <div className="fifa-ranks-head">
        <span className="fifa-ranks-icon" aria-hidden="true"><Award size={11} /></span>
        <span className="fifa-ranks-label">FIFA top ranked</span>
      </div>
      <ul className="fifa-ranks-list">
        {TOP.map((t) => {
          const mine = t.team === champion;
          return (
            <li key={t.team} className={`fifa-ranks-row ${mine ? 'is-mine' : ''}`}>
              <span className="fifa-ranks-pos">#{t.rank}</span>
              <span className="fifa-ranks-flag" aria-hidden="true">{FLAGS[t.team] || '🏳️'}</span>
              <span className="fifa-ranks-team">{t.team}</span>
            </li>
          );
        })}
      </ul>
      <div className="fifa-ranks-foot">
        {!champion ? (
          <span>Pick a champion to compare.</span>
        ) : championInTop ? (
          <span><strong>Your pick</strong> is a FIFA top-{TOP_N} side.</span>
        ) : champRank ? (
          <span>Your pick: <strong>{champion}</strong> (FIFA #{champRank})</span>
        ) : (
          <span>Your pick: <strong>{champion}</strong> — outside the FIFA top {Object.keys(FIFA_RANK).length}</span>
        )}
      </div>
    </div>
  );
}
