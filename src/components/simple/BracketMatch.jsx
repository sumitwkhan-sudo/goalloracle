/**
 * BracketMatch
 *
 * A single knockout match rendered as two selectable team rows.
 * Used by both BracketMobile (size="full") and BracketDesktop (size="compact").
 */

import React from 'react';
import { Lock, ChevronRight, Ban } from 'lucide-react';
import { koMatchNumber, koSlotLabel } from '../../utils/bracketUtils';

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatMatchDate(dateStr) {
  if (!dateStr) return null;
  const [, m, d] = dateStr.split('-');
  return `${MONTH_SHORT[parseInt(m, 10) - 1]} ${parseInt(d, 10)}`;
}

function BracketMatch({ matchId, homeTeam, awayTeam, homeFlag, awayFlag, winnerId, onPick, isLocked, size = 'full', label, city, date, needsPick, readOnly = false, homeAdvancePct, awayAdvancePct, homeEarned = true, awayEarned = true, actualWinnerId = null, pointsIfRight = 0, pickScoreEligible = true }) {
  const homeSelected = winnerId && winnerId === homeTeam;
  const awaySelected = winnerId && winnerId === awayTeam;

  const handlePick = (team) => {
    if (readOnly || isLocked || !team || !homeTeam || !awayTeam) return;
    // Any real team in the slot is pickable — including teams the user didn't
    // predict to reach the knockouts. Those just won't score (the row is
    // marked "won't score"); scoring is decided server-side, not blocked here.
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
  // Static (matchId-derived) display helpers: the FIFA match number (M73–M104)
  // and the per-side qualifier descriptor shown in an undecided slot instead of
  // a bare "TBD" (e.g. "2nd Group A", "Winner of M73").
  const matchNum = koMatchNumber(matchId);
  const slotLabels = koSlotLabel(matchId);

  // Read-only render — used by PicksViewer to show another user's bracket
  // without exposing pick affordances. No buttons, no hover arrow, no
  // lock icon (which is a different state). Just static cells highlighted
  // with the same winner/loser styling.
  const Row = ({ isWinner, isLoser, isTBD, flag, team, withLockIcon, earned = true, slotLabel }) => {
    // An undecided side shows its qualifier descriptor (which team will fill it)
    // instead of a bare "TBD", so slots are distinguishable and the user knows
    // who's coming. Once the real team resolves, `team` is set and shown.
    const tbdText = slotLabel || 'TBD';
    // "Won't score": a real knockout team the user did NOT predict to reach the
    // knockouts. Still fully pickable — it just earns 0 points.
    const noScore = earned === false && !!team;
    if (readOnly) {
      // When the real result is in, mark the user's advanced pick right/wrong:
      // ✓ +points if their team actually won this match, ✗ if it didn't. A
      // correct pick of a team they never predicted to advance won the match
      // but scores 0 (pickScoreEligible === false) — show that honestly.
      const graded = isWinner && actualWinnerId != null && !!team;
      const rightPick = graded && team === actualWinnerId;
      const wrongPick = graded && team !== actualWinnerId;
      const rightButZero = rightPick && pickScoreEligible === false;
      // The real winner showing on the OTHER (loser) row — flag it so it's clear
      // who actually went through when the user's pick was wrong.
      const isActualOnLoserRow = isLoser && actualWinnerId != null && team === actualWinnerId;
      return (
        <div className={`${rowClass(isWinner, isLoser, isTBD)}${rightPick && !rightButZero ? ' pick-right' : ''}${wrongPick ? ' pick-wrong' : ''}`}>
          <span className="bracket-row-flag" aria-hidden="true">{flag || '🏳️'}</span>
          <span className={`bracket-row-name${!team ? ' bracket-row-name-tbd' : ''}`}>{team || tbdText}</span>
          {rightPick && !rightButZero && <span className="bracket-row-pill correct">✓ +{pointsIfRight}</span>}
          {rightButZero && <span className="bracket-row-pill noscore" title="Not one of your predicted teams — scores 0">✓ 0 pts</span>}
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
        className={`${rowClass(isWinner, isLoser, isTBD)}${noScore ? ' not-earned' : ''}`}
        onClick={() => handlePick(team)}
        disabled={isLocked || !homeTeam || !awayTeam}
        aria-pressed={!!isWinner}
        aria-label={noScore ? `${team} — you didn't pick this team to reach the knockouts, so it won't score, but you can still advance it` : undefined}
        title={noScore ? `You didn't pick ${team} to reach the knockouts — you can still advance it, but it won't score` : undefined}
      >
        <span className="bracket-row-flag" aria-hidden="true">{flag || '🏳️'}</span>
        <span className={`bracket-row-name${!team ? ' bracket-row-name-tbd' : ''}`}>{team || tbdText}</span>
        {isWinner && <span className="bracket-row-pill adv">ADV</span>}
        {isLoser && <span className="bracket-row-pill out">OUT</span>}
        {noScore && (
          <span className="bracket-row-noscore" title={`You didn't pick ${team} to reach the knockouts — you can still advance it, but it won't score`}>
            <Ban size={10} aria-hidden="true" /> won&rsquo;t score
          </span>
        )}
        {withLockIcon && isLocked && <Lock size={12} className="bracket-row-lock" />}
        {!isWinner && !isLoser && !isLocked && !noScore && homeTeam && awayTeam && (
          <ChevronRight size={14} className="bracket-row-advance" aria-hidden="true" />
        )}
      </button>
    );
  };

  return (
    <div className={`bracket-match size-${size}${needsPick && !readOnly ? ' needs-pick' : ''}${readOnly ? ' readonly' : ''}${isLocked && !readOnly ? ' match-locked' : ''}`} data-match-id={matchId}>
      {(city || formattedDate || matchNum || (isLocked && !readOnly)) && (
        <div className="bracket-match-meta">
          {matchNum && <span className="bracket-match-num">M{matchNum}</span>}
          {city && <span className="bracket-match-city">{city}</span>}
          {isLocked && !readOnly
            ? <span className="bracket-match-lock-badge"><Lock size={9} aria-hidden="true" /> Locked</span>
            : formattedDate && <span className="bracket-match-date">{formattedDate}</span>}
        </div>
      )}
      {label && <div className="bracket-match-label">{label}</div>}
      <Row isWinner={homeSelected} isLoser={homeIsLoser} isTBD={!homeTeam} flag={homeFlag} team={homeTeam} earned={homeEarned} slotLabel={slotLabels.home} withLockIcon />
      <Row isWinner={awaySelected} isLoser={awayIsLoser} isTBD={!awayTeam} flag={awayFlag} team={awayTeam} earned={awayEarned} slotLabel={slotLabels.away} />
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
