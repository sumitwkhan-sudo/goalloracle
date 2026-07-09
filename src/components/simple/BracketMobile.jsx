/**
 * BracketMobile
 *
 * Round-by-round knockout view. Shows one round at a time; the next round
 * unlocks as soon as the current one is fully picked. Round headers stick
 * to the top of the scroll container.
 */

import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, Award } from 'lucide-react';
import BracketMatch from './BracketMatch';
import BracketHintTooltip from './BracketHintTooltip';
import { KNOCKOUT_POINTS_PER_PICK } from '../../utils/scoringSimple';
import { ROUND_ORDER, ROUND_FEED_PAIRS, koMatchNumber } from '../../utils/bracketUtils';

// Arrange a round's slots in BRACKET-STRUCTURE order: consecutive pairs whose
// winners meet in the same next-round match, each pair tagged with that match.
// Rounds without pairs (3rd place, Final) come back as one untagged group.
// This is what lets the vertical mobile list read like a printed bracket —
// R32 is scheduled in a different order than the bracket, so without the
// reorder the two feeders of an R16 game can sit five cards apart.
function displayGroups(roundKey, slots) {
  const pairs = ROUND_FEED_PAIRS[roundKey];
  if (!pairs) return [{ next: null, slots }];
  const byId = {};
  for (const s of slots) byId[s.matchId] = s;
  const seen = new Set();
  const groups = [];
  for (const p of pairs) {
    const pairSlots = p.sources.map((id) => byId[id]).filter(Boolean);
    if (pairSlots.length === 0) continue;
    pairSlots.forEach((s) => seen.add(s.matchId));
    groups.push({ next: p.next, slots: pairSlots });
  }
  // Safety net: any slot the pair map didn't cover still renders (untagged).
  const leftovers = slots.filter((s) => !seen.has(s.matchId));
  if (leftovers.length) groups.push({ next: null, slots: leftovers });
  return groups;
}

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

// Center a match element in the *visible* band — i.e. below the sticky
// navbar + round-progress strip, not the raw viewport center. We measure
// the sticky chrome live (rather than hardcoding 106px) so the math stays
// correct across viewports, themes, and when the news ticker is present.
// item F: the next required pick is always brought clearly into view.
function centerMatchInView(matchId) {
  if (typeof document === 'undefined') return;
  const el = document.querySelector(`[data-match-id="${matchId}"]`);
  if (!el || typeof el.getBoundingClientRect !== 'function') return;
  // Top of the usable band = bottom edge of whatever sticky chrome is
  // currently pinned at the top (navbar + bracket progress strip).
  let topInset = 0;
  for (const sel of ['.navbar', '.bracket-progress']) {
    const chrome = document.querySelector(sel);
    if (chrome) {
      const r = chrome.getBoundingClientRect();
      // Only count it if it's actually pinned near the top of the screen.
      if (r.top <= 4 && r.bottom > topInset) topInset = r.bottom;
    }
  }
  const rect = el.getBoundingClientRect();
  const visibleBand = window.innerHeight - topInset;
  // Desired position: vertically centered within the band below the chrome,
  // but never scrolled so far that the match's top hides under the chrome.
  const targetTop = topInset + Math.max(0, (visibleBand - rect.height) / 2);
  const delta = rect.top - targetTop;
  if (Math.abs(delta) < 8) return; // already essentially in place
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  window.scrollBy({ top: delta, left: 0, behavior: reduce ? 'auto' : 'smooth' });
}

export default function BracketMobile({ bracket, pickWinner, isRoundComplete, isRoundUnlocked, isMatchLocked, matchLookup, showHint, onDismissHint, readOnly = false, consensus, actualKnockout = null, predictedSet = null }) {
  const firstIncomplete = ROUND_ORDER.find((r) => isRoundUnlocked(r) && !isRoundComplete(r)) || 'roundOf32';
  const [openRound, setOpenRound] = useState(firstIncomplete);

  // item F — the matchId that should currently glow as "pick this next":
  // the first unpicked, ready (both teams known) match in the open round,
  // in DISPLAY (bracket-structure) order so the glow + auto-scroll walk the
  // list top to bottom as the user sees it.
  const nextRequiredId = (() => {
    if (readOnly) return null;
    const ordered = displayGroups(openRound, bracket[openRound] || []).flatMap((g) => g.slots);
    const slot = ordered.find((s) => s.home && s.away && !s.pick?.winnerId);
    return slot ? slot.matchId : null;
  })();

  // After each pick within a round, bring the NEXT required match into the
  // visible band (item F). Without this, on a long round (R32 = 16 matches)
  // the user finishes one pick and has to manually hunt for the next — the
  // existing round-transition scroll only fires when a whole round completes.
  // We trigger on the change of nextRequiredId (i.e. a pick was just made and
  // the "next" pointer moved), not on every render.
  const prevNextIdRef = useRef(nextRequiredId);
  useEffect(() => {
    const prev = prevNextIdRef.current;
    prevNextIdRef.current = nextRequiredId;
    if (readOnly) return;
    // Only react when the pointer actually advanced to a different match
    // (a pick was made) and there's still a next match in this round.
    if (nextRequiredId && prev && nextRequiredId !== prev) {
      requestAnimationFrame(() => centerMatchInView(nextRequiredId));
    }
  }, [nextRequiredId, readOnly]);

  // Auto-advance the open accordion ONLY at the moment a round's
  // completion flips from incomplete → complete. Two refs are needed:
  //   - prevRoundRef:    which round the effect last evaluated, so we
  //                      can detect navigation between rounds.
  //   - prevCompleteRef: that round's completion state, so we can
  //                      detect a false → true edge within it.
  // If we tracked completion alone, the previous round's value would
  // be misread as "was incomplete" the moment the user tapped into a
  // finished round, and the edge check would auto-advance them right
  // back out — defeating the whole purpose of the reopen fix.
  const prevRoundRef = useRef(openRound);
  const prevCompleteRef = useRef(isRoundComplete(openRound));
  useEffect(() => {
    // Reset both refs on navigation so completion edges are only
    // detected within a single round.
    if (prevRoundRef.current !== openRound) {
      prevRoundRef.current = openRound;
      prevCompleteRef.current = isRoundComplete(openRound);
      return;
    }
    const nowComplete = isRoundComplete(openRound);
    const wasComplete = prevCompleteRef.current;
    prevCompleteRef.current = nowComplete;
    // Only advance on the false → true edge — the user just finished
    // the round they're currently looking at.
    if (!wasComplete && nowComplete) {
      const next = ROUND_ORDER.find((r) => isRoundUnlocked(r) && !isRoundComplete(r));
      if (next) {
        setOpenRound(next);
        // After auto-advancing, scroll the new round's section header
        // to the top of the viewport (offset by the sticky chrome via
        // scroll-margin-top in CSS). Without this, the previous round
        // collapsing pushes content up — and because the user finished
        // their LAST pick at the bottom of that round, the new round's
        // body opens with the *end* of it under the viewport, leaving
        // the user looking at "match 8 of R16" instead of "match 1".
        // requestAnimationFrame waits for React to commit the new body
        // before we attempt to scroll to it.
        requestAnimationFrame(() => {
          const el = typeof document !== 'undefined'
            ? document.querySelector(`[data-bracket-round="${next}"]`)
            : null;
          if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      }
    }
  }, [openRound, bracket, isRoundComplete, isRoundUnlocked]);

  // Progress strip across the top — one cell per round so the user sees
  // exactly where they are without expanding sections. Tapping a cell
  // jumps to that round (only if it's already unlocked).
  const currentIdx = ROUND_ORDER.indexOf(openRound);

  // "Only 3rd place left" prompt. Most users don't realize the
  // 3rd-place match is a separate pick — they finish the Final and
  // wonder why their bracket still shows "1 left". When that's the
  // exact case, surface an animated banner with a chevron pointing
  // at the round, and auto-open the round so the actual matchup is
  // immediately tappable.
  const thirdPlaceOnlyLeft = !readOnly
    && isRoundComplete('roundOf32')
    && isRoundComplete('roundOf16')
    && isRoundComplete('quarterFinals')
    && isRoundComplete('semiFinals')
    && isRoundComplete('final')
    && !isRoundComplete('thirdPlace');
  const thirdPlaceNudgeRef = useRef(false);
  useEffect(() => {
    if (thirdPlaceOnlyLeft && !thirdPlaceNudgeRef.current) {
      thirdPlaceNudgeRef.current = true;
      setOpenRound('thirdPlace');
    }
    if (!thirdPlaceOnlyLeft) thirdPlaceNudgeRef.current = false;
  }, [thirdPlaceOnlyLeft]);

  return (
    <div className="bracket-mobile">
      {thirdPlaceOnlyLeft && (
        <div className="bracket-third-nudge" role="status" aria-live="polite">
          <Award size={16} className="bracket-third-nudge-icon" aria-hidden="true" />
          <div className="bracket-third-nudge-body">
            <strong>One pick left:</strong> the 3rd-place match (5 pts).
            <span className="bracket-third-nudge-sub"> Tap below to lock it in.</span>
          </div>
          <ChevronDown size={18} className="bracket-third-nudge-chevron" aria-hidden="true" />
        </div>
      )}
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
            data-bracket-round={roundKey}
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
                {(() => {
                  const groups = displayGroups(roundKey, slots);
                  let displayIdx = 0;
                  const renderMatch = (s) => {
                    const i = displayIdx++;
                    const meta = matchLookup?.[s.matchId];
                    const needsPick = !!(s.home && s.away && !s.pick?.winnerId);
                    // Anchor the first-visit hint to the first match of the
                    // first incomplete round so it's the matchup the user
                    // is most likely to interact with.
                    const isHintAnchor = !readOnly && showHint && roundKey === 'roundOf32' && i === 0;
                    // Crowd consensus only renders once the user has picked a
                    // winner for this match — pre-pick we deliberately hide
                    // it so the user's call isn't anchored to the herd. In
                    // readOnly mode (e.g. PicksViewer) the winner is already
                    // set, so the bar appears.
                    const showBar = !!s.pick?.winnerId && consensus?.[roundKey]?.[s.matchId];
                    const homePct = showBar ? consensus[roundKey][s.matchId][s.home] : undefined;
                    const awayPct = showBar ? consensus[roundKey][s.matchId][s.away] : undefined;
                    // item F: glow ONLY the single next-required match (not
                    // every unpicked one), so the user's eye goes to exactly
                    // the one to pick next.
                    const isNext = !readOnly && s.matchId === nextRequiredId;
                    return (
                      <div key={s.matchId} className={`bracket-match-wrap ${isHintAnchor ? 'has-hint' : ''} ${isNext ? 'is-next' : ''}`}>
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
                          readOnly={readOnly}
                          homeAdvancePct={homePct}
                          awayAdvancePct={awayPct}
                          homeEarned={s.homeEarned}
                          awayEarned={s.awayEarned}
                          actualWinnerId={(actualKnockout && actualKnockout[s.matchId]?.winnerId) || null}
                          pointsIfRight={KNOCKOUT_POINTS_PER_PICK[roundKey] || 0}
                          pickScoreEligible={!predictedSet || !s.pick?.winnerId || predictedSet.has(s.pick.winnerId)}
                        />
                      </div>
                    );
                  };
                  return groups.map((g, gi) => {
                    // Untagged group (3rd place / Final / safety leftovers):
                    // flat list, no connector.
                    if (!g.next || g.slots.length < 2) {
                      return <React.Fragment key={`flat-${gi}`}>{g.slots.map(renderMatch)}</React.Fragment>;
                    }
                    // Bracket pair: the two matches whose winners meet, joined
                    // by a connector spine + a chip naming the match they feed
                    // (printed-bracket style — see The Athletic reference).
                    const nextNum = g.next === 'final' ? 'Final' : `M${koMatchNumber(g.next)}`;
                    return (
                      <div key={g.next} className="bracket-pair">
                        {g.slots.map(renderMatch)}
                        <span
                          className="bracket-pair-chip"
                          title={`Winners meet in ${g.next === 'final' ? 'the Final' : `Match ${koMatchNumber(g.next)}`}`}
                          aria-label={`Winners of these two matches meet in ${g.next === 'final' ? 'the Final' : `match ${koMatchNumber(g.next)}`}`}
                        >
                          {nextNum}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
