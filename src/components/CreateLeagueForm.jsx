/**
 * CreateLeagueForm
 *
 * Extracted from goaloracle.jsx — previously defined inside the GoalOracle
 * render function, which re-created the component type on every parent state
 * update and caused inputs to lose focus after each keystroke. Keeping this
 * at module scope stabilizes the component identity so React preserves the
 * DOM and the focused input across re-renders.
 */

import React, { useMemo } from 'react';
import {
  AlertTriangle, CheckCircle, Key, Unlock, Lock, Eye, EyeOff,
  RefreshCw, ChevronRight, Globe, Target, TrendingUp, Loader,
} from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import ModePicker from './simple/ModePicker';

const ALL_GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const ALL_ROUNDS = [
  { id: 'group', label: 'Group Stage' },
  { id: 'r32', label: 'Round of 32' },
  { id: 'r16', label: 'Round of 16' },
  { id: 'qf', label: 'Quarterfinals' },
  { id: 'sf', label: 'Semifinals' },
  { id: 'final', label: 'Final' },
];

function generatePasscode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
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
  const matchScope = createScope, setMatchScope = setCreateScope;
  const selGroups = createGroups, setSelGroups = setCreateGroups;
  const selRounds = createRounds, setSelRounds = setCreateRounds;
  const busy = createBusy, setBusy = setCreateBusy;
  const err = createErr, setErr = setCreateErr;
  const cu = 'USDC';
  const tot = di.first + di.second + di.third;

  const genCode = () => setPasscode(generatePasscode());
  const toggleGroup = (g) => setSelGroups((p) => (p.includes(g) ? p.filter((x) => x !== g) : [...p, g]));
  const toggleRound = (r) => setSelRounds((p) => (p.includes(r) ? p.filter((x) => x !== r) : [...p, r]));

  const scopeMatchCount = useMemo(() => {
    if (matchScope === 'all') return WORLD_CUP_MATCHES.length;
    if (matchScope === 'groups') return WORLD_CUP_MATCHES.filter((m) => !m.isKnockout && selGroups.some((g) => m.stage === `Group ${g}`)).length;
    if (matchScope === 'rounds') {
      return WORLD_CUP_MATCHES.filter((m) => {
        if (selRounds.includes('group') && !m.isKnockout) return true;
        if (selRounds.includes('r32') && m.stage === 'Round of 32') return true;
        if (selRounds.includes('r16') && m.stage === 'Round of 16') return true;
        if (selRounds.includes('qf') && m.stage === 'Quarterfinal') return true;
        if (selRounds.includes('sf') && m.stage === 'Semifinal') return true;
        if (selRounds.includes('final') && (m.stage === 'Final' || m.stage === '3rd Place')) return true;
        return false;
      }).length;
    }
    return 0;
  }, [matchScope, selGroups, selRounds]);

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
    if (matchScope === 'groups' && selGroups.length === 0) { setErr('Select at least one group'); return; }
    if (matchScope === 'rounds' && selRounds.length === 0) { setErr('Select at least one round'); return; }
    if (tp === 'paid' && matchScope === 'rounds') { setErr('Paid leagues must use All Matches or Specific Groups'); return; }
    setBusy(true); setErr('');
    const scopeData = matchScope === 'all' ? { matchScope: 'all' } :
      matchScope === 'groups' ? { matchScope: 'groups', selectedGroups: selGroups } :
      { matchScope: 'rounds', selectedRounds: selRounds };
    try {
      const leagueData = {
        name: nm.trim(), type: tp, visibility: vis,
        passcode: vis === 'private' ? passcode.trim().toUpperCase() : null,
        entryFee: tp === 'paid' ? parseFloat(fe) : 0, currency: cu,
        prizeDistribution: tp === 'paid' ? di : null,
        pointsSystem: createMode === 'simple' ? null : ps,
        predictionMode: createMode,
        ...scopeData,
      };
      const lid = await createLeague(leagueData, uData.id);
      const savedName = nm.trim();
      const savedPasscode = vis === 'private' ? passcode.trim().toUpperCase() : null;
      resetForm();
      setCreateSuccess({ name: savedName, id: lid, passcode: savedPasscode });
    } catch (e) {
      console.error('[create] FAILED:', e);
      setBusy(false);
      setErr(e.message || 'Failed to create league');
      notify('League creation failed: ' + e.message, 'error');
    }
  };

  if (createSuccess) return (
    <div className="create-league">
      <div className="create-success">
        <CheckCircle size={56} className="create-success-icon" />
        <h2>League Created!</h2>
        <p className="create-success-name">{createSuccess.name}</p>
        {createSuccess.passcode && <div className="create-success-code"><Key size={16} /> Invite code: <strong>{createSuccess.passcode}</strong></div>}
        <div className="create-success-actions">
          <button className="btn btn-primary btn-lg" onClick={() => { const l = leagues.find((x) => x.id === createSuccess.id); setCreateSuccess(null); if (l) nav('detail', l); else nav('dashboard'); }}>
            Start Predicting <ChevronRight size={18} />
          </button>
          <button className="btn btn-secondary" onClick={() => { setCreateSuccess(null); nav('dashboard'); }}>
            Go to Dashboard
          </button>
        </div>
        {createSuccess.passcode && <p className="create-success-hint">Share the invite code with friends so they can join your league.</p>}
      </div>
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
        <div className="form-section"><label>Match Selection {tp === 'paid' && <span className="form-hint-inline">(Paid leagues: All Matches or Groups only)</span>}</label>
          <div className="type-selector triple">
            <button type="button" className={`type-option ${matchScope === 'all' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setMatchScope('all'); }}><Globe size={24} /><div><h4>All Matches</h4><p>Full tournament (104)</p></div></button>
            <button type="button" className={`type-option ${matchScope === 'groups' ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); setMatchScope('groups'); }}><Target size={24} /><div><h4>Specific Groups</h4><p>Pick groups A–L</p></div></button>
            <button type="button" className={`type-option ${matchScope === 'rounds' ? 'active' : ''} ${tp === 'paid' ? 'disabled-option' : ''}`} onClick={(e) => { e.preventDefault(); if (tp !== 'paid') setMatchScope('rounds'); }}><TrendingUp size={24} /><div><h4>By Round</h4><p>{tp === 'paid' ? 'Free leagues only' : 'Group stage, knockouts, etc.'}</p></div></button>
          </div>
        </div>
        {matchScope === 'groups' && (
          <div className="form-section">
            <label>Select Groups <span className="form-hint-inline">({selGroups.length} selected · {scopeMatchCount} matches)</span></label>
            <div className="group-selector">{ALL_GROUPS.map((g) => (
              <button type="button" key={g} className={`group-chip ${selGroups.includes(g) ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); toggleGroup(g); }}>
                Group {g}
              </button>
            ))}</div>
          </div>
        )}
        {matchScope === 'rounds' && (
          <div className="form-section">
            <label>Select Rounds <span className="form-hint-inline">({selRounds.length} selected · {scopeMatchCount} matches)</span></label>
            <div className="group-selector">{ALL_ROUNDS.map((r) => (
              <button type="button" key={r.id} className={`group-chip ${selRounds.includes(r.id) ? 'active' : ''}`} onClick={(e) => { e.preventDefault(); toggleRound(r.id); }}>
                {r.label}
              </button>
            ))}</div>
          </div>
        )}
        {createMode !== 'simple' && (
          <div className="form-section"><label>Points System</label><div className="points-grid">{Object.entries(ps).map(([k, v]) => <div className="point-item" key={k}><label>{k.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}</label><input type="number" value={v} min="0" onChange={(e) => setPs({ ...ps, [k]: parseInt(e.target.value) || 0 })} className="input-field-sm" /></div>)}</div></div>
        )}
        <div className="form-actions"><button className="btn btn-secondary" onClick={() => nav('dashboard')}>Cancel</button><button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? <><RefreshCw size={18} className="spin" /> Creating...</> : <>Create League <ChevronRight size={18} /></>}</button></div>
      </div>
    </div>
  );
}
