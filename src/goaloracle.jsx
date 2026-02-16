import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Trophy, Users, Coins, Shield, ChevronRight, Menu, X, Globe, Zap, TrendingUp, Award, Lock, Unlock, LogOut, Plus, Search, CheckCircle, Clock, Target, Save, Eye, EyeOff, RefreshCw, UserPlus, AlertTriangle, Copy, Wallet, ChevronDown, User, ArrowRightLeft, ExternalLink, Loader, Moon, Sun, Trash2, Share2, Key, Home, HelpCircle, Sparkles } from 'lucide-react';
import WORLD_CUP_MATCHES from './data/matches';
import { getCode } from './utils/countryCodes';
import { getPedigree, FINALS, CHAMPIONS } from './utils/pedigree';
import { calculatePoints, calculateTotalPoints, sortLeaderboard, getMatchStatus } from './utils/points';
import { createOrUpdateUser, updateUserProfile, getUserRole, createLeague, joinLeague, deleteLeague, leaveLeague, subscribeToUserLeagues, subscribeToAllLeagues, saveBatchPredictions, subscribeToUserPredictions, subscribeToMatchResults, subscribeToPlatformStats, getLeagueLeaderboard, setAuthToken } from './utils/db';
import { validateUsername } from './utils/profanity';
import AdminDashboard from './components/AdminDashboard';
import './styles.css';

// Scroll reveal hook with stadium + code wall parallax + section depth
const useScrollReveal = () => {
  useEffect(() => {
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); obs.unobserve(e.target); } });
    }, { threshold: 0.08, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.reveal, .reveal-left, .reveal-right, .reveal-scale, .reveal-float, .section-zoom').forEach(el => obs.observe(el));

    const onScroll = () => {
      const y = window.scrollY;
      const vh = window.innerHeight;
      // Stadium hero parallax + subtle zoom
      const bg = document.querySelector('.hero-stadium-bg');
      if (bg) bg.style.transform = `scale(${1.05 + y * 0.0002}) translateY(${y * 0.3}px)`;
      // Hero content counter-parallax (moves up slightly slower)
      const hc = document.querySelector('.hero-content');
      if (hc) hc.style.transform = `translateY(${y * 0.08}px)`;
      // Hero overlay opacity shift
      const ho = document.querySelector('.hero-stadium-overlay');
      if (ho) ho.style.opacity = Math.min(1, 0.85 + y * 0.0005);
      // Code wall columns — different speeds per column
      document.querySelectorAll('.code-col').forEach((col, i) => {
        const speeds = [0.07, -0.05, 0.09, -0.06, 0.08, -0.04];
        col.style.transform = `translateY(${y * speeds[i]}px)`;
      });
      // Atmosphere section bg parallax
      const abg = document.querySelector('.atmosphere-bg');
      if (abg) {
        const rect = abg.parentElement.getBoundingClientRect();
        const offset = (rect.top - vh) * -0.15;
        abg.style.transform = `translateY(${offset}px) scale(1.1)`;
      }
      // Floating depth on feature cards
      document.querySelectorAll('.feature-card').forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        const center = rect.top + rect.height / 2;
        const dist = (center - vh / 2) / vh;
        card.style.transform = `translateY(${dist * -8}px) scale(${1 - Math.abs(dist) * 0.015})`;
      });
      // Legacy cards subtle float
      document.querySelectorAll('.legacy-card').forEach((card, i) => {
        const rect = card.getBoundingClientRect();
        if (rect.top < vh && rect.bottom > 0) {
          const progress = 1 - rect.top / vh;
          card.style.transform = `translateY(${(1 - progress) * 12}px)`;
        }
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { obs.disconnect(); window.removeEventListener('scroll', onScroll); };
  }, []);
};

const AnimatedCounter = ({ value, prefix = '', suffix = '', decimals = 0 }) => {
  const [d, setD] = useState(0);
  useEffect(() => { if (!value) { setD(0); return; } let cur = 0, step = 0; const inc = value / 60; const t = setInterval(() => { step++; cur = Math.min(cur + inc, value); setD(cur); if (step >= 60) { setD(value); clearInterval(t); } }, 25); return () => clearInterval(t); }, [value]);
  return <span>{prefix}{decimals > 0 ? d.toFixed(decimals) : Math.floor(d).toLocaleString()}{suffix}</span>;
};

const GoalOracle = () => {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const [view, setView] = useState('landing');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [confetti, setConfetti] = useState(false);
  const cycleTheme = () => {
    const order = ['dark', 'light', 'fifa2026'];
    const next = order[(order.indexOf(theme) + 1) % 3];
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    if (next === 'fifa2026') {
      setConfetti(true);
      setTimeout(() => setConfetti(false), 3000);
    }
  };
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
  const [showUsernamePrompt, setShowUsernamePrompt] = useState(false);
  // Lifted from Detail — survives Firestore re-renders
  const [detailTab, setDetailTab] = useState('predictions');
  const [detailWeek, setDetailWeek] = useState('week1');
  const [detailStage, setDetailStage] = useState('all');

  const notify = useCallback((msg, type = 'success') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000); }, []);
  const nav = useCallback((v, l) => {
    if (l) { setSelLeague(l); setDetailTab('predictions'); setDetailWeek('week1'); setDetailStage('all'); }
    setView(prev => prev === v && !l ? prev : v);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => subscribeToPlatformStats(setStats), []);
  useEffect(() => subscribeToMatchResults(setResults), []);
  useEffect(() => {
    if (!authenticated || !user) { setUData(null); setRole('user'); setAuthToken(null); return; }
    (async () => {
      try {
        const token = await getAccessToken();
        setAuthToken(token);
        const u = await createOrUpdateUser(user);
        if (u) {
          setUData(u);
          setRole(u.role || 'user');
          // Show username prompt if user hasn't set one yet
          if (!u.usernameSet) setShowUsernamePrompt(true);
        } else {
          console.error('createOrUpdateUser returned null');
          notify('Account setup failed. Please try logging out and back in.', 'error');
        }
      } catch(e) {
        console.error('User setup error:', e);
        notify('Account setup error: ' + e.message, 'error');
      }
    })();
  }, [authenticated, user]);
  useEffect(() => { if (!uData?.id) return; return subscribeToUserLeagues(uData.id, setLeagues); }, [uData?.id]);
  useEffect(() => subscribeToAllLeagues(setAllLeagues), []);
  // Keep selLeague synced with live Firestore data (e.g. memberCount changes) without remounting Detail
  useEffect(() => {
    if (!selLeague?.id) return;
    const fresh = [...leagues, ...allLeagues].find(l => l.id === selLeague.id);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(selLeague)) {
      setSelLeague(fresh);
    }
  }, [leagues, allLeagues]);
  useEffect(() => { if (!uData?.id || !selLeague?.id) return; return subscribeToUserPredictions(uData.id, selLeague.id, setPreds); }, [uData?.id, selLeague?.id]);
  // Don't auto-redirect — users can stay on landing while logged in and navigate via nav

  const handleSave = async () => { if (!uData?.id || !selLeague?.id) return; setSaving(true); try { await saveBatchPredictions(uData.id, selLeague.id, preds); notify('Predictions saved!'); } catch(e) { notify('Save failed', 'error'); } finally { setSaving(false); } };

  // Auto-save: debounce 2s after any prediction change
  const autoSaveTimer = useRef(null);
  const predsRef = useRef(preds);
  predsRef.current = preds;
  useEffect(() => {
    if (!uData?.id || !selLeague?.id) return;
    const hasAny = Object.values(preds).some(p => p.result);
    if (!hasAny) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(async () => {
      try { await saveBatchPredictions(uData.id, selLeague.id, predsRef.current); } catch(e) { console.error('Auto-save failed:', e); }
    }, 2000);
    return () => { if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current); };
  }, [preds, uData?.id, selLeague?.id]);

  const stages = ['Group A','Group B','Group C','Group D','Group E','Group F','Group G','Group H','Group I','Group J','Group K','Group L','Round of 32','Round of 16','Quarterfinal','Semifinal','3rd Place','Final'];

  // Score Picker — white drum with black numbers, arrows always visible
  const ScoreDrum = ({ value, onChange, locked }) => {
    const val = parseInt(value) || 0;
    const [animDir, setAnimDir] = useState(0);
    const isDragging = useRef(false);
    const startY = useRef(0);
    const accum = useRef(0);

    const prev = val > 0 ? val - 1 : null;
    const next = val < 15 ? val + 1 : null;

    const spin = (dir) => {
      if (locked) return;
      const n = Math.max(0, Math.min(15, val + dir));
      if (n === val) return;
      setAnimDir(dir);
      onChange(String(n));
      setTimeout(() => setAnimDir(0), 160);
    };

    const onWheel = (e) => { if (locked) return; e.preventDefault(); spin(e.deltaY > 0 ? 1 : -1); };
    const onPointerDown = (e) => { if (locked) return; isDragging.current = true; startY.current = e.clientY; accum.current = 0; e.target.setPointerCapture?.(e.pointerId); };
    const onPointerMove = (e) => { if (!isDragging.current || locked) return; accum.current += startY.current - e.clientY; startY.current = e.clientY; if (Math.abs(accum.current) >= 18) { spin(accum.current > 0 ? 1 : -1); accum.current = 0; } };
    const onPointerUp = () => { isDragging.current = false; accum.current = 0; };

    return (
      <div className={`score-drum ${locked ? 'drum-locked' : ''}`}>
        {/* Up arrow */}
        <button type="button" className="drum-arrow-btn" onClick={() => spin(1)} disabled={locked || val >= 15}>
          <svg width="12" height="8" viewBox="0 0 12 8"><path d="M1 6.5L6 1.5L11 6.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
        </button>
        {/* Number display */}
        <div className="drum-wheel" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp}>
          <span className={`drum-ghost drum-ghost-prev ${animDir === -1 ? 'drum-enter-down' : ''}`}>{prev !== null ? prev : ''}</span>
          <span className={`drum-val ${animDir === 1 ? 'drum-enter-up' : animDir === -1 ? 'drum-enter-down' : ''}`}>{val}</span>
          <span className={`drum-ghost drum-ghost-next ${animDir === 1 ? 'drum-enter-up' : ''}`}>{next !== null ? next : ''}</span>
        </div>
        {/* Down arrow */}
        <button type="button" className="drum-arrow-btn" onClick={() => spin(-1)} disabled={locked || val <= 0}>
          <svg width="12" height="8" viewBox="0 0 12 8"><path d="M1 1.5L6 6.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
        </button>
      </div>
    );
  };

  // Compact Prediction Row — fits 4-5 per screen
  const PredictionCard = ({ match }) => {
    const p = preds[match.id] || { result: null, score: { home: '0', away: '0' }, extraTime: false, penalties: false };
    const status = getMatchStatus(match.date, match.time);
    const locked = status !== 'open';
    const res = results[match.id];
    const pts = res?.completed ? calculatePoints(p, res, selLeague?.pointsSystem || {}) : null;
    const [mismatch, setMismatch] = useState('');
    const mismatchTimer = useRef(null);

    const showMismatch = (msg) => {
      setMismatch(msg);
      if (mismatchTimer.current) clearTimeout(mismatchTimer.current);
      mismatchTimer.current = setTimeout(() => setMismatch(''), 3500);
    };

    // Check if a score is consistent with a result prediction
    const scoreMatchesResult = (result, homeScore, awayScore) => {
      const h = parseInt(homeScore); const a = parseInt(awayScore);
      if (isNaN(h) || isNaN(a)) return true; // no score yet, allow
      if (!result) return true; // no result picked yet
      if (result === 'home' && h <= a) return false;
      if (result === 'away' && a <= h) return false;
      if (result === 'draw' && h !== a) return false;
      return true;
    };

    // Infer what result a score implies
    const inferResult = (homeScore, awayScore) => {
      const h = parseInt(homeScore); const a = parseInt(awayScore);
      if (isNaN(h) || isNaN(a)) return null;
      if (h > a) return 'home';
      if (a > h) return 'away';
      return 'draw';
    };

    const upd = (f, v) => {
      if (locked) return;
      const u = { ...p, score: { ...p.score } };

      if (f === 'result') {
        u.result = v;
        // Check if existing score contradicts new result
        const h = parseInt(u.score.home); const a = parseInt(u.score.away);
        if (!isNaN(h) && !isNaN(a) && (h > 0 || a > 0)) {
          if (!scoreMatchesResult(v, u.score.home, u.score.away)) {
            // Auto-clear score when result changes and they conflict
            u.score = { home: '0', away: '0' };
            showMismatch('Score reset to match your new pick');
          }
        }
      } else if (f === 'hs') {
        u.score.home = v;
        // Check score vs result
        if (u.result && !scoreMatchesResult(u.result, v, u.score.away)) {
          // Auto-update result to match score
          const implied = inferResult(v, u.score.away);
          if (implied && !(match.isKnockout && implied === 'draw')) {
            u.result = implied;
            showMismatch(`Switched to ${implied === 'home' ? match.home : implied === 'away' ? match.away : 'Draw'} to match score`);
          } else if (match.isKnockout && implied === 'draw') {
            showMismatch("Knockout matches can't end in a draw — adjust score");
          }
        } else if (!u.result) {
          // Auto-set result from score
          const implied = inferResult(v, u.score.away);
          if (implied && !(match.isKnockout && implied === 'draw')) u.result = implied;
        }
      } else if (f === 'as') {
        u.score.away = v;
        if (u.result && !scoreMatchesResult(u.result, u.score.home, v)) {
          const implied = inferResult(u.score.home, v);
          if (implied && !(match.isKnockout && implied === 'draw')) {
            u.result = implied;
            showMismatch(`Switched to ${implied === 'home' ? match.home : implied === 'away' ? match.away : 'Draw'} to match score`);
          } else if (match.isKnockout && implied === 'draw') {
            showMismatch("Knockout matches can't end in a draw — adjust score");
          }
        } else if (!u.result) {
          const implied = inferResult(u.score.home, v);
          if (implied && !(match.isKnockout && implied === 'draw')) u.result = implied;
        }
      } else if (f === 'et') { u.extraTime = v; }
      else if (f === 'pen') { u.penalties = v; }

      setPreds(pr => ({ ...pr, [match.id]: u }));
    };

    const dateStr = new Date(match.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return (
      <div className={`pred-row ${locked ? 'locked' : ''} ${res?.completed ? 'completed' : ''} ${match.isKnockout ? 'knockout' : ''}`}>
        {/* Meta */}
        <div className="pred-meta">
          <span className="pred-stage-badge">{match.stage}</span>
          <span className="pred-date">{dateStr}</span>
          {locked && <span className="lock-badge"><Lock size={10} /></span>}
          {pts !== null && <span className="points-badge">+{pts}</span>}
        </div>

        {/* Mismatch warning */}
        {mismatch && <div className="pred-mismatch"><AlertTriangle size={12} /><span>{mismatch}</span></div>}

        {/* Main row: Team Flag+Name | Score : Score | Flag+Name Team */}
        <div className="pred-main">
          <div className="pred-team">
            <span className="flag">{match.homeFlag}</span>
            <div><span className="pred-team-name">{match.home}</span>{getPedigree(match.home) && <div className="pred-pedigree">{getPedigree(match.home)}</div>}</div>
          </div>

          {res?.completed ? (
            <div className="pred-final-score">
              <span className="fs-num">{res.homeScore}</span>
              <span className="fs-sep">-</span>
              <span className="fs-num">{res.awayScore}</span>
              {res.extraTime && <span className="fs-tag">AET</span>}
              {res.penalties && <span className="fs-tag">PEN</span>}
            </div>
          ) : !locked ? (
            <div className="pred-scores">
              <ScoreDrum value={p.score.home} onChange={v => upd('hs', v)} locked={locked} />
              <span className="pred-score-sep">:</span>
              <ScoreDrum value={p.score.away} onChange={v => upd('as', v)} locked={locked} />
            </div>
          ) : (
            <div className="pred-locked-pick">
              {p.result ? <span className="locked-result">{getCode(match[p.result === 'home' ? 'home' : p.result === 'away' ? 'away' : 'home'])}{p.score.home !== '' && ` ${p.score.home}-${p.score.away}`}</span> : <span className="no-pick">—</span>}
            </div>
          )}

          <div className="pred-team away">
            <div><span className="pred-team-name">{match.away}</span>{getPedigree(match.away) && <div className="pred-pedigree">{getPedigree(match.away)}</div>}</div>
            <span className="flag">{match.awayFlag}</span>
          </div>
        </div>

        {/* Pick buttons with country codes */}
        {!locked && !res?.completed && (
          <div className="pred-picks">
            <button type="button" className={`pred-pick ${p.result === 'home' ? 'active home-pick' : ''}`} onClick={() => upd('result', 'home')}>{getCode(match.home)}</button>
            <button type="button" className={`pred-pick ${p.result === 'draw' ? 'active draw-pick' : ''} ${match.isKnockout ? 'disabled-pick' : ''}`} onClick={() => !match.isKnockout && upd('result', 'draw')}>Draw</button>
            <button type="button" className={`pred-pick ${p.result === 'away' ? 'active away-pick' : ''}`} onClick={() => upd('result', 'away')}>{getCode(match.away)}</button>
          </div>
        )}

        {/* Knockout extras */}
        {!locked && !res?.completed && match.isKnockout && (
          <div className="pred-ko-opts">
            <label className="pred-ko-label"><input type="checkbox" checked={p.extraTime || false} onChange={e => upd('et', e.target.checked)} /><span>Extra Time</span></label>
            <label className="pred-ko-label"><input type="checkbox" checked={p.penalties || false} onChange={e => upd('pen', e.target.checked)} /><span>Penalties</span></label>
          </div>
        )}
      </div>
    );
  };

  const Landing = () => {
    useScrollReveal();
    const featuredIds = ['gs07', 'gs09', 'gs15', 'gs17', 'gs21', 'gs32', 'gs61', 'gs68'];
    const featured = featuredIds.map(id => WORLD_CUP_MATCHES.find(m => m.id === id)).filter(Boolean).slice(0, 6);
    // Code wall data
    const codeData = [
      'URU 4-2 ARG 1930 Montevideo\nITA 2-1 CZE 1934 Rome\nITA 4-2 HUN 1938 Paris\nURU 2-1 BRA 1950 Rio\nGER 3-2 HUN 1954 Bern\nBRA 5-2 SWE 1958 Stockholm\nBRA 3-1 CZE 1962 Santiago\nENG 4-2 GER 1966 London\nBRA 4-1 ITA 1970 Mexico City\nGER 2-1 NED 1974 Munich\nARG 3-1 NED 1978 Buenos Aires\nITA 3-1 GER 1982 Madrid\nARG 3-2 GER 1986 Mexico City\nGER 1-0 ARG 1990 Rome\nBRA 0-0(P) ITA 1994 LA\nFRA 3-0 BRA 1998 Paris\nBRA 2-0 GER 2002 Yokohama\nITA 1-1(P) FRA 2006 Berlin\nESP 1-0 NED 2010 Joburg\nGER 1-0 ARG 2014 Rio\nFRA 4-2 CRO 2018 Moscow\nARG 3-3(P) FRA 2022 Doha',
      'BRA x5 GER x4 ITA x4 ARG x3\nFRA x2 URU x2 ENG x1 ESP x1\nKLOSE 16G RONALDO 15G\nMULLER 14G FONTAINE 13G\nPELE 12G MBAPPE 12G\n900+ MATCHES PLAYED\n2720 GOALS SCORED\n48 TEAMS 2026\n104 MATCHES AHEAD\n3 HOST NATIONS USA MEX CAN',
      'gs01 MEX v RSA Jun11\ngs03 USA v PAR Jun12\ngs07 BRA v MAR Jun13\ngs08 GER v CUW Jun14\ngs09 NED v JPN Jun14\ngs11 BEL v IRN Jun15\ngs13 ESP v CPV Jun15\ngs15 FRA v SEN Jun16\ngs17 ARG v ALG Jun16\ngs19 POR v TBD Jun17\ngs21 ENG v CRO Jun17',
      'POLYGON 137 USDC\nORACLE_1 0x7f..3a\nORACLE_2 0x4b..9e\nVERIFY hash==hash\nCONFIRMATIONS >= 2\nDISPUTE_WINDOW 1h\nPAYOUT_READY true\ncorrectResult +3pts\nexactScore +5pts\npenaltyBonus +2pts\nextraTimeBonus +1pt\nNON-CUSTODIAL\nTRANSPARENT',
      '1930 Montevideo URU\n1934 Rome ITA\n1938 Paris ITA\n1950 Rio URU\n1954 Bern GER\n1958 Stockholm BRA\n1962 Santiago BRA\n1966 London ENG\n1970 Mexico BRA\n1974 Munich GER\n1978 B.Aires ARG\n1982 Madrid ITA\n1986 Mexico ARG\n1990 Rome GER\n1994 LA BRA\n1998 Paris FRA\n2002 Yokohama BRA\n2006 Berlin ITA\n2010 Joburg ESP\n2014 Rio GER\n2018 Moscow FRA\n2022 Doha ARG\n2026 ???? ???',
      '48 NATIONS\n12 GROUPS\n104 MATCHES\n16 HOST CITIES\nMetLife Stadium\nSoFi Stadium\nAT&T Stadium\nEstadio Azteca\nHard Rock Stadium\nNRG Houston\nMercedes-Benz ATL\nGillette Foxborough\nLincoln Financial\nLumen Seattle\nLevis Santa Clara\nBC Place Vancouver\nBMO Toronto',
    ];

    return (
      <div className="landing-page">
        {/* Code Wall Background */}
        <div className="code-wall">
          {codeData.map((d, i) => <div key={i} className="code-col">{d.split('\n').map((l, j) => <span key={j}>{l}<br/></span>)}{d.split('\n').map((l, j) => <span key={`r${j}`}>{l}<br/></span>)}</div>)}
        </div>
        <div className="grad-mesh"></div>

        {/* Hero with Stadium */}
        <section className="hero">
          <div className="hero-stadium-bg"></div>
          <div className="hero-stadium-overlay"></div>
          <div className="hero-content">
            <div className="hero-badge"><span className="live-dot"></span><span>FIFA World Cup 2026 · 23rd Edition</span></div>
            <div className="hero-text-panel">
              <h1 className="hero-title">Predict the<br/><span className="highlight">Beautiful Game</span></h1>
              <p className="hero-subtitle">104 matches. 48 nations. 96 years of history. Make your predictions count — compete for glory or stake crypto for real rewards.</p>
            </div>
            <div className="hero-cta">
              <button className="btn btn-primary btn-lg" onClick={() => authenticated ? nav('dashboard') : login()}><Globe size={20} /> {authenticated ? 'Start Predicting' : 'Sign Up or Login'}</button>
              <button className="btn btn-secondary btn-lg" onClick={() => document.querySelector('.features')?.scrollIntoView({ behavior: 'smooth' })}>How It Works <ChevronRight size={18} /></button>
            </div>
            <div className="hero-stats">
              <div className="stat"><div className="stat-value"><AnimatedCounter value={stats.totalPlayers || 0} suffix="+" /></div><div className="stat-label">Predictors</div></div>
              <div className="stat"><div className="stat-value"><AnimatedCounter value={stats.totalPrizePools || 0} prefix="$" /></div><div className="stat-label">Prize Pools</div></div>
              <div className="stat"><div className="stat-value">22</div><div className="stat-label">Tournaments of Legacy</div></div>
            </div>
          </div>
        </section>

        {/* Finals Marquee Strip */}
        <div className="finals-strip"><div className="finals-track">
          {[...FINALS, ...FINALS].map((f, i) => (
            <span key={i} className="fi"><span className="yr">{f.yr}</span> <span className="win">{f.win}</span> <span className="sc">{f.score}</span> {f.city}</span>
          ))}
        </div></div>

        {/* Legacy Section with Stadium Atmosphere */}
        <section className="atmosphere">
          <div className="atmosphere-bg"></div>
          <div className="atmosphere-overlay"></div>
          <div className="container">
            <div className="section-eyebrow reveal" style={{color: 'var(--cyan)'}}>01 — Legacy</div>
            <div className="section-title reveal">96 Years of Glory</div>
            <div className="section-sub reveal">Every nation that has lifted the trophy</div>
            <div className="legacy-grid">
              {CHAMPIONS.map((c, i) => (
                <div key={c.name} className={`legacy-card reveal stagger-${i + 1}`}>
                  <div className="legacy-flag">{c.name === 'England' ? '🏴󠁧󠁢󠁥󠁮󠁧󠁿' : c.flag}</div>
                  <div className="legacy-name">{c.name}</div>
                  <div className="legacy-count">{c.count}× Champions</div>
                  <div className="legacy-years">{c.years}</div>
                  <div className="legacy-bar"><div className="legacy-fill" style={{width: `${(c.count / 5) * 100}%`}}></div></div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="features"><div className="container">
          <div className="section-header reveal"><h2>How It Works</h2><p>From spectator to oracle in three steps</p></div>
          <div className="features-grid">
            <div className="feature-card reveal-float stagger-1 glow-hover"><div className="feature-icon">// 01</div><h3>Predict Every Match</h3><p>Call the winner across all 104 fixtures. Predict exact scores for bonus points. Knockout rounds unlock extra time & penalty predictions.</p></div>
            <div className="feature-card reveal-float stagger-2 glow-hover"><div className="feature-icon">// 02</div><h3>Compete in Leagues</h3><p>Join the global free league or create private ones. Stake USDC on Polygon for crypto prize pools — fully non-custodial.</p></div>
            <div className="feature-card reveal-float stagger-3 glow-hover"><div className="feature-icon">// 03</div><h3>Collect Rewards</h3><p>Smart contracts distribute prizes automatically when dual-oracle verification confirms results. Transparent, trustless, instant.</p></div>
          </div>
        </div></section>

        {/* Featured Matches */}
        <section className="matches-showcase"><div className="container">
          <div className="section-header reveal"><h2>Featured Matches</h2><p>Some of the biggest group stage clashes</p></div>
          <div className="showcase-grid">
            {featured.map((m, i) => (
              <div key={m.id} className={`showcase-match reveal-scale stagger-${(i % 3) + 1} glow-hover`}>
                <div className="showcase-group">{m.stage}</div>
                <div className="showcase-teams">
                  <span className="showcase-flag">{m.homeFlag}</span>
                  <span>{m.home}</span>
                  <span className="showcase-vs">vs</span>
                  <span>{m.away}</span>
                  <span className="showcase-flag">{m.awayFlag}</span>
                </div>
                <div className="showcase-date">{m.city} · {new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
              </div>
            ))}
          </div>
        </div></section>

        {/* Crypto Section */}
        <section className="crypto-section section-zoom"><div className="container"><div className="crypto-content">
          <div className="crypto-text reveal-left">
            <h2>Non-Custodial. Transparent. Fair.</h2>
            <p>Entry fees go directly to smart contracts on Polygon — never to us. Prizes are distributed automatically when results are verified by two independent oracles.</p>
            <ul className="crypto-features">
              <li><CheckCircle size={20} /> Embedded wallet via Privy — no extensions needed</li>
              <li><CheckCircle size={20} /> USDC escrow on Polygon smart contracts</li>
              <li><CheckCircle size={20} /> Multi-source oracle verification before payout</li>
              <li><CheckCircle size={20} /> Bridge any token from any chain</li>
            </ul>
          </div>
          <div className="crypto-visual reveal-right">
            <div className="wallet-card">
              <Coins size={48} />
              <div className="wallet-info"><div className="wallet-label">Entry Fee</div><div className="wallet-amount">50 USDC</div></div>
              <div className="wallet-info"><div className="wallet-label">Prize Pool</div><div className="wallet-amount">5,000 USDC</div></div>
            </div>
          </div>
        </div></div></section>

        <footer className="site-footer">
          <div className="footer-content">
            <div className="footer-brand"><span className="gt">GoalOracle</span> · 2026</div>
            <div className="footer-links">
              <a onClick={() => authenticated ? nav('dashboard') : login()}>Play Now</a>
              <a onClick={() => document.querySelector('.features')?.scrollIntoView({ behavior: 'smooth' })}>How It Works</a>
              <a onClick={() => nav('faq')}>FAQ</a>
            </div>
            <div className="footer-copy">Built on Polygon · Smart Contract Verified · 22 Tournaments of Legacy</div>
            <div className="photo-credit">Stadium photos via Unsplash (free commercial license)</div>
          </div>
        </footer>
      </div>
    );
  };

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
              <div style={{display:'flex', gap:'0.35rem', alignItems:'center'}}>
                {l.visibility === 'private' && <span className="badge badge-private"><EyeOff size={12} /></span>}
                {l.type === 'paid' ? <span className="badge badge-premium"><Coins size={14} /> {l.entryFee} {l.currency || 'USDC'}</span> : <span className="badge badge-free">Free</span>}
              </div>
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
    const [joiningId, setJoiningId] = useState(null);
    const [passInput, setPassInput] = useState('');
    const [joinErr, setJoinErr] = useState('');
    const publicLeagues = allLeagues.filter(l => l.visibility !== 'private');
    const f = publicLeagues.filter(l => l.name?.toLowerCase().includes(q.toLowerCase()));

    const handleJoin = async (league, passcode = null) => {
      if (!uData?.id) return;
      try {
        setJoinErr('');
        await joinLeague(league.id, uData.id, passcode);
        notify(`Joined ${league.name}!`);
        setJoiningId(null);
        setPassInput('');
      } catch(e) { setJoinErr(e.message); notify(e.message, 'error'); }
    };

    return (
      <div className="browse-leagues">
        <div className="page-header"><button className="btn-back" onClick={() => nav('dashboard')}>← Back</button><h1>Browse Leagues</h1><p style={{color:'var(--text-sec)', fontSize:'0.88rem', marginTop:'0.25rem'}}>Public leagues are shown below. Got a passcode? Enter it to join a private league.</p></div>

        {/* Passcode join section */}
        <div className="passcode-join-section">
          <div className="passcode-join-row">
            <Key size={16} style={{color:'var(--cyan)', flexShrink:0}} />
            <input type="text" placeholder="Enter invite passcode (e.g., GOAL2026)" value={passInput} onChange={e => setPassInput(e.target.value.toUpperCase())} className="input-field" style={{flex:1}} maxLength={8} />
            <button className="btn btn-primary btn-sm" disabled={!passInput.trim()} onClick={async () => {
              if (!passInput.trim() || !uData?.id) return;
              try {
                setJoinErr('');
                const match = allLeagues.find(l => l.passcode === passInput.trim());
                if (!match) { setJoinErr('No league found with that passcode'); notify('No league found with that passcode', 'error'); return; }
                await joinLeague(match.id, uData.id, passInput.trim());
                notify(`Joined ${match.name}!`);
                setPassInput('');
              } catch(e) { setJoinErr(e.message); notify(e.message, 'error'); }
            }}><UserPlus size={14} /> Join Private</button>
          </div>
          {joinErr && <p className="form-error-inline"><AlertTriangle size={12} /> {joinErr}</p>}
        </div>

        <div className="search-bar"><Search size={20} /><input type="text" placeholder="Search public leagues..." value={q} onChange={e => setQ(e.target.value)} /></div>
        <div className="leagues-grid">{f.map(l => {
          const mem = l.members?.includes(uData?.id);
          return (<div key={l.id} className="league-card">
            <div className="league-header">
              <div className="league-title"><Trophy size={24} /><h3>{l.name}</h3></div>
              <div style={{display:'flex', gap:'0.35rem', alignItems:'center'}}>
                {l.type === 'paid' ? <span className="badge badge-premium"><Coins size={14} /> {l.entryFee} {l.currency}</span> : <span className="badge badge-free">Free</span>}
              </div>
            </div>
            <div className="league-stats"><div className="league-stat"><Users size={18} /><span>{l.memberCount || 0} players</span></div></div>
            <div className="league-footer">{mem ? <button className="btn btn-secondary btn-sm" onClick={() => nav('detail', l)}><Eye size={16} /> View</button> : <button className="btn btn-primary btn-sm" onClick={() => handleJoin(l)}><UserPlus size={16} /> Join</button>}</div>
          </div>);
        })}{f.length === 0 && <div className="empty-state"><p>No public leagues found.</p><button className="btn btn-primary" onClick={() => nav('create')}><Plus size={18} /> Create</button></div>}</div>
      </div>
    );
  };

  const Create = () => {
    const [tp, setTp] = useState('free');
    const [nm, setNm] = useState('');
    const [vis, setVis] = useState('public');
    const [passcode, setPasscode] = useState('');
    const [fe, setFe] = useState('');
    const [cu, setCu] = useState('USDC');
    const [di, setDi] = useState({ first: 50, second: 30, third: 20 });
    const [ps, setPs] = useState({ correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 });
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const tot = di.first + di.second + di.third;
    const genCode = () => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)]; setPasscode(c); };
    const go = async () => {
      if (!uData?.id) { setErr('Still loading your account. Please wait a moment and try again.'); return; }
      if (!nm.trim()) { setErr('Name required'); return; }
      if (vis === 'private' && !passcode.trim()) { setErr('Passcode required for private leagues'); return; }
      if (tp === 'paid' && (!fe || parseFloat(fe) <= 0)) { setErr('Fee required'); return; }
      if (tp === 'paid' && tot !== 100) { setErr('Must total 100%'); return; }
      setBusy(true); setErr('');
      try { await createLeague({ name: nm.trim(), type: tp, visibility: vis, passcode: vis === 'private' ? passcode.trim().toUpperCase() : null, entryFee: tp === 'paid' ? parseFloat(fe) : 0, currency: cu, prizeDistribution: tp === 'paid' ? di : null, pointsSystem: ps }, uData.id); notify('League created!'); nav('dashboard'); } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };
    return (
      <div className="create-league">
        <div className="page-header"><button className="btn-back" onClick={() => nav('dashboard')}>← Back</button><h1>Create Your League</h1></div>
        <div className="create-league-form">
          {err && <div className="form-error"><AlertTriangle size={16} /> {err}</div>}
          <div className="form-section"><label>League Type</label>
            <div className="type-selector">
              <button type="button" className={`type-option ${tp === 'free' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setTp('free'); }}><Unlock size={24} /><div><h4>Free League</h4><p>Play for fun and glory</p></div></button>
              <button type="button" className={`type-option ${tp === 'paid' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setTp('paid'); }}><Lock size={24} /><div><h4>Paid League</h4><p>Stake crypto, win rewards</p></div></button>
            </div>
          </div>
          <div className="form-section"><label>Visibility</label>
            <div className="type-selector">
              <button type="button" className={`type-option ${vis === 'public' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setVis('public'); }}><Eye size={24} /><div><h4>Public</h4><p>Anyone can find & join</p></div></button>
              <button type="button" className={`type-option ${vis === 'private' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setVis('private'); if (!passcode) genCode(); }}><EyeOff size={24} /><div><h4>Private</h4><p>Invite-only with passcode</p></div></button>
            </div>
          </div>
          <div className="form-section"><label>League Name</label><input type="text" placeholder="e.g., Friends & Family 2026" value={nm} onChange={e => setNm(e.target.value)} className="input-field" /></div>
          {vis === 'private' && (
            <div className="form-section"><label>Invite Passcode</label>
              <div className="passcode-row">
                <input type="text" value={passcode} onChange={e => setPasscode(e.target.value.toUpperCase())} className="input-field passcode-input" maxLength={8} placeholder="e.g., GOAL2026" />
                <button type="button" className="btn btn-secondary btn-sm" onClick={e => { e.preventDefault(); genCode(); }}><RefreshCw size={14} /> Generate</button>
              </div>
              <p className="form-hint">Share this code with people you want to invite. They'll need it to join.</p>
            </div>
          )}
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
    const tab = detailTab, setTab = setDetailTab;
    const sf = detailWeek, setSf = setDetailWeek;
    const stageFilter = detailStage, setStageFilter = setDetailStage;
    const [lb, setLb] = useState([]);
    const [lbl, setLbl] = useState(false);
    const [showDelete, setShowDelete] = useState(false);
    const [showInvite, setShowInvite] = useState(false);
    const [inviteCopied, setInviteCopied] = useState(false);

    const isAdmin = role === 'superadmin' || role === 'admin';
    const isCreator = selLeague?.createdBy === uData?.id;
    const isPrivate = selLeague?.visibility === 'private';
    const isMember = selLeague?.members?.includes(uData?.id);

    useEffect(() => { if (tab !== 'leaderboard' || !selLeague?.id) return; (async () => { setLbl(true); try { const bu = await getLeagueLeaderboard(selLeague.id); const p = selLeague.pointsSystem || {}; const e = Object.entries(bu).map(([uid, pr]) => ({ userId: uid, displayName: uid.slice(0, 8), ...calculateTotalPoints(pr, results, p) })); setLb(sortLeaderboard(e)); } catch(e){console.error(e);} finally{setLbl(false);} })(); }, [tab, selLeague?.id, results]);

    const handleDelete = async () => {
      try { await deleteLeague(selLeague.id); notify(`"${selLeague.name}" deleted`); nav('dashboard'); } catch(e) { notify(e.message, 'error'); }
    };
    const handleLeave = async () => {
      try { await leaveLeague(selLeague.id); notify(`Left "${selLeague.name}"`); nav('dashboard'); } catch(e) { notify(e.message, 'error'); }
    };
    const copyInvite = () => {
      const msg = `Join my GoalOracle league "${selLeague.name}"!\n\nPasscode: ${selLeague.passcode}\n\nSign up at ${window.location.origin}`;
      navigator.clipboard.writeText(msg).then(() => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000); });
    };

    // Group matches by week for easier navigation
    const matchWeeks = useMemo(() => {
      const weeks = [
        { id: 'week1', label: 'Week 1', sub: 'Jun 11–17', filter: m => m.date >= '2026-06-11' && m.date <= '2026-06-17' && !m.isKnockout },
        { id: 'week2', label: 'Week 2', sub: 'Jun 18–22', filter: m => m.date >= '2026-06-18' && m.date <= '2026-06-22' && !m.isKnockout },
        { id: 'week3', label: 'Week 3', sub: 'Jun 23–27', filter: m => m.date >= '2026-06-23' && m.date <= '2026-06-27' && !m.isKnockout },
        { id: 'r32', label: 'Rd of 32', sub: 'Jun 28–Jul 3', filter: m => m.stage === 'Round of 32' },
        { id: 'r16', label: 'Rd of 16', sub: 'Jul 4–7', filter: m => m.stage === 'Round of 16' },
        { id: 'qf', label: 'Quarters', sub: 'Jul 9–11', filter: m => m.stage === 'Quarterfinal' },
        { id: 'sf', label: 'Semis', sub: 'Jul 14–15', filter: m => m.stage === 'Semifinal' },
        { id: 'finals', label: 'Finals', sub: 'Jul 18–19', filter: m => m.stage === '3rd Place' || m.stage === 'Final' },
      ];
      return weeks.map(w => ({ ...w, matches: WORLD_CUP_MATCHES.filter(w.filter), count: WORLD_CUP_MATCHES.filter(w.filter).length }));
    }, []);

    const activeWeek = matchWeeks.find(w => w.id === sf);
    const fm = sf === 'all' ? WORLD_CUP_MATCHES : (activeWeek?.matches || []);
    const filteredMatches = stageFilter === 'all' ? fm : fm.filter(m => m.stage === stageFilter);
    const stagesInView = [...new Set(fm.map(m => m.stage))];

    const hasU = Object.values(preds).some(p => p.result);
    const filledCount = Object.values(preds).filter(p => p.result).length;

    return (
      <div className="league-detail">
        <div className="page-header"><button className="btn-back" onClick={() => nav('dashboard')}>← Back to Leagues</button>
          <div className="league-info">
            <h1>{selLeague?.name}</h1>
            <div className="league-meta">
              <span><Users size={16} /> {(selLeague?.memberCount || selLeague?.members?.length || 0).toLocaleString()} players</span>
              {selLeague?.type === 'paid' && <span><Coins size={16} /> {selLeague?.entryFee} {selLeague?.currency || 'USDC'}</span>}
              <span><Target size={16} /> {filledCount}/104 predicted</span>
              {isPrivate && <span className="badge badge-private"><EyeOff size={12} /> Private</span>}
              {!isPrivate && <span className="badge badge-public"><Eye size={12} /> Public</span>}
            </div>
          </div>
          <div className="league-actions">
            {isPrivate && (isCreator || isAdmin) && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowInvite(true)}><Share2 size={14} /> Invite</button>
            )}
            {isAdmin && selLeague?.id !== 'global' && (
              <button className="btn btn-sm" style={{background: 'rgba(255,59,92,0.1)', color: 'var(--danger)', border: '1px solid rgba(255,59,92,0.2)'}} onClick={() => setShowDelete(true)}><Trash2 size={14} /> Delete</button>
            )}
          </div>
        </div>

        {/* Invite Modal */}
        {showInvite && <div className="modal-overlay" onClick={() => setShowInvite(false)}>
          <div className="invite-modal" onClick={e => e.stopPropagation()}>
            <div className="fund-modal-header"><h3><Key size={20} /> Invite to League</h3><button className="modal-close" onClick={() => setShowInvite(false)}><X size={18} /></button></div>
            <p className="fund-desc">Share this passcode with people you want to invite to <strong>{selLeague?.name}</strong>.</p>
            <div className="invite-code-box">
              <code className="invite-code">{selLeague?.passcode}</code>
              <button className="btn btn-primary btn-sm" onClick={copyInvite}>{inviteCopied ? <><CheckCircle size={14} /> Copied!</> : <><Copy size={14} /> Copy Invite</>}</button>
            </div>
            <p className="form-hint" style={{marginTop:'0.75rem'}}>They'll need this code when joining from the Browse Leagues page.</p>
          </div>
        </div>}

        {/* Delete Confirm */}
        {showDelete && <div className="modal-overlay" onClick={() => setShowDelete(false)}>
          <div className="fund-modal" onClick={e => e.stopPropagation()}>
            <div className="fund-modal-header"><h3><Trash2 size={20} /> Delete League</h3><button className="modal-close" onClick={() => setShowDelete(false)}><X size={18} /></button></div>
            <p className="fund-desc">Are you sure you want to permanently delete <strong>{selLeague?.name}</strong>? This will remove all predictions and cannot be undone.</p>
            <div className="form-actions">
              <button className="btn btn-secondary" onClick={() => setShowDelete(false)}>Cancel</button>
              <button className="btn" style={{background:'var(--danger)', color:'#fff'}} onClick={handleDelete}><Trash2 size={16} /> Delete Permanently</button>
            </div>
          </div>
        </div>}

        <div className="tabs">
          <button className={`tab ${tab === 'predictions' ? 'active' : ''}`} onClick={() => setTab('predictions')}><Target size={16} /> Predictions</button>
          <button className={`tab ${tab === 'leaderboard' ? 'active' : ''}`} onClick={() => setTab('leaderboard')}><TrendingUp size={16} /> Leaderboard</button>
          <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}><Shield size={16} /> Rules</button>
          <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}><Zap size={16} /> Settings</button>
        </div>

        {tab === 'predictions' && <div className="predictions-view">
          {/* Week tabs */}
          <div className="week-tabs">
            <button type="button" className={`week-tab ${sf === 'all' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setSf('all'); setStageFilter('all'); }}>All ({WORLD_CUP_MATCHES.length})</button>
            {matchWeeks.map(w => (
              <button type="button" key={w.id} className={`week-tab ${sf === w.id ? 'active' : ''}`} onClick={e => { e.preventDefault(); setSf(w.id); setStageFilter('all'); }}>
                <span className="week-tab-label">{w.label}</span>
                <span className="week-tab-sub">{w.sub}</span>
              </button>
            ))}
          </div>

          {/* Stage sub-filter if multiple groups in view */}
          {stagesInView.length > 1 && (
            <div className="stage-pills">
              <button type="button" className={`stage-pill ${stageFilter === 'all' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setStageFilter('all'); }}>All ({fm.length})</button>
              {stagesInView.map(s => <button type="button" key={s} className={`stage-pill ${stageFilter === s ? 'active' : ''}`} onClick={e => { e.preventDefault(); setStageFilter(s); }}>{s}</button>)}
            </div>
          )}

          <div className="autosave-hint">{saving ? <><RefreshCw size={12} className="spin" /> Saving...</> : <><CheckCircle size={12} /> Auto-saves as you go</>}</div>

          <div className="matches-list">{filteredMatches.map(m => <PredictionCard key={m.id} match={m} />)}</div>
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

        {tab === 'settings' && <div className="settings-view">
          <div className="rules-card">
            <h3>League Info</h3>
            <div className="settings-row"><span className="settings-label">Type</span><span className="badge badge-free">{selLeague?.type === 'paid' ? 'Paid' : 'Free'}</span></div>
            <div className="settings-row"><span className="settings-label">Visibility</span><span className={`badge ${isPrivate ? 'badge-private' : 'badge-public'}`}>{isPrivate ? <><EyeOff size={12} /> Private</> : <><Eye size={12} /> Public</>}</span></div>
            {isPrivate && (isCreator || isAdmin) && <div className="settings-row"><span className="settings-label">Passcode</span><code className="settings-code">{selLeague?.passcode}</code></div>}
            <div className="settings-row"><span className="settings-label">Created by</span><span>{selLeague?.createdBy === uData?.id ? 'You' : selLeague?.createdBy?.slice(0,8)}</span></div>
          </div>
          {selLeague?.id !== 'global' && isMember && !isCreator && (
            <div className="rules-card">
              <h3>Leave League</h3>
              <p style={{color:'var(--text-sec)', fontSize:'0.88rem', marginBottom:'1rem'}}>You'll lose your predictions for this league. This cannot be undone.</p>
              <button className="btn" style={{background:'rgba(255,59,92,0.1)', color:'var(--danger)', border:'1px solid rgba(255,59,92,0.2)'}} onClick={handleLeave}><LogOut size={16} /> Leave League</button>
            </div>
          )}
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
  const TOKENS = ['ETH', 'USDC', 'USDT', 'POL'];

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
      if (srcToken === 'ETH' || srcToken === 'POL') return 18;
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
    const [editingName, setEditingName] = useState(false);
    const [newName, setNewName] = useState('');
    const walletAddr = typeof user?.wallet === 'string' ? user.wallet : user?.wallet?.address || uData?.walletAddress || '';
    const displayEmail = uData?.email || '';
    const displayName = uData?.displayName || displayEmail?.split('@')[0] || 'Player';

    const copyAddress = () => {
      if (!walletAddr) return;
      navigator.clipboard.writeText(walletAddr).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
    };

    const saveName = async () => {
      if (!newName.trim()) return;
      const validErr = validateUsername(newName.trim());
      if (validErr) { notify(validErr, 'error'); return; }
      try {
        const updated = await updateUserProfile({ displayName: newName.trim(), usernameSet: true });
        if (updated) setUData(updated);
        setEditingName(false);
        notify('Display name updated!');
      } catch(e) { notify('Failed to update name', 'error'); }
    };

    return (
      <div className="account-dropdown-wrap" onClick={e => e.stopPropagation()}>
        <button type="button" className="account-btn" onClick={e => { e.stopPropagation(); setOpen(!open); }}>
          <User size={14} />
          <span className="account-btn-name">{displayName}</span>
          <ChevronDown size={14} className={open ? 'flip' : ''} />
        </button>
        {open && <>
          <div className="dropdown-overlay" onClick={e => { e.stopPropagation(); setOpen(false); }}></div>
          <div className="account-dropdown" onClick={e => e.stopPropagation()}>
            <div className="dropdown-header">
              {!editingName ? (
                <div className="dropdown-name-row">
                  <div className="dropdown-name">{displayName}</div>
                  <button type="button" className="edit-name-btn" onClick={() => { setNewName(displayName); setEditingName(true); }} title="Edit display name">✏️</button>
                </div>
              ) : (
                <div className="edit-name-row">
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)} className="edit-name-input" maxLength={24} placeholder="Display name" onKeyDown={e => e.key === 'Enter' && saveName()} autoFocus />
                  <button type="button" className="btn btn-primary btn-sm" onClick={saveName} style={{padding:'0.3rem 0.6rem',fontSize:'0.7rem'}}>Save</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingName(false)} style={{padding:'0.3rem 0.6rem',fontSize:'0.7rem'}}>✕</button>
                </div>
              )}
              {displayEmail && <div className="dropdown-email">{displayEmail}</div>}
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
            <button type="button" className="dropdown-item" onClick={e => { e.stopPropagation(); setOpen(false); setFundModal(true); }}>
              <ArrowRightLeft size={16} />
              <div>
                <div className="dropdown-item-title">Add Funds</div>
                <div className="dropdown-item-sub">Bridge any token to USDC on Polygon</div>
              </div>
            </button>
            <div className="dropdown-divider"></div>
            <button type="button" className="dropdown-item logout-item" onClick={e => { e.stopPropagation(); setOpen(false); logout(); nav('landing'); }}>
              <LogOut size={16} />
              <span>Log Out</span>
            </button>
          </div>
        </>}
      </div>
    );
  };

  // ================================
  // FAQ PAGE
  // ================================
  const FAQ = () => {
    const [openQ, setOpenQ] = useState(null);
    const toggle = (i) => setOpenQ(openQ === i ? null : i);

    const sections = [
      {
        title: 'How GoalOracle Works',
        icon: '⚽',
        questions: [
          {
            q: 'What is GoalOracle?',
            a: 'GoalOracle is a prediction game for the FIFA World Cup 2026. You predict the outcomes of all 104 matches — from the group stage through to the final — and compete against friends and the global community on leaderboards. You can play for free or stake crypto for real prizes.'
          },
          {
            q: 'How do I make predictions?',
            a: 'After signing up and joining a league, go to the Predictions tab. For each match you can predict the winner (home/draw/away) for 3 points, and optionally predict the exact score for 5 bonus points. For knockout matches you can also predict extra time (+1 pt) and penalty shootout outcomes (+2 pts).'
          },
          {
            q: 'When do predictions lock?',
            a: 'Predictions lock 5 minutes before each match kicks off. You can update your predictions as many times as you want before the lock — they auto-save as you go. Once a match locks, your prediction for that match is final.'
          },
          {
            q: 'How is the leaderboard calculated?',
            a: 'Points are awarded per match: Correct result (home/draw/away) = 3 pts, Exact score = 5 pts, Extra time prediction = 1 pt, Penalty prediction = 2 pts. League creators can customize these values. Tiebreakers are: total points → exact scores → knockout bonuses → earliest submission time.'
          },
          {
            q: 'Can I join multiple leagues?',
            a: 'Yes. You can join as many leagues as you want — the Global League, public leagues, and private leagues. Your predictions are per-league, so you can use different strategies in different leagues.'
          },
        ]
      },
      {
        title: 'Leagues & Privacy',
        icon: '🏆',
        questions: [
          {
            q: 'What is the difference between public and private leagues?',
            a: 'Public leagues appear in the Browse page and anyone can join. Private leagues are invite-only — the creator gets a unique passcode (like "GOAL2K") that they share with friends. You need the passcode to join a private league.'
          },
          {
            q: 'How do I invite friends to a private league?',
            a: 'After creating a private league, go to the league detail page and click "Invite." This shows your league passcode and a "Copy Invite" button that copies a ready-made message with the code and signup link. Share it via text, email, or group chat.'
          },
          {
            q: 'Can the league creator change settings after creation?',
            a: 'Currently, league settings (points system, entry fee, prize distribution) are fixed at creation. Admins can delete leagues if needed. We may add editable settings in a future update.'
          },
        ]
      },
      {
        title: 'Transparency & Score Verification',
        icon: '🔮',
        questions: [
          {
            q: 'How are match results verified?',
            a: 'GoalOracle uses a dual-source oracle system. When a match finishes, results are fetched from two independent football data providers. Both sources must agree on the final score before the result is accepted. This prevents errors from any single data source.'
          },
          {
            q: 'Which APIs provide the match scores?',
            a: (<>
              We use two independent, widely-trusted football data APIs:
              <br/><br/>
              <strong>Source 1: Football-Data.org</strong> — A free, community-trusted API that provides live scores, fixtures, and standings for major football competitions including the FIFA World Cup. Used by thousands of developers worldwide.
              <br/><a href="https://www.football-data.org" target="_blank" rel="noopener noreferrer" className="faq-link"><ExternalLink size={12} /> football-data.org</a>
              <br/><br/>
              <strong>Source 2: API-Sports (API-Football)</strong> — A comprehensive sports data provider covering 900+ football leagues with real-time scores, events, and statistics. Trusted by major sports platforms globally.
              <br/><a href="https://www.api-football.com" target="_blank" rel="noopener noreferrer" className="faq-link"><ExternalLink size={12} /> api-football.com</a>
              <br/><br/>
              Both sources must return the same score for a result to be marked as verified. If they disagree, an admin review is triggered before any points are awarded.
            </>)
          },
          {
            q: 'What happens if the two data sources disagree?',
            a: 'If the two APIs return different scores — which is rare but possible during extra time or penalty scenarios — the result enters a "dispute" state. An admin manually verifies using official FIFA sources before confirming. No points or prizes are distributed until the result is verified.'
          },
          {
            q: 'Can I verify the results myself?',
            a: 'Yes. All verified match results are visible on the platform and you can cross-check them against the official FIFA World Cup website (fifa.com), or the two data sources we use (football-data.org and api-football.com). Full transparency is a core principle.'
          },
        ]
      },
      {
        title: 'Crypto, Wallets & Smart Contracts',
        icon: '💰',
        questions: [
          {
            q: 'Do I need crypto to play?',
            a: 'No. Free leagues require no wallet or crypto at all — just sign up and predict. Crypto is only needed if you want to join paid leagues with real prize pools.'
          },
          {
            q: 'How do wallets work on GoalOracle?',
            a: 'When you sign up, an embedded wallet is automatically created for you via Privy — no browser extension or MetaMask needed. This wallet lives on the Polygon network and can hold USDC for paid league entry fees. You can also bridge tokens from Ethereum, Base, Arbitrum, and Optimism.'
          },
          {
            q: 'How are prize pools managed?',
            a: (<>
              For paid leagues, entry fees are held in a smart contract on the Polygon blockchain — not by GoalOracle. The contract automatically distributes prizes to the top 3 finishers based on the prize split set at league creation (default: 50% / 30% / 20%). This is fully non-custodial — we never hold your funds.
              <br/><br/>
              <strong>Smart Contract:</strong> GoalOracleVerifier.sol
              <br/>
              <span className="faq-contract-label">Contract Address (Polygon):</span>
              <br/>
              <code className="faq-contract-addr">Coming soon — deployment pending</code>
              <br/><br/>
              Once deployed, you'll be able to verify the contract source code on:
              <br/>
              <a href="https://polygonscan.com" target="_blank" rel="noopener noreferrer" className="faq-link"><ExternalLink size={12} /> Polygonscan</a>
              <br/><br/>
              The contract source code is open and auditable in our repository:
              <br/>
              <a href="https://github.com/nicholascpark/goaloracle/blob/main/contracts/GoalOracleVerifier.sol" target="_blank" rel="noopener noreferrer" className="faq-link"><ExternalLink size={12} /> View GoalOracleVerifier.sol on GitHub</a>
            </>)
          },
          {
            q: 'What blockchain does GoalOracle use?',
            a: 'GoalOracle uses Polygon PoS for all on-chain transactions. Polygon offers fast transactions (2-second finality) and very low gas fees (typically under $0.01), making it ideal for a prediction game with many participants. Entry fees and prizes are in USDC, a dollar-pegged stablecoin.'
          },
          {
            q: 'How does the on-chain oracle verification work?',
            a: (<>
              The GoalOracleVerifier smart contract uses a multi-oracle pattern:
              <br/><br/>
              1. Two independent oracle wallets are registered on the contract<br/>
              2. Each oracle submits match results independently (score, extra time, penalties)<br/>
              3. Results are hashed and compared — when 2 out of 2 oracles agree, the result is marked as VERIFIED<br/>
              4. Only verified results can trigger prize distribution<br/>
              5. An admin can flag disputes if oracles conflict, freezing payouts until resolved
              <br/><br/>
              This dual-oracle design ensures no single point of failure can produce incorrect results or trigger wrongful payouts.
            </>)
          },
          {
            q: 'Are there fees beyond the entry fee?',
            a: 'GoalOracle does not take a platform fee from prize pools. The only additional cost is the small Polygon gas fee (under $0.01) when the smart contract distributes prizes. What goes into the pool is what gets paid out.'
          },
        ]
      },
      {
        title: 'Account & Support',
        icon: '👤',
        questions: [
          {
            q: 'How do I change my username?',
            a: 'Click your account name in the top navigation bar to open the dropdown, then click the pencil icon next to your display name. Usernames must be 3–20 characters, letters/numbers/underscores only, and cannot contain inappropriate language.'
          },
          {
            q: 'What login methods are supported?',
            a: 'You can sign up with email, Google, Twitter/X, or directly with a crypto wallet (MetaMask, Coinbase Wallet, etc.). All methods create the same account with an embedded Polygon wallet.'
          },
          {
            q: 'Who can I contact for support?',
            a: 'For bugs, questions, or feedback, reach out to us at support@goaloracle.com or open an issue on our GitHub repository.'
          },
        ]
      },
    ];

    return (
      <div className="faq-page">
        <div className="page-header">
          {authenticated && <button className="btn-back" onClick={() => nav('dashboard')}>← Back</button>}
          <div>
            <h1>Frequently Asked Questions</h1>
            <p className="faq-page-sub">Everything you need to know about GoalOracle — how it works, how scores are verified, and how your funds are protected.</p>
          </div>
        </div>

        {sections.map((sec, si) => (
          <div key={si} className="faq-section">
            <div className="faq-section-header">
              <span className="faq-section-icon">{sec.icon}</span>
              <h2>{sec.title}</h2>
            </div>
            {sec.questions.map((item, qi) => {
              const idx = `${si}-${qi}`;
              const isOpen = openQ === idx;
              return (
                <div key={qi} className={`faq-item ${isOpen ? 'open' : ''}`}>
                  <button type="button" className="faq-question" onClick={() => toggle(idx)}>
                    <span>{item.q}</span>
                    <ChevronRight size={18} className={`faq-chevron ${isOpen ? 'rotated' : ''}`} />
                  </button>
                  {isOpen && <div className="faq-answer">{item.a}</div>}
                </div>
              );
            })}
          </div>
        ))}

        <div className="faq-footer-cta">
          <div className="faq-footer-card">
            <h3>Ready to play?</h3>
            <p>Join the world's most transparent World Cup prediction game.</p>
            <button className="btn btn-primary" onClick={() => authenticated ? nav('dashboard') : login()}>
              {authenticated ? 'Go to Dashboard' : 'Sign Up or Login'} <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  };

  // ================================
  // USERNAME PROMPT (shown on first login / existing users without username)
  // ================================
  const UsernamePrompt = () => {
    const [username, setUsername] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const email = uData?.email || '';
    const emailPrefix = email?.split('@')[0] || '';

    const handleSubmit = async (chosenName) => {
      const trimmed = chosenName.trim();
      const validErr = validateUsername(trimmed);
      if (validErr) { setErr(validErr); return; }
      setBusy(true); setErr('');
      try {
        const updated = await updateUserProfile({ displayName: trimmed, usernameSet: true });
        if (updated) setUData(updated);
        setShowUsernamePrompt(false);
        notify(`Welcome, ${trimmed}!`);
      } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };

    const handleUseEmail = async () => {
      if (!emailPrefix) return;
      setBusy(true); setErr('');
      try {
        const updated = await updateUserProfile({ displayName: emailPrefix, usernameSet: true });
        if (updated) setUData(updated);
        setShowUsernamePrompt(false);
        notify(`Welcome, ${emailPrefix}!`);
      } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };

    return (
      <div className="modal-overlay" style={{zIndex: 2000}}>
        <div className="username-modal">
          <div className="username-modal-icon">👋</div>
          <h2 className="username-modal-title">Choose Your Username</h2>
          <p className="username-modal-desc">This is how you'll appear on leaderboards and to other players. Pick something memorable!</p>

          <div className="username-input-wrap">
            <User size={16} className="username-input-icon" />
            <input
              type="text" value={username}
              onChange={e => { setUsername(e.target.value); setErr(''); }}
              onKeyDown={e => e.key === 'Enter' && username.trim() && handleSubmit(username)}
              className="username-input" placeholder="e.g., GoalKing99"
              maxLength={20} autoFocus
            />
          </div>
          <div className="username-rules">3–20 characters · Letters, numbers, _ . - only</div>
          {err && <div className="username-error"><AlertTriangle size={14} /> {err}</div>}

          <button type="button" className="btn btn-primary btn-lg username-submit" onClick={() => handleSubmit(username)} disabled={busy || !username.trim()}>
            {busy ? <><RefreshCw size={16} className="spin" /> Setting up...</> : <>Set Username <ChevronRight size={16} /></>}
          </button>

          {emailPrefix && (
            <div className="username-divider"><span>or</span></div>
          )}
          {emailPrefix && (
            <button type="button" className="btn btn-secondary username-email-btn" onClick={handleUseEmail} disabled={busy}>
              Use <strong>{emailPrefix}</strong> as my username
            </button>
          )}
        </div>
      </div>
    );
  };

  const Nav = () => (
    <nav className="navbar"><div className="nav-container">
      <div className="nav-brand" onClick={() => nav('landing')}><Trophy size={24} /><span className="gt">GoalOracle</span></div>
      <button type="button" className="mobile-toggle" onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>{menuOpen ? <X size={24} /> : <Menu size={24} />}</button>
      <div className={`nav-menu ${menuOpen ? 'active' : ''}`} onClick={e => e.stopPropagation()}>
        <a className="nav-link" onClick={() => nav('landing')}><Home size={14} /><span>Home</span></a>
        {authenticated && <>
          <a className="nav-link" onClick={() => nav('dashboard')}><Trophy size={14} /><span>Dashboard</span></a>
          <a className="nav-link" onClick={() => nav('browse')}><Search size={14} /><span>Leagues</span></a>
          {(role === 'superadmin' || role === 'admin') && <a className="nav-link" onClick={() => nav('admin')}><Shield size={14} /><span>Admin</span></a>}
        </>}
        <a className="nav-link" onClick={() => nav('faq')}><HelpCircle size={14} /><span>FAQ</span></a>
        <div className="nav-actions" onClick={e => e.stopPropagation()}>
          {authenticated ? <AccountDropdown /> : <button className="btn btn-primary btn-sm" onClick={login}>Sign Up or Login</button>}
          <button type="button" className="theme-toggle-btn" onClick={e => { e.stopPropagation(); cycleTheme(); }}>
            {theme === 'dark' ? <Sun size={14} /> : theme === 'light' ? <Sparkles size={14} /> : <Moon size={14} />}
            <span>{theme === 'dark' ? 'Light' : theme === 'light' ? '⚽ 2026' : 'Dark'}</span>
          </button>
        </div>
      </div>
    </div></nav>
  );

  return (
    <div className="app">
      {notif && <div className={`notification ${notif.type}`}>{notif.type === 'success' ? <CheckCircle size={18} /> : <AlertTriangle size={18} />}<span>{notif.msg}</span></div>}
      {confetti && <div className="confetti-container">{Array.from({length: 60}).map((_, i) => (
        <div key={i} className="confetti-piece" style={{
          left: `${Math.random() * 100}%`,
          animationDelay: `${Math.random() * 0.8}s`,
          animationDuration: `${1.5 + Math.random() * 2}s`,
          backgroundColor: ['#02B906','#FFDB00','#00D4FF','#FF2D87','#fff','#7B61FF','#FFB800'][i % 7],
          transform: `rotate(${Math.random() * 360}deg)`,
          width: `${6 + Math.random() * 8}px`,
          height: `${4 + Math.random() * 6}px`,
        }} />
      ))}</div>}
      <Nav />
      {view === 'landing' && <Landing />}
      {view === 'dashboard' && <Dash />}
      {view === 'browse' && <Browse />}
      {view === 'create' && <Create />}
      {view === 'detail' && <Detail />}
      {view === 'faq' && <FAQ />}
      {view === 'admin' && (role === 'superadmin' || role === 'admin') && <AdminDashboard userData={uData} platformStats={stats} matchResults={results} notify={notify} />}
      {fundModal && <AddFundsModal />}
      {showUsernamePrompt && authenticated && uData && <UsernamePrompt />}
    </div>
  );
};

export default GoalOracle;