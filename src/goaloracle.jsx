import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Trophy, Users, Coins, Shield, ChevronRight, Menu, X, Globe, Zap, TrendingUp, Award, Lock, Unlock, LogOut, Plus, Search, CheckCircle, Clock, Target, Save, Eye, RefreshCw, UserPlus, AlertTriangle, Copy, Wallet, ChevronDown, User, ArrowRightLeft, ExternalLink, Loader } from 'lucide-react';
import WORLD_CUP_MATCHES from './data/matches';
import { calculatePoints, calculateTotalPoints, sortLeaderboard, getMatchStatus } from './utils/points';
import { createOrUpdateUser, getUserRole, createLeague, joinLeague, subscribeToUserLeagues, subscribeToAllLeagues, saveBatchPredictions, subscribeToUserPredictions, subscribeToMatchResults, subscribeToPlatformStats, getLeagueLeaderboard, setAuthToken } from './utils/db';
import AdminDashboard from './components/AdminDashboard';
import './styles.css';

const AnimatedCounter = ({ value, prefix = '', suffix = '', decimals = 0 }) => {
  const [d, setD] = useState(0);
  useEffect(() => { if (!value) { setD(0); return; } let cur = 0, step = 0; const inc = value / 60; const t = setInterval(() => { step++; cur = Math.min(cur + inc, value); setD(cur); if (step >= 60) { setD(value); clearInterval(t); } }, 25); return () => clearInterval(t); }, [value]);
  return <span>{prefix}{decimals > 0 ? d.toFixed(decimals) : Math.floor(d).toLocaleString()}{suffix}</span>;
};

const GoalOracle = () => {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const [view, setView] = useState('landing');
  const [menuOpen, setMenuOpen] = useState(false);
  const [selLeague, setSelLeague] = useState(null);
  const [role, setRole] = useState('user');
  const [uData, setUData] = useState(null);
  const [preds, setPreds] = useState({});
  const [results, setResults] = useState({});
  const [leagues, setLeagues] = useState([]);
  const [allLeagues, setAllLeagues] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notif, setNotif] = useState(null);
  const [stats, setStats] = useState({ totalPlayers: 0, totalPrizePools: 0, activeLeagues: 0 });

  const notify = useCallback((msg, type = 'success') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000); }, []);
  const nav = useCallback((v, l) => { if (l) setSelLeague(l); setView(v); setMenuOpen(false); }, []);

  useEffect(() => subscribeToPlatformStats(setStats), []);
  useEffect(() => subscribeToMatchResults(setResults), []);
  useEffect(() => { if (!authenticated || !user) { setUData(null); setRole('user'); setAuthToken(null); return; } (async () => { try { const token = await getAccessToken(); setAuthToken(token); const u = await createOrUpdateUser(user); if (u) { setUData(u); setRole(u.role || 'user'); } else { console.error('createOrUpdateUser returned null'); notify('Account setup failed. Please try logging out and back in.', 'error'); } } catch(e) { console.error('User setup error:', e); notify('Account setup error: ' + e.message, 'error'); } })(); }, [authenticated, user]);
  useEffect(() => { if (!uData?.id) return; return subscribeToUserLeagues(uData.id, setLeagues); }, [uData?.id]);
  useEffect(() => subscribeToAllLeagues(setAllLeagues), []);
  useEffect(() => { if (!uData?.id || !selLeague?.id) return; return subscribeToUserPredictions(uData.id, selLeague.id, setPreds); }, [uData?.id, selLeague?.id]);
  useEffect(() => { if (authenticated && view === 'landing') setView('dashboard'); }, [authenticated]);

  const handleSave = async () => { if (!uData?.id || !selLeague?.id) return; setSaving(true); try { await saveBatchPredictions(uData.id, selLeague.id, preds); notify('Predictions saved!'); } catch(e) { notify('Save failed', 'error'); } finally { setSaving(false); } };

  const stages = ['Group A','Group B','Group C','Group D','Group E','Group F','Group G','Group H','Group I','Group J','Group K','Group L','Round of 32','Round of 16','Quarterfinal','Semifinal','3rd Place','Final'];

  // Compact Prediction Row — fits 4-5 per screen
  const PredictionCard = ({ match }) => {
    const p = preds[match.id] || { result: null, score: { home: '', away: '' }, extraTime: false, penalties: false };
    const status = getMatchStatus(match.date, match.time);
    const locked = status !== 'open';
    const res = results[match.id];
    const pts = res?.completed ? calculatePoints(p, res, selLeague?.pointsSystem || {}) : null;
    const upd = (f, v) => { if (locked) return; const u = { ...p }; if (f === 'result') u.result = v; else if (f === 'hs') u.score = { ...u.score, home: v }; else if (f === 'as') u.score = { ...u.score, away: v }; else if (f === 'et') u.extraTime = v; else if (f === 'pen') u.penalties = v; setPreds(pr => ({ ...pr, [match.id]: u })); };
    const clamp = e => String(Math.max(0, Math.min(15, parseInt(e.target.value) || 0)));
    const dateStr = new Date(match.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return (
      <div className={`pred-row ${locked ? 'locked' : ''} ${res?.completed ? 'completed' : ''}`}>
        {/* Top bar: date, venue, status */}
        <div className="pred-meta">
          <span className="pred-stage-badge">{match.stage}</span>
          <span className="pred-venue">{match.city}</span>
          <span className="pred-date">{dateStr} • {match.time}</span>
          {locked && <span className="lock-badge"><Lock size={10} /></span>}
          {pts !== null && <span className="points-badge">+{pts}</span>}
        </div>

        {/* Main row: teams + score inputs + result buttons */}
        <div className="pred-main">
          <div className="pred-teams">
            <div className="pred-team">
              <span className="flag">{match.homeFlag}</span>
              <span className="pred-team-name">{match.home}</span>
            </div>
            <div className="pred-team">
              <span className="flag">{match.awayFlag}</span>
              <span className="pred-team-name">{match.away}</span>
            </div>
          </div>

          {res?.completed ? (
            <div className="pred-final-score">
              <span className="fs-num">{res.homeScore}</span>
              <span className="fs-sep">-</span>
              <span className="fs-num">{res.awayScore}</span>
              {res.extraTime && <span className="fs-tag">AET</span>}
              {res.penalties && <span className="fs-tag">PEN</span>}
            </div>
          ) : !locked ? (<>
            <div className="pred-scores">
              <input type="number" min="0" max="15" placeholder="–" className="pred-score-input" value={p.score.home} onChange={e => upd('hs', clamp(e))} />
              <span className="pred-score-sep">:</span>
              <input type="number" min="0" max="15" placeholder="–" className="pred-score-input" value={p.score.away} onChange={e => upd('as', clamp(e))} />
            </div>
            <div className="pred-picks">
              <button className={`pred-pick ${p.result === 'home' ? 'active home-pick' : ''}`} onClick={() => upd('result', 'home')}>1</button>
              <button className={`pred-pick ${p.result === 'draw' ? 'active draw-pick' : ''}`} onClick={() => upd('result', 'draw')}>X</button>
              <button className={`pred-pick ${p.result === 'away' ? 'active away-pick' : ''}`} onClick={() => upd('result', 'away')}>2</button>
            </div>
            {match.isKnockout && <div className="pred-ko-opts">
              <label className="pred-ko-label"><input type="checkbox" checked={p.extraTime || false} onChange={e => upd('et', e.target.checked)} /><span>ET</span></label>
              <label className="pred-ko-label"><input type="checkbox" checked={p.penalties || false} onChange={e => upd('pen', e.target.checked)} /><span>Pen</span></label>
            </div>}
          </>) : (
            <div className="pred-locked-pick">
              {p.result ? <span className="locked-result">{p.result === 'home' ? '1' : p.result === 'away' ? '2' : 'X'}{p.score.home !== '' && ` (${p.score.home}-${p.score.away})`}</span> : <span className="no-pick">—</span>}
            </div>
          )}
        </div>
      </div>
    );
  };

  const Landing = () => (
    <div className="landing-page">
      <section className="hero"><div className="hero-grid"></div>
        <div className="hero-content">
          <div className="hero-badge"><Zap size={16} /><span>World Cup 2026</span></div>
          <h1 className="hero-title">Predict. Compete. <span className="highlight">Dominate.</span></h1>
          <p className="hero-subtitle">Join fans predicting all 104 FIFA World Cup 2026 matches. Play for glory or crypto prizes.</p>
          <div className="hero-cta">
            <button className="btn btn-primary" onClick={() => authenticated ? nav('dashboard') : login()}><Globe size={20} /> Start Predicting</button>
            <button className="btn btn-secondary" onClick={() => document.querySelector('.features')?.scrollIntoView({ behavior: 'smooth' })}>Learn More <ChevronRight size={18} /></button>
          </div>
          <div className="hero-stats">
            <div className="stat"><div className="stat-value"><AnimatedCounter value={stats.totalPlayers} suffix="+" /></div><div className="stat-label">Players</div></div>
            <div className="stat"><div className="stat-value"><AnimatedCounter value={stats.totalPrizePools} prefix="$" /></div><div className="stat-label">Prize Pools</div></div>
            <div className="stat"><div className="stat-value"><AnimatedCounter value={stats.activeLeagues} /></div><div className="stat-label">Leagues</div></div>
          </div>
        </div>
      </section>
      <section className="features"><div className="container">
        <div className="section-header"><h2>How It Works</h2><p>Three simple steps to start winning</p></div>
        <div className="features-grid">
          <div className="feature-card"><div className="feature-icon"><Trophy /></div><h3>Make Predictions</h3><p>Predict winners, draws, and exact scores for all 104 World Cup matches including knockout rounds</p></div>
          <div className="feature-card"><div className="feature-icon"><Users /></div><h3>Join Leagues</h3><p>Compete globally or create private leagues. Free or crypto-staked competitions</p></div>
          <div className="feature-card"><div className="feature-icon"><Award /></div><h3>Win Rewards</h3><p>Earn points for correct predictions. Top players win crypto prizes via smart contracts</p></div>
        </div>
      </div></section>
      <section className="crypto-section"><div className="container"><div className="crypto-content">
        <div className="crypto-text">
          <h2>Non-Custodial. Transparent. Fair.</h2>
          <p>Funds go directly to smart contracts — never to us. Prizes distributed automatically.</p>
          <ul className="crypto-features">
            <li><CheckCircle size={20} /> Secure wallet integration via Privy</li>
            <li><CheckCircle size={20} /> Non-custodial smart contract payouts</li>
            <li><CheckCircle size={20} /> Customizable prize structures</li>
            <li><CheckCircle size={20} /> Verifiable on-chain transactions</li>
          </ul>
        </div>
        <div className="crypto-visual"><div className="wallet-card"><Coins size={48} /><div className="wallet-info"><div className="wallet-label">Entry Fee</div><div className="wallet-amount">50 USDC</div></div><div className="wallet-info"><div className="wallet-label">Prize Pool</div><div className="wallet-amount">5,000 USDC</div></div></div></div>
      </div></div></section>
    </div>
  );

  const Dash = () => {
    const ml = leagues.length > 0 ? leagues : [{ id: 'global', name: 'Global League', type: 'free', memberCount: stats.totalPlayers, pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 } }];
    return (
      <div className="dashboard">
        <div className="dashboard-header">
          <div><h1>Your Leagues</h1><p>Welcome back, {uData?.displayName || 'Player'}</p></div>
          <div className="dashboard-actions">
            <button className="btn btn-secondary" onClick={() => nav('browse')}><Search size={18} /> Browse</button>
            <button className="btn btn-primary" onClick={() => nav('create')}><Plus size={20} /> Create League</button>
          </div>
        </div>
        <div className="leagues-grid">{ml.map(l => (
          <div key={l.id} className="league-card" onClick={() => nav('detail', l)}>
            <div className="league-header"><div className="league-title"><Trophy size={24} /><h3>{l.name}</h3></div>
              {l.type === 'paid' ? <span className="badge badge-premium"><Coins size={14} /> {l.entryFee} {l.currency || 'USDC'}</span> : <span className="badge badge-free">Free</span>}
            </div>
            <div className="league-stats"><div className="league-stat"><Users size={18} /><span>{(l.memberCount || l.members?.length || 0).toLocaleString()} players</span></div></div>
            <div className="league-footer"><span className="view-league">View League</span><ChevronRight size={18} /></div>
          </div>
        ))}</div>
      </div>
    );
  };

  const Browse = () => {
    const [q, setQ] = useState('');
    const f = allLeagues.filter(l => l.name?.toLowerCase().includes(q.toLowerCase()));
    return (
      <div className="browse-leagues">
        <div className="page-header"><button className="btn-back" onClick={() => nav('dashboard')}>← Back</button><h1>Browse Leagues</h1></div>
        <div className="search-bar"><Search size={20} /><input type="text" placeholder="Search..." value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="leagues-grid">{f.map(l => {
          const mem = l.members?.includes(uData?.id);
          return (<div key={l.id} className="league-card">
            <div className="league-header"><div className="league-title"><Trophy size={24} /><h3>{l.name}</h3></div>{l.type === 'paid' ? <span className="badge badge-premium"><Coins size={14} /> {l.entryFee} {l.currency}</span> : <span className="badge badge-free">Free</span>}</div>
            <div className="league-stats"><div className="league-stat"><Users size={18} /><span>{l.memberCount || 0} players</span></div></div>
            <div className="league-footer">{mem ? <button className="btn btn-secondary btn-sm" onClick={() => nav('detail', l)}><Eye size={16} /> View</button> : <button className="btn btn-primary btn-sm" onClick={async () => { if (!uData?.id) return; try { await joinLeague(l.id, uData.id); notify(`Joined ${l.name}!`); } catch(e) { notify(e.message, 'error'); } }}><UserPlus size={16} /> Join</button>}</div>
          </div>);
        })}{f.length === 0 && <div className="empty-state"><p>No leagues found.</p><button className="btn btn-primary" onClick={() => nav('create')}><Plus size={18} /> Create</button></div>}</div>
      </div>
    );
  };

  const Create = () => {
    const [tp, setTp] = useState('free');
    const [nm, setNm] = useState('');
    const [fe, setFe] = useState('');
    const [cu, setCu] = useState('USDC');
    const [di, setDi] = useState({ first: 50, second: 30, third: 20 });
    const [ps, setPs] = useState({ correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const tot = di.first + di.second + di.third;
    const go = async () => {
      if (!uData?.id) { setErr('Still loading your account. Please wait a moment and try again.'); return; }
      if (!nm.trim()) { setErr('Name required'); return; }
      if (tp === 'paid' && (!fe || parseFloat(fe) <= 0)) { setErr('Fee required'); return; }
      if (tp === 'paid' && tot !== 100) { setErr('Must total 100%'); return; }
      setBusy(true); setErr('');
      try { await createLeague({ name: nm.trim(), type: tp, entryFee: tp === 'paid' ? parseFloat(fe) : 0, currency: cu, prizeDistribution: tp === 'paid' ? di : null, pointsSystem: ps }, uData.id); notify('League created!'); nav('dashboard'); } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };
    return (
      <div className="create-league">
        <div className="page-header"><button className="btn-back" onClick={() => nav('dashboard')}>← Back</button><h1>Create Your League</h1></div>
        <div className="create-league-form">
          {err && <div className="form-error"><AlertTriangle size={16} /> {err}</div>}
          <div className="form-section"><label>League Type</label>
            <div className="type-selector">
              <button className={`type-option ${tp === 'free' ? 'active' : ''}`} onClick={() => setTp('free')}><Unlock size={24} /><div><h4>Free League</h4><p>Play for fun and glory</p></div></button>
              <button className={`type-option ${tp === 'paid' ? 'active' : ''}`} onClick={() => setTp('paid')}><Lock size={24} /><div><h4>Paid League</h4><p>Stake crypto, win rewards</p></div></button>
            </div>
          </div>
          <div className="form-section"><label>League Name</label><input type="text" placeholder="e.g., Friends & Family 2026" value={nm} onChange={e => setNm(e.target.value)} className="input-field" /></div>
          {tp === 'paid' && <>
            <div className="form-section"><label>Entry Fee</label><div className="input-group"><input type="number" placeholder="50" value={fe} min="1" onChange={e => setFe(e.target.value)} className="input-field" /><select value={cu} onChange={e => setCu(e.target.value)} className="select-field"><option value="USDC">USDC</option><option value="USDG">USDG</option></select></div></div>
            <div className="form-section"><label>Prize Distribution {tot !== 100 && <span className="validation-error">(Currently {tot}%)</span>}</label>
              <div className="prize-distribution">{['first','second','third'].map((k,i) => <div key={k} className="prize-item"><span>{['1st','2nd','3rd'][i]} Place</span><input type="number" value={di[k]} onChange={e => setDi({...di,[k]:parseInt(e.target.value)||0})} className="input-field-sm" /><span>%</span></div>)}</div>
            </div>
          </>}
          <div className="form-section"><label>Points System</label><div className="points-grid">{Object.entries(ps).map(([k,v]) => <div className="point-item" key={k}><label>{k.replace(/([A-Z])/g,' $1').replace(/^./,s=>s.toUpperCase())}</label><input type="number" value={v} min="0" onChange={e=>setPs({...ps,[k]:parseInt(e.target.value)||0})} className="input-field-sm" /></div>)}</div></div>
          <div className="form-actions"><button className="btn btn-secondary" onClick={() => nav('dashboard')}>Cancel</button><button className="btn btn-primary" onClick={go} disabled={busy}>{busy ? <><RefreshCw size={18} className="spin" /> Creating...</> : <>Create League <ChevronRight size={18} /></>}</button></div>
        </div>
      </div>
    );
  };

  const Detail = () => {
    const [tab, setTab] = useState('predictions');
    const [sf, setSf] = useState('all');
    const [lb, setLb] = useState([]);
    const [lbl, setLbl] = useState(false);

    useEffect(() => { if (tab !== 'leaderboard' || !selLeague?.id) return; (async () => { setLbl(true); try { const bu = await getLeagueLeaderboard(selLeague.id); const p = selLeague.pointsSystem || {}; const e = Object.entries(bu).map(([uid, pr]) => ({ userId: uid, displayName: uid.slice(0, 8), ...calculateTotalPoints(pr, results, p) })); setLb(sortLeaderboard(e)); } catch(e){console.error(e);} finally{setLbl(false);} })(); }, [tab, selLeague?.id, results]);

    const fm = sf === 'all' ? WORLD_CUP_MATCHES : WORLD_CUP_MATCHES.filter(m => m.stage === sf);
    const hasU = Object.values(preds).some(p => p.result);

    return (
      <div className="league-detail">
        <div className="page-header"><button className="btn-back" onClick={() => nav('dashboard')}>← Back to Leagues</button>
          <div className="league-info"><h1>{selLeague?.name}</h1><div className="league-meta"><span><Users size={16} /> {(selLeague?.memberCount || selLeague?.members?.length || 0).toLocaleString()} players</span>{selLeague?.type === 'paid' && <span><Coins size={16} /> {selLeague?.entryFee} {selLeague?.currency || 'USDC'}</span>}</div></div>
        </div>
        <div className="tabs">
          <button className={`tab ${tab === 'predictions' ? 'active' : ''}`} onClick={() => setTab('predictions')}><Target size={16} /> Predictions</button>
          <button className={`tab ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}><TrendingUp size={16} /> Leaderboard</button>
          <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}><Shield size={16} /> Rules</button>
        </div>

        {tab === 'predictions' && <div className="predictions-view">
          <div className="predictions-toolbar">
            <select value={sf} onChange={e => setSf(e.target.value)} className="select-field"><option value="all">All Stages ({WORLD_CUP_MATCHES.length})</option>{stages.map(s => { const c = WORLD_CUP_MATCHES.filter(m => m.stage === s).length; return c > 0 ? <option key={s} value={s}>{s} ({c})</option> : null; })}</select>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving || !hasU}>{saving ? <><RefreshCw size={16} className="spin" /> Saving...</> : <><Save size={16} /> Save</>}</button>
          </div>
          <div className="matches-list">{fm.map(m => <PredictionCard key={m.id} match={m} />)}</div>
          {hasU && <div className="sticky-save"><button className="btn btn-primary btn-lg" onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save All Predictions'}</button></div>}
        </div>}

        {tab === 'leaderboard' && <div className="leaderboard"><div className="leaderboard-header"><h3>Rankings</h3></div>
          {lbl ? <div className="loading-state"><RefreshCw size={24} className="spin" /> Loading...</div>
            : lb.length === 0 ? <div className="empty-state"><p>No predictions yet.</p></div>
            : <div className="leaderboard-list">{lb.map((e, i) => (
              <div key={e.userId} className={`leaderboard-item ${e.userId === uData?.id ? 'is-you' : ''}`}>
                <div className="rank">{i === 0 && <Trophy size={20} className="gold" />}{i === 1 && <Trophy size={20} className="silver" />}{i === 2 && <Trophy size={20} className="bronze" />}{i > 2 && <span>#{i+1}</span>}</div>
                <div className="player-info"><div className="player-avatar">{e.displayName[0]?.toUpperCase()}</div><div><div className="player-name">{e.displayName} {e.userId === uData?.id && <span className="you-badge">You</span>}</div><div className="player-sub">{e.correctResults} correct • {e.exactScores} exact</div></div></div>
                <div className="player-points"><span className="points">{e.totalPoints} pts</span></div>
              </div>
            ))}</div>}
        </div>}

        {tab === 'rules' && <div className="rules-view">
          <div className="rules-card"><h3>Points System</h3><div className="points-breakdown">
            <div className="point-rule"><Target size={20} /><div><strong>Correct Result</strong><p>+{selLeague?.pointsSystem?.correctResult || 3} pts</p></div></div>
            <div className="point-rule"><Award size={20} /><div><strong>Correct Score</strong><p>+{selLeague?.pointsSystem?.correctScore || 5} pts</p></div></div>
            <div className="point-rule"><Zap size={20} /><div><strong>Penalty Prediction</strong><p>+{selLeague?.pointsSystem?.penaltyBonus || 2} pts</p></div></div>
            <div className="point-rule"><Clock size={20} /><div><strong>Extra Time</strong><p>+{selLeague?.pointsSystem?.extraTimeBonus || 1} pt</p></div></div>
          </div></div>
          <div className="rules-card"><h3>Tiebreaker Rules</h3><div className="tiebreaker-list">
            <div className="tiebreaker-item"><span className="tb-num">1</span> Total points</div>
            <div className="tiebreaker-item"><span className="tb-num">2</span> Exact score predictions</div>
            <div className="tiebreaker-item"><span className="tb-num">3</span> Knockout bonus predictions</div>
            <div className="tiebreaker-item"><span className="tb-num">4</span> Earliest submission</div>
          </div></div>
          <div className="rules-card"><h3>Deadline</h3><p>Predictions lock <strong>5 minutes</strong> before kickoff.</p></div>
        </div>}
      </div>
    );
  };

  // ================================
  // ACCOUNT DROPDOWN + ADD FUNDS MODAL
  // ================================
  const CHAINS = [
    { id: 137, name: 'Polygon', color: '#8247E5' },
    { id: 8453, name: 'Base', color: '#0052FF' },
    { id: 42161, name: 'Arbitrum', color: '#28A0F0' },
    { id: 10, name: 'Optimism', color: '#FF0420' },
    { id: 1, name: 'Ethereum', color: '#627EEA' },
  ];
  const TOKENS = ['ETH', 'USDC', 'USDT', 'MATIC'];

  const [fundModal, setFundModal] = useState(false);

  const AddFundsModal = () => {
    const [srcChain, setSrcChain] = useState(CHAINS[4]); // Ethereum
    const [srcToken, setSrcToken] = useState('ETH');
    const [amount, setAmount] = useState('');
    const [depositAddr, setDepositAddr] = useState(null);
    const [reqId, setReqId] = useState(null);
    const [bridgeStatus, setBridgeStatus] = useState(null);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState('');
    const [copied2, setCopied2] = useState(false);
    const walletAddr = typeof user?.wallet === 'string' ? user.wallet : user?.wallet?.address || uData?.walletAddress || '';

    const getDecimals = () => {
      if (srcToken === 'ETH' || srcToken === 'MATIC') return 18;
      return 6; // USDC, USDT
    };

    const toSmallestUnit = (val) => {
      const dec = getDecimals();
      const parts = val.split('.');
      const whole = parts[0] || '0';
      let frac = (parts[1] || '').padEnd(dec, '0').slice(0, dec);
      return BigInt(whole) * BigInt(10 ** dec) + BigInt(frac);
    };

    const requestDeposit = async () => {
      setErr(''); setLoading(true); setDepositAddr(null);
      if (!amount || parseFloat(amount) <= 0) { setErr('Enter a valid amount'); setLoading(false); return; }
      if (!walletAddr) { setErr('No wallet connected'); setLoading(false); return; }
      try {
        const res = await fetch('/api/bridge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await getAccessToken()}` },
          body: JSON.stringify({
            recipientAddress: walletAddr,
            originChainId: srcChain.id,
            originToken: srcToken,
            destinationChainId: 137,
            amount: toSmallestUnit(amount).toString(),
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setDepositAddr(data.depositAddress);
        setReqId(data.requestId);
      } catch (e) {
        setErr(e.message);
      } finally { setLoading(false); }
    };

    const checkStatus = async () => {
      if (!reqId) return;
      try {
        const res = await fetch(`/api/bridge?requestId=${reqId}`, {
          headers: { 'Authorization': `Bearer ${await getAccessToken()}` },
        });
        const data = await res.json();
        setBridgeStatus(data.status || data.state || 'pending');
      } catch (e) { setBridgeStatus('error'); }
    };

    const copyDeposit = () => {
      if (!depositAddr) return;
      navigator.clipboard.writeText(depositAddr).then(() => {
        setCopied2(true);
        setTimeout(() => setCopied2(false), 2000);
      });
    };

    return (
      <div className="modal-overlay" onClick={() => setFundModal(false)}>
        <div className="fund-modal" onClick={e => e.stopPropagation()}>
          <div className="fund-modal-header">
            <h3><Wallet size={20} /> Add Funds</h3>
            <button className="modal-close" onClick={() => setFundModal(false)}><X size={20} /></button>
          </div>
          <p className="fund-desc">Send any supported token from any chain — it auto-converts to USDC on Polygon for your prize pool.</p>

          {!depositAddr ? (<>
            <div className="fund-section">
              <label>Send from</label>
              <div className="fund-row">
                <select className="fund-select" value={srcChain.id} onChange={e => setSrcChain(CHAINS.find(c => c.id === parseInt(e.target.value)))}>
                  {CHAINS.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="fund-select" value={srcToken} onChange={e => setSrcToken(e.target.value)}>
                  {TOKENS.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            <div className="fund-arrow"><ArrowRightLeft size={20} /></div>

            <div className="fund-section">
              <label>Receive as</label>
              <div className="fund-dest">
                <span className="chain-dot" style={{ background: '#8247E5' }}></span>
                <strong>USDC</strong> on <strong>Polygon</strong>
              </div>
            </div>

            <div className="fund-section">
              <label>Amount</label>
              <input type="number" className="fund-input" placeholder={`0.00 ${srcToken}`} value={amount} onChange={e => setAmount(e.target.value)} min="0" step="any" />
            </div>

            {err && <div className="fund-error"><AlertTriangle size={14} /> {err}</div>}

            <button className="btn btn-primary fund-btn" onClick={requestDeposit} disabled={loading}>
              {loading ? <><Loader size={16} className="spin" /> Getting deposit address...</> : 'Get Deposit Address'}
            </button>
          </>) : (<>
            <div className="fund-success">
              <CheckCircle size={20} />
              <span>Deposit address ready!</span>
            </div>
            <div className="fund-section">
              <label>Send {amount} {srcToken} on {srcChain.name} to:</label>
              <div className="deposit-addr-box">
                <code>{depositAddr}</code>
                <button className="copy-btn" onClick={copyDeposit}>{copied2 ? <CheckCircle size={14} /> : <Copy size={14} />}</button>
              </div>
            </div>
            <p className="fund-note">After sending, Relay will automatically bridge and swap your {srcToken} to USDC on Polygon and deliver it to your wallet.</p>

            <div className="fund-actions">
              <button className="btn btn-secondary btn-sm" onClick={checkStatus}>
                <RefreshCw size={14} /> Check Status
              </button>
              {bridgeStatus && <span className={`bridge-status ${bridgeStatus}`}>{bridgeStatus}</span>}
            </div>

            <button className="btn btn-sm fund-new" onClick={() => { setDepositAddr(null); setReqId(null); setBridgeStatus(null); setAmount(''); }}>
              New Deposit
            </button>
          </>)}
        </div>
      </div>
    );
  };

  const AccountDropdown = () => {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [activeChain, setActiveChain] = useState(CHAINS[0]);
    const walletAddr = typeof user?.wallet === 'string' ? user.wallet : user?.wallet?.address || uData?.walletAddress || '';

    const copyAddress = () => {
      if (!walletAddr) return;
      navigator.clipboard.writeText(walletAddr).then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      });
    };

    return (
      <div className="account-dropdown-wrap">
        <button className="account-btn" onClick={() => setOpen(!open)}>
          <span className="chain-dot" style={{ background: activeChain.color }}></span>
          <span>Account</span>
          <ChevronDown size={14} className={open ? 'flip' : ''} />
        </button>
        {open && <>
          <div className="dropdown-overlay" onClick={() => setOpen(false)}></div>
          <div className="account-dropdown">
            <div className="dropdown-header">
              <div className="dropdown-name">{uData?.displayName || 'User'}</div>
              {uData?.email && <div className="dropdown-email">{uData.email}</div>}
            </div>
            <div className="dropdown-divider"></div>
            <div className="dropdown-section-label">Network</div>
            <div className="chain-selector">
              {CHAINS.map(c => (
                <button key={c.id} className={`chain-option ${activeChain.id === c.id ? 'active' : ''}`} onClick={() => setActiveChain(c)}>
                  <span className="chain-dot" style={{ background: c.color }}></span>
                  <span>{c.name}</span>
                </button>
              ))}
            </div>
            <div className="dropdown-divider"></div>
            <div className="dropdown-section-label">Wallet</div>
            {walletAddr ? (
              <div className="dropdown-wallet">
                <code className="wallet-addr">{walletAddr.slice(0, 10)}...{walletAddr.slice(-8)}</code>
                <button className="copy-btn" onClick={copyAddress} title="Copy address">
                  {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                </button>
              </div>
            ) : (
              <div className="dropdown-wallet"><span className="no-wallet">No wallet connected</span></div>
            )}
            <button className="dropdown-item" onClick={() => { setOpen(false); setFundModal(true); }}>
              <ArrowRightLeft size={16} />
              <div>
                <div className="dropdown-item-title">Add Funds</div>
                <div className="dropdown-item-sub">Bridge any token to USDC on Polygon</div>
              </div>
            </button>
            <button className="dropdown-item" onClick={() => { copyAddress(); notify(walletAddr ? 'Wallet address copied!' : 'No wallet', walletAddr ? 'success' : 'error'); }}>
              <Copy size={16} />
              <div>
                <div className="dropdown-item-title">Copy Address</div>
                <div className="dropdown-item-sub">Direct transfer on {activeChain.name}</div>
              </div>
            </button>
            <div className="dropdown-divider"></div>
            <button className="dropdown-item logout-item" onClick={() => { setOpen(false); logout(); nav('landing'); }}>
              <LogOut size={16} />
              <span>Log Out</span>
            </button>
          </div>
        </>}
      </div>
    );
  };

  const Nav = () => (
    <nav className="navbar"><div className="nav-container">
      <div className="nav-brand" onClick={() => nav(authenticated ? 'dashboard' : 'landing')}><Trophy size={28} /><span>GoalOracle</span></div>
      <div className={`nav-menu ${menuOpen ? 'active' : ''}`}>
        {authenticated && <><a onClick={() => nav('dashboard')}>Dashboard</a><a onClick={() => nav('browse')}>Leagues</a>{(role === 'superadmin' || role === 'admin') && <a onClick={() => nav('admin')}>Admin</a>}</>}
        {authenticated ? <AccountDropdown /> : <button className="btn btn-primary btn-sm" onClick={login}>Connect</button>}
      </div>
      <button className="mobile-toggle" onClick={() => setMenuOpen(!menuOpen)}>{menuOpen ? <X size={24} /> : <Menu size={24} />}</button>
    </div></nav>
  );

  return (
    <div className="app">
      {notif && <div className={`notification ${notif.type}`}>{notif.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}<span>{notif.msg}</span></div>}
      <Nav />
      {view === 'landing' && <Landing />}
      {view === 'dashboard' && <Dash />}
      {view === 'browse' && <Browse />}
      {view === 'create' && <Create />}
      {view === 'detail' && <Detail />}
      {view === 'admin' && (role === 'superadmin' || role === 'admin') && <AdminDashboard userData={uData} platformStats={stats} matchResults={results} notify={notify} />}
      {fundModal && <AddFundsModal />}
    </div>
  );
};

export default GoalOracle;
