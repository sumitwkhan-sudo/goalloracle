/**
 * BestThirdSelector
 *
 * Step 2 of the Simple Mode wizard. User sees the 12 teams they ranked 3rd
 * in each group and selects exactly 8 to advance. Unselected cards dim once
 * 8 have been chosen.
 */

import React, { useState, useRef } from 'react';
import { Check, ChevronDown, ChevronUp, Info, AlertTriangle, Sparkles } from 'lucide-react';
import { GROUPS } from '../../utils/bracketUtils';
import { FIFA_THIRD_PLACE_CRITERIA } from '../../utils/fifaThirdPlaceRules';
import { BEST_THIRD_REQUIRED } from '../../hooks/useBestThird';
import { thirdPlaceStrength } from '../../utils/pedigree';

export default function BestThirdSelector({ groupPredictions, flags, picks, isFull, onToggle, onSetPicks, readOnly = false }) {
  const [showGuide, setShowGuide] = useState(false);
  const [shakingGroup, setShakingGroup] = useState(null);
  const [showSwapHint, setShowSwapHint] = useState(false);
  const shakeTimer = useRef(null);
  const hintTimer = useRef(null);

  const thirdPlaceTeams = GROUPS.map((g) => ({
    group: g,
    team: groupPredictions[g]?.ranking?.[2] || null,
  })).filter((x) => x.team);

  // Suggest the 8 strongest third-place picks based on World Cup titles +
  // a coarse knockout-pedigree tiebreaker. Stable alphabetical fallback so
  // the same input always produces the same suggestion. Useful as a
  // starting point — users can still adjust by toggling individual cards.
  const suggestEightGroups = () => {
    if (!onSetPicks) return;
    const ranked = [...thirdPlaceTeams].sort((a, b) => {
      const sb = thirdPlaceStrength(b.team) - thirdPlaceStrength(a.team);
      if (sb !== 0) return sb;
      return a.group.localeCompare(b.group);
    });
    onSetPicks(ranked.slice(0, BEST_THIRD_REQUIRED).map(c => c.group));
  };

  const selectedCount = picks.length;
  // Defensive: red guard if somehow over-selected. Cards being disabled
  // when isFull keeps this from happening, but it's a cheap safety net.
  const counterState = selectedCount > BEST_THIRD_REQUIRED ? 'over'
    : selectedCount === BEST_THIRD_REQUIRED ? 'complete'
    : 'progress';

  // Fire the shake when a user taps a disabled (already-full) card. The
  // <button> itself is disabled so we listen on the wrapper via mousedown.
  const handleDisabledTap = (group) => {
    if (shakeTimer.current) clearTimeout(shakeTimer.current);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setShakingGroup(group);
    setShowSwapHint(true);
    shakeTimer.current = setTimeout(() => setShakingGroup(null), 500);
    hintTimer.current = setTimeout(() => setShowSwapHint(false), 2400);
  };

  return (
    <div className="best-third">
      <div className={`best-third-header best-third-header-${counterState}`} role="region" aria-label="Third-place selection summary">
        <div className="best-third-header-text">
          <h3 className="best-third-title">Which {BEST_THIRD_REQUIRED} third-place teams advance?</h3>
          <p className="best-third-subtitle">
            Only {BEST_THIRD_REQUIRED} of the 12 group third-place finishers go through. Select exactly {BEST_THIRD_REQUIRED}.
          </p>
        </div>
        <div className={`best-third-counter best-third-counter-${counterState}`} aria-live="polite">
          {counterState === 'complete' && <Check size={14} aria-hidden="true" />}
          {counterState === 'over' && <AlertTriangle size={14} aria-hidden="true" />}
          <span><strong>{selectedCount}</strong> / {BEST_THIRD_REQUIRED} selected</span>
        </div>
        {onSetPicks && (
          <button
            type="button"
            className="best-third-suggest"
            onClick={suggestEightGroups}
            title="Pre-fill 8 picks based on World Cup pedigree — you can still adjust"
          >
            <Sparkles size={12} aria-hidden="true" />
            <span>{selectedCount === 0 ? 'Suggest 8' : 'Reset suggestion'}</span>
          </button>
        )}
        {showSwapHint && (
          <div className="best-third-swap-hint" role="status">
            Deselect one first to swap.
          </div>
        )}
      </div>

      <div className="best-third-banner">
        <button
          type="button"
          className="best-third-banner-head"
          onClick={() => setShowGuide((v) => !v)}
          aria-expanded={showGuide}
        >
          <Info size={14} />
          <strong>How FIFA decides best third place</strong>
          {showGuide ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {showGuide && (
          <div className="best-third-banner-body">
            <p>FIFA ranks all 12 third-place teams using these criteria in order:</p>
            <ol>
              {FIFA_THIRD_PLACE_CRITERIA.map((c) => <li key={c}>{c}</li>)}
            </ol>
            <p className="best-third-banner-note">
              Historically, 4+ points is usually enough to advance. 3 points is borderline.
            </p>
          </div>
        )}
      </div>

      <div className="best-third-grid">
        {thirdPlaceTeams.map(({ group, team }) => {
          const isSelected = picks.includes(group);
          const isDisabled = !isSelected && isFull;
          const isShaking = shakingGroup === group;
          return (
            <div
              key={group}
              className={`best-third-card-wrap ${isShaking ? 'is-shaking' : ''}`}
              onMouseDown={() => { if (isDisabled) handleDisabledTap(group); }}
              onTouchStart={() => { if (isDisabled) handleDisabledTap(group); }}
            >
              <button
                type="button"
                className={`best-third-card ${isSelected ? 'selected' : ''} ${isDisabled || readOnly ? 'disabled' : ''}`}
                onClick={() => { if (!readOnly) onToggle(group); }}
                disabled={isDisabled || readOnly}
                aria-pressed={isSelected}
              >
                <span className="best-third-flag" aria-hidden="true">{flags[team] || '🏳️'}</span>
                <span className="best-third-team">{team}</span>
                <span className="best-third-group">Group {group}</span>
                {isSelected && (
                  <span className="best-third-check" aria-hidden="true">
                    <Check size={14} />
                  </span>
                )}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
