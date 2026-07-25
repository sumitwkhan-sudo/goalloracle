/**
 * WinnersPage (/winners) — the permanent World Cup 2026 podium. Content comes
 * from ONE edge-cached doc published by Admin → Close out, with on-chain /
 * Stripe proof-of-payout links. Per-view Firestore cost ≈ zero.
 */

import React, { useEffect, useState } from 'react';
import { Trophy, ExternalLink, RefreshCw } from 'lucide-react';
import { fetchWinnersPage } from '../utils/db';
import { countryFlag } from '../utils/flags';

const MEDALS = ['🥇', '🥈', '🥉'];

export default function WinnersPage({ onViewProfile, onGoLeaderboard }) {
  const [data, setData] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchWinnersPage().then((d) => { if (!cancelled) setData(d); });
    return () => { cancelled = true; };
  }, []);

  if (!data) {
    return <div className="winners-page"><div className="ll-loading"><RefreshCw size={16} className="spin" /> Loading…</div></div>;
  }

  if (!data.published || !data.winners?.length) {
    return (
      <div className="winners-page">
        <div className="winners-head">
          <h1><Trophy size={26} className="gold" /> World Cup 2026 Winners</h1>
          <p>Winners will be announced here once prizes are confirmed. Stay tuned.</p>
        </div>
      </div>
    );
  }

  // Podium order: 2nd, 1st, 3rd (classic podium layout on desktop).
  const byPlace = {};
  data.winners.forEach((w) => { byPlace[w.place] = w; });
  const order = [byPlace[2], byPlace[1], byPlace[3]].filter(Boolean);

  return (
    <div className="winners-page">
      <div className="winners-head">
        <h1><Trophy size={26} className="gold" /> World Cup 2026 Winners</h1>
        <p>
          {data.totalPlayers ? `${data.totalPlayers.toLocaleString()} players. ` : ''}
          One month of football. Three brackets better than everyone else&rsquo;s.
        </p>
      </div>
      <div className="winners-podium">
        {order.map((w) => (
          <div key={w.place} className={`winners-card winners-place-${w.place}`}>
            <div className="winners-medal" aria-hidden="true">{MEDALS[w.place - 1]}</div>
            <button
              type="button"
              className="winners-name"
              onClick={() => onViewProfile && onViewProfile(w.userId)}
              title="View profile"
            >
              {w.country && <span aria-hidden="true">{countryFlag(w.country)} </span>}
              {w.displayName}
            </button>
            <div className="winners-points">{w.points} pts</div>
            <div className="winners-prize">${w.amount} {w.currency}</div>
            {w.proofUrl && (
              <a className="winners-proof" href={w.proofUrl} target="_blank" rel="noopener noreferrer">
                Paid ✓ view proof <ExternalLink size={11} aria-hidden="true" />
              </a>
            )}
          </div>
        ))}
      </div>
      <div className="winners-footer">
        <button type="button" className="btn btn-secondary" onClick={onGoLeaderboard}>
          See the full final leaderboard
        </button>
        <p className="winners-footnote">
          Prizes paid per the <a href="/official-rules">Official Rules</a>. GoalOracle returns for the next tournament —
          winners keep their badges forever.
        </p>
      </div>
    </div>
  );
}
