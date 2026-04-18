/**
 * BracketMatch
 *
 * A single knockout match rendered as two selectable team rows.
 * Used by both BracketMobile (size="full") and BracketDesktop (size="compact").
 */

import React from 'react';
import { Lock } from 'lucide-react';

function BracketMatch({ matchId, homeTeam, awayTeam, homeFlag, awayFlag, winnerId, onPick, isLocked, size = 'full', label }) {
  const homeSelected = winnerId && winnerId === homeTeam;
  const awaySelected = winnerId && winnerId === awayTeam;

  const handlePick = (team) => {
    if (isLocked || !team || !homeTeam || !awayTeam) return;
    onPick && onPick(team);
  };

  const rowClass = (isWinner, isLoser, isTBD) => [
    'bracket-row',
    isWinner && 'winner',
    isLoser && 'loser',
    isTBD && 'tbd',
    isLocked && 'locked',
  ].filter(Boolean).join(' ');

  const homeIsLoser = winnerId && !homeSelected;
  const awayIsLoser = winnerId && !awaySelected;

  return (
    <div className={`bracket-match size-${size}`} data-match-id={matchId}>
      {label && <div className="bracket-match-label">{label}</div>}
      <button
        type="button"
        className={rowClass(homeSelected, homeIsLoser, !homeTeam)}
        onClick={() => handlePick(homeTeam)}
        disabled={isLocked || !homeTeam || !awayTeam}
        aria-pressed={!!homeSelected}
      >
        <span className="bracket-row-flag" aria-hidden="true">{homeFlag || '🏳️'}</span>
        <span className="bracket-row-name">{homeTeam || 'TBD'}</span>
        {homeSelected && <span className="bracket-row-pill adv">ADV</span>}
        {homeIsLoser && <span className="bracket-row-pill out">OUT</span>}
        {isLocked && <Lock size={12} className="bracket-row-lock" />}
      </button>
      <button
        type="button"
        className={rowClass(awaySelected, awayIsLoser, !awayTeam)}
        onClick={() => handlePick(awayTeam)}
        disabled={isLocked || !homeTeam || !awayTeam}
        aria-pressed={!!awaySelected}
      >
        <span className="bracket-row-flag" aria-hidden="true">{awayFlag || '🏳️'}</span>
        <span className="bracket-row-name">{awayTeam || 'TBD'}</span>
        {awaySelected && <span className="bracket-row-pill adv">ADV</span>}
        {awayIsLoser && <span className="bracket-row-pill out">OUT</span>}
      </button>
    </div>
  );
}

export default React.memo(BracketMatch);
