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
import { ROUND_ORDER } from '../../utils/bracketUtils';

const ROUND_LABEL = {
  roundOf32: 'Round of 32',
  roundOf16: 'Round of 16',
  quarterFinals: 'Quarterfinals',
  semiFinals: 'Semifinals',
  thirdPlace: '3rd Place Match',
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

export default function BracketMobile({ bracket, pickWinner, isRoundComplete, isRoundUnlocked, isMatchLocked }) {
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

  return (
    <div className="bracket-mobile">
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
                {slots.map((s, i) => (
                  <BracketMatch
                    key={s.matchId}
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
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
