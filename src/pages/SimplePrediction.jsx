/**
 * SimplePrediction
 *
 * Wizard page for Simple Mode predictions, per league. Steps:
 *   1. Group stage — rank 4 teams in each of 12 groups via drag-and-drop
 *   2. Best third — pick 8 of 12 third-place teams to advance
 *   3. Bracket — pick winners round by round
 *
 * Each league keeps its own independent picks at
 * /simplePredictions/{userId}__{leagueId}. The "Copy my existing predictions
 * from the Global League" button clones the user's global-simple picks
 * wholesale into the current league.
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { ArrowLeft, ArrowRight, Check, AlertTriangle, Copy, RotateCcw, RefreshCw } from 'lucide-react';
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
import { GROUPS, ROUND_ORDER, areGroupRankingsComplete, emptyKnockoutPredictions } from '../utils/bracketUtils';
import WORLD_CUP_MATCHES from '../data/matches';
import { isPredictionLocked } from '../utils/points';
import { copySimplePrediction, resetSimplePrediction, getSimplePrediction } from '../utils/db';

const SAVED_INDICATOR_MS = 2000;
const GLOBAL_SIMPLE_ID = 'global-simple';

export default function SimplePrediction({ userId, league, onExit, onComplete, embedded = false }) {
  const { data, loading, saving, savedAt, error, save, saveNow } = useSimplePrediction(userId, league?.id);

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
    <SimplePredictionWizard
      key={league?.id || 'no-league'}
      initialData={data}
      userId={userId}
      league={league}
      onExit={onExit}
      onComplete={onComplete}
      embedded={embedded}
      saving={saving}
      savedAt={savedAt}
      error={error}
      save={save}
      saveNow={saveNow}
    />
  );
}

function SimplePredictionWizard({ initialData, userId, league, onExit, onComplete, embedded, saving, savedAt, error, save, saveNow }) {
  const [step, setStep] = useState(1);
  const [showSaved, setShowSaved] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  // Copy banner: 'prompt' (offer to copy), 'success' (just copied, show reset), null.
  const isGlobalSimple = league?.id === GLOBAL_SIMPLE_ID;
  const hasLocalPicks = !!(initialData && (
    (initialData.groupPredictions && Object.keys(initialData.groupPredictions).length) ||
    (initialData.bestThirdPicks && initialData.bestThirdPicks.length) ||
    (initialData.knockoutPredictions && Object.values(initialData.knockoutPredictions).some(a => Array.isArray(a) && a.length))
  ));
  const [copyBanner, setCopyBanner] = useState(
    !isGlobalSimple && !hasLocalPicks ? 'prompt' : null,
  );

  // Freeze the initial snapshot for hydration. Further snapshots don't
  // re-hydrate — local state is the source of truth after mount.
  const frozenInitial = useRef(initialData).current;

  const groups = useGroupPredictions(frozenInitial?.groupPredictions);
  const bestThird = useBestThird(frozenInitial?.bestThirdPicks);
  const layout = useBracketLayout();

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
    knockoutPredictions: frozenInitial?.knockoutPredictions,
    onChange: (next) => save({ knockoutPredictions: next }),
  });

  useEffect(() => {
    if (!savedAt) return;
    setShowSaved(true);
    const t = setTimeout(() => setShowSaved(false), SAVED_INDICATOR_MS);
    return () => clearTimeout(t);
  }, [savedAt]);

  // Skip the initial fire of these effects (post-hydration) so we don't
  // re-save the just-loaded data on mount.
  const groupsHydrated = useRef(false);
  const bestThirdHydrated = useRef(false);

  useEffect(() => {
    if (groups.touchedCount === 0) return;
    if (!groupsHydrated.current) { groupsHydrated.current = true; return; }
    save({ groupPredictions: groups.predictions });
  }, [groups.predictions, groups.touchedCount, save]);

  useEffect(() => {
    if (!bestThirdHydrated.current) { bestThirdHydrated.current = true; return; }
    save({ bestThirdPicks: bestThird.picks });
  }, [bestThird.picks, save]);

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
    const hasKnockoutPicks = Object.keys(bracketState.picksByMatchId).length > 0;
    if (s === 1 && step === 3 && hasKnockoutPicks) {
      const ok = window.confirm('Changing group rankings will reset your knockout predictions. Continue?');
      if (!ok) return;
      bracketState.resetAll();
      save({ knockoutPredictions: emptyKnockoutPredictions() });
    }
    goToStep(s);
  }, [bracketState, step, save, goToStep]);

  const handleCopyFromGlobal = useCallback(async () => {
    if (!userId || !league?.id || league.id === GLOBAL_SIMPLE_ID) return;
    setCopyBusy(true);
    try {
      const globalSnap = await getSimplePrediction(userId, GLOBAL_SIMPLE_ID);
      if (!globalSnap) {
        setCopyBanner(null);
        window.alert('You haven\u2019t made any Global Simple picks yet. Start predicting here to seed your first set.');
        return;
      }
      await copySimplePrediction(userId, GLOBAL_SIMPLE_ID, league.id);
      setCopyBanner('success');
      // Reload the page after a short delay so every hook rehydrates from the
      // freshly copied doc (groups, best third, bracket state).
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      window.alert(e?.message || 'Copy failed');
    } finally {
      setCopyBusy(false);
    }
  }, [userId, league?.id]);

  const handleResetAll = useCallback(async () => {
    if (!userId || !league?.id) return;
    if (!window.confirm(`Reset all predictions for ${league.name || 'this league'}? This can't be undone.`)) return;
    setCopyBusy(true);
    try {
      await resetSimplePrediction(userId, league.id);
      setCopyBanner('prompt');
      setTimeout(() => window.location.reload(), 400);
    } catch (e) {
      window.alert(e?.message || 'Reset failed');
    } finally {
      setCopyBusy(false);
    }
  }, [userId, league?.id, league?.name]);

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

      {!isGlobalSimple && copyBanner === 'prompt' && (
        <div className="copy-banner copy-banner-prompt">
          <div className="copy-banner-body">
            <Copy size={16} />
            <div>
              <strong>Start fresh or copy your Global picks?</strong>
              <span>Every league keeps its own predictions. Pull in what you already submitted in the Global League to save time.</span>
            </div>
          </div>
          <div className="copy-banner-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCopyBanner(null)}>Predict fresh</button>
            <button type="button" className="btn btn-primary btn-sm" onClick={handleCopyFromGlobal} disabled={copyBusy}>
              {copyBusy ? <><RefreshCw size={14} className="spin" /> Copying...</> : <><Copy size={14} /> Copy Global picks</>}
            </button>
          </div>
        </div>
      )}
      {!isGlobalSimple && copyBanner === 'success' && (
        <div className="copy-banner copy-banner-success">
          <div className="copy-banner-body">
            <Check size={16} />
            <div>
              <strong>Predictions submitted for {league?.name || 'this league'}</strong>
              <span>Copied from your Global Simple picks. You can still edit any step below.</span>
            </div>
          </div>
          <div className="copy-banner-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetAll} disabled={copyBusy}>
              {copyBusy ? <><RefreshCw size={14} className="spin" /> Resetting...</> : <><RotateCcw size={14} /> Reset my picks</>}
            </button>
          </div>
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
              matchLookup={matchLookup}
            />
          ) : (
            <BracketMobile
              bracket={bracketState.bracket}
              pickWinner={bracketState.pickWinner}
              isRoundComplete={bracketState.isRoundComplete}
              isRoundUnlocked={bracketState.isRoundUnlocked}
              isMatchLocked={isMatchLocked}
              matchLookup={matchLookup}
            />
          )}

          <div className="simple-step-nav simple-step-nav-split">
            <button type="button" className="btn btn-secondary" onClick={() => goToStep(2)}>
              <ArrowLeft size={16} /> Back to best third
            </button>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-ghost" onClick={() => {
                if (window.confirm('Reset all knockout predictions?')) {
                  bracketState.resetAll();
                  save({ knockoutPredictions: emptyKnockoutPredictions() });
                }
              }}>
                Reset bracket
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={async () => {
                  const allComplete = step1Complete && step2Complete && ROUND_ORDER.every(r => bracketState.isRoundComplete(r));
                  if (allComplete) {
                    await saveNow({ isComplete: true });
                  }
                  if (onComplete) onComplete();
                  else if (onExit) onExit();
                }}
              >
                Continue <ArrowRight size={16} />
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
