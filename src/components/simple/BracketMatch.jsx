/**
 * BracketMatch
 *
 * A single knockout match rendered as two selectable team rows.
 * Used by both BracketMobile (size="full") and BracketDesktop (size="compact").
 */

import React from 'react';
import { Lock, ChevronRight } from 'lucide-react';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatMatchDate(dateStr) {
  if (!dateStr) return null;
  const [, m, d] = dateStr.split('-');
  return `${MONTH_SHORT[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

function BracketMatch({ matchId, homeTeam, awayTeam, homeFlag, awayFlag, winnerId, onPick, isLocked, size = 'full', label, city, date, needsPick }) {
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
  const formattedDate = formatMatchDate(date);

  return (
    <div className={`bracket-match size-${size}${needsPick ? ' needs-pick' : ''}`} data-match-id={matchId}>
      {(city || formattedDate) && (
        <div className="bracket-match-meta">
          {city && <span className="bracket-match-city">{city}</span>}
          {formattedDate && <span className="bracket-match-date">{formattedDate}</span>}
        </div>
      )}
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
        {!homeSelected && !homeIsLoser && !isLocked && homeTeam && awayTeam && (
          <ChevronRight size={14} className="bracket-row-advance" aria-hidden="true" />
        )}
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
        {!awaySelected && !awayIsLoser && !isLocked && homeTeam && awayTeam && (
          <ChevronRight size={14} className="bracket-row-advance" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}

export default React.memo(BracketMatch);
