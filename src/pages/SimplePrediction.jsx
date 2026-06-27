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
import HouseRulesSection from '../components/HouseRulesSection';
import useSimplePrediction from '../hooks/useSimplePrediction';
import useGroupPredictions from '../hooks/useGroupPredictions';
import useBestThird, { BEST_THIRD_REQUIRED } from '../hooks/useBestThird';
import useBracketState from '../hooks/useBracketState';
import useBracketLayout from '../hooks/useBracketLayout';
import { GROUPS, ROUND_ORDER, areGroupRankingsComplete, emptyKnockoutPredictions } from '../utils/bracketUtils';
import { predictedAdvancers } from '../utils/scoringSimple';
import { computeLiveStandings, projectRealR32, eliminatedTeams, mergeLiveScores } from '../utils/liveStandings';
import WORLD_CUP_MATCHES from '../data/matches';
import { isMatchStageLocked, isStageLocked } from '../utils/stageLock';
import { copySimplePrediction, resetSimplePrediction, getSimplePrediction, getSimpleConsensus, fetchActualBracket, fetchLiveScores, subscribeToFeatureFlags, applyGlobalKnockoutToMyLeagues } from '../utils/db';

const SAVED_INDICATOR_MS = 2000;
const GLOBAL_SIMPLE_ID = 'global-simple';

export default function SimplePrediction({ userId, league, onExit, onComplete, onShareBracket, onCelebrate, displayName, embedded = false, isAnonymous = false, onRequireSignup = () => {}, userLeagues = [], results = {} }) {
  const { data, loading, saving, savedAt, error, save, saveNow } = useSimplePrediction(userId, league?.id);
  // Bumping this key remounts the wizard so its frozen-initial hooks
  // rehydrate from the latest subscription data (used after copy / reset).
  const [rehydrateKey, setRehydrateKey] = useState(0);
  // After certain rehydrations we want the wizard to mount at a specific
  // step — e.g. after copying Global picks, jump straight to the bracket
  // so the user can confirm + submit their Final winner.
  const [initialStep, setInitialStep] = useState(1);
  // Optional initial-data override consumed on the next remount. The copy
  // flow passes the freshly-copied payload here so the wizard hydrates from
  // it deterministically instead of racing the Firestore subscription for
  // the just-written doc. Cleared (back to the live subscription `data`) on
  // any rehydrate that doesn't supply one (e.g. reset).
  const [rehydrateInitial, setRehydrateInitial] = useState(null);
  const triggerRehydrate = useCallback((opts = {}) => {
    if (opts.openStep) setInitialStep(opts.openStep);
    setRehydrateInitial(opts.initialData || null);
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
      initialData={rehydrateInitial || data}
      initialStep={initialStep}
      userId={userId}
      league={league}
      userLeagues={userLeagues}
      results={results}
      onExit={onExit}
      onComplete={onComplete}
      onShareBracket={onShareBracket}
      onCelebrate={onCelebrate}
      displayName={displayName}
      embedded={embedded}
      isAnonymous={isAnonymous}
      onRequireSignup={onRequireSignup}
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

// Returns the first wizard step the user still has work in. If they've
// already finished groups + best-thirds + bracket, return step 3 (the
// bracket) so they can review their picks. Mirrors the same completion
// rules the wizard uses for predStatus / step gating.
function pickResumeStep(initialData, explicitStep, league) {
  // Knockout-only leagues have no group/best-thirds steps — always land on
  // the bracket (step 3).
  if (league?.knockoutOnly) return 3;
  if (explicitStep && explicitStep > 1) return explicitStep;
  // Once the group stage has locked, group rankings + best-thirds are frozen
  // (read-only) — the only thing left to edit is the knockout bracket. Land
  // straight on it so "Edit picks" opens the knockouts, not a locked Step 1.
  if (isStageLocked('groupStage')) return 3;
  if (!initialData) return 1;
  // Step 1: ranking incomplete → resume on Step 1.
  const groups = initialData.groupPredictions || {};
  const groupsAllSet = ['A','B','C','D','E','F','G','H','I','J','K','L'].every(g => {
    const r = groups[g]?.ranking;
    return Array.isArray(r) && r.length === 4 && r.every(Boolean);
  });
  if (!groupsAllSet) return 1;
  // Step 2: best-thirds incomplete → resume on Step 2.
  const thirds = Array.isArray(initialData.bestThirdPicks) ? initialData.bestThirdPicks.filter(Boolean) : [];
  if (thirds.length < 8) return 2;
  // Step 3: any bracket pick still missing → resume on Step 3 (the
  // wizard's own openRound logic positions the user on the right
  // round inside step 3).
  return 3;
}

function SimplePredictionWizard({ initialData, initialStep = 1, userId, league, userLeagues = [], results = {}, onExit, onComplete, onShareBracket, onCelebrate, displayName, embedded, isAnonymous = false, onRequireSignup = () => {}, saving, savedAt, error, save, saveNow, onRehydrate }) {
  // Resume on the first incomplete step instead of always starting at
  // group rankings. Users with 1 pick left were being sent back to
  // Step 1 — they had to scroll past 12 already-correct group rankings
  // before reaching the round that actually had the missing pick.
  const [step, setStep] = useState(() => pickResumeStep(initialData, initialStep, league));
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
  // Knockout-only league: skips group + best-thirds entirely. The bracket is
  // pre-seeded from the REAL Round of 32 (same 32 teams for everyone), and
  // every real team is pickable (there's no group prediction to "earn" from).
  // Scoring counts knockout rounds only — group/thirds sections are never
  // submitted, so calculateSimpleScore's denominator collapses to KNOCKOUT_MAX.
  const knockoutOnly = !!league?.knockoutOnly;
  const hasLocalPicks = !!(initialData && (
    (initialData.groupPredictions && Object.keys(initialData.groupPredictions).length) ||
    (initialData.bestThirdPicks && initialData.bestThirdPicks.length) ||
    (initialData.knockoutPredictions && Object.values(initialData.knockoutPredictions).some(a => Array.isArray(a) && a.length))
  ));
  const [copyBanner, setCopyBanner] = useState(
    !isGlobalSimple && !hasLocalPicks && !knockoutOnly ? 'prompt' : null,
  );

  // Auto-submit-to-Global note. On a non-global league we tell the user
  // that finishing here also enters them in the Global League (server
  // does this on completion via the copy util). Suppressed once they're
  // already complete in Global, or once the group stage has locked
  // (a fresh completion can no longer be copied → would be misleading).
  // null = unknown (don't flash the note before we know).
  const [globalComplete, setGlobalComplete] = useState(null);
  useEffect(() => {
    if (isGlobalSimple || !userId) return;
    let cancelled = false;
    getSimplePrediction(userId, GLOBAL_SIMPLE_ID)
      .then((doc) => { if (!cancelled) setGlobalComplete(doc?.isComplete === true); })
      .catch(() => { if (!cancelled) setGlobalComplete(false); });
    return () => { cancelled = true; };
  }, [isGlobalSimple, userId]);
  const showAutoSubmitNote = !isGlobalSimple && globalComplete === false && !isStageLocked('groupStage');

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

  const [celebrationOpen, setCelebrationOpen] = useState(false);
  const [celebrationChampion, setCelebrationChampion] = useState({ name: null, flag: null });

  // Group rankings + best-thirds freeze when the group stage locks (kickoff).
  // The wizard must render those steps read-only then — otherwise a user can
  // drag a locked group, the save is rejected, and it "reverts on refresh".
  const groupStageLocked = isStageLocked('groupStage');

  // A participant who has no group predictions and arrives after the group
  // stage has locked (e.g. a new "Enter free" entrant) can't make group or
  // best-third picks — there's nothing for them to do there. Treat them like a
  // knockout-only player: skip straight to the bracket, pre-filled with the
  // real teams, every team pickable + scoring. Existing users who DID predict
  // groups keep their group/best-third scoring and the predicted-teams
  // knockout restriction (effectiveKnockoutOnly stays false for them).
  const hasGroupPicks = Object.values(frozenInitial?.groupPredictions || {}).some(
    (g) => Array.isArray(g?.ranking) && g.ranking.filter(Boolean).length > 0,
  );
  const effectiveKnockoutOnly = knockoutOnly || (groupStageLocked && !hasGroupPicks);

  // #6 — First-visit coach overlay. Only shows when a user hasn't dismissed
  // it yet AND they don't already have picks (so existing users in the
  // middle of editing their bracket don't get nagged). One-shot per browser.
  const [coachVisible, setCoachVisible] = useState(() => {
    if (hasSeenWizardTutorial()) return false;
    if (frozenInitial?.isComplete) return false;
    // No group/best-third steps to walk through for a knockout-only flow (a
    // real knockout league OR a new post-group-lock entrant) — the 3-step
    // coach would describe a flow the user never sees.
    if (effectiveKnockoutOnly) return false;
    return true;
  });

  // ── Knockout-real-reseed (flag-gated) ───────────────────────────────
  // When the founder enables `knockoutRealReseed`, the bracket reflects the
  // REAL advancing teams (per group as they finish) and restricts the user to
  // advancing only teams they correctly predicted. Off → predicted bracket as
  // before. Re-fetches every 60s so a freshly-decided group appears.
  const [reseedFlag, setReseedFlag] = useState(false);
  useEffect(() => subscribeToFeatureFlags((f) => setReseedFlag(!!f?.knockoutRealReseed)), []);
  // A knockout-only league ALWAYS seeds from the real bracket (independent of
  // the global reseed flag) — that's its whole premise.
  const wantRealBracket = reseedFlag || knockoutOnly;
  const [realBracket, setRealBracket] = useState(null);
  // In-progress scores feed (/api/live-scores). The freshest qualified-team
  // picture lives here — a game's result reaches matchResults only once the
  // poll-results cron reads FINISHED, so the wizard must merge this feed (the
  // same way the Standings page does) or its bracket lags behind / shows the
  // user's predicted teams. Poll only while we actually want the real bracket.
  const [liveScores, setLiveScores] = useState({});
  useEffect(() => {
    if (!wantRealBracket) { setRealBracket(null); setLiveScores({}); return; }
    let cancelled = false;
    const loadBracket = async () => { const d = await fetchActualBracket(); if (!cancelled) setRealBracket(d); };
    const loadLive = async () => { const l = await fetchLiveScores(); if (!cancelled) setLiveScores(l || {}); };
    loadBracket(); loadLive();
    const t = setInterval(() => { loadBracket(); loadLive(); }, 60000);
    return () => { cancelled = true; clearInterval(t); };
  }, [wantRealBracket]);
  // Real R32 for the bracket. Project the direct 1st/2nd-place sides from the
  // CURRENT live standings so qualified-so-far teams show immediately — instead
  // of waiting for the server to mark a slot real only once its whole group is
  // mathematically complete (which left the bracket showing predicted teams
  // through the final group matchday). 3rd-place sides still come from the
  // server payload (Annexe C needs all groups done). Standings come from the
  // SAME merged source the Results page uses (matchResults + the live feed), so
  // the wizard bracket matches it exactly. Display/pick only — scoring runs
  // server-side off the final results.
  const merged = useMemo(() => mergeLiveScores(results || {}, liveScores || {}), [results, liveScores]);
  const liveStandings = useMemo(() => computeLiveStandings(merged), [merged]);
  const realR32 = useMemo(
    () => (wantRealBracket ? projectRealR32(liveStandings, realBracket?.r32 || {}) : null),
    [wantRealBracket, liveStandings, realBracket],
  );
  const reseedActive = !!realR32 && Object.values(realR32).some((s) => s && (s.homeReal || s.awayReal));
  // Teams mathematically out of the R32 — blanked from any still-unresolved
  // slot so an eliminated predicted pick (e.g. a best-third that didn't advance)
  // doesn't keep showing while its third-place slot waits on all groups to
  // finish. Only meaningful while reseeding from real teams.
  const eliminatedSet = useMemo(
    () => (wantRealBracket ? eliminatedTeams(liveStandings) : null),
    [wantRealBracket, liveStandings],
  );
  const predictedTeamSet = useMemo(() => {
    if (!reseedActive) return null;
    // Knockout-only (incl. a new no-group-picks entrant): every real R32 team
    // is pickable AND scores (there's no group prediction to restrict by).
    // Build the "earned" set from ALL resolved real teams so nothing is marked
    // "won't score" — matching the scorer, where an empty advancers set means
    // no restriction.
    if (effectiveKnockoutOnly) {
      const all = new Set();
      for (const s of Object.values(realR32 || {})) {
        if (s?.home) all.add(s.home);
        if (s?.away) all.add(s.away);
      }
      return all;
    }
    // Global reseed: the teams the user predicted to advance — these are the
    // ones that will SCORE. Others are pickable but marked "won't score". Use
    // the same direct, routing-free set the scorer uses (predictedAdvancers in
    // scoringSimple.js) so the UI marking and the points always agree.
    return predictedAdvancers(groups.predictions, bestThird.picks);
  }, [reseedActive, effectiveKnockoutOnly, realR32, groups.predictions, bestThird.picks]);

  // How many of the teams the user predicted to reach the knockouts actually
  // made it — i.e. how many of the real R32 teams are on their bracket (and so
  // are advanceable). Null until the real bracket has resolved teams.
  const reseedHitCount = useMemo(() => {
    if (!reseedActive || effectiveKnockoutOnly || !predictedTeamSet) return null;
    const realTeams = new Set();
    for (const s of Object.values(realR32 || {})) {
      if (s?.homeReal && s.home) realTeams.add(s.home);
      if (s?.awayReal && s.away) realTeams.add(s.away);
    }
    if (realTeams.size === 0) return null;
    let hit = 0;
    for (const t of realTeams) if (predictedTeamSet.has(t)) hit += 1;
    return { hit, total: realTeams.size };
  }, [reseedActive, effectiveKnockoutOnly, realR32, predictedTeamSet]);

  const bracketState = useBracketState({
    groupPredictions: groups.predictions,
    bestThirdPicks: bestThird.picks,
    knockoutPredictions: frozenInitial?.knockoutPredictions,
    realR32: reseedActive ? realR32 : null,
    predictedTeamSet,
    eliminatedSet: reseedActive ? eliminatedSet : null,
    onChange: (next) => {
      // Treat picking the Final winner as the user finishing their
      // bracket — leaderboards key off isComplete and we don't want
      // users to stay in "In progress" forever just because they
      // skipped the 3rd-Place match.
      const finalPick = next?.final?.[0];
      const finalPicked = !!finalPick?.winnerId;
      save({ knockoutPredictions: next, isComplete: finalPicked });
    },
  });

  // ── Sync Global knockout edits to the user's other leagues ──────────
  // While editing the GLOBAL bracket, offer to push the updated knockout picks
  // to every other Quick Picks league the user is in (classic + knockout-only
  // leagues are excluded server-side). They can still fine-tune each league on
  // its own page afterwards.
  // IMPORTANT: this block must stay AFTER `bracketState` — handleSyncLeagues
  // closes over it AND lists it in its dependency array, which React evaluates
  // eagerly during render. Declared above bracketState it throws a TDZ
  // "Cannot access 'bracketState' before initialization" on every render,
  // which blanks/crashes the whole wizard.
  const otherSyncableLeagues = useMemo(
    () => (userLeagues || []).filter(
      (l) => l && l.id !== GLOBAL_SIMPLE_ID && l.predictionMode !== 'classic' && !l.knockoutOnly,
    ),
    [userLeagues],
  );
  const canSyncLeagues = isGlobalSimple && otherSyncableLeagues.length > 0;
  const [koTouched, setKoTouched] = useState(false);
  const [syncState, setSyncState] = useState({ status: 'idle', count: 0 });
  const handleSyncLeagues = useCallback(async () => {
    setSyncState({ status: 'applying', count: 0 });
    try {
      // Flush the latest Global bracket first so the server copies the picks
      // the user is looking at (auto-save is async — avoid a stale copy).
      await saveNow({
        knockoutPredictions: bracketState.knockoutPredictions,
        isComplete: bracketState.isRoundComplete('final'),
      });
      const res = await applyGlobalKnockoutToMyLeagues();
      setSyncState({ status: 'done', count: res?.count || 0 });
    } catch {
      setSyncState({ status: 'error', count: 0 });
    }
  }, [saveNow, bracketState]);

  // Wrap pickWinner so the wizard can: (1) dismiss the first-visit hint
  // tooltip, (2) surface a toast when changing an upstream pick wipes
  // downstream rounds, so the user understands why bracket cells they
  // already filled went blank.
  const pickWinnerWithFeedback = useCallback((matchId, winnerTeam) => {
    const result = bracketState.pickWinner(matchId, winnerTeam) || {};
    // Editing the Global bracket → surface the "apply to my other leagues"
    // prompt, and reset any prior "done" state so a fresh edit can re-apply.
    if (canSyncLeagues) {
      setKoTouched(true);
      setSyncState((s) => (s.status === 'done' ? { status: 'idle', count: 0 } : s));
    }
    if (bracketHintVisible) dismissBracketHint();
    if (result.cleared > 0) {
      if (cascadeToastTimer.current) clearTimeout(cascadeToastTimer.current);
      setCascadeToast(`Pick updated — ${result.cleared} dependent pick${result.cleared === 1 ? '' : 's'} reset.`);
      cascadeToastTimer.current = setTimeout(() => setCascadeToast(null), 3500);
    }
    return result;
  }, [bracketState, bracketHintVisible, dismissBracketHint, canSyncLeagues]);

  // Celebration trigger: detect the false → true edge on the two
  // milestone rounds (3rd-place + Final) and fire onCelebrate so the
  // shell's confetti burst plays. Both rounds have a single match, so
  // "round complete" === "user just made the pick." Refs hold the
  // previous completion state so the effect doesn't fire on mount
  // when initialData already has both rounds picked (e.g. user
  // navigated back into a completed bracket).
  const prevThirdCompleteRef = useRef(bracketState.isRoundComplete('thirdPlace'));
  const prevFinalCompleteRef = useRef(bracketState.isRoundComplete('final'));
  useEffect(() => {
    const thirdNow = bracketState.isRoundComplete('thirdPlace');
    const finalNow = bracketState.isRoundComplete('final');
    if (!prevThirdCompleteRef.current && thirdNow) onCelebrate?.();
    if (!prevFinalCompleteRef.current && finalNow) onCelebrate?.();
    prevThirdCompleteRef.current = thirdNow;
    prevFinalCompleteRef.current = finalNow;
  }, [bracketState, onCelebrate]);

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
    // No-login funnel completion gate: an anonymous visitor's picks are
    // already saved under their anon UID (autosaved as they picked), so the
    // SUBMIT action is the conversion moment. Show the prize sign-up prompt
    // instead of submitting; after they sign up, the post-signup migration
    // carries their bracket to the new account (already complete).
    if (isAnonymous) { onRequireSignup('prizes'); return; }
    const thirdPlacePicked = bracketState.isRoundComplete('thirdPlace');
    if (!thirdPlacePicked) {
      const ok = window.confirm(
        'You haven’t picked a winner for the 3rd-place playoff (worth 5 pts). Submit anyway?',
      );
      if (!ok) return;
    }
    // Persist the FULL bracket the user is looking at — not just the
    // isComplete flag. The copy-from-Global path fills the wizard via
    // hydration (frozenInitial), so the sections were never queued in this
    // wizard instance's pending save. The old `saveNow({ isComplete: true })`
    // therefore relied on the sections already being in the league doc, which
    // is exactly why a copied bracket only showed on the leaderboard after a
    // manual edit + re-save (the edit re-queued the sections). Re-sending the
    // whole bracket here makes the FIRST "Save & submit" write everything.
    // Unchanged sections that have already locked are a no-op server-side
    // (lockedSectionsInUpdate only flags *changed* locked sections), so this
    // is safe after a stage locks.
    await saveNow(effectiveKnockoutOnly
      ? {
          // Knockout-only leagues have no group/thirds sections — persist only
          // the bracket so the doc never carries empty group data.
          knockoutPredictions: bracketState.knockoutPredictions,
          isComplete: true,
        }
      : {
          groupPredictions: groups.predictions,
          bestThirdPicks: bestThird.picks,
          knockoutPredictions: bracketState.knockoutPredictions,
          isComplete: true,
        });
    // Surface the "Bracket locked in!" + Share moment AFTER the user submits
    // — not mid-pick. Dismissing (or sharing) continues to the leaderboard.
    const champ = bracketState.knockoutPredictions?.final?.[0];
    setCelebrationChampion({ name: champ?.winnerId || null, flag: champ?.winnerFlag || null });
    setCelebrationOpen(true);
  }, [bracketState, groups.predictions, bestThird.picks, saveNow, isAnonymous, onRequireSignup]);

  // No-login funnel 'save' prompt: when an anonymous visitor who has already
  // made picks tries to leave the wizard, surface the "keep your picks across
  // devices" sign-up prompt ONCE (their picks are safe server-side under the
  // anon UID — the honest promise is cross-device persistence, not rescue from
  // loss). Dismissing the prompt lets them leave on the next press; we don't
  // trap them. Only fires for the standalone (non-embedded) route's back
  // button, the exit affordance anon users actually reach.
  const savePromptShownRef = useRef(false);
  const guardedExit = useCallback(() => {
    const hasPicks = groups?.predictions && Object.keys(groups.predictions).length > 0;
    if (isAnonymous && hasPicks && !savePromptShownRef.current) {
      savePromptShownRef.current = true;
      onRequireSignup('save');
      return;
    }
    if (onExit) onExit();
  }, [isAnonymous, onRequireSignup, onExit, groups?.predictions]);

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
      const { payload } = await copySimplePrediction(userId, GLOBAL_SIMPLE_ID, league.id);
      const copiedComplete = !!(payload?.knockoutPredictions?.final?.[0]?.winnerId);
      if (copiedComplete) {
        // The copy wrote a COMPLETE bracket and marked it submitted (isComplete
        // is derived from the bracket server-side; the leaderboard keys by the
        // doc id). Go straight to THIS league's leaderboard with the picks
        // already reflected — no separate "Save & submit" step needed.
        setCopyBanner(null);
        if (onComplete) onComplete();
        else if (onExit) onExit();
      } else {
        // Global bracket isn't finished — drop the user on Step 3, hydrated
        // directly from the copied payload (no subscription race), so they
        // can complete + submit it.
        setCopyBanner('success');
        onRehydrate && onRehydrate({ openStep: 3, initialData: payload });
      }
    } catch (e) {
      window.alert(e?.message || 'Copy failed');
    } finally {
      setCopyBusy(false);
    }
  }, [userId, league?.id, onRehydrate, onComplete, onExit]);

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

    // Once the group stage has locked, group rankings + best-thirds are frozen
    // — so "Reset my picks" must clear ONLY the knockout bracket (the part
    // that's still editable). A full-doc reset would 403 server-side anyway
    // (the DELETE path rejects once any stage is locked). Knockout-only leagues
    // have no group/thirds, so they always take this path.
    if (groupStageLocked || knockoutOnly) {
      const ok = window.confirm(
        `Reset your knockout bracket for "${leagueLabel}"?\n\n`
        + `Your group rankings and best-thirds are locked and stay exactly as they are — only your knockout picks (Round of 32 through the Final) will be cleared.\n\n`
        + `This can't be undone.`,
      );
      if (!ok) return;
      setCopyBusy(true);
      try {
        bracketState.resetAll();
        save({ knockoutPredictions: emptyKnockoutPredictions(), isComplete: false });
      } catch (e) {
        window.alert(e?.message || 'Reset failed');
      } finally {
        setCopyBusy(false);
      }
      return;
    }

    // Pre-tournament: nothing is locked yet, so a full reset (groups +
    // best-thirds + knockout) via the server DELETE is allowed.
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
  }, [userId, league?.id, league?.name, onRehydrate, groupStageLocked, knockoutOnly, bracketState, save]);

  return (
    <div className={`simple-page${embedded ? ' simple-page-embedded' : ''}`}>
      {!embedded && (
        <div className="simple-page-header">
          <button type="button" className="btn-back-sm btn-back-sm-named" onClick={guardedExit} aria-label="Back to leagues">
            <ArrowLeft size={14} /> <span>Leagues</span>
          </button>
          <div className="simple-page-title">
            <h1>{league?.name || 'Quick Picks'}</h1>
            <span className="simple-page-subtitle">Predict rankings, not scores</span>
          </div>
          {/* House Rules — only renders on private user-created
              leagues. Hidden on global-simple and any public league.
              Placed in the header area so it's visible across all
              wizard steps, not just the start. */}
          <HouseRulesSection
            league={league}
            userId={userId}
            isCreator={league?.createdBy === userId}
            notify={() => { /* no-op: SimplePrediction has its own toast surface */ }}
          />
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

      {copyBanner !== 'prompt' && !effectiveKnockoutOnly && (
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
            readOnly={groupStageLocked}
          />

          <div className="simple-step-nav">
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
                : <>Finish {GROUPS.length - groups.touchedCount} more group{GROUPS.length - groups.touchedCount === 1 ? '' : 's'} to continue</>}
            </button>
            {!step1Complete && (
              <button
                type="button"
                className="simple-step-jump-link"
                onClick={() => {
                  const firstIncomplete = GROUPS.find((g) => !groups.touched[g]);
                  if (!firstIncomplete) return;
                  const el = document.getElementById(`group-card-${firstIncomplete}`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }}
              >
                Jump to next unfinished group &uarr;
              </button>
            )}
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
            readOnly={groupStageLocked}
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
              <h2>{effectiveKnockoutOnly ? 'Knockout bracket' : 'Step 3 — Knockouts'}</h2>
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
            <p>{effectiveKnockoutOnly
              ? 'Pick the winner of each match, from the real Round of 32 through to the Final. The bracket fills forward as you go.'
              : 'Pick the winner of each match. The bracket fills forward as you go.'}</p>
          </div>

          {showAutoSubmitNote && (
            <div className="simple-autosubmit-note" role="note">
              <Sparkles size={14} aria-hidden="true" />
              <span>We&rsquo;ll also submit these predictions to the <strong>Global League</strong>. You can edit or reset your global picks anytime from your dashboard.</span>
            </div>
          )}

          {/* Top nav mirror — the bracket is tall on desktop, so the user
              shouldn't have to scroll all the way down to find the
              Save & finish button. Reset stays at the bottom only. */}
          <div className="simple-step-nav simple-step-nav-top simple-step-nav-split">
            {effectiveKnockoutOnly ? <span /> : (
              <button type="button" className="btn btn-secondary" onClick={() => goToStep(2)}>
                <ArrowLeft size={16} /> Back
              </button>
            )}
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

          {canSyncLeagues && koTouched && (
            <div className="bracket-sync-note">
              {syncState.status === 'done' ? (
                <span className="bracket-sync-done">
                  <Check size={15} /> Applied to {syncState.count} {syncState.count === 1 ? 'league' : 'leagues'}.
                  You can still fine-tune each one on its own league page.
                </span>
              ) : (
                <>
                  <span>
                    <strong>Bracket updated.</strong> Apply these knockout picks to your{' '}
                    {otherSyncableLeagues.length} other {otherSyncableLeagues.length === 1 ? 'league' : 'leagues'} too?
                    You can still edit each one separately afterwards.
                  </span>
                  <span className="bracket-sync-actions">
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={handleSyncLeagues}
                      disabled={syncState.status === 'applying'}
                    >
                      {syncState.status === 'applying' ? 'Applying…' : 'Apply to my leagues'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setKoTouched(false)}>
                      Not now
                    </button>
                  </span>
                  {syncState.status === 'error' && (
                    <span className="bracket-sync-err">Couldn’t apply — try again.</span>
                  )}
                </>
              )}
            </div>
          )}

          {effectiveKnockoutOnly && !reseedActive && (
            <div className="bracket-reseed-note">
              <strong>Setting up the Round of 32…</strong> This league starts from the real bracket.
              As the group stage wraps up, the actual 32 teams drop in here — check back shortly if any
              slots still read “TBD.”
            </div>
          )}

          {reseedActive && effectiveKnockoutOnly && (
            <div className="bracket-reseed-note">
              <strong>Knockout league — pure bracket.</strong> Your bracket is pre-filled with the real
              Round of 32, the same 32 teams for everyone. Pick winners through to the Final. No group
              picks, no head start — just who you’ve got lifting the trophy. Teams update as the last
              group games finish.
            </div>
          )}

          {reseedActive && !effectiveKnockoutOnly && (
            <div className="bracket-reseed-note">
              {reseedHitCount && (
                <>
                  <strong>{reseedHitCount.hit} of your picks made the knockouts.</strong>{' '}
                  You called {reseedHitCount.hit} of the {reseedHitCount.total} teams now in the bracket — those
                  are the ones that <strong>earn points</strong>.
                  <br />
                </>
              )}
              <strong>Your bracket now shows the real teams.</strong> Pick winners through to the
              Final — and reset and re-pick as many times as you like before the bracket locks. You
              can advance <strong>any</strong> team in the bracket, but you only score knockout points
              for teams you originally predicted to reach the knockouts (your group + best-third picks).
              Teams you didn’t pick are tagged <span className="bracket-reseed-locked">won’t score</span> —
              still pickable, just worth 0 points. Teams update as the last group games finish, and
              third-place slots fill once all groups are done.
              <br />
              <strong>Happy with your picks?</strong> You don’t have to change a thing — your group and
              best-third picks are locked and still scoring, and your knockout picks stay exactly as you
              left them. This just lets you re-pick winners now that the real teams are set.
            </div>
          )}

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
            {effectiveKnockoutOnly ? <span /> : (
              <button type="button" className="btn btn-secondary" onClick={() => goToStep(2)}>
                <ArrowLeft size={16} /> Back to best third
              </button>
            )}
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

      {/* #2 — Post-SUBMIT celebration (fired from handleFinish, not during
          picking). Dismissing or sharing continues to the leaderboard. */}
      <CompletionCelebration
        open={celebrationOpen}
        championName={celebrationChampion.name}
        championFlag={celebrationChampion.flag}
        onShare={onShareBracket}
        onDismiss={() => {
          setCelebrationOpen(false);
          if (onComplete) onComplete();
          else if (onExit) onExit();
        }}
      />

      {/* #6 — First-visit 3-step tutorial. */}
      {coachVisible && <WizardCoachmarks onDismiss={() => setCoachVisible(false)} />}
    </div>
  );
}
