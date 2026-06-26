/**
 * CreateLeagueForm
 *
 * Extracted from goaloracle.jsx — previously defined inside the GoalOracle
 * render function, which re-created the component type on every parent state
 * update and caused inputs to lose focus after each keystroke. Keeping this
 * at module scope stabilizes the component identity so React preserves the
 * DOM and the focused input across re-renders.
 */

import React, { useState, useEffect } from 'react';
import {
  AlertTriangle, CheckCircle, Key, Unlock, Lock, Eye, EyeOff,
  RefreshCw, ChevronRight, Loader, Copy, Target, Trophy,
} from 'lucide-react';
import { isStageLocked } from '../utils/stageLock';
import ModePicker from './simple/ModePicker';
import HouseRulesInput from './HouseRulesInput';
import { copyPredictions, copySimplePrediction } from '../utils/db';

function generatePasscode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

function CreateSuccessPanel({ createSuccess, leagues, nav, notify, setCreateSuccess, userId }) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(null); // { count, skipped } | null
  const isSimple = createSuccess.mode === 'simple';
  const sourceLeagueId = isSimple ? 'global-simple' : 'global';
  // User-facing label for the source of copyable picks. Both global
  // leagues are branded simply as "Global League" — the mode is implied
  // by the league the user just created (we copy same-mode picks). We
  // deliberately don't surface the internal "simple"/"classic" split.
  const sourceLabel = 'Global League';

  const goToDetail = () => {
    const l = leagues.find((x) => x.id === createSuccess.id);
    setCreateSuccess(null);
    if (l) nav('detail', l); else nav('dashboard');
  };

  const handleCopy = async () => {
    setCopying(true);
    try {
      if (isSimple) {
        if (!userId) throw new Error('Sign in required');
        const res = await copySimplePrediction(userId, sourceLeagueId, createSuccess.id);
        if (res?.copied) {
          setCopied({ count: 1 });
          notify(`Predictions submitted for ${createSuccess.name}`);
        } else {
          setCopied({ count: 0 });
          notify(`No ${sourceLabel} picks to copy yet — start fresh in your new league.`);
        }
      } else {
        const res = await copyPredictions(sourceLeagueId, createSuccess.id);
        setCopied({ count: res?.copied || 0, skipped: (res?.skippedLocked || 0) + (res?.skippedExisting || 0) });
        if ((res?.copied || 0) > 0) {
          notify(`Predictions submitted for ${createSuccess.name} (${res.copied} pick${res.copied !== 1 ? 's' : ''} copied)`);
        } else {
          notify(`No ${sourceLabel} predictions to copy yet — start fresh in your new league.`);
        }
      }
    } catch (e) {
      notify(e.message || 'Copy failed', 'error');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="create-success">
      <CheckCircle size={56} className="create-success-icon" />
      <h2>League Created!</h2>
      <p className="create-success-name">{createSuccess.name}</p>
      {createSuccess.passcode && <div className="create-success-code"><Key size={16} /> Invite code: <strong>{createSuccess.passcode}</strong></div>}

      <div className="copy-flow-card">
        <div className="copy-flow-head">
          <Target size={18} />
          <div>
            <h3>Every league is predicted separately</h3>
            <p>Your {sourceLabel} picks don&rsquo;t auto-apply here. Copy them in one click, or predict fresh.</p>
          </div>
        </div>
        <div className="copy-flow-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={handleCopy}
            disabled={copying || !!copied}
          >
            {copying ? (<><RefreshCw size={14} className="spin" /> Copying...</>) :
              copied ? (<><CheckCircle size={14} /> {copied.count > 0 ? `Copied ${copied.count}` : 'Nothing to copy'}</>) :
              (<><Copy size={14} /> Copy my {sourceLabel} picks</>)}
          </button>
          <span className="copy-flow-or">or predict fresh below</span>
        </div>
      </div>

      <div className="create-success-actions">
        <button className="btn btn-primary btn-lg" onClick={goToDetail}>
          Start Predicting <ChevronRight size={18} />
        </button>
        <button className="btn btn-secondary" onClick={() => { setCreateSuccess(null); nav('dashboard'); }}>
          Go to Dashboard
        </button>
      </div>
      {createSuccess.passcode && <p className="create-success-hint">Share the invite code with friends so they can join your league.</p>}
    </div>
  );
}

export default function CreateLeagueForm({
  // state + setters
  createName, setCreateName,
  createTp, setCreateTp,
  createVis, setCreateVis,
  createPasscode, setCreatePasscode,
  createFe, setCreateFe,
  createDi, setCreateDi,
  createPs, setCreatePs,
  createScope, setCreateScope,
  createGroups, setCreateGroups,
  createRounds, setCreateRounds,
  createBusy, setCreateBusy,
  createErr, setCreateErr,
  createMode, setCreateMode,
  createSuccess, setCreateSuccess,
  // House rules — optional textarea wired on private leagues only.
  // Lives in parent state so a draft survives toggling visibility
  // back and forth before submit.
  createHouseRules, setCreateHouseRules,
  // parent data + handlers
  uData,
  leagues,
  nav,
  notify,
  createLeague,
  featureFlags,
}) {
  // If the currently-selected mode is disabled by an admin flag, snap to
  // the other one so the form doesn't submit a hidden mode.
  useEffect(() => {
    if (!featureFlags) return;
    if (createMode === 'classic' && featureFlags.classicEnabled === false) setCreateMode('simple');
    else if (createMode === 'simple' && featureFlags.quickPicksEnabled === false) setCreateMode('classic');
  }, [featureFlags, createMode, setCreateMode]);
  const tp = createTp, setTp = setCreateTp;
  const nm = createName, setNm = setCreateName;
  const vis = createVis, setVis = setCreateVis;
  const passcode = createPasscode, setPasscode = setCreatePasscode;
  const fe = createFe, setFe = setCreateFe;
  const di = createDi, setDi = setCreateDi;
  const ps = createPs, setPs = setCreatePs;
  const houseRules = createHouseRules || '';
  const setHouseRules = setCreateHouseRules || (() => {});
  const busy = createBusy, setBusy = setCreateBusy;
  const err = createErr, setErr = setCreateErr;
  const cu = 'USDC';
  const tot = di.first + di.second + di.third;

  // Knockout-only league: skips group ranking + best-thirds; the bracket is
  // pre-filled with the real Round of 32 so members only pick knockout winners.
  // Local state — it only needs to exist until submit. A Quick Picks variant.
  // Once the group stage has KICKED OFF, full-tournament prediction is
  // impossible (the groups already played), so a new league can only be
  // knockout-only: we default the flag ON and hide the format picker.
  const groupStageLocked = isStageLocked('groupStage');
  const simpleMode = createMode === 'simple' && featureFlags?.quickPicksEnabled !== false;
  const [knockoutOnly, setKnockoutOnly] = useState(groupStageLocked);
  // The Full-vs-Knockout picker only makes sense BEFORE the group stage locks.
  const showFormatPicker = simpleMode && !groupStageLocked;
  useEffect(() => {
    // Force OFF in classic mode; force ON for simple-mode leagues created after
    // the group stage has started.
    if (!simpleMode && knockoutOnly) setKnockoutOnly(false);
    else if (simpleMode && groupStageLocked && !knockoutOnly) setKnockoutOnly(true);
  }, [simpleMode, groupStageLocked, knockoutOnly]);

  // Prize-league capability is platform-wide config gated by the
  // enablePrizeLeagues superadmin flag. Off by default. When off the
  // entire "League Type" picker hides; user-created leagues are just
  // free leagues with a public/private toggle.
  const prizeLeaguesEnabled = featureFlags?.enablePrizeLeagues === true;

  // If a prior session left tp === 'paid' in state but the flag is now
  // off, snap back to free so submit doesn't carry stale paid config.
  useEffect(() => {
    if (!prizeLeaguesEnabled && tp === 'paid') setTp('free');
  }, [prizeLeaguesEnabled, tp, setTp]);

  const genCode = () => setPasscode(generatePasscode());

  const resetForm = () => {
    setCreateName(''); setCreateVis('public'); setCreatePasscode('');
    setCreateTp('free'); setCreateFe(''); setCreateDi({ first: 50, second: 30, third: 20 });
    setCreatePs({ correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 });
    setCreateScope('all'); setCreateGroups([]); setCreateRounds([]);
    setCreateBusy(false); setCreateErr('');
    setCreateMode('simple');
    setHouseRules('');
    setKnockoutOnly(false);
  };

  const go = async () => {
    if (!uData?.id) { setErr('Still loading your account. Please wait a moment and try again.'); return; }
    if (!nm.trim()) { setErr('Name required'); return; }
    if (vis === 'private' && !passcode.trim()) { setErr('Passcode required for private leagues'); return; }
    // Prize-league validations only run when the feature is enabled
    // platform-wide. With the flag off, tp is forced to 'free' above.
    if (prizeLeaguesEnabled && tp === 'paid' && (!fe || parseFloat(fe) <= 0)) { setErr('Fee required'); return; }
    if (prizeLeaguesEnabled && tp === 'paid' && tot !== 100) { setErr('Must total 100%'); return; }
    // House rules: 500-char client-side cap (server enforces the same).
    // Trim whitespace; an all-whitespace value persists as null.
    const trimmedRules = (houseRules || '').trim();
    if (trimmedRules.length > 500) { setErr('House Rules must be 500 characters or fewer.'); return; }
    setBusy(true); setErr('');
    try {
      const leagueData = {
        name: nm.trim(),
        type: prizeLeaguesEnabled ? tp : 'free',
        visibility: vis,
        passcode: vis === 'private' ? passcode.trim().toUpperCase() : null,
        entryFee: (prizeLeaguesEnabled && tp === 'paid') ? parseFloat(fe) : 0, currency: cu,
        prizeDistribution: (prizeLeaguesEnabled && tp === 'paid') ? di : null,
        pointsSystem: createMode === 'simple' ? null : ps,
        predictionMode: createMode,
        matchScope: 'all',
        // Knockout-only: server forces simple mode + the rounds scope and
        // seeds the bracket from the real R32.
        knockoutOnly: simpleMode && knockoutOnly,
        // House rules only on private leagues; server rejects on public.
        houseRules: (vis === 'private' && trimmedRules) ? { content: trimmedRules } : null,
      };
      const lid = await createLeague(leagueData, uData.id);
      const savedName = nm.trim();
      const savedPasscode = vis === 'private' ? passcode.trim().toUpperCase() : null;
      const savedMode = createMode;
      resetForm();
      setCreateSuccess({ name: savedName, id: lid, passcode: savedPasscode, mode: savedMode });
    } catch (e) {
      console.error('[create] FAILED:', e);
      setBusy(false);
      setErr(e.message || 'Failed to create league');
      notify('League creation failed: ' + e.message, 'error');
    }
  };

  if (createSuccess) return (
    <div className="create-league">
      <CreateSuccessPanel
        createSuccess={createSuccess}
        leagues={leagues}
        nav={nav}
        notify={notify}
        setCreateSuccess={setCreateSuccess}
        userId={uData?.id}
      />
    </div>
  );

  return (
    <div className="create-league">
      <div className="page-header"><button className="btn-back-sm btn-back-sm-named" onClick={() => { resetForm(); setCreateSuccess(null); nav('dashboard'); }}>&larr; <span>Dashboard</span></button><h1>Create Your League</h1></div>
      <div className="create-league-form" style={{ position: 'relative' }}>
        {busy && <div className="create-loading-overlay"><div className="create-loading-inner"><Loader size={32} className="spin" /><p>Creating your league...</p></div></div>}
        {err && <div className="form-error"><AlertTriangle size={16} /> {err}</div>}
        {/* Hide the entire mode-picker section when only one mode is
            available. With Classic disabled by feature flag there's only
            Quick Picks to choose, so the section becomes visual clutter. */}
        {(() => {
          const showSimple = featureFlags?.quickPicksEnabled !== false;
          const showClassic = featureFlags?.classicEnabled !== false;
          const visibleCount = (showSimple ? 1 : 0) + (showClassic ? 1 : 0);
          if (visibleCount <= 1) return null;
          return (
            <div className="form-section"><label>Prediction Mode</label>
              <ModePicker value={createMode} onChange={setCreateMode} featureFlags={featureFlags} />
            </div>
          );
        })()}
        <div className="form-section"><label>League Name</label><input type="text" placeholder="e.g., Friends & Family 2026" value={nm} onChange={(e) => setNm(e.target.value)} className="input-field" /></div>
        {/* Knockout-only format — a Quick Picks variant that skips the group
            stage. The Full-vs-Knockout picker only shows before the group
            stage locks; after kickoff a new league can only be knockout-only. */}
        {showFormatPicker && (
          <div className="form-section">
            <label>League Format</label>
            <div className="type-selector">
              <button
                type="button"
                className={`type-option ${!knockoutOnly ? 'active' : ''}`}
                onClick={(e) => { e.preventDefault(); setKnockoutOnly(false); }}
              >
                <Target size={24} />
                <div><h4>Full Tournament</h4><p>Rank groups, pick best-thirds, then the bracket</p></div>
              </button>
              <button
                type="button"
                className={`type-option ${knockoutOnly ? 'active' : ''}`}
                onClick={(e) => { e.preventDefault(); setKnockoutOnly(true); }}
              >
                <Trophy size={24} />
                <div><h4>Knockout Only</h4><p>Skip the groups — start from the real Round of 32 and pick winners</p></div>
              </button>
            </div>
            {knockoutOnly && (
              <p className="form-hint" style={{ marginTop: 8 }}>
                Everyone starts from the same 32 teams that actually advanced. Round-of-32 picks lock when the knockouts kick off (Jun 28).
              </p>
            )}
          </div>
        )}
        {simpleMode && groupStageLocked && (
          <div className="form-section">
            <label>League Format</label>
            <div className="knockout-format-note">
              <Trophy size={18} />
              <span>
                The group stage has kicked off, so new leagues run on the <strong>knockouts</strong> —
                pre-filled with the real Round of 32. Everyone picks winners from the same 32 teams.
                Round-of-32 picks lock Jun 28.
              </span>
            </div>
          </div>
        )}
        {/* League Type selector: hidden when prize-leagues feature flag
            is off. With the flag off there's only one type (free), so
            the picker becomes pointless visual clutter — users go
            straight from name → visibility. */}
        {prizeLeaguesEnabled && (
          <div className="form-section"><label>League Type</label>
            <div className="type-selector">
              <button type="button" className={`type-option ${tp === 'free' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setTp('free'); }}><Unlock size={24} /><div><h4>Free League</h4><p>Play for fun and bragging rights</p></div></button>
              <button type="button" className={`type-option ${tp === 'paid' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setTp('paid'); }}><Lock size={24} /><div><h4>Prize League</h4><p>Custom entry fee + payout split</p></div></button>
            </div>
          </div>
        )}
        <div className="form-section"><label>Visibility</label>
          <div className="type-selector">
            <button type="button" className={`type-option ${vis === 'public' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setVis('public'); }}><Eye size={24} /><div><h4>Public</h4><p>Anyone can find &amp; join</p></div></button>
            <button type="button" className={`type-option ${vis === 'private' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setVis('private'); if (!passcode) genCode(); }}><EyeOff size={24} /><div><h4>Private</h4><p>Invite-only with passcode</p></div></button>
          </div>
        </div>
        {vis === 'private' && (
          <div className="form-section"><label>Invite Passcode</label>
            <div className="passcode-row">
              <input type="text" value={passcode} onChange={(e) => setPasscode(e.target.value.toUpperCase())} className="input-field passcode-input" maxLength={8} placeholder="e.g., GOAL2026" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.preventDefault(); genCode(); }}><RefreshCw size={14} /> Generate</button>
            </div>
            <p className="form-hint">Share this code with people you want to invite. They&rsquo;ll need it to join.</p>
          </div>
        )}
        {/* House Rules — private leagues only, optional. Plain-text
            free-form note from the league creator to members. */}
        {vis === 'private' && (
          <div className="form-section">
            <HouseRulesInput value={houseRules} onChange={setHouseRules} disabled={busy} />
          </div>
        )}
        {prizeLeaguesEnabled && tp === 'paid' && <>
          <div className="form-section"><label>Entry Fee</label><div className="input-group"><input type="number" placeholder="50" value={fe} min="1" onChange={(e) => setFe(e.target.value)} className="input-field" /><span className="input-currency">USDC</span></div></div>
          <div className="form-section"><label>Prize Distribution {tot !== 100 && <span className="validation-error">(Currently {tot}%)</span>}</label>
            <div className="prize-distribution">{['first', 'second', 'third'].map((k, i) => <div key={k} className="prize-item"><span>{['1st', '2nd', '3rd'][i]} Place</span><input type="number" value={di[k]} onChange={(e) => setDi({ ...di, [k]: parseInt(e.target.value) || 0 })} className="input-field-sm" /><span>%</span></div>)}</div>
          </div>
        </>}
        {createMode !== 'simple' && (
          <div className="form-section"><label>Points System</label><div className="points-grid">{Object.entries(ps).map(([k, v]) => <div className="point-item" key={k}><label>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}</label><input type="number" value={v} min="0" onChange={(e) => setPs({ ...ps, [k]: parseInt(e.target.value) || 0 })} className="input-field-sm" /></div>)}</div></div>
        )}
        <div className="form-actions"><button className="btn btn-secondary" onClick={() => nav('dashboard')}>Cancel</button><button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? <><RefreshCw size={18} className="spin" /> Creating...</> : <>Create League <ChevronRight size={18} /></>}</button></div>
      </div>
    </div>
  );
}
