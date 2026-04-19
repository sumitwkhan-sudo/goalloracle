/**
 * CreateLeagueForm
 *
 * Extracted from goaloracle.jsx — previously defined inside the GoalOracle
 * render function, which re-created the component type on every parent state
 * update and caused inputs to lose focus after each keystroke. Keeping this
 * at module scope stabilizes the component identity so React preserves the
 * DOM and the focused input across re-renders.
 */

import React, { useState } from 'react';
import {
  AlertTriangle, CheckCircle, Key, Unlock, Lock, Eye, EyeOff,
  RefreshCw, ChevronRight, Loader, Copy, Target,
} from 'lucide-react';
import ModePicker from './simple/ModePicker';
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
  const sourceLabel = isSimple ? 'Global Simple' : 'Global Classic';

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
              (<><Copy size={14} /> Copy my existing {sourceLabel} picks</>)}
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
  // parent data + handlers
  uData,
  leagues,
  nav,
  notify,
  createLeague,
}) {
  const tp = createTp, setTp = setCreateTp;
  const nm = createName, setNm = setCreateName;
  const vis = createVis, setVis = setCreateVis;
  const passcode = createPasscode, setPasscode = setCreatePasscode;
  const fe = createFe, setFe = setCreateFe;
  const di = createDi, setDi = setCreateDi;
  const ps = createPs, setPs = setCreatePs;
  const busy = createBusy, setBusy = setCreateBusy;
  const err = createErr, setErr = setCreateErr;
  const cu = 'USDC';
  const tot = di.first + di.second + di.third;

  const genCode = () => setPasscode(generatePasscode());

  const resetForm = () => {
    setCreateName(''); setCreateVis('public'); setCreatePasscode('');
    setCreateTp('free'); setCreateFe(''); setCreateDi({ first: 50, second: 30, third: 20 });
    setCreatePs({ correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 });
    setCreateScope('all'); setCreateGroups([]); setCreateRounds([]);
    setCreateBusy(false); setCreateErr('');
    setCreateMode('simple');
  };

  const go = async () => {
    if (!uData?.id) { setErr('Still loading your account. Please wait a moment and try again.'); return; }
    if (!nm.trim()) { setErr('Name required'); return; }
    if (vis === 'private' && !passcode.trim()) { setErr('Passcode required for private leagues'); return; }
    if (tp === 'paid' && (!fe || parseFloat(fe) <= 0)) { setErr('Fee required'); return; }
    if (tp === 'paid' && tot !== 100) { setErr('Must total 100%'); return; }
    setBusy(true); setErr('');
    try {
      const leagueData = {
        name: nm.trim(), type: tp, visibility: vis,
        passcode: vis === 'private' ? passcode.trim().toUpperCase() : null,
        entryFee: tp === 'paid' ? parseFloat(fe) : 0, currency: cu,
        prizeDistribution: tp === 'paid' ? di : null,
        pointsSystem: createMode === 'simple' ? null : ps,
        predictionMode: createMode,
        matchScope: 'all',
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
      <div className="page-header"><button className="btn-back" onClick={() => { resetForm(); setCreateSuccess(null); nav('dashboard'); }}>← Back</button><h1>Create Your League</h1></div>
      <div className="create-league-form" style={{ position: 'relative' }}>
        {busy && <div className="create-loading-overlay"><div className="create-loading-inner"><Loader size={32} className="spin" /><p>Creating your league...</p></div></div>}
        {err && <div className="form-error"><AlertTriangle size={16} /> {err}</div>}
        <div className="form-section"><label>Prediction Mode</label>
          <ModePicker value={createMode} onChange={setCreateMode} />
        </div>
        <div className="form-section"><label>League Name</label><input type="text" placeholder="e.g., Friends & Family 2026" value={nm} onChange={(e) => setNm(e.target.value)} className="input-field" /></div>
        <div className="form-section"><label>League Type</label>
          <div className="type-selector">
            <button type="button" className={`type-option ${tp === 'free' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setTp('free'); }}><Unlock size={24} /><div><h4>Free League</h4><p>Play for fun and bragging rights</p></div></button>
            <button type="button" className="type-option disabled-option" disabled style={{ opacity: 0.5, cursor: 'not-allowed' }} onClick={(e) => e.preventDefault()}><Lock size={24} /><div><h4>Prize League</h4><p>Coming soon</p></div></button>
          </div>
        </div>
        <div className="form-section"><label>Visibility</label>
          <div className="type-selector">
            <button type="button" className={`type-option ${vis === 'public' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setVis('public'); }}><Eye size={24} /><div><h4>Public</h4><p>Anyone can find & join</p></div></button>
            <button type="button" className={`type-option ${vis === 'private' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setVis('private'); if (!passcode) genCode(); }}><EyeOff size={24} /><div><h4>Private</h4><p>Invite-only with passcode</p></div></button>
          </div>
        </div>
        {vis === 'private' && (
          <div className="form-section"><label>Invite Passcode</label>
            <div className="passcode-row">
              <input type="text" value={passcode} onChange={(e) => setPasscode(e.target.value.toUpperCase())} className="input-field passcode-input" maxLength={8} placeholder="e.g., GOAL2026" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={(e) => { e.preventDefault(); genCode(); }}><RefreshCw size={14} /> Generate</button>
            </div>
            <p className="form-hint">Share this code with people you want to invite. They'll need it to join.</p>
          </div>
        )}
        {tp === 'paid' && <>
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
