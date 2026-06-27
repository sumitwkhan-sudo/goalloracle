/**
 * BracketDesktop
 *
 * Full tournament bracket tree for screens ≥ 1024px. Left half: R32 matches
 * 1–8 → R16 → QF. Right half: matches 9–16. Center: SF + Final + 3rd Place.
 *
 * SVG connectors link each match to its downstream slot. We use a CSS grid
 * to lay out match cards, then draw the connectors in an absolutely-positioned
 * SVG overlay sized to the grid (recomputed on resize).
 */

import React, { useLayoutEffect, useRef, useState, useMemo, useCallback } from 'react';
import BracketMatch from './BracketMatch';
import BracketHintTooltip from './BracketHintTooltip';
import { KNOCKOUT_POINTS_PER_PICK } from '../../utils/scoringSimple';
import { getRoundForMatchId } from '../../utils/bracketUtils';

// Read-only grading: the actual winner of a knockout match + the points a
// correct pick earns that round. `actualKnockout` is { matchId: { winnerId } }.
// `pickScoreEligible` is false when the user's picked winner wasn't one of the
// teams they predicted to reach the knockouts — a correct pick that scores 0.
// `predictedSet` null (or absent) means no restriction → always eligible.
function gradeKo(actualKnockout, id, winnerId = null, predictedSet = null) {
  return {
    actualWinnerId: (actualKnockout && actualKnockout[id]?.winnerId) || null,
    pointsIfRight: KNOCKOUT_POINTS_PER_PICK[getRoundForMatchId(id)] || 0,
    pickScoreEligible: !predictedSet || !winnerId || predictedSet.has(winnerId),
  };
}

// R32 ids are listed in BRACKET-FLOW ORDER, not numerical order, so that
// each pair of R32 matches sits adjacent in the column and visually feeds
// into the R16 match they actually advance to. With `justify-content:
// space-around` on the column, an 8-item column places adjacent pairs at
// vertical midpoints 1/8, 3/8, 5/8, 7/8 — exactly where the 4 R16 items
// sit. Reordering R32 (rather than fighting it with CSS) is what makes
// the SVG connectors land cleanly. Logical routing in CONNECTIONS below
// is unchanged; only display order is.
const LEFT_SIDE_R32_IDS  = ['r32-01', 'r32-04', 'r32-03', 'r32-06', 'r32-02', 'r32-05', 'r32-07', 'r32-08'];
const RIGHT_SIDE_R32_IDS = ['r32-09', 'r32-10', 'r32-13', 'r32-12', 'r32-15', 'r32-11', 'r32-14', 'r32-16'];
const LEFT_R16_IDS  = ['r16-02', 'r16-01', 'r16-03', 'r16-04'];
const RIGHT_R16_IDS = ['r16-06', 'r16-05', 'r16-07', 'r16-08'];
const LEFT_QF_IDS   = ['qf-01', 'qf-03'];
const RIGHT_QF_IDS  = ['qf-02', 'qf-04'];

const CONNECTIONS = [
  // R32 → R16
  { from: 'r32-01', to: 'r16-02' }, { from: 'r32-04', to: 'r16-02' },
  { from: 'r32-03', to: 'r16-01' }, { from: 'r32-06', to: 'r16-01' },
  { from: 'r32-02', to: 'r16-03' }, { from: 'r32-05', to: 'r16-03' },
  { from: 'r32-07', to: 'r16-04' }, { from: 'r32-08', to: 'r16-04' },
  { from: 'r32-13', to: 'r16-05' }, { from: 'r32-12', to: 'r16-05' },
  { from: 'r32-09', to: 'r16-06' }, { from: 'r32-10', to: 'r16-06' },
  { from: 'r32-15', to: 'r16-07' }, { from: 'r32-11', to: 'r16-07' },
  { from: 'r32-14', to: 'r16-08' }, { from: 'r32-16', to: 'r16-08' },
  // R16 → QF
  { from: 'r16-01', to: 'qf-01' }, { from: 'r16-02', to: 'qf-01' },
  { from: 'r16-05', to: 'qf-02' }, { from: 'r16-06', to: 'qf-02' },
  { from: 'r16-03', to: 'qf-03' }, { from: 'r16-04', to: 'qf-03' },
  { from: 'r16-07', to: 'qf-04' }, { from: 'r16-08', to: 'qf-04' },
  // QF → SF
  { from: 'qf-01', to: 'sf-01' }, { from: 'qf-02', to: 'sf-01' },
  { from: 'qf-03', to: 'sf-02' }, { from: 'qf-04', to: 'sf-02' },
  // SF → Final + 3rd
  { from: 'sf-01', to: 'final' }, { from: 'sf-02', to: 'final' },
  { from: 'sf-01', to: '3rd' },   { from: 'sf-02', to: '3rd' },
];

// Walk the consensus payload (rounds → matchIds → teams) to find the
// per-team % object for a match. matchIds are unique across rounds so
// we don't need round-keyed callers.
function getMatchConsensus(consensus, matchId) {
  if (!consensus || !matchId) return null;
  for (const round of Object.keys(consensus)) {
    if (consensus[round]?.[matchId]) return consensus[round][matchId];
  }
  return null;
}

function MatchColumn({ title, matchIds, bracket, pickWinner, isMatchLocked, matchRefs, matchLookup, compact = true, hintMatchId, onDismissHint, readOnly = false, consensus, actualKnockout = null, predictedSet = null }) {
  return (
    <div className="bracket-desktop-col">
      {title && <div className="bracket-desktop-col-title">{title}</div>}
      <div className="bracket-desktop-col-body">
        {matchIds.map((id) => {
          const slot = findSlot(bracket, id);
          if (!slot) return null;
          const meta = matchLookup?.[id];
          const needsPick = !!(slot.home && slot.away && !slot.pick?.winnerId);
          const isHintAnchor = hintMatchId && hintMatchId === id;
          // Anchoring guard: only show the consensus bar once the user
          // has picked a winner for this match.
          const showBar = !!slot.pick?.winnerId;
          const cm = showBar ? getMatchConsensus(consensus, id) : null;
          return (
            <div
              key={id}
              className={`bracket-desktop-slot ${isHintAnchor ? 'has-hint' : ''}`}
              ref={(el) => { if (el) matchRefs.current[id] = el; }}
            >
              {isHintAnchor && <BracketHintTooltip onDismiss={onDismissHint} />}
              <BracketMatch
                matchId={id}
                homeTeam={slot.home}
                awayTeam={slot.away}
                homeFlag={slot.homeFlag}
                awayFlag={slot.awayFlag}
                winnerId={slot.pick?.winnerId || null}
                onPick={(team) => pickWinner(id, team)}
                isLocked={isMatchLocked ? isMatchLocked(id) : false}
                size={compact ? 'compact' : 'full'}
                city={meta?.city}
                date={meta?.date}
                needsPick={needsPick}
                readOnly={readOnly}
                homeAdvancePct={cm ? cm[slot.home] : undefined}
                awayAdvancePct={cm ? cm[slot.away] : undefined}
                homeEarned={slot.homeEarned}
                awayEarned={slot.awayEarned}
                {...gradeKo(actualKnockout, id, slot.pick?.winnerId || null, predictedSet)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function findSlot(bracket, matchId) {
  for (const key of Object.keys(bracket)) {
    const m = bracket[key].find((s) => s.matchId === matchId);
    if (m) return m;
  }
  return null;
}

export default function BracketDesktop({ bracket, pickWinner, isMatchLocked, matchLookup, showHint, onDismissHint, readOnly = false, consensus, actualKnockout = null, predictedSet = null }) {
  const hintMatchId = !readOnly && showHint ? 'r32-01' : null;
  const containerRef = useRef(null);
  const matchRefs = useRef({});
  const [paths, setPaths] = useState([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const recalc = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const cRect = container.getBoundingClientRect();
    setSize({ w: container.scrollWidth, h: container.scrollHeight });

    const next = [];
    for (const { from, to } of CONNECTIONS) {
      const fromEl = matchRefs.current[from];
      const toEl = matchRefs.current[to];
      if (!fromEl || !toEl) continue;
      const f = fromEl.getBoundingClientRect();
      const t = toEl.getBoundingClientRect();
      // Figure out direction: from-right → to-left, or vice versa
      const fromOnLeft = f.left < t.left;
      const x1 = (fromOnLeft ? f.right : f.left) - cRect.left + container.scrollLeft;
      const y1 = f.top + f.height / 2 - cRect.top + container.scrollTop;
      const x2 = (fromOnLeft ? t.left : t.right) - cRect.left + container.scrollLeft;
      const y2 = t.top + t.height / 2 - cRect.top + container.scrollTop;
      const mx = (x1 + x2) / 2;
      next.push(`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`);
    }
    setPaths(next);
  }, []);

  useLayoutEffect(() => {
    recalc();
    const ro = new ResizeObserver(recalc);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', recalc);
    return () => { ro.disconnect(); window.removeEventListener('resize', recalc); };
  }, [recalc, bracket]);

  return (
    <div className="bracket-desktop" ref={containerRef}>
      <svg className="bracket-desktop-svg" width={size.w} height={size.h} aria-hidden="true">
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1.5" />
        ))}
      </svg>

      <div className="bracket-desktop-grid">
        <MatchColumn
          title="Round of 32"
          matchIds={LEFT_SIDE_R32_IDS}
          bracket={bracket}
          pickWinner={pickWinner}
          isMatchLocked={isMatchLocked}
          matchRefs={matchRefs}
          matchLookup={matchLookup}
          hintMatchId={hintMatchId}
          onDismissHint={onDismissHint}
          readOnly={readOnly}
          consensus={consensus}
          actualKnockout={actualKnockout}
          predictedSet={predictedSet}
        />
        <MatchColumn
          title="Round of 16"
          matchIds={LEFT_R16_IDS}
          bracket={bracket}
          pickWinner={pickWinner}
          isMatchLocked={isMatchLocked}
          matchRefs={matchRefs}
          matchLookup={matchLookup}
          readOnly={readOnly}
          consensus={consensus}
          actualKnockout={actualKnockout}
          predictedSet={predictedSet}
        />
        <MatchColumn
          title="Quarterfinals"
          matchIds={LEFT_QF_IDS}
          bracket={bracket}
          pickWinner={pickWinner}
          isMatchLocked={isMatchLocked}
          matchRefs={matchRefs}
          matchLookup={matchLookup}
          readOnly={readOnly}
          consensus={consensus}
          actualKnockout={actualKnockout}
          predictedSet={predictedSet}
        />

        <div className="bracket-desktop-center">
          <div className="bracket-desktop-col-title">Semifinals &amp; Final</div>
          <div className="bracket-desktop-center-body">
            <div className="bracket-desktop-slot" ref={(el) => { if (el) matchRefs.current['sf-01'] = el; }}>
              <BracketMatch
                matchId="sf-01"
                {...slotProps(bracket, 'sf-01', consensus)}
                {...gradeKo(actualKnockout, 'sf-01', slotProps(bracket, 'sf-01').winnerId, predictedSet)}
                onPick={(team) => pickWinner('sf-01', team)}
                isLocked={isMatchLocked ? isMatchLocked('sf-01') : false}
                size="compact"
                city={matchLookup?.['sf-01']?.city}
                date={matchLookup?.['sf-01']?.date}
                needsPick={!!(slotProps(bracket, 'sf-01').homeTeam && slotProps(bracket, 'sf-01').awayTeam && !slotProps(bracket, 'sf-01').winnerId)}
                readOnly={readOnly}
              />
            </div>
            <div className="bracket-desktop-final-slot" ref={(el) => { if (el) matchRefs.current['final'] = el; }}>
              <div className="bracket-desktop-col-title center">Final</div>
              <BracketMatch
                matchId="final"
                {...slotProps(bracket, 'final', consensus)}
                {...gradeKo(actualKnockout, 'final', slotProps(bracket, 'final').winnerId, predictedSet)}
                onPick={(team) => pickWinner('final', team)}
                isLocked={isMatchLocked ? isMatchLocked('final') : false}
                size="compact"
                city={matchLookup?.['final']?.city}
                date={matchLookup?.['final']?.date}
                needsPick={!!(slotProps(bracket, 'final').homeTeam && slotProps(bracket, 'final').awayTeam && !slotProps(bracket, 'final').winnerId)}
                readOnly={readOnly}
              />
            </div>
            <div className="bracket-desktop-slot" ref={(el) => { if (el) matchRefs.current['sf-02'] = el; }}>
              <BracketMatch
                matchId="sf-02"
                {...slotProps(bracket, 'sf-02', consensus)}
                {...gradeKo(actualKnockout, 'sf-02', slotProps(bracket, 'sf-02').winnerId, predictedSet)}
                onPick={(team) => pickWinner('sf-02', team)}
                isLocked={isMatchLocked ? isMatchLocked('sf-02') : false}
                size="compact"
                city={matchLookup?.['sf-02']?.city}
                date={matchLookup?.['sf-02']?.date}
                needsPick={!!(slotProps(bracket, 'sf-02').homeTeam && slotProps(bracket, 'sf-02').awayTeam && !slotProps(bracket, 'sf-02').winnerId)}
                readOnly={readOnly}
              />
            </div>
            <div className="bracket-desktop-third-slot" ref={(el) => { if (el) matchRefs.current['3rd'] = el; }}>
              <div className="bracket-desktop-col-title center">3rd Place</div>
              <BracketMatch
                matchId="3rd"
                {...slotProps(bracket, '3rd', consensus)}
                {...gradeKo(actualKnockout, '3rd', slotProps(bracket, '3rd').winnerId, predictedSet)}
                onPick={(team) => pickWinner('3rd', team)}
                isLocked={isMatchLocked ? isMatchLocked('3rd') : false}
                size="compact"
                city={matchLookup?.['3rd']?.city}
                date={matchLookup?.['3rd']?.date}
                needsPick={!!(slotProps(bracket, '3rd').homeTeam && slotProps(bracket, '3rd').awayTeam && !slotProps(bracket, '3rd').winnerId)}
                readOnly={readOnly}
              />
            </div>
          </div>
        </div>

        <MatchColumn
          title="Quarterfinals"
          matchIds={RIGHT_QF_IDS}
          bracket={bracket}
          pickWinner={pickWinner}
          isMatchLocked={isMatchLocked}
          matchRefs={matchRefs}
          matchLookup={matchLookup}
          readOnly={readOnly}
          consensus={consensus}
          actualKnockout={actualKnockout}
          predictedSet={predictedSet}
        />
        <MatchColumn
          title="Round of 16"
          matchIds={RIGHT_R16_IDS}
          bracket={bracket}
          pickWinner={pickWinner}
          isMatchLocked={isMatchLocked}
          matchRefs={matchRefs}
          matchLookup={matchLookup}
          readOnly={readOnly}
          consensus={consensus}
          actualKnockout={actualKnockout}
          predictedSet={predictedSet}
        />
        <MatchColumn
          title="Round of 32"
          matchIds={RIGHT_SIDE_R32_IDS}
          bracket={bracket}
          pickWinner={pickWinner}
          isMatchLocked={isMatchLocked}
          matchRefs={matchRefs}
          matchLookup={matchLookup}
          readOnly={readOnly}
          consensus={consensus}
          actualKnockout={actualKnockout}
          predictedSet={predictedSet}
        />
      </div>
    </div>
  );
}

function slotProps(bracket, matchId, consensus) {
  const slot = findSlot(bracket, matchId) || {};
  const showBar = !!slot.pick?.winnerId;
  const cm = showBar ? getMatchConsensus(consensus, matchId) : null;
  return {
    homeTeam: slot.home,
    awayTeam: slot.away,
    homeFlag: slot.homeFlag,
    awayFlag: slot.awayFlag,
    winnerId: slot.pick?.winnerId || null,
    homeAdvancePct: cm ? cm[slot.home] : undefined,
    awayAdvancePct: cm ? cm[slot.away] : undefined,
    // Knockout-real-reseed: real teams not in the user's predicted pool are
    // locked. Undefined on rounds without the merge → treated as earned.
    homeEarned: slot.homeEarned,
    awayEarned: slot.awayEarned,
  };
}
