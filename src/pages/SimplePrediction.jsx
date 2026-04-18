/**
 * SimplePrediction
 *
 * Wizard page for Simple Mode predictions. Steps:
 *   1. Group stage — rank 4 teams in each of 12 groups via drag-and-drop
 *   2. Best third — pick 8 of 12 third-place teams to advance
 *   3. Bracket — pick winners round by round (Phase 3)
 *
 * Autosaves to /simplePredictions/{userId} with 1s debounce. A "Saved ✓"
 * indicator briefly appears after each successful save. Partial submissions
 * are allowed — the scoring engine handles them with an adjusted denominator.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { ArrowLeft, ArrowRight, Check, AlertTriangle } from 'lucide-react';
import StepProgress from '../components/simple/StepProgress';
import GroupGrid from '../components/simple/GroupGrid';
import BestThirdSelector from '../components/simple/BestThirdSelector';
import BracketMobile from '../components/simple/BracketMobile';
import BracketDesktop from '../components/simple/BracketDesktop';
import useSimplePrediction from '../hooks/useSimplePrediction';
import useGroupPredictions from '../hooks/useGroupPredictions';
import useBestThird, { BEST_THIRD_REQUIRED } from '../hooks/useBestThird';
import useBracketState from '../hooks/useBracketState';
import useBracketLayout from '../hooks/useBracketLayout';
import { GROUPS, areGroupRankingsComplete, emptyKnockoutPredictions } from '../utils/bracketUtils';
import WORLD_CUP_MATCHES from '../data/matches';
import { isPredictionLocked } from '../utils/points';

const SAVED_INDICATOR_MS = 2000;

export default function SimplePrediction({ userId, league, onExit, embedded = false }) {
  const { data, loading, saving, savedAt, error, save } = useSimplePrediction(userId);
  const [step, setStep] = useState(1);
  const [showSaved, setShowSaved] = useState(false);

  const groups = useGroupPredictions(data?.groupPredictions);
  const bestThird = useBestThird(data?.bestThirdPicks);
  const layout = useBracketLayout();

  // Lookup table for kickoff-based locking on knockout matches.
  const matchLookup = useMemo(() => {
    const out = {};
    for (const m of WORLD_CUP_MATCHES) out[m.id] = m;
    return out;
  }, []);

  const isMatchLocked = useCallback((matchId) => {
    const m = matchLookup[matchId];
    if (!m) return false;
    return isPredictionLocked(m.date, m.time);
  }, [matchLookup]);

  const bracketState = useBracketState({
    groupPredictions: groups.predictions,
    bestThirdPicks: bestThird.picks,
    knockoutPredictions: data?.knockoutPredictions,
    onChange: (next) => save({ knockoutPredictions: next }),
  });

  // Briefly flash "Saved ✓" after each successful save
  useEffect(() => {
    if (!savedAt) return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), SAVED_INDICATOR_MS);
    return () => clearTimeout(t);
  }, [savedAt]);

  // Debounced autosave on group ranking changes (after any user interaction)
  useEffect(() => {
    if (loading || groups.touchedCount === 0) return;
    save({ groupPredictions: groups.predictions });
  }, [groups.predictions, groups.touchedCount, loading, save]);

  // Autosave best-third selection
  useEffect(() => {
    if (loading) return;
    save({ bestThirdPicks: bestThird.picks });
  }, [bestThird.picks, loading, save]);

  const step1Complete = groups.allTouched;
  const step2Complete = bestThird.isComplete;

  const completedSteps = useMemo(() => {
    const done = [];
    if (step1Complete) done.push(1);
    if (step2Complete) done.push(2);
    return done;
  }, [step1Complete, step2Complete]);

  const goToStep = useCallback((nextStep) => {
    setStep(nextStep);
    window.scrollTo(0, 0);
  }, []);

  const handleStepClick = useCallback((s) => {
    // Warn if changing group rankings would invalidate downstream knockout picks
    const hasKnockoutPicks = data?.knockoutPredictions && Object.values(data.knockoutPredictions)
      .some((arr) => Array.isArray(arr) && arr.length > 0);
    if (s === 1 && step === 3 && hasKnockoutPicks) {
      const ok = window.confirm('Changing group rankings will reset your knockout predictions. Continue?');
      if (!ok) return;
      save({ knockoutPredictions: emptyKnockoutPredictions() });
    }
    goToStep(s);
  }, [data, step, save, goToStep]);

  if (loading) {
    return (
      <div className="simple-page">
        <div className="simple-skeleton">
          <div className="simple-skeleton-steps" />
          <div className="simple-skeleton-grid" />
        </div>
      </div>
    );
  }

  return (
    <div className={`simple-page${embedded ? ' simple-page-embedded' : ''}`}>
      {!embedded && (
        <div className="simple-page-header">
          <button type="button" className="btn btn-ghost" onClick={onExit} aria-label="Back">
            <ArrowLeft size={16} /> Back
          </button>
          <div className="simple-page-title">
            <h1>{league?.name || 'Simple Mode'}</h1>
            <span className="simple-page-subtitle">Predict rankings, not scores</span>
          </div>
          <div className="simple-page-status" aria-live="polite">
            {error && <span className="simple-page-error"><AlertTriangle size={14} /> {error}</span>}
            {!error && saving && <span className="simple-page-saving">Saving…</span>}
            {!error && !saving && showSaved && (
              <span className="simple-page-saved"><Check size={14} /> Saved</span>
            )}
          </div>
        </div>
      )}
      {embedded && (
        <div className="simple-page-status-inline" aria-live="polite">
          {error && <span className="simple-page-error"><AlertTriangle size={14} /> {error}</span>}
          {!error && saving && <span className="simple-page-saving">Saving…</span>}
          {!error && !saving && showSaved && (
            <span className="simple-page-saved"><Check size={14} /> Saved</span>
          )}
        </div>
      )}

      <StepProgress current={step} completed={completedSteps} onStepClick={handleStepClick} />

      {step === 1 && (
        <section className="simple-step-section">
          <div className="simple-step-intro">
            <h2>Step 1 — Rank each group</h2>
            <p>Drag teams to order them 1st through 4th in each of the 12 groups.</p>
          </div>

          <GroupGrid
            predictions={groups.predictions}
            touched={groups.touched}
            flags={groups.flags}
            touchedCount={groups.touchedCount}
            onReorder={groups.setRanking}
          />

          <div className="simple-step-nav">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => goToStep(2)}
              disabled={!step1Complete}
            >
              Save &amp; Continue <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="simple-step-section">
          <div className="simple-step-intro">
            <h2>Step 2 — Pick best third-place teams</h2>
            <p>Select exactly {BEST_THIRD_REQUIRED} of the 12 third-place teams to advance.</p>
          </div>

          <BestThirdSelector
            groupPredictions={groups.predictions}
            flags={groups.flags}
            picks={bestThird.picks}
            isFull={bestThird.isFull}
            onToggle={bestThird.toggle}
          />

          <div className="simple-step-nav simple-step-nav-split">
            <button type="button" className="btn btn-secondary" onClick={() => goToStep(1)}>
              <ArrowLeft size={16} /> Back to groups
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => goToStep(3)}
              disabled={!step2Complete}
            >
              Save &amp; Continue <ArrowRight size={16} />
            </button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="simple-step-section">
          <div className="simple-step-intro">
            <h2>Step 3 — Knockout bracket</h2>
            <p>Pick the winner of each match. The bracket fills forward as you go.</p>
          </div>

          {layout === 'desktop' ? (
            <BracketDesktop
              bracket={bracketState.bracket}
              pickWinner={bracketState.pickWinner}
              isMatchLocked={isMatchLocked}
            />
          ) : (
            <BracketMobile
              bracket={bracketState.bracket}
              pickWinner={bracketState.pickWinner}
              isRoundComplete={bracketState.isRoundComplete}
              isRoundUnlocked={bracketState.isRoundUnlocked}
              isMatchLocked={isMatchLocked}
            />
          )}

          <div className="simple-step-nav simple-step-nav-split">
            <button type="button" className="btn btn-secondary" onClick={() => goToStep(2)}>
              <ArrowLeft size={16} /> Back to best third
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => {
              if (window.confirm('Reset all knockout predictions?')) bracketState.resetAll();
            }}>
              Reset bracket
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
