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

function BracketMatch({ matchId, homeTeam, awayTeam, homeFlag, awayFlag, winnerId, onPick, isLocked, size = 'full', label, city, date, needsPick, readOnly = false, homeAdvancePct, awayAdvancePct, homeEarned = true, awayEarned = true, actualWinnerId = null, pointsIfRight = 0 }) {
  const homeSelected = winnerId && winnerId === homeTeam;
  const awaySelected = winnerId && winnerId === awayTeam;

  const handlePick = (team) => {
    if (readOnly || isLocked || !team || !homeTeam || !awayTeam) return;
    // A non-earned (locked) team is NOT short-circuited here: we let the tap
    // reach onPick so the wizard can explain WHY it's locked (pickWinner
    // rejects the pick and returns a 'blocked' signal → a toast on mobile,
    // alongside the hover title on web). The row keeps its locked styling.
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
  const Row = ({ isWinner, isLoser, isTBD, flag, team, withLockIcon, earned = true }) => {
    const notEarned = earned === false && !!team;
    if (readOnly) {
      // When the real result is in, mark the user's advanced pick right/wrong:
      // ✓ +points if their team actually won this match, ✗ if it didn't.
      const graded = isWinner && actualWinnerId != null && !!team;
      const rightPick = graded && team === actualWinnerId;
      const wrongPick = graded && team !== actualWinnerId;
      // The real winner showing on the OTHER (loser) row — flag it so it's clear
      // who actually went through when the user's pick was wrong.
      const isActualOnLoserRow = isLoser && actualWinnerId != null && team === actualWinnerId;
      return (
        <div className={`${rowClass(isWinner, isLoser, isTBD)}${rightPick ? ' pick-right' : ''}${wrongPick ? ' pick-wrong' : ''}`}>
          <span className="bracket-row-flag" aria-hidden="true">{flag || '🏳️'}</span>
          <span className="bracket-row-name">{team || 'TBD'}</span>
          {rightPick && <span className="bracket-row-pill correct">✓ +{pointsIfRight}</span>}
          {wrongPick && <span className="bracket-row-pill missed">✗</span>}
          {isActualOnLoserRow && <span className="bracket-row-pill adv">WON</span>}
          {isWinner && actualWinnerId == null && <span className="bracket-row-pill adv">ADV</span>}
          {isLoser && actualWinnerId == null && <span className="bracket-row-pill out">OUT</span>}
        </div>
      );
    }
    return (
      <button
        type="button"
        className={`${rowClass(isWinner, isLoser, isTBD)}${notEarned ? ' not-earned' : ''}`}
        onClick={() => handlePick(team)}
        // Locked (not-earned) rows stay tappable so we can explain why on tap;
        // disabled only for genuinely un-pickable states (locked stage / TBD).
        // Encode the locked reason in the accessible NAME (not aria-disabled,
        // which would tell SR users it's inert and they'd never tap to hear it).
        disabled={isLocked || !homeTeam || !awayTeam}
        aria-pressed={!!isWinner}
        aria-label={notEarned ? `${team} — locked: you didn't pick this team to reach the knockouts` : undefined}
        title={notEarned ? `You didn't pick ${team} to reach the knockouts` : undefined}
      >
        <span className="bracket-row-flag" aria-hidden="true">{flag || '🏳️'}</span>
        <span className="bracket-row-name">{team || 'TBD'}</span>
        {isWinner && <span className="bracket-row-pill adv">ADV</span>}
        {isLoser && <span className="bracket-row-pill out">OUT</span>}
        {notEarned && <Lock size={11} className="bracket-row-lock" />}
        {withLockIcon && isLocked && <Lock size={12} className="bracket-row-lock" />}
        {!isWinner && !isLoser && !isLocked && !notEarned && homeTeam && awayTeam && (
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
      <Row isWinner={homeSelected} isLoser={homeIsLoser} isTBD={!homeTeam} flag={homeFlag} team={homeTeam} earned={homeEarned} withLockIcon />
      <Row isWinner={awaySelected} isLoser={awayIsLoser} isTBD={!awayTeam} flag={awayFlag} team={awayTeam} earned={awayEarned} />
      {(homeAdvancePct != null || awayAdvancePct != null) && homeTeam && awayTeam && (
        <div
          className="bracket-consensus"
          role="img"
          aria-label={`Crowd consensus: ${homeTeam} ${Math.round((homeAdvancePct || 0) * 100)}%, ${awayTeam} ${Math.round((awayAdvancePct || 0) * 100)}%`}
        >
          <div className="bracket-consensus-bar">
            <div
              className="bracket-consensus-fill bracket-consensus-home"
              style={{ width: `${(homeAdvancePct || 0) * 100}%` }}
            />
            <div
              className="bracket-consensus-fill bracket-consensus-away"
              style={{ width: `${(awayAdvancePct || 0) * 100}%` }}
            />
          </div>
          <div className="bracket-consensus-pcts">
            <span>{Math.round((homeAdvancePct || 0) * 100)}%</span>
            <span className="bracket-consensus-label">crowd pick</span>
            <span>{Math.round((awayAdvancePct || 0) * 100)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default React.memo(BracketMatch);
