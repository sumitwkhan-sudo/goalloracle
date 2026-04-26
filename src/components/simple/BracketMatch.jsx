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

function BracketMatch({ matchId, homeTeam, awayTeam, homeFlag, awayFlag, winnerId, onPick, isLocked, size = 'full', label, city, date, needsPick, readOnly = false }) {
  const homeSelected = winnerId && winnerId === homeTeam;
  const awaySelected = winnerId && winnerId === awayTeam;

  const handlePick = (team) => {
    if (readOnly || isLocked || !team || !homeTeam || !awayTeam) return;
    onPick && onPick(team);
  };

  const rowClass = (isWinner, isLoser, isTBD) => [
    'bracket-row',
    isWinner && 'winner',
    isLoser && 'loser',
    isTBD && 'tbd',
    isLocked && 'locked',
    readOnly && 'readonly',
  ].filter(Boolean).join(' ');

  const homeIsLoser = winnerId && !homeSelected;
  const awayIsLoser = winnerId && !awaySelected;
  const formattedDate = formatMatchDate(date);

  // Read-only render — used by PicksViewer to show another user's bracket
  // without exposing pick affordances. No buttons, no hover arrow, no
  // lock icon (which is a different state). Just static cells highlighted
  // with the same winner/loser styling.
  const Row = ({ isWinner, isLoser, isTBD, flag, team, withLockIcon }) => {
    if (readOnly) {
      return (
        <div className={rowClass(isWinner, isLoser, isTBD)}>
          <span className="bracket-row-flag" aria-hidden="true">{flag || '🏳️'}</span>
          <span className="bracket-row-name">{team || 'TBD'}</span>
          {isWinner && <span className="bracket-row-pill adv">ADV</span>}
          {isLoser && <span className="bracket-row-pill out">OUT</span>}
        </div>
      );
    }
    return (
      <button
        type="button"
        className={rowClass(isWinner, isLoser, isTBD)}
        onClick={() => handlePick(team)}
        disabled={isLocked || !homeTeam || !awayTeam}
        aria-pressed={!!isWinner}
      >
        <span className="bracket-row-flag" aria-hidden="true">{flag || '🏳️'}</span>
        <span className="bracket-row-name">{team || 'TBD'}</span>
        {isWinner && <span className="bracket-row-pill adv">ADV</span>}
        {isLoser && <span className="bracket-row-pill out">OUT</span>}
        {withLockIcon && isLocked && <Lock size={12} className="bracket-row-lock" />}
        {!isWinner && !isLoser && !isLocked && homeTeam && awayTeam && (
          <ChevronRight size={14} className="bracket-row-advance" aria-hidden="true" />
        )}
      </button>
    );
  };

  return (
    <div className={`bracket-match size-${size}${needsPick && !readOnly ? ' needs-pick' : ''}${readOnly ? ' readonly' : ''}`} data-match-id={matchId}>
      {(city || formattedDate) && (
        <div className="bracket-match-meta">
          {city && <span className="bracket-match-city">{city}</span>}
          {formattedDate && <span className="bracket-match-date">{formattedDate}</span>}
        </div>
      )}
      {label && <div className="bracket-match-label">{label}</div>}
      <Row isWinner={homeSelected} isLoser={homeIsLoser} isTBD={!homeTeam} flag={homeFlag} team={homeTeam} withLockIcon />
      <Row isWinner={awaySelected} isLoser={awayIsLoser} isTBD={!awayTeam} flag={awayFlag} team={awayTeam} />
    </div>
  );
}

export default React.memo(BracketMatch);
