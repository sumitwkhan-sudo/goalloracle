/**
 * BestThirdSelector
 *
 * Step 2 of the Simple Mode wizard. User sees the 12 teams they ranked 3rd
 * in each group and selects exactly 8 to advance. Unselected cards dim once
 * 8 have been chosen.
 */

import React, { useState } from 'react';
import { Check, ChevronDown, ChevronUp, Info } from 'lucide-react';
import { GROUPS } from '../../utils/bracketUtils';
import { FIFA_THIRD_PLACE_CRITERIA } from '../../utils/fifaThirdPlaceRules';
import { BEST_THIRD_REQUIRED } from '../../hooks/useBestThird';

export default function BestThirdSelector({ groupPredictions, flags, picks, isFull, onToggle }) {
  const [showGuide, setShowGuide] = useState(true);

  const thirdPlaceTeams = GROUPS.map((g) => ({
    group: g,
    team: groupPredictions[g]?.ranking?.[2] || null,
  })).filter((x) => x.team);

  const selectedCount = picks.length;
  const counterClass = selectedCount === BEST_THIRD_REQUIRED ? 'counter-complete' : '';

  return (
    <div className="best-third">
      <div className={`best-third-counter ${counterClass}`} aria-live="polite">
        <strong>{BEST_THIRD_REQUIRED} teams advance</strong>
        <span>selected: {selectedCount} / {BEST_THIRD_REQUIRED}</span>
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
          return (
            <button
              key={group}
              type="button"
              className={`best-third-card ${isSelected ? 'selected' : ''} ${isDisabled ? 'disabled' : ''}`}
              onClick={() => onToggle(group)}
              disabled={isDisabled}
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
          );
        })}
      </div>
    </div>
  );
}
