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
import { ArrowLeft, ArrowRight, Check, AlertTriangle, Copy, RotateCcw, RefreshCw, Sparkles } from 'lucide-react';
import StepProgress from '../components/simple/StepProgress';
import GroupGrid from '../components/simple/GroupGrid';
import QuickPicksScoringPanel from '../components/simple/QuickPicksScoringPanel';
import ScrollDownNudge from '../components/simple/ScrollDownNudge';
import BestThirdSelector from '../components/simple/BestThirdSelector';
import BracketMobile from '../components/simple/BracketMobile';
import BracketDesktop from '../components/simple/BracketDesktop';
import RarityCard from '../components/simple/RarityCard';
import CompletionCelebration from '../components/simple/CompletionCelebration';
import WizardCoachmarks, { hasSeenWizardTutorial } from '../components/onboarding/WizardCoachmarks';
import useSimplePrediction from '../hooks/useSimplePrediction';
import useGroupPredictions from '../hooks/useGroupPredictions';
import useBestThird, { BEST_THIRD_REQUIRED } from '../hooks/useBestThird';
import useBracketState from '../hooks/useBracketState';
import useBracketLayout from '../hooks/useBracketLayout';
import { GROUPS, ROUND_ORDER, areGroupRankingsComplete, emptyKnockoutPredictions } from '../utils/bracketUtils';
import WORLD_CUP_MATCHES from '../data/matches';
import { isMatchStageLocked } from '../utils/stageLock';
import { copySimplePrediction, resetSimplePrediction, getSimplePrediction, getSimpleConsensus } from '../utils/db';

const SAVED_INDICATOR_MS = 2000;
const GLOBAL_SIMPLE_ID = 'global-simple';

export default function SimplePrediction({ userId, league, onExit, onComplete, onShareBracket, displayName, embedded = false }) {
  const { data, loading, saving, savedAt, error, save, saveNow } = useSimplePrediction(userId, league?.id);
  // Bumping this key remounts the wizard so its frozen-initial hooks
  // rehydrate from the latest subscription data (used after copy / reset).
  const [rehydrateKey, setRehydrateKey] = useState(0);
  // After certain rehydrations we want the wizard to mount at a specific
  // step — e.g. after copying Global picks, jump straight to the bracket
  // so the user can confirm + submit their Final winner.
  const [initialStep, setInitialStep] = useState(1);
  const triggerRehydrate = useCallback((opts = {}) => {
    if (opts.openStep) setInitialStep(opts.openStep);
    setRehydrateKey(k => k + 1);
  }, []);

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
      key={`${league?.id || 'no-league'}:${rehydrateKey}`}
      initialData={data}
      initialStep={initialStep}
      userId={userId}
      league={league}
      onExit={onExit}
      onComplete={onComplete}
      onShareBracket={onShareBracket}
      displayName={displayName}
      embedded={embedded}
      saving={saving}
      savedAt={savedAt}
      error={error}
      save={save}
      saveNow={saveNow}
      onRehydrate={triggerRehydrate}
    />
  );
}

const BRACKET_HINT_KEY = 'goaloracle_qp_bracket_hint_dismissed';

function SimplePredictionWizard({ initialData, initialStep = 1, userId, league, onExit, onComplete, onShareBracket, displayName, embedded, saving, savedAt, error, save, saveNow, onRehydrate }) {
  const [step, setStep] = useState(initialStep);
  const [showSaved, setShowSaved] = useState(false);
  const [copyBusy, setCopyBusy] = useState(false);
  // Crowd consensus for the active league. Lazy-fetched the first time
  // the user reaches Step 3 (the bracket) — Step 1/2 don't surface
  // consensus, no need to pay the round-trip up front. The wrapper
  // memoizes per-leagueId so this won't re-fetch within the cache TTL.
  const [consensus, setConsensus] = useState(null);
  useEffect(() => {
    if (step !== 3) return;
    if (consensus) return;
    if (!league?.id) return;
    let cancelled = false;
    getSimpleConsensus(league.id)
      .then((data) => { if (!cancelled) setConsensus(data); })
      .catch(() => { /* non-fatal — bars just won't render */ });
    return () => { cancelled = true; };
  }, [step, league?.id, consensus]);
  const [bracketHintVisible, setBracketHintVisible] = useState(() => {
    try { return localStorage.getItem(BRACKET_HINT_KEY) !== '1'; } catch { return true; }
  });
  const [cascadeToast, setCascadeToast] = useState(null);
  const cascadeToastTimer = useRef(null);
  const bracketHintTimer = useRef(null);
  const dismissBracketHint = useCallback(() => {
    setBracketHintVisible(false);
    try { localStorage.setItem(BRACKET_HINT_KEY, '1'); } catch {}
  }, []);

  // Auto-dismiss the bracket hint 4s after the user lands on Step 3.
  useEffect(() => {
    if (step !== 3 || !bracketHintVisible) return;
    if (bracketHintTimer.current) clearTimeout(bracketHintTimer.current);
    bracketHintTimer.current = setTimeout(() => dismissBracketHint(), 4000);
    return () => { if (bracketHintTimer.current) clearTimeout(bracketHintTimer.current); };
  }, [step, bracketHintVisible, dismissBracketHint]);
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

  // Stage-based lock: every match in a stage freezes simultaneously when the
  // first match of that stage kicks off (5-min buffer). Lets users keep
  // editing later-stage picks even after earlier stages have started.
  const isMatchLocked = useCallback((matchId) => isMatchStageLocked(matchId), []);

  // Track whether the bracket was already complete on hydration so we
  // don't show the "you finished!" celebration to users returning to an
  // already-complete bracket (only on the false → true transition).
  const wasCompleteOnLoadRef = useRef(!!frozenInitial?.isComplete);
  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [celebrationChampion, setCelebrationChampion] = useState({ name: null, flag: null });

  // #6 — First-visit coach overlay. Only shows when a user hasn't dismissed
  // it yet AND they don't already have picks (so existing users in the
  // middle of editing their bracket don't get nagged). One-shot per browser.
  const [coachVisible, setCoachVisible] = useState(() => {
    if (hasSeenWizardTutorial()) return false;
    if (frozenInitial?.isComplete) return false;
    return true;
  });

  const bracketState = useBracketState({
    groupPredictions: groups.predictions,
    bestThirdPicks: bestThird.picks,
    knockoutPredictions: frozenInitial?.knockoutPredictions,
    onChange: (next) => {
      // Treat picking the Final winner as the user finishing their
      // bracket — leaderboards key off isComplete and we don't want
      // users to stay in "In progress" forever just because they
      // skipped the 3rd-Place match.
      const finalPick = next?.final?.[0];
      const finalPicked = !!finalPick?.winnerId;
      save({ knockoutPredictions: next, isComplete: finalPicked });

      // Celebration: only when this save is the moment the bracket
      // BECOMES complete. Skip if the user already had isComplete=true
      // when the wizard mounted (they're just editing).
      if (finalPicked && !wasCompleteOnLoadRef.current && !celebrationOpen) {
        wasCompleteOnLoadRef.current = true; // don't fire again this session
        setCelebrationChampion({
          name: finalPick.winnerId || null,
          flag: finalPick.winnerFlag || null,
        });
        setCelebrationOpen(true);
      }
    },
  });

  // Wrap pickWinner so the wizard can: (1) dismiss the first-visit hint
  // tooltip, (2) surface a toast when changing an upstream pick wipes
  // downstream rounds, so the user understands why bracket cells they
  // already filled went blank.
  const pickWinnerWithFeedback = useCallback((matchId, winnerTeam) => {
    const result = bracketState.pickWinner(matchId, winnerTeam) || {};
    if (bracketHintVisible) dismissBracketHint();
    if (result.cleared > 0) {
      if (cascadeToastTimer.current) clearTimeout(cascadeToastTimer.current);
      setCascadeToast(`Pick updated — ${result.cleared} dependent pick${result.cleared === 1 ? '' : 's'} reset.`);
      cascadeToastTimer.current = setTimeout(() => setCascadeToast(null), 3500);
    }
    return result;
  }, [bracketState, bracketHintVisible, dismissBracketHint]);

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

  // Submit/save handler used by both the top and bottom Save & finish
  // buttons on Step 3. Bails out if the Final isn't picked yet, and
  // warns (without blocking) if the 3rd-place playoff is empty —
  // it's worth 5 points and easy to miss after picking the Final.
  const handleFinish = useCallback(async () => {
    if (!bracketState.isRoundComplete('final')) return;
    const thirdPlacePicked = bracketState.isRoundComplete('thirdPlace');
    if (!thirdPlacePicked) {
      const ok = window.confirm(
        'You haven’t picked a winner for the 3rd-place playoff (worth 5 pts). Submit anyway?',
      );
      if (!ok) return;
    }
    const allComplete = step1Complete && step2Complete && ROUND_ORDER.every(r => bracketState.isRoundComplete(r));
    if (allComplete) {
      await saveNow({ isComplete: true });
    }
    if (onComplete) onComplete();
    else if (onExit) onExit();
  }, [bracketState, step1Complete, step2Complete, saveNow, onComplete, onExit]);

  const completedSteps = useMemo(() => {
    const done = [];
    if (step1Complete) done.push(1);
    if (step2Complete) done.push(2);
    return done;
  }, [step1Complete, step2Complete]);

  const goToStep = useCallback((nextStep) => {
    setStep(nextStep);
  }, []);

  // Scroll to top whenever the step changes. Doing this in an effect
  // (rather than inside goToStep alongside setStep) guarantees the
  // new step's DOM is in place before we scroll — on iOS Safari a
  // synchronous window.scrollTo inside the click handler runs against
  // the old, taller layout and the layout shift to the shorter next
  // step landed the user at the bottom of the page instead of the top.
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [step]);

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
      // Wait briefly for the Firestore subscription to deliver the freshly
      // copied doc, then remount the wizard on Step 3 so the user can
      // confirm + submit their Final winner without scrolling back through
      // groups + best-thirds they already filled in the Global league.
      setTimeout(() => onRehydrate && onRehydrate({ openStep: 3 }), 400);
    } catch (e) {
      window.alert(e?.message || 'Copy failed');
    } finally {
      setCopyBusy(false);
    }
  }, [userId, league?.id, onRehydrate]);

  // Live "does the user have any picks here yet?" \u2014 drives the label
  // on the Global-copy button (Replace vs Copy) and whether we need
  // a destructive confirmation step.
  const hasAnyPicks = useMemo(
    () =>
      groups.touchedCount > 0
        || bestThird.picks.length > 0
        || Object.keys(bracketState.picksByMatchId || {}).length > 0,
    [groups.touchedCount, bestThird.picks.length, bracketState.picksByMatchId],
  );

  // #13 — Welcome-back banner. Computed from hydrated initial picks (not
  // current state) so it reflects "what they had when they arrived". Hidden
  // for first-time users and for already-complete brackets.
  const [welcomeBackDismissed, setWelcomeBackDismissed] = useState(false);
  const initialHadPicks = useMemo(() => {
    if (!frozenInitial) return false;
    const groupCount = Object.keys(frozenInitial.groupPredictions || {}).length;
    const thirdCount = (frozenInitial.bestThirdPicks || []).length;
    const koCount = Object.values(frozenInitial.knockoutPredictions || {})
      .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.filter(Boolean).length : 0), 0);
    return groupCount + thirdCount + koCount > 0;
  }, [frozenInitial]);
  const welcomeBackProgress = useMemo(() => {
    const made = Math.min(52,
      (frozenInitial?.groupPredictions ? Object.values(frozenInitial.groupPredictions).filter(g => Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)).length : 0)
      + Math.min(8, (frozenInitial?.bestThirdPicks || []).length)
      + Object.values(frozenInitial?.knockoutPredictions || {})
        .reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.filter(p => p?.winnerId).length : 0), 0)
    );
    const sectionLabel = step === 1 ? 'Group rankings'
      : step === 2 ? 'Best 3rd-place picks'
      : 'the bracket';
    return { made, total: 52, sectionLabel };
  }, [frozenInitial, step]);
  const welcomeBackVisible = !welcomeBackDismissed
    && initialHadPicks
    && !frozenInitial?.isComplete
    && copyBanner !== 'prompt';

  const handleReplaceFromGlobal = useCallback(async () => {
    if (hasAnyPicks) {
      const ok = window.confirm(
        'Replace all of your current picks with your Global league picks?\n\n'
        + 'This will overwrite your group rankings, best-thirds, and bracket for this league.\n\n'
        + 'This can\u2019t be undone.',
      );
      if (!ok) return;
    }
    await handleCopyFromGlobal();
  }, [hasAnyPicks, handleCopyFromGlobal]);

  const handleResetAll = useCallback(async () => {
    if (!userId || !league?.id) return;
    const leagueLabel = league.name || 'this league';
    const ok = window.confirm(
      `Reset ALL your picks for "${leagueLabel}"?\n\n`
      + `This will clear your group rankings, best-third selections, and full knockout bracket.\n\n`
      + `This can't be undone.`,
    );
    if (!ok) return;
    setCopyBusy(true);
    try {
      await resetSimplePrediction(userId, league.id);
      setCopyBanner('prompt');
      setTimeout(() => onRehydrate && onRehydrate(), 400);
    } catch (e) {
      window.alert(e?.message || 'Reset failed');
    } finally {
      setCopyBusy(false);
    }
  }, [userId, league?.id, league?.name, onRehydrate]);

  return (
    <div className={`simple-page${embedded ? ' simple-page-embedded' : ''}`}>
      {!embedded && (
        <div className="simple-page-header">
          <button type="button" className="btn-back-sm btn-back-sm-named" onClick={onExit} aria-label="Back to leagues">
            <ArrowLeft size={14} /> <span>Leagues</span>
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
            {!isGlobalSimple && copyBanner !== 'prompt' && (
              <button
                type="button"
                className="btn btn-ghost btn-sm simple-page-replace-global"
                onClick={handleReplaceFromGlobal}
                disabled={copyBusy}
                title={hasAnyPicks ? 'Overwrite my picks here with my Global league picks' : 'Use my Global league picks here'}
              >
                {copyBusy ? <RefreshCw size={13} className="spin" /> : <Copy size={13} />}
                {' '}
                {copyBusy ? 'Copying…' : (hasAnyPicks ? 'Replace with Global picks' : 'Copy Global picks')}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-sm simple-page-reset"
              onClick={handleResetAll}
              disabled={copyBusy}
              title="Reset all of my predictions for this league"
            >
              {copyBusy ? <RefreshCw size={13} className="spin" /> : <RotateCcw size={13} />} Reset my picks
            </button>
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
          {!isGlobalSimple && copyBanner !== 'prompt' && (
            <button
              type="button"
              className="btn btn-ghost btn-sm simple-page-replace-global"
              onClick={handleReplaceFromGlobal}
              disabled={copyBusy}
              title={hasAnyPicks ? 'Overwrite my picks here with my Global league picks' : 'Use my Global league picks here'}
            >
              {copyBusy ? <RefreshCw size={13} className="spin" /> : <Copy size={13} />}
              {' '}
              {copyBusy ? 'Copying…' : (hasAnyPicks ? 'Replace with Global picks' : 'Copy Global picks')}
            </button>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm simple-page-reset"
            onClick={handleResetAll}
            disabled={copyBusy}
            title="Reset all of my predictions for this league"
          >
            {copyBusy ? <RefreshCw size={13} className="spin" /> : <RotateCcw size={13} />} Reset my picks
          </button>
        </div>
      )}

      {/* First-visit gate: when the user has just joined a private league
          and has no local picks yet, ask them up-front whether to copy
          their Global bracket or start fresh. We hide the rest of the
          wizard chrome so this is the only thing on screen. */}
      {!isGlobalSimple && copyBanner === 'prompt' && (
        <div className="copy-gate">
          <div className="copy-gate-card">
            <div className="copy-gate-icon" aria-hidden="true"><Copy size={24} /></div>
            <h2 className="copy-gate-title">How do you want to predict {league?.name || 'this league'}?</h2>
            <p className="copy-gate-sub">
              Each league keeps its own bracket. Reuse the picks you already
              made in the Global league, or start a fresh prediction from
              scratch.
            </p>
            <div className="copy-gate-actions">
              <button
                type="button"
                className="copy-gate-option copy-gate-option-copy"
                onClick={handleCopyFromGlobal}
                disabled={copyBusy}
              >
                <Copy size={18} aria-hidden="true" />
                <div>
                  <strong>{copyBusy ? 'Copying…' : 'Copy & submit my Global bracket'}</strong>
                  <span>Brings in your groups, best-thirds, and bracket. You'll only need to confirm your Final winner.</span>
                </div>
              </button>
              <button
                type="button"
                className="copy-gate-option copy-gate-option-fresh"
                onClick={() => setCopyBanner(null)}
                disabled={copyBusy}
              >
                <Sparkles size={18} aria-hidden="true" />
                <div>
                  <strong>Predict fresh for this league</strong>
                  <span>Rank the groups, pick best-thirds, then fill the bracket from scratch.</span>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}
      {!isGlobalSimple && copyBanner === 'success' && (
        <div className="copy-banner copy-banner-success">
          <div className="copy-banner-body">
            <Check size={16} />
            <div>
              <strong>Picks copied — confirm your winner below</strong>
              <span>Your Global bracket is loaded into {league?.name || 'this league'}. Pick the Final winner to lock it in, or edit any earlier round.</span>
            </div>
          </div>
          <div className="copy-banner-actions">
            <button type="button" className="btn btn-ghost btn-sm" onClick={handleResetAll} disabled={copyBusy}>
              {copyBusy ? <><RefreshCw size={14} className="spin" /> Resetting...</> : <><RotateCcw size={14} /> Reset my picks</>}
            </button>
          </div>
        </div>
      )}

      {/* #13 — Welcome-back banner. Visible when the user has saved picks
          but the bracket isn't complete. Single-fire per session via the
          dismissed flag below. */}
      {welcomeBackVisible && (
        <div className="simple-welcome-back" role="status">
          <div className="simple-welcome-back-text">
            <strong>Welcome back{displayName ? `, ${displayName}` : ''}.</strong>
            <span className="simple-welcome-back-sub"> {welcomeBackProgress.made}/{welcomeBackProgress.total} picks done — picking up on <em>{welcomeBackProgress.sectionLabel}</em>.</span>
          </div>
          <button type="button" className="simple-welcome-back-dismiss" onClick={() => setWelcomeBackDismissed(true)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {copyBanner !== 'prompt' && (
        <StepProgress current={step} completed={completedSteps} onStepClick={handleStepClick} />
      )}

      {copyBanner !== 'prompt' && step === 1 && (
        <section className="simple-step-section">
          <div className="simple-step-intro">
            <h2>Step 1 — Rank each group</h2>
            <p>Drag teams to order them 1st through 4th in each of the 12 groups, then tap <strong>Confirm ranking</strong> on each card.</p>
          </div>

          <QuickPicksScoringPanel />

          <ScrollDownNudge label="Scroll down to rank each group" />

          <div className="simple-step-nav simple-step-nav-top">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => goToStep(2)}
              disabled={!step1Complete}
              aria-label={step1Complete
                ? 'Save and continue to best third-place teams'
                : `Finish ${GROUPS.length - groups.touchedCount} more group${GROUPS.length - groups.touchedCount === 1 ? '' : 's'} to continue`}
            >
              {step1Complete
                ? <>Save &amp; Continue <ArrowRight size={16} /></>
                : <>Finish all {GROUPS.length} groups to continue</>}
            </button>
          </div>

          <GroupGrid
            predictions={groups.predictions}
            touched={groups.touched}
            flags={groups.flags}
            touchedCount={groups.touchedCount}
            onReorder={groups.setRanking}
            onConfirm={groups.confirm}
            onUnconfirm={groups.unconfirm}
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

      {copyBanner !== 'prompt' && step === 2 && (
        <section className="simple-step-section">
          <div className="simple-step-intro">
            <h2>Step 2 — Pick best third-place teams</h2>
            <p>Select exactly {BEST_THIRD_REQUIRED} of the 12 third-place teams to advance.</p>
          </div>

          <div className="simple-step-nav simple-step-nav-top simple-step-nav-split">
            <button type="button" className="btn btn-secondary" onClick={() => goToStep(1)}>
              <ArrowLeft size={16} /> Back
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => goToStep(3)}
              disabled={!step2Complete}
            >
              {step2Complete
                ? <>Save &amp; Continue <ArrowRight size={16} /></>
                : <>Pick {BEST_THIRD_REQUIRED - bestThird.picks.length} more to continue</>}
            </button>
          </div>

          <BestThirdSelector
            groupPredictions={groups.predictions}
            flags={groups.flags}
            picks={bestThird.picks}
            isFull={bestThird.isFull}
            onToggle={bestThird.toggle}
            onSetPicks={bestThird.setAll}
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

      {copyBanner !== 'prompt' && step === 3 && (
        <section className="simple-step-section">
          <div className="simple-step-intro">
            <div className="simple-step-intro-head">
              <h2>Step 3 — Knockouts</h2>
              <span className="simple-bracket-save-pill" aria-live="polite">
                {error ? (
                  <><AlertTriangle size={14} /> Save failed</>
                ) : saving ? (
                  <>Saving…</>
                ) : savedAt ? (
                  <><Check size={14} /> All picks saved</>
                ) : (
                  <>Picks auto-save</>
                )}
              </span>
            </div>
            <p>Pick the winner of each match. The bracket fills forward as you go.</p>
          </div>

          {/* Top nav mirror — the bracket is tall on desktop, so the user
              shouldn't have to scroll all the way down to find the
              Save & finish button. Reset stays at the bottom only. */}
          <div className="simple-step-nav simple-step-nav-top simple-step-nav-split">
            <button type="button" className="btn btn-secondary" onClick={() => goToStep(2)}>
              <ArrowLeft size={16} /> Back
            </button>
            {(() => {
              const finalPicked = bracketState.isRoundComplete('final');
              return (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!finalPicked}
                  aria-label={finalPicked ? 'Save and finish' : 'Pick the Final winner to continue'}
                  onClick={handleFinish}
                >
                  {finalPicked
                    ? <>Save &amp; finish <ArrowRight size={16} /></>
                    : <>Pick the Final winner</>}
                </button>
              );
            })()}
          </div>

          {layout === 'desktop' ? (
            <BracketDesktop
              bracket={bracketState.bracket}
              pickWinner={pickWinnerWithFeedback}
              isMatchLocked={isMatchLocked}
              matchLookup={matchLookup}
              showHint={bracketHintVisible}
              onDismissHint={dismissBracketHint}
              consensus={consensus?.knockout}
            />
          ) : (
            <BracketMobile
              bracket={bracketState.bracket}
              pickWinner={pickWinnerWithFeedback}
              isRoundComplete={bracketState.isRoundComplete}
              isRoundUnlocked={bracketState.isRoundUnlocked}
              isMatchLocked={isMatchLocked}
              matchLookup={matchLookup}
              showHint={bracketHintVisible}
              onDismissHint={dismissBracketHint}
              consensus={consensus?.knockout}
            />
          )}

          {cascadeToast && (
            <div className="bracket-cascade-toast" role="status" aria-live="polite">
              {cascadeToast}
            </div>
          )}

          {/* Rarity reveal — once the user has picked the Final winner,
              show how unique their bracket is vs the global crowd. The
              card collapses gracefully if consensus is still loading or
              the user is the first to submit. */}
          {(() => {
            const finalSlot = bracketState.bracket?.final?.[0];
            const thirdSlot = bracketState.bracket?.thirdPlace?.[0];
            if (!finalSlot?.pick?.winnerId) return null;
            const winnerId = finalSlot.pick.winnerId;
            const runnerUpId = winnerId === finalSlot.home ? finalSlot.away : finalSlot.home;
            return (
              <RarityCard
                consensus={consensus}
                champion={winnerId}
                runnerUp={runnerUpId}
                thirdPlace={thirdSlot?.pick?.winnerId || null}
              />
            );
          })()}

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
              {(() => {
                // Block Continue until the user has actually picked the
                // tournament winner (the Final). Picking the Final
                // implies every upstream round is filled (each match
                // feeds the next), so this single check covers R32 →
                // Final completeness. The 3rd-place playoff isn't
                // required, but `handleFinish` will warn the user
                // before submitting if it's empty (worth 5 pts).
                const finalPicked = bracketState.isRoundComplete('final');
                return (
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={!finalPicked}
                    aria-label={finalPicked ? 'Save and finish' : 'Pick the Final winner to continue'}
                    onClick={handleFinish}
                  >
                    {finalPicked
                      ? <>Continue <ArrowRight size={16} /></>
                      : <>Pick the Final winner to continue</>}
                  </button>
                );
              })()}
            </div>
          </div>
        </section>
      )}

      {/* #2 — One-time celebration when the user transitions from
          incomplete → complete by picking the Final winner. */}
      <CompletionCelebration
        open={celebrationOpen}
        championName={celebrationChampion.name}
        championFlag={celebrationChampion.flag}
        onShare={onShareBracket}
        onDismiss={() => setCelebrationOpen(false)}
      />

      {/* #6 — First-visit 3-step tutorial. */}
      {coachVisible && <WizardCoachmarks onDismiss={() => setCoachVisible(false)} />}
    </div>
  );
}
