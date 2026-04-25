/**
 * BracketMobile
 *
 * Round-by-round knockout view. Shows one round at a time; the next round
 * unlocks as soon as the current one is fully picked. Round headers stick
 * to the top of the scroll container.
 */

import React, { useState, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';
import BracketMatch from './BracketMatch';
import BracketHintTooltip from './BracketHintTooltip';
import { ROUND_ORDER } from '../../utils/bracketUtils';

const ROUND_LABEL = {
  roundOf32: 'Round of 32',
  roundOf16: 'Round of 16',
  quarterFinals: 'Quarterfinals',
  semiFinals: 'Semifinals',
  thirdPlace: '3rd Place Match',
  final: 'Final',
};

// Short labels for the progress strip — one strip cell per round, full
// labels stay in the section header below.
const ROUND_LABEL_SHORT = {
  roundOf32: 'R32',
  roundOf16: 'R16',
  quarterFinals: 'QF',
  semiFinals: 'SF',
  thirdPlace: '3rd',
  final: 'Final',
};

const ROUND_TOTAL = {
  roundOf32: 16,
  roundOf16: 8,
  quarterFinals: 4,
  semiFinals: 2,
  thirdPlace: 1,
  final: 1,
};

export default function BracketMobile({ bracket, pickWinner, isRoundComplete, isRoundUnlocked, isMatchLocked, matchLookup, showHint, onDismissHint }) {
  const firstIncomplete = ROUND_ORDER.find((r) => isRoundUnlocked(r) && !isRoundComplete(r)) || 'roundOf32';
  const [openRound, setOpenRound] = useState(firstIncomplete);

  // If the unlocked-but-incomplete round changes (e.g. user completes a round),
  // follow the frontier automatically.
  useEffect(() => {
    if (isRoundComplete(openRound)) {
      const next = ROUND_ORDER.find((r) => isRoundUnlocked(r) && !isRoundComplete(r));
      if (next) setOpenRound(next);
    }
  }, [openRound, isRoundComplete, isRoundUnlocked]);

  // Progress strip across the top — one cell per round so the user sees
  // exactly where they are without expanding sections. Tapping a cell
  // jumps to that round (only if it's already unlocked).
  const currentIdx = ROUND_ORDER.indexOf(openRound);
  return (
    <div className="bracket-mobile">
      <nav className="bracket-progress" aria-label="Bracket round progress">
        {ROUND_ORDER.map((roundKey, i) => {
          const slots = bracket[roundKey] || [];
          const picked = slots.filter((s) => s.pick && s.pick.winnerId).length;
          const total = ROUND_TOTAL[roundKey];
          const unlocked = isRoundUnlocked(roundKey);
          const complete = isRoundComplete(roundKey);
          const isCurrent = roundKey === openRound;
          const state = !unlocked ? 'locked' : complete ? 'done' : isCurrent ? 'current' : 'open';
          return (
            <button
              key={roundKey}
              type="button"
              className={`bracket-progress-cell bracket-progress-${state}`}
              onClick={() => unlocked && setOpenRound(roundKey)}
              disabled={!unlocked}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`${ROUND_LABEL[roundKey]} — ${picked} of ${total} picked`}
              title={`${ROUND_LABEL[roundKey]}: ${picked} / ${total}`}
            >
              <span className="bracket-progress-label">{ROUND_LABEL_SHORT[roundKey]}</span>
              <span className="bracket-progress-meta">
                {complete ? '✓' : !unlocked ? '🔒' : `${picked}/${total}`}
              </span>
            </button>
          );
        })}
      </nav>
      {ROUND_ORDER.map((roundKey) => {
        const slots = bracket[roundKey] || [];
        const unlocked = isRoundUnlocked(roundKey);
        const complete = isRoundComplete(roundKey);
        const isOpen = openRound === roundKey;
        const picked = slots.filter((s) => s.pick && s.pick.winnerId).length;

        return (
          <section
            key={roundKey}
            className={`bracket-round ${isOpen ? 'open' : ''} ${!unlocked ? 'disabled' : ''}`}
          >
            <button
              type="button"
              className="bracket-round-header"
              onClick={() => unlocked && setOpenRound(isOpen ? null : roundKey)}
              disabled={!unlocked}
              aria-expanded={isOpen}
            >
              <span className="bracket-round-label">{ROUND_LABEL[roundKey]}</span>
              <span className="bracket-round-progress">
                {unlocked ? `${picked} / ${ROUND_TOTAL[roundKey]}` : 'Locked'}
              </span>
              <ChevronDown size={16} className={`bracket-round-chevron ${isOpen ? 'flipped' : ''}`} />
            </button>

            {isOpen && unlocked && (
              <div className="bracket-round-body">
                {slots.map((s, i) => {
                  const meta = matchLookup?.[s.matchId];
                  const needsPick = !!(s.home && s.away && !s.pick?.winnerId);
                  // Anchor the first-visit hint to the first match of the
                  // first incomplete round so it's the matchup the user
                  // is most likely to interact with.
                  const isHintAnchor = showHint && roundKey === 'roundOf32' && i === 0;
                  return (
                    <div key={s.matchId} className={`bracket-match-wrap ${isHintAnchor ? 'has-hint' : ''}`}>
                      {isHintAnchor && <BracketHintTooltip onDismiss={onDismissHint} />}
                      <BracketMatch
                        matchId={s.matchId}
                        label={`Match ${i + 1}`}
                        homeTeam={s.home}
                        awayTeam={s.away}
                        homeFlag={s.homeFlag}
                        awayFlag={s.awayFlag}
                        winnerId={s.pick?.winnerId || null}
                        onPick={(team) => pickWinner(s.matchId, team)}
                        isLocked={isMatchLocked ? isMatchLocked(s.matchId) : false}
                        size="full"
                        city={meta?.city}
                        date={meta?.date}
                        needsPick={needsPick}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
