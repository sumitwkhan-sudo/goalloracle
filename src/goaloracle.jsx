import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { Trophy, Users, Coins, Shield, ChevronRight, Menu, X, Globe, Zap, TrendingUp, Award, Lock, Unlock, LogOut, Plus, Search, CheckCircle, Clock, Target, Save, Eye, EyeOff, RefreshCw, UserPlus, AlertTriangle, Copy, Wallet, ChevronDown, User, ArrowRightLeft, ExternalLink, Loader, Moon, Sun, Trash2, Share2, Key, Home, HelpCircle, Sparkles, MessageSquare, Send, LayoutGrid, List } from 'lucide-react';
import WORLD_CUP_MATCHES from './data/matches';
import { getCode } from './utils/countryCodes';
import { getPedigree, FINALS, CHAMPIONS } from './utils/pedigree';
import { calculatePoints, calculateTotalPoints, sortLeaderboard, getMatchStatus } from './utils/points';
import TEAM_COLORS from './data/teamColors';
import { resolveBracket, calcGroupStandings, rankThirdPlaced, groupPredictionsComplete } from './utils/bracket';
import { createOrUpdateUser, updateUserProfile, getUserRole, createLeague, joinLeague, deleteLeague, leaveLeague, subscribeToUserLeagues, subscribeToAllLeagues, saveBatchPredictions, subscribeToUserPredictions, subscribeToMatchResults, subscribeToPlatformStats, getLeagueLeaderboard, setAuthToken, signIntoFirebase, resetFirebaseAuth, submitFeedback } from './utils/db';
import { validateUsername } from './utils/profanity';
import { getWalletBalances, formatBalance } from './utils/wallet';
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

let heroAnimated = false;
const CITY_CODES = {
  'Atlanta': 'ATL', 'Boston': 'BOS', 'Dallas': 'DAL', 'Guadalajara': 'GDL',
  'Houston': 'HOU', 'Kansas City': 'KC', 'Los Angeles': 'LA', 'Mexico City': 'MEX',
  'Miami': 'MIA', 'Monterrey': 'MTY', 'New York/NJ': 'NJ', 'Philadelphia': 'PHI',
  'San Francisco': 'SF', 'Seattle': 'SEA', 'Toronto': 'TOR', 'Vancouver': 'VAN',
};
const GoalOracle = () => {
  const { ready, authenticated, user, login, logout, getAccessToken } = usePrivy();
  const [view, setView] = useState('landing');
  const [menuOpen, setMenuOpen] = useState(false);
  const [theme, setTheme] = useState('light');
  const [confetti, setConfetti] = useState(false);
  const [homeTeam, setHomeTeam] = useState(() => localStorage.getItem('goaloracle_home_team') || '');
  const [teamPickerOpen, setTeamPickerOpen] = useState(false);
  const teamPickerRef = useRef(null);
  useEffect(() => { document.documentElement.setAttribute('data-theme', 'light'); }, []);

  // Apply team colors as CSS variables
  useEffect(() => {
    const root = document.documentElement;
    if (homeTeam && TEAM_COLORS[homeTeam]) {
      const t = TEAM_COLORS[homeTeam];
      root.style.setProperty('--team-primary', t.primary);
      root.style.setProperty('--team-secondary', t.secondary);
      root.style.setProperty('--team-accent', t.accent);
      root.setAttribute('data-team', homeTeam);
      localStorage.setItem('goaloracle_home_team', homeTeam);
    } else {
      root.style.removeProperty('--team-primary');
      root.style.removeProperty('--team-secondary');
      root.style.removeProperty('--team-accent');
      root.removeAttribute('data-team');
      localStorage.removeItem('goaloracle_home_team');
    }
  }, [homeTeam]);

  // Close team picker on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (teamPickerRef.current && !teamPickerRef.current.contains(e.target)) setTeamPickerOpen(false);
    };
    if (teamPickerOpen) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [teamPickerOpen]);

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
  const [detailPredView, setDetailPredView] = useState(() => {
    // Default to 'rows' on mobile, 'rows' on desktop (user can toggle)
    // But on desktop, rows will render in 2 columns via CSS
    return 'rows';
  });

  const notify = useCallback((msg, type = 'success') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000); }, []);
  const nav = useCallback((v, l) => {
    if (l) { setSelLeague(l); setDetailTab('predictions'); setDetailWeek('week1'); setDetailStage('all'); }
    setView(prev => prev === v && !l ? prev : v);
    setMenuOpen(false);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => subscribeToPlatformStats(setStats), []);
  useEffect(() => subscribeToMatchResults(setResults), []);
  const authInitRef = useRef(false);

  // getAccessToken() hangs forever when Privy wallet iframe isn't ready — wrap with timeout
  const getTokenSafe = useCallback(async (timeoutMs = 5000) => {
    try {
      return await Promise.race([
        getAccessToken(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('token_timeout')), timeoutMs))
      ]);
    } catch {
      return null;
    }
  }, [getAccessToken]);

  useEffect(() => {
    if (!ready) return;
    if (!authenticated) {
      setUData(null); setRole('user'); setAuthToken(null); resetFirebaseAuth();
      authInitRef.current = false;
      return;
    }
    if (authInitRef.current) return;

    let stopped = false;
    let attempts = 0;
    const tryAuth = async () => {
      if (stopped || authInitRef.current) return;
      attempts++;
      const timeout = Math.min(3000 + attempts * 2000, 15000);
      console.log(`[auth] attempt ${attempts}, timeout=${timeout}ms`);
      const token = await getTokenSafe(timeout);
      if (!token) { console.warn(`[auth] no token attempt ${attempts}`); return; }
      if (stopped) return;
      console.log('[auth] got token, signing into Firebase...');
      setAuthToken(token);
      const fbOk = await signIntoFirebase(token);
      if (!fbOk) { console.warn('[auth] Firebase sign-in failed, retrying...'); return; }
      if (stopped) return;
      const u = await createOrUpdateUser(user);
      if (stopped || !u) return;
      console.log('[auth] SUCCESS:', u.displayName, u.role);
      stopped = true;
      authInitRef.current = true;
      setUData(u);
      setRole(u.role || 'user');
      if (!u.usernameSet) setShowUsernamePrompt(true);
    };

    // Delay first attempt 1s to let Privy wallet iframe initialize
    const first = setTimeout(() => tryAuth().catch(e => console.error('[auth]', e.message)), 1000);
    const interval = setInterval(() => {
      if (stopped || authInitRef.current) { clearInterval(interval); return; }
      tryAuth().catch(e => console.error('[auth]', e.message));
    }, 3000);

    return () => { stopped = true; clearTimeout(first); clearInterval(interval); };
  }, [ready, authenticated, getTokenSafe]);
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

  const handleSave = async () => {
    if (!uData?.id || !selLeague?.id) return;
    setSaving(true);
    try {
      await saveBatchPredictions(uData.id, selLeague.id, preds);
      notify('Predictions saved!');
    } catch(e) { notify('Save failed', 'error'); } finally { setSaving(false); }
  };

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
      try {
        await saveBatchPredictions(uData.id, selLeague.id, predsRef.current);
      } catch(e) {
        console.error('Auto-save failed:', e);
      }
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
  const PredictionCard = React.memo(({ match, pred, result: res }) => {
    const p = pred || { result: null, score: { home: '0', away: '0' }, extraTime: false, penalties: false };
    const status = getMatchStatus(match.date, match.time);
    const locked = status !== 'open';
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
      setPreds(pr => {
        const cur = pr[match.id] || { result: null, score: { home: '0', away: '0' }, extraTime: false, penalties: false };
        const u = { ...cur, score: { ...cur.score } };

        if (f === 'result') {
          u.result = v;
          const h = parseInt(u.score.home); const a = parseInt(u.score.away);
          if (!isNaN(h) && !isNaN(a) && (h > 0 || a > 0)) {
            if (!scoreMatchesResult(v, u.score.home, u.score.away)) {
              u.score = { home: '0', away: '0' };
              showMismatch('Score reset to match your new pick');
            }
          }
        } else if (f === 'hs') {
          u.score.home = v;
          if (u.result && !scoreMatchesResult(u.result, v, u.score.away)) {
            const implied = inferResult(v, u.score.away);
            if (implied && !(match.isKnockout && implied === 'draw')) {
              u.result = implied;
              showMismatch(`Switched to ${implied === 'home' ? match.home : implied === 'away' ? match.away : 'Draw'} to match score`);
            } else if (match.isKnockout && implied === 'draw') {
              showMismatch("Knockout matches can't end in a draw — adjust score");
            }
          } else if (!u.result) {
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

        return { ...pr, [match.id]: u };
      });
    };

    const dateStr = new Date(match.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    // Timezone mapping for each host city
    const cityTZ = {
      'Atlanta': { tz: 'US Eastern', offset: 0 }, 'Boston': { tz: 'US Eastern', offset: 0 },
      'Miami': { tz: 'US Eastern', offset: 0 }, 'New York/NJ': { tz: 'US Eastern', offset: 0 },
      'Philadelphia': { tz: 'US Eastern', offset: 0 }, 'Toronto': { tz: 'US Eastern', offset: 0 },
      'Dallas': { tz: 'US Central', offset: -1 }, 'Houston': { tz: 'US Central', offset: -1 },
      'Kansas City': { tz: 'US Central', offset: -1 }, 'Monterrey': { tz: 'Mexico Central', offset: -2 },
      'Guadalajara': { tz: 'Mexico Central', offset: -2 }, 'Mexico City': { tz: 'Mexico Central', offset: -2 },
      'Los Angeles': { tz: 'US Pacific', offset: -3 }, 'San Francisco': { tz: 'US Pacific', offset: -3 },
      'Seattle': { tz: 'US Pacific', offset: -3 }, 'Vancouver': { tz: 'US Pacific', offset: -3 },
    };
    const tzInfo = cityTZ[match.city] || { tz: '', offset: 0 };
    // match.time is stored in ET — convert to local
    const [hh, mm] = match.time.split(':').map(Number);
    const localH = ((hh + tzInfo.offset) % 24 + 24) % 24;
    const localTime = `${localH > 12 ? localH - 12 : localH || 12}:${String(mm).padStart(2, '0')} ${localH >= 12 ? 'PM' : 'AM'}`;

    const needsPrediction = !locked && !res?.completed && !p.result;

    return (
      <div className={`pred-row ${locked ? 'locked' : ''} ${res?.completed ? 'completed' : ''} ${match.isKnockout ? 'knockout' : ''} ${needsPrediction ? 'needs-prediction' : ''}`}>
        {/* Meta */}
        <div className="pred-meta">
          <span className="pred-stage-badge">{match.stage}</span>
          <span className="pred-date">{dateStr}</span>
          {locked && <span className="lock-badge"><Lock size={10} /></span>}
          {pts !== null && <span className="points-badge">+{pts}</span>}
        </div>
        {/* Venue & local time */}
        <div className="pred-venue-row">
          <span className="pred-venue">{match.venue}, {match.city}</span>
          <span className="pred-kickoff">{localTime} {CITY_CODES[match.city] || match.city}</span>
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
  });

  // Compact row variant — single line per match
  const CompactRow = React.memo(({ match, pred, result: res }) => {
    const p = pred || { result: null, score: { home: '0', away: '0' }, extraTime: false, penalties: false };
    const status = getMatchStatus(match.date, match.time);
    const locked = status !== 'open';
    const pts = res?.completed ? calculatePoints(p, res, selLeague?.pointsSystem || {}) : null;
    const homeRef = useRef(null);
    const awayRef = useRef(null);

    const upd = (f, v) => {
      if (locked) return;
      setPreds(pr => {
        const cur = pr[match.id] || { result: null, score: { home: '0', away: '0' }, extraTime: false, penalties: false };
        const u = { ...cur, score: { ...cur.score } };
        if (f === 'result') { u.result = v; const h = parseInt(u.score.home); const a = parseInt(u.score.away); if (!isNaN(h) && !isNaN(a) && (h > 0 || a > 0) && ((v === 'home' && h <= a) || (v === 'away' && a <= h) || (v === 'draw' && h !== a))) u.score = { home: '0', away: '0' }; }
        else if (f === 'hs') { u.score.home = v; const implied = parseInt(v) > parseInt(u.score.away) ? 'home' : parseInt(v) < parseInt(u.score.away) ? 'away' : 'draw'; if (implied && !(match.isKnockout && implied === 'draw')) u.result = implied; }
        else if (f === 'as') { u.score.away = v; const implied = parseInt(u.score.home) > parseInt(v) ? 'home' : parseInt(u.score.home) < parseInt(v) ? 'away' : 'draw'; if (implied && !(match.isKnockout && implied === 'draw')) u.result = implied; }
        else if (f === 'et') { u.extraTime = v; }
        else if (f === 'pen') { u.penalties = v; }
        return { ...pr, [match.id]: u };
      });
    };

    const spin = (field, dir) => {
      if (locked) return;
      const cur = parseInt(field === 'hs' ? p.score.home : p.score.away) || 0;
      upd(field, String(Math.max(0, Math.min(20, cur + dir))));
    };

    const handleScoreInput = (field, val) => {
      const num = val.replace(/[^0-9]/g, '');
      if (num === '') { upd(field, '0'); return; }
      const n = Math.min(parseInt(num), 20);
      upd(field, String(n));
      // Auto-advance: home → away after typing a digit
      if (field === 'hs' && num.length >= 1 && awayRef.current) {
        setTimeout(() => { awayRef.current.focus(); awayRef.current.select(); }, 60);
      }
    };

    const cityTZ = { 'Atlanta': 0, 'Boston': 0, 'Miami': 0, 'New York/NJ': 0, 'Philadelphia': 0, 'Toronto': 0, 'Dallas': -1, 'Houston': -1, 'Kansas City': -1, 'Monterrey': -2, 'Guadalajara': -2, 'Mexico City': -2, 'Los Angeles': -3, 'San Francisco': -3, 'Seattle': -3, 'Vancouver': -3 };
    const [hh, mm] = match.time.split(':').map(Number);
    const localH = ((hh + (cityTZ[match.city] || 0)) % 24 + 24) % 24;
    const localTime = `${localH > 12 ? localH - 12 : localH || 12}:${String(mm).padStart(2, '0')}${localH >= 12 ? 'p' : 'a'}`;
    const cityCode = CITY_CODES[match.city] || match.city.slice(0, 3).toUpperCase();
    const needsPrediction = !locked && !res?.completed && !p.result;

    const ScoreStepper = ({ value, field, inputRef }) => (
      <div className="cr-stepper">
        <button type="button" className="cr-arrow" onClick={() => spin(field, 1)} disabled={locked}>
          <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 5L5 1L9 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
        </button>
        <input ref={inputRef} type="text" className="cr-input" value={value} inputMode="numeric" pattern="[0-9]*" maxLength={2}
          onChange={e => handleScoreInput(field, e.target.value)} onFocus={e => e.target.select()}
          onKeyDown={e => { if (e.key === 'ArrowUp') { e.preventDefault(); spin(field, 1); } else if (e.key === 'ArrowDown') { e.preventDefault(); spin(field, -1); } }}
          disabled={locked} />
        <button type="button" className="cr-arrow" onClick={() => spin(field, -1)} disabled={locked || parseInt(value) <= 0}>
          <svg width="10" height="6" viewBox="0 0 10 6"><path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/></svg>
        </button>
      </div>
    );

    return (
      <div className={`compact-row ${locked ? 'locked' : ''} ${res?.completed ? 'completed' : ''} ${needsPrediction ? 'needs-prediction' : ''} ${match.isKnockout ? 'knockout' : ''}`}>
        <div className="cr-main">
          <span className="cr-flag">{match.homeFlag}</span>
          <span className="cr-name">{getCode(match.home)}</span>
          {res?.completed ? (
            <div className="cr-final"><span>{res.homeScore}</span><span className="cr-sep">-</span><span>{res.awayScore}</span></div>
          ) : !locked ? (
            <div className="cr-scores">
              <ScoreStepper value={p.score.home} field="hs" inputRef={homeRef} />
              <span className="cr-sep">:</span>
              <ScoreStepper value={p.score.away} field="as" inputRef={awayRef} />
            </div>
          ) : (
            <div className="cr-locked-pick">{p.result ? <span>{p.score.home}-{p.score.away}</span> : <span>—</span>}</div>
          )}
          <span className="cr-name aw">{getCode(match.away)}</span>
          <span className="cr-flag">{match.awayFlag}</span>
        </div>
        <div className="cr-bottom">
          <span className="cr-stage">{match.stage.replace('Group ', 'Grp ')}</span>
          {!locked && !res?.completed && (
            <div className="cr-picks">
              <button className={`cr-pk ${p.result === 'home' ? 'active home-pick' : ''}`} onClick={() => upd('result', 'home')}>{getCode(match.home)}</button>
              <button className={`cr-pk ${p.result === 'draw' ? 'active draw-pick' : ''} ${match.isKnockout ? 'disabled-pick' : ''}`} onClick={() => !match.isKnockout && upd('result', 'draw')}>Draw</button>
              <button className={`cr-pk ${p.result === 'away' ? 'active away-pick' : ''}`} onClick={() => upd('result', 'away')}>{getCode(match.away)}</button>
            </div>
          )}
          {!locked && !res?.completed && match.isKnockout && (
            <div className="cr-ko">
              <label className="cr-ko-label"><input type="checkbox" checked={p.extraTime || false} onChange={e => upd('et', e.target.checked)} /><span>AET</span></label>
              <label className="cr-ko-label"><input type="checkbox" checked={p.penalties || false} onChange={e => upd('pen', e.target.checked)} /><span>PEN</span></label>
            </div>
          )}
          <span className="cr-time">{localTime} {cityCode}</span>
          {pts !== null && <span className="cr-pts">+{pts}</span>}
        </div>
      </div>
    );
  });

  const Landing = () => {
    useScrollReveal();
    const [quickPicks, setQuickPicks] = useState({});
    const [showSignupNudge, setShowSignupNudge] = useState(false);
    const [activeGroup, setActiveGroup] = useState('featured');
    const pickCount = Object.keys(quickPicks).length;

    // Featured big matches for Quick Pick
    const featuredIds = ['gs01', 'gs04', 'gs07', 'gs11', 'gs17', 'gs19', 'gs23', 'gs15', 'gs13', 'gs09', 'gs16', 'gs05'];
    const featuredMatches = featuredIds.map(id => WORLD_CUP_MATCHES.find(m => m.id === id)).filter(Boolean);

    // Group matches for browsing
    const groups = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const displayMatches = activeGroup === 'featured'
      ? featuredMatches
      : WORLD_CUP_MATCHES.filter(m => m.stage === `Group ${activeGroup}`);

    const handleQuickPick = (matchId, pick) => {
      setQuickPicks(prev => {
        const next = { ...prev };
        if (next[matchId] === pick) { delete next[matchId]; return next; }
        next[matchId] = pick;
        // Show signup nudge after 3 picks if not authenticated
        if (!authenticated && Object.keys(next).length >= 3 && !showSignupNudge) {
          setShowSignupNudge(true);
        }
        return next;
      });
    };

    const handleSavePicks = () => {
      if (!authenticated) { login(); return; }
      nav('dashboard');
    };

    // Countdown to tournament
    const daysToGo = Math.max(0, Math.ceil((new Date('2026-06-11T00:00:00Z') - Date.now()) / 86400000));

    return (
      <div className="landing-page">
        <div className="grad-mesh"></div>

        {/* Hero — compact, action-oriented */}
        <section className={`hero hero-compact ${heroAnimated ? 'hero-no-anim' : ''}`}>
          <div className="hero-stadium-bg"></div>
          <div className="hero-stadium-overlay"></div>
          <div className="hero-content" ref={el => { if (el && !heroAnimated) { heroAnimated = true; } }}>
            <div className="hero-badge"><span className="live-dot"></span><span>{daysToGo > 0 ? `${daysToGo} days to kickoff` : 'Tournament is LIVE'}</span></div>
            <h1 className="hero-title">Who&rsquo;s Going to<br/><span className="highlight">Win?</span></h1>
            <p className="hero-subtitle">Pick winners for every World Cup 2026 match. No sign-up needed to start.</p>
            <div className="hero-cta">
              <button className="btn btn-primary btn-lg" onClick={() => document.querySelector('.qp-section')?.scrollIntoView({ behavior: 'smooth' })}>
                <Zap size={20} /> Make Your Picks
              </button>
              {authenticated && (
                <button className="btn btn-secondary btn-lg" onClick={() => nav('dashboard')}>
                  My Leagues <ChevronRight size={18} />
                </button>
              )}
            </div>
            <div className="hero-stats">
              <div className="stat"><div className="stat-value"><AnimatedCounter value={stats.totalPlayers || 0} suffix="+" /></div><div className="stat-label">Players</div></div>
              <div className="stat"><div className="stat-value"><AnimatedCounter value={stats.activeLeagues || 0} /></div><div className="stat-label">Leagues</div></div>
              <div className="stat"><div className="stat-value">104</div><div className="stat-label">Matches</div></div>
            </div>
          </div>
        </section>

        {/* Finals Marquee Strip */}
        <div className="finals-strip"><div className="finals-track">
          {[...FINALS, ...FINALS].map((f, i) => (
            <span key={i} className="fi"><span className="yr">{f.yr}</span> <span className="win">{f.win}</span> <span className="sc">{f.score}</span> {f.city}</span>
          ))}
        </div></div>

        {/* Quick Pick Section — the hook */}
        <section className="qp-section">
          <div className="container">
            <div className="qp-header">
              <div>
                <h2 className="qp-title">Quick Pick</h2>
                <p className="qp-sub">Tap a winner or call it a draw — it&rsquo;s that simple</p>
              </div>
              {pickCount > 0 && (
                <div className="qp-pick-counter">
                  <span className="qp-count">{pickCount}</span>
                  <span className="qp-count-label">{pickCount === 1 ? 'pick' : 'picks'} made</span>
                </div>
              )}
            </div>

            {/* Group filter tabs */}
            <div className="qp-group-tabs">
              <button className={`qp-tab ${activeGroup === 'featured' ? 'active' : ''}`} onClick={() => setActiveGroup('featured')}>
                <Sparkles size={14} /> Featured
              </button>
              {groups.map(g => (
                <button key={g} className={`qp-tab ${activeGroup === g ? 'active' : ''}`} onClick={() => setActiveGroup(g)}>
                  {g}
                </button>
              ))}
            </div>

            {/* Quick Pick match cards */}
            <div className="qp-grid">
              {displayMatches.map(m => {
                const pick = quickPicks[m.id];
                return (
                  <div key={m.id} className={`qp-card ${pick ? 'qp-card-picked' : ''}`}>
                    <div className="qp-card-meta">
                      <span className="qp-stage">{m.stage}</span>
                      <span className="qp-date">{new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <div className="qp-matchup">
                      <button
                        className={`qp-team ${pick === 'home' ? 'qp-team-selected' : ''}`}
                        onClick={() => handleQuickPick(m.id, 'home')}
                      >
                        <span className="qp-flag">{m.homeFlag}</span>
                        <span className="qp-name">{m.home}</span>
                        {pick === 'home' && <CheckCircle size={16} className="qp-check" />}
                      </button>
                      <button
                        className={`qp-draw ${pick === 'draw' ? 'qp-draw-selected' : ''}`}
                        onClick={() => handleQuickPick(m.id, 'draw')}
                      >
                        Draw
                      </button>
                      <button
                        className={`qp-team qp-team-away ${pick === 'away' ? 'qp-team-selected' : ''}`}
                        onClick={() => handleQuickPick(m.id, 'away')}
                      >
                        {pick === 'away' && <CheckCircle size={16} className="qp-check" />}
                        <span className="qp-name">{m.away}</span>
                        <span className="qp-flag">{m.awayFlag}</span>
                      </button>
                    </div>
                    <div className="qp-venue">{m.city}</div>
                  </div>
                );
              })}
            </div>

            {/* Signup nudge — appears after a few picks for unauthenticated users */}
            {showSignupNudge && !authenticated && (
              <div className="qp-nudge reveal">
                <div className="qp-nudge-inner">
                  <div className="qp-nudge-icon"><Trophy size={28} /></div>
                  <div className="qp-nudge-text">
                    <strong>Nice picks!</strong> Save your predictions, join leagues, and compete on the leaderboard.
                  </div>
                  <button className="btn btn-primary" onClick={() => login()}>
                    <UserPlus size={18} /> Sign up free
                  </button>
                  <button className="qp-nudge-dismiss" onClick={() => setShowSignupNudge(false)}>
                    <X size={16} />
                  </button>
                </div>
              </div>
            )}

            {/* Sticky save bar when picks exist */}
            {pickCount > 0 && (
              <div className="qp-save-bar">
                <div className="qp-save-inner">
                  <span>{pickCount} {pickCount === 1 ? 'prediction' : 'predictions'} ready</span>
                  <button className="btn btn-primary" onClick={handleSavePicks}>
                    {authenticated ? <><Save size={18} /> Save &amp; Go to Leagues</> : <><UserPlus size={18} /> Sign up to save</>}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* How it Works — simplified */}
        <section className="features"><div className="container">
          <div className="section-header reveal"><h2>How It Works</h2><p>From spectator to oracle in three steps</p></div>
          <div className="features-grid">
            <div className="feature-card reveal-float stagger-1 glow-hover">
              <div className="feature-icon">// 01</div>
              <h3>Pick Winners</h3>
              <p>Tap home, draw, or away for every match. Quick Pick mode gets you started in seconds — or go deep with exact score predictions in leagues.</p>
            </div>
            <div className="feature-card reveal-float stagger-2 glow-hover">
              <div className="feature-icon">// 02</div>
              <h3>Join Leagues</h3>
              <p>Create your own league or join public ones. Go private with invite codes and compete with friends, family, or coworkers.</p>
            </div>
            <div className="feature-card reveal-float stagger-3 glow-hover">
              <div className="feature-icon">// 03</div>
              <h3>Climb the Leaderboard</h3>
              <p>Earn points for correct calls. Exact score predictions score big bonus points. Results verified live from multiple sources.</p>
            </div>
          </div>
        </div></section>

        {/* Social proof / CTA */}
        <section className="cta-section">
          <div className="container">
            <div className="cta-card reveal">
              <h2>104 matches. 48 nations. One question.</h2>
              <p>Who&rsquo;s going to win?</p>
              <button className="btn btn-primary btn-lg" onClick={() => authenticated ? nav('dashboard') : login()}>
                {authenticated ? 'Go to Dashboard' : 'Join free — takes 10 seconds'}
              </button>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <div className="footer-content">
            <div className="footer-brand"><span className="gt">GoalOracle</span> · 2026</div>
            <div className="footer-links">
              <a onClick={() => document.querySelector('.qp-section')?.scrollIntoView({ behavior: 'smooth' })}>Quick Pick</a>
              <a onClick={() => authenticated ? nav('dashboard') : login()}>Play Now</a>
              <a onClick={() => nav('faq')}>FAQ</a>
              <a onClick={() => nav('feedback')}>Feedback</a>
            </div>
            <div className="footer-copy">A free prediction game for the FIFA World Cup 2026 · Not affiliated with FIFA · For entertainment purposes only</div>
            <div className="footer-disclaimer" style={{fontSize: '11px', opacity: 0.5, maxWidth: '600px', margin: '8px auto 0', lineHeight: 1.4}}>
              GoalOracle is a free entertainment platform. No real money is wagered, collected, or distributed. This is not a gambling service. &ldquo;FIFA World Cup&rdquo; and related marks are trademarks of FIFA. GoalOracle is not endorsed by or affiliated with FIFA.
            </div>
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
                const match = allLeagues.find(l => l.passcode && l.passcode === passInput.trim());
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
            <div className="league-stats">
              <div className="league-stat"><Users size={18} /><span>{l.memberCount || 0} players</span></div>
              {l.matchScope && l.matchScope !== 'all' && (
                <div className="league-stat"><Target size={16} /><span>{l.matchScope === 'groups' ? `Groups ${(l.selectedGroups||[]).join(',')}` : `${(l.selectedRounds||[]).length} rounds`}</span></div>
              )}
            </div>
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
    const [matchScope, setMatchScope] = useState('all'); // all | groups | rounds
    const [selGroups, setSelGroups] = useState([]); // selected group letters
    const [selRounds, setSelRounds] = useState([]); // selected round ids
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState('');
    const tot = di.first + di.second + di.third;
    const genCode = () => { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let c = ''; for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)]; setPasscode(c); };

    const allGroups = ['A','B','C','D','E','F','G','H','I','J','K','L'];
    const allRounds = [
      { id: 'group', label: 'Group Stage' },
      { id: 'r32', label: 'Round of 32' },
      { id: 'r16', label: 'Round of 16' },
      { id: 'qf', label: 'Quarterfinals' },
      { id: 'sf', label: 'Semifinals' },
      { id: 'final', label: 'Final' },
    ];
    const toggleGroup = (g) => setSelGroups(p => p.includes(g) ? p.filter(x => x !== g) : [...p, g]);
    const toggleRound = (r) => setSelRounds(p => p.includes(r) ? p.filter(x => x !== r) : [...p, r]);

    // Compute match count for scope
    const scopeMatchCount = useMemo(() => {
      if (matchScope === 'all') return WORLD_CUP_MATCHES.length;
      if (matchScope === 'groups') return WORLD_CUP_MATCHES.filter(m => !m.isKnockout && selGroups.some(g => m.stage === `Group ${g}`)).length;
      if (matchScope === 'rounds') {
        return WORLD_CUP_MATCHES.filter(m => {
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

    const go = async () => {
      if (!uData?.id) { setErr('Still loading your account. Please wait a moment and try again.'); return; }
      if (!nm.trim()) { setErr('Name required'); return; }
      if (vis === 'private' && !passcode.trim()) { setErr('Passcode required for private leagues'); return; }
      if (tp === 'paid' && (!fe || parseFloat(fe) <= 0)) { setErr('Fee required'); return; }
      if (tp === 'paid' && tot !== 100) { setErr('Must total 100%'); return; }
      if (matchScope === 'groups' && selGroups.length === 0) { setErr('Select at least one group'); return; }
      if (matchScope === 'rounds' && selRounds.length === 0) { setErr('Select at least one round'); return; }
      if (tp === 'paid' && matchScope === 'rounds') { setErr('Paid leagues must use All Matches or Specific Groups — knockout-only scope is available for free leagues only'); return; }
      setBusy(true); setErr('');
      const scopeData = matchScope === 'all' ? { matchScope: 'all' } :
        matchScope === 'groups' ? { matchScope: 'groups', selectedGroups: selGroups } :
        { matchScope: 'rounds', selectedRounds: selRounds };
      try { 
        const leagueData = { name: nm.trim(), type: tp, visibility: vis, passcode: vis === 'private' ? passcode.trim().toUpperCase() : null, entryFee: tp === 'paid' ? parseFloat(fe) : 0, currency: cu, prizeDistribution: tp === 'paid' ? di : null, pointsSystem: ps, ...scopeData }; 
        const lid = await createLeague(leagueData, uData.id); 
        console.log('[create] success, id:', lid); 
        notify('League created!'); 
        nav('dashboard'); 
      } catch(e) { 
        console.error('[create] FAILED:', e); 
        setBusy(false); 
        setErr(e.message || 'Failed to create league — check Firestore rules'); 
        notify('League creation failed: ' + e.message, 'error'); 
        return; 
      } finally { setBusy(false); }
    };
    return (
      <div className="create-league">
        <div className="page-header"><button className="btn-back" onClick={() => nav('dashboard')}>← Back</button><h1>Create Your League</h1></div>
        <div className="create-league-form">
          {err && <div className="form-error"><AlertTriangle size={16} /> {err}</div>}
          <div className="form-section"><label>League Type</label>
            <div className="type-selector">
              <button type="button" className={`type-option ${tp === 'free' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setTp('free'); }}><Unlock size={24} /><div><h4>Free League</h4><p>Play for fun and bragging rights</p></div></button>
              <button type="button" className="type-option disabled-option" disabled style={{opacity: 0.5, cursor: 'not-allowed'}} onClick={e => e.preventDefault()}><Lock size={24} /><div><h4>Prize League</h4><p>Coming soon</p></div></button>
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
            <div className="form-section"><label>Entry Fee</label><div className="input-group"><input type="number" placeholder="50" value={fe} min="1" onChange={e => setFe(e.target.value)} className="input-field" /><span className="input-currency">USDC</span></div></div>
            <div className="form-section"><label>Prize Distribution {tot !== 100 && <span className="validation-error">(Currently {tot}%)</span>}</label>
              <div className="prize-distribution">{['first','second','third'].map((k,i) => <div key={k} className="prize-item"><span>{['1st','2nd','3rd'][i]} Place</span><input type="number" value={di[k]} onChange={e => setDi({...di,[k]:parseInt(e.target.value)||0})} className="input-field-sm" /><span>%</span></div>)}</div>
            </div>
          </>}
          <div className="form-section"><label>Match Selection {tp === 'paid' && <span className="form-hint-inline">(Paid leagues: All Matches or Groups only)</span>}</label>
            <div className="type-selector triple">
              <button type="button" className={`type-option ${matchScope === 'all' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setMatchScope('all'); }}><Globe size={24} /><div><h4>All Matches</h4><p>Full tournament (104)</p></div></button>
              <button type="button" className={`type-option ${matchScope === 'groups' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setMatchScope('groups'); }}><Target size={24} /><div><h4>Specific Groups</h4><p>Pick groups A–L</p></div></button>
              <button type="button" className={`type-option ${matchScope === 'rounds' ? 'active' : ''} ${tp === 'paid' ? 'disabled-option' : ''}`} onClick={e => { e.preventDefault(); if (tp !== 'paid') setMatchScope('rounds'); }}><TrendingUp size={24} /><div><h4>By Round</h4><p>{tp === 'paid' ? 'Free leagues only' : 'Group stage, knockouts, etc.'}</p></div></button>
            </div>
          </div>
          {matchScope === 'groups' && (
            <div className="form-section">
              <label>Select Groups <span className="form-hint-inline">({selGroups.length} selected · {scopeMatchCount} matches)</span></label>
              <div className="group-selector">{allGroups.map(g => (
                <button type="button" key={g} className={`group-chip ${selGroups.includes(g) ? 'active' : ''}`} onClick={e => { e.preventDefault(); toggleGroup(g); }}>
                  Group {g}
                </button>
              ))}</div>
            </div>
          )}
          {matchScope === 'rounds' && (
            <div className="form-section">
              <label>Select Rounds <span className="form-hint-inline">({selRounds.length} selected · {scopeMatchCount} matches)</span></label>
              <div className="group-selector">{allRounds.map(r => (
                <button type="button" key={r.id} className={`group-chip ${selRounds.includes(r.id) ? 'active' : ''}`} onClick={e => { e.preventDefault(); toggleRound(r.id); }}>
                  {r.label}
                </button>
              ))}</div>
            </div>
          )}
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
    const weekCelebratedRef = useRef({});
    const predView = detailPredView, setPredView = setDetailPredView;
    const predsLoadedRef = useRef(false);
    // Load celebrated state from localStorage when league changes
    useEffect(() => {
      predsLoadedRef.current = false;
      if (!selLeague?.id) { weekCelebratedRef.current = {}; return; }
      try { weekCelebratedRef.current = JSON.parse(localStorage.getItem(`celebrated_${selLeague.id}`) || '{}'); } catch { weekCelebratedRef.current = {}; }
    }, [selLeague?.id]);

    const isAdmin = role === 'superadmin' || role === 'admin';
    const isCreator = selLeague?.createdBy === uData?.id;
    const isPrivate = selLeague?.visibility === 'private';
    const isMember = selLeague?.members?.includes(uData?.id);

    useEffect(() => { if (tab !== 'leaderboard' || !selLeague?.id) return; (async () => { setLbl(true); try { const { leaderboard: bu, userNames } = await getLeagueLeaderboard(selLeague.id); const p = selLeague.pointsSystem || {}; const e = Object.entries(bu).map(([uid, pr]) => ({ userId: uid, displayName: userNames[uid] || uid.slice(0, 8), ...calculateTotalPoints(pr, results, p) })); setLb(sortLeaderboard(e)); } catch(e){console.error(e);} finally{setLbl(false);} })(); }, [tab, selLeague?.id, results]);

    const handleDelete = async () => {
      try { await deleteLeague(selLeague.id, uData.id); notify(`"${selLeague.name}" deleted`); nav('dashboard'); } catch(e) { notify(e.message, 'error'); }
    };
    const handleLeave = async () => {
      try { await leaveLeague(selLeague.id, uData.id); notify(`Left "${selLeague.name}"`); nav('dashboard'); } catch(e) { notify(e.message, 'error'); }
    };
    const copyInvite = () => {
      const msg = `Join my GoalOracle league "${selLeague.name}"!\n\nPasscode: ${selLeague.passcode}\n\nSign up at ${window.location.origin}`;
      navigator.clipboard.writeText(msg).then(() => { setInviteCopied(true); setTimeout(() => setInviteCopied(false), 2000); });
    };


    // ── Bracket resolution: compute resolved team names for knockout matches ──
    const bracketData = useMemo(() => {
      try {
        return resolveBracket(preds);
      } catch (e) { console.error('Bracket resolve error:', e); return { resolved: {}, standings: {} }; }
    }, [preds]);

    // Augmented match list: overlay resolved names onto knockout matches
    const augmentedMatches = useMemo(() => {
      const all = WORLD_CUP_MATCHES.map(m => {
        if (!m.isKnockout) return m;
        const r = bracketData.resolved[m.id];
        if (!r) return m; // not yet resolved
        return { ...m, home: r.home, away: r.away, homeFlag: r.homeFlag, awayFlag: r.awayFlag };
      });
      // Apply league match scope filter
      const scope = selLeague?.matchScope;
      if (!scope || scope === 'all') return all;
      if (scope === 'groups') {
        const sg = selLeague?.selectedGroups || [];
        return all.filter(m => !m.isKnockout && sg.some(g => m.stage === `Group ${g}`));
      }
      if (scope === 'rounds') {
        const sr = selLeague?.selectedRounds || [];
        return all.filter(m => {
          if (sr.includes('group') && !m.isKnockout) return true;
          if (sr.includes('r32') && m.stage === 'Round of 32') return true;
          if (sr.includes('r16') && m.stage === 'Round of 16') return true;
          if (sr.includes('qf') && m.stage === 'Quarterfinal') return true;
          if (sr.includes('sf') && m.stage === 'Semifinal') return true;
          if (sr.includes('final') && (m.stage === 'Final' || m.stage === '3rd Place')) return true;
          return false;
        });
      }
      return all;
    }, [bracketData, selLeague?.matchScope, selLeague?.selectedGroups, selLeague?.selectedRounds]);

    // Group matches by week for easier navigation
    const matchWeeks = useMemo(() => {
      const weeks = [
        { id: 'week1', label: 'Week 1', sub: 'Jun 11–17', filter: m => m.date >= '2026-06-11' && m.date <= '2026-06-17' && !m.isKnockout },
        { id: 'week2', label: 'Week 2', sub: 'Jun 18–23', filter: m => m.date >= '2026-06-18' && m.date <= '2026-06-23' && !m.isKnockout },
        { id: 'week3', label: 'Week 3', sub: 'Jun 24–27', filter: m => m.date >= '2026-06-24' && m.date <= '2026-06-27' && !m.isKnockout },
        { id: 'r32', label: 'Rd of 32', sub: 'Jun 28–Jul 3', filter: m => m.stage === 'Round of 32' },
        { id: 'r16', label: 'Rd of 16', sub: 'Jul 4–7', filter: m => m.stage === 'Round of 16' },
        { id: 'qf', label: 'Quarters', sub: 'Jul 9–11', filter: m => m.stage === 'Quarterfinal' },
        { id: 'sf', label: 'Semis', sub: 'Jul 14–15', filter: m => m.stage === 'Semifinal' },
        { id: 'finals', label: 'Finals', sub: 'Jul 18–19', filter: m => m.stage === '3rd Place' || m.stage === 'Final' },
      ];
      return weeks.map(w => {
        const matches = augmentedMatches.filter(w.filter);
        const predicted = matches.filter(m => preds[m.id]?.result).length;
        return { ...w, matches, count: matches.length, predicted, complete: matches.length > 0 && predicted === matches.length };
      });
    }, [augmentedMatches, preds]);

    const activeWeek = matchWeeks.find(w => w.id === sf);
    const fm = sf === 'all' ? augmentedMatches : (activeWeek?.matches || []);
    const filteredMatches = stageFilter === 'all' ? fm : fm.filter(m => m.stage === stageFilter);
    const stagesInView = [...new Set(fm.map(m => m.stage))];

    // Progress stats for current view
    const viewPredicted = filteredMatches.filter(m => preds[m.id]?.result).length;
    const viewTotal = filteredMatches.length;
    const viewRemaining = viewTotal - viewPredicted;
    const viewPct = viewTotal > 0 ? Math.round((viewPredicted / viewTotal) * 100) : 0;

    // Streak: consecutive predictions made (from most recent)
    const streak = useMemo(() => {
      let s = 0;
      for (const m of [...filteredMatches].reverse()) {
        if (preds[m.id]?.result) s++;
        else break;
      }
      return s;
    }, [filteredMatches, preds]);

    // Group matches by date for rendering
    const matchesByDate = useMemo(() => {
      const displayMatches = hidePredicted && frozenUnpredictedIds
        ? filteredMatches.filter(m => frozenUnpredictedIds.has(m.id))
        : filteredMatches;
      const groups = {};
      displayMatches.forEach(m => {
        const key = m.date;
        if (!groups[key]) groups[key] = [];
        groups[key].push(m);
      });
      return Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([date, matches]) => ({
        date,
        label: new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }),
        matches,
        predicted: matches.filter(m => preds[m.id]?.result).length,
      }));
    }, [filteredMatches, preds, hidePredicted, frozenUnpredictedIds]);

    // How many unpredicted remain for quick pick
    const unpredictedCount = filteredMatches.filter(m => {
      const status = getMatchStatus(m.date, m.time);
      return status === 'open' && !results[m.id]?.completed && !preds[m.id]?.result;
    }).length;

    // Quick Pick: auto-fill unpredicted matches with random picks
    const handleQuickPick = () => {
      const updates = {};
      const targets = filteredMatches.filter(m => {
        const status = getMatchStatus(m.date, m.time);
        return status === 'open' && !results[m.id]?.completed && !preds[m.id]?.result;
      });
      targets.forEach(m => {
        const options = m.isKnockout ? ['home', 'away'] : ['home', 'draw', 'away'];
        const pick = options[Math.floor(Math.random() * options.length)];
        const hs = pick === 'home' ? String(Math.floor(Math.random() * 3) + 1) : String(Math.floor(Math.random() * 2));
        const as = pick === 'away' ? String(Math.floor(Math.random() * 3) + 1) : pick === 'draw' ? hs : String(Math.floor(Math.random() * 2));
        updates[m.id] = { result: pick, score: { home: hs, away: as }, extraTime: false, penalties: false };
      });
      if (Object.keys(updates).length > 0) {
        setPreds(prev => ({ ...prev, ...updates }));
        notify(`Quick picked ${Object.keys(updates).length} matches — adjust any you disagree with!`);
      }
    };

    // Celebrate when a week is fully predicted (once ever, persisted in localStorage)
    useEffect(() => {
      if (!selLeague?.id) return;
      // On first prediction load, mark already-complete weeks as celebrated silently
      if (!predsLoadedRef.current) {
        const hasAny = Object.values(preds).some(p => p.result);
        if (!hasAny) return;
        predsLoadedRef.current = true;
        let changed = false;
        matchWeeks.forEach(w => {
          if (w.complete && !weekCelebratedRef.current[w.id]) {
            weekCelebratedRef.current[w.id] = true;
            changed = true;
          }
        });
        if (changed) {
          try { localStorage.setItem(`celebrated_${selLeague.id}`, JSON.stringify(weekCelebratedRef.current)); } catch {}
        }
        return;
      }
      if (sf === 'all') return;
      const w = matchWeeks.find(w => w.id === sf);
      if (w && w.complete && !weekCelebratedRef.current[sf]) {
        weekCelebratedRef.current[sf] = true;
        try { localStorage.setItem(`celebrated_${selLeague.id}`, JSON.stringify(weekCelebratedRef.current)); } catch {}
        setConfetti(true);
        notify(`${w.label} complete! 🎉`);
        setTimeout(() => setConfetti(false), 3000);
      }
    }, [matchWeeks, sf, preds, selLeague?.id]);

    const hasU = Object.values(preds).some(p => p.result);
    const filledCount = Object.values(preds).filter(p => p.result).length;

    return (
      <div className="league-detail">
        <div className="page-header-compact">
          <div className="phc-left">
            <button className="btn-back-sm" onClick={() => nav('dashboard')}>←</button>
            <h1 className="phc-title">{selLeague?.name}</h1>
            <div className="phc-meta">
              <span><Users size={14} /> {(selLeague?.memberCount || selLeague?.members?.length || 0)}</span>
              {selLeague?.type === 'paid' && <span><Coins size={14} /> {selLeague?.entryFee} {selLeague?.currency || 'USDC'}</span>}
              <span><Target size={14} /> {filledCount}/{augmentedMatches.length}</span>
              {isPrivate ? <span className="badge badge-private"><EyeOff size={10} /> Private</span> : <span className="badge badge-public"><Eye size={10} /> Public</span>}
            </div>
          </div>
          <div className="phc-right">
            {isPrivate && (isCreator || isAdmin) && (
              <button className="btn btn-secondary btn-sm" onClick={() => setShowInvite(true)}><Share2 size={14} /></button>
            )}
            {isAdmin && selLeague?.id !== 'global' && (
              <button className="btn btn-sm" style={{background: 'rgba(255,59,92,0.1)', color: 'var(--danger)', border: '1px solid rgba(255,59,92,0.2)'}} onClick={() => setShowDelete(true)}><Trash2 size={14} /></button>
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
            <button type="button" className={`week-tab ${sf === 'all' ? 'active' : ''}`} onClick={e => { e.preventDefault(); setSf('all'); setStageFilter('all'); }}>All ({augmentedMatches.length})</button>
            {matchWeeks.map(w => (
              <button type="button" key={w.id} className={`week-tab ${sf === w.id ? 'active' : ''} ${w.complete ? 'week-complete' : ''}`} onClick={e => { e.preventDefault(); setSf(w.id); setStageFilter('all'); }}>
                <span className="week-tab-label">{w.label}</span>
                <span className="week-tab-sub">{w.predicted}/{w.count}</span>
                {w.complete && <CheckCircle size={12} className="week-check" />}
              </button>
            ))}
          </div>

          {/* Inline progress + autosave + view toggle + quick pick */}
          <div className="pred-inline-bar">
            <span className="pib-count">{viewPredicted}/{viewTotal}</span>
            <div className="pib-bar"><div className="pib-fill" style={{ width: `${viewPct}%` }} /></div>
            <span className="pib-pct">{viewPct}%{viewPct === 100 && ' ✓'}</span>
            <span className="pib-auto">{saving ? <><RefreshCw size={10} className="spin" /> Saving</> : <><CheckCircle size={10} /> Auto-saves</>}</span>
            {unpredictedCount > 0 && (
              <button type="button" className="btn btn-secondary btn-xs" onClick={handleQuickPick}>
                <Sparkles size={12} /> Quick Pick
              </button>
            )}
            {viewPredicted > 0 && viewRemaining > 0 && (
              <label className="pib-hide"><input type="checkbox" checked={hidePredicted} onChange={e => { const on = e.target.checked; setHidePredicted(on); if (on) { setFrozenUnpredictedIds(new Set(filteredMatches.filter(m => !preds[m.id]?.result).map(m => m.id))); } else { setFrozenUnpredictedIds(null); } }} /><span>Unpredicted only</span></label>
            )}
            <div className="pib-view-toggle">
              <button className={`pvt-btn ${predView === 'rows' ? 'active' : ''}`} onClick={() => setPredView('rows')} title="Compact rows"><List size={14} /></button>
              <button className={`pvt-btn ${predView === 'grid' ? 'active' : ''}`} onClick={() => setPredView('grid')} title="Card grid"><LayoutGrid size={14} /></button>
            </div>
          </div>

          {/* Bracket hint for knockout tabs */}
          {['r32','r16','qf','sf','finals'].includes(sf) && filteredMatches.some(m => m.isKnockout && (m.home.includes('Group') || m.home.includes('W '))) && (
            <div className="bracket-hint">
              <AlertTriangle size={16} />
              <span>Some matchups are still pending — predict all group stage matches to auto-fill the knockout bracket.</span>
            </div>
          )}

          {/* Date-grouped matches */}
          <div className="matches-list">
            {matchesByDate.map(group => (
              <div key={group.date} className="match-date-group">
                <div className="match-date-header">
                  <span className="match-date-label">{group.label}</span>
                  <span className="match-date-count">{group.predicted}/{group.matches.length}</span>
                </div>
                {predView === 'grid' ? (
                  <div className="match-date-group-grid">
                    {group.matches.map(m => <PredictionCard key={m.id} match={m} pred={preds[m.id]} result={results[m.id]} />)}
                  </div>
                ) : (
                  <div className="match-date-group-rows">
                    {group.matches.map(m => <CompactRow key={m.id} match={m} pred={preds[m.id]} result={results[m.id]} />)}
                  </div>
                )}
              </div>
            ))}
            {matchesByDate.length === 0 && hidePredicted && (
              <div className="empty-state" style={{ textAlign: 'center', padding: '2rem' }}>
                <CheckCircle size={32} style={{ color: '#00c853', marginBottom: '0.5rem' }} />
                <p>All matches in this view are predicted!</p>
                <button className="btn btn-secondary btn-sm" onClick={() => setHidePredicted(false)}>Show all matches</button>
              </div>
            )}
          </div>
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

  // Parent-level league creation handler (survives inline component remounts)
  const createLeagueRef = useRef(null);
  const handleCreateLeague = useCallback(async (leagueData) => {
    if (!uData?.id) return;
    try {
      const lid = await createLeague(leagueData, uData.id);
      console.log('[create] success, leagueId=', lid);
      notify('League created!');
      nav('dashboard');
    } catch (e) {
      console.error('[create] failed:', e);
      notify(e.message || 'Failed to create league', 'error');
    }
  }, [uData?.id, nav, notify]);
  createLeagueRef.current = handleCreateLeague;

  const [fundModal, setFundModal] = useState(false);
  const [hidePredicted, setHidePredicted] = useState(false);
  const [frozenUnpredictedIds, setFrozenUnpredictedIds] = useState(null);
  const [walletBalances, setWalletBalances] = useState({ USDC: '0.00', POL: '0.00' });
  const [balLoading, setBalLoading] = useState(false);
  const balancesRef = useRef(walletBalances);

  // Resolve wallet address from Privy user
  const walletAddress = useMemo(() => {
    return typeof user?.wallet === 'string' ? user.wallet : user?.wallet?.address || uData?.walletAddress || '';
  }, [user?.wallet, uData?.walletAddress]);

  // Fetch balances on auth and periodically
  const refreshBalances = useCallback(async () => {
    if (!walletAddress) return;
    setBalLoading(true);
    try {
      const bal = await getWalletBalances(walletAddress);
      balancesRef.current = bal;
      setWalletBalances(bal);
    } catch (e) {
      console.error('[wallet] Balance fetch failed:', e.message);
    } finally { setBalLoading(false); }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;
    refreshBalances();
    // Use ref-based polling to avoid re-renders every 60s
    const interval = setInterval(async () => {
      if (!walletAddress) return;
      try {
        const bal = await getWalletBalances(walletAddress);
        balancesRef.current = bal;
        // Only update state if values actually changed
        setWalletBalances(prev => {
          if (prev.USDC === bal.USDC && prev.POL === bal.POL) return prev;
          return bal;
        });
      } catch {}
    }, 60000);
    return () => clearInterval(interval);
  }, [walletAddress, refreshBalances]);

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
    const [useBridge, setUseBridge] = useState(false);
    const walletAddr = walletAddress;

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
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${await getTokenSafe(5000)}` },
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
          headers: { 'Authorization': `Bearer ${await getTokenSafe(5000)}` },
        });
        const data = await res.json();
        setBridgeStatus(data.status || data.state || 'pending');
      } catch (e) { setBridgeStatus('error'); }
    };

    const copyDeposit = () => {
      const addr = useBridge ? depositAddr : walletAddr;
      if (!addr) return;
      navigator.clipboard.writeText(addr).then(() => {
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

          {/* Current balance */}
          <div className="fund-balance-bar">
            <div className="fund-bal-item"><span className="fund-bal-label">USDC</span><span className="fund-bal-val">{formatBalance(walletBalances.USDC)}</span></div>
            <div className="fund-bal-item fund-bal-dim"><span className="fund-bal-label">POL</span><span className="fund-bal-val">{formatBalance(walletBalances.POL)}</span></div>
            <button className="balance-refresh" onClick={refreshBalances} title="Refresh"><RefreshCw size={12} className={balLoading ? 'spin' : ''} /></button>
          </div>

          {/* Tab: Direct Transfer vs Bridge */}
          <div className="fund-tabs">
            <button className={`fund-tab ${!useBridge ? 'active' : ''}`} onClick={() => setUseBridge(false)}>Direct Transfer</button>
            <button className={`fund-tab ${useBridge ? 'active' : ''}`} onClick={() => setUseBridge(true)}>Bridge & Swap</button>
          </div>

          {!useBridge ? (<>
            {/* Simple direct transfer — just show wallet address */}
            <p className="fund-desc">Send USDC directly to your wallet on Polygon. No bridging needed if you already have USDC on Polygon.</p>
            <div className="fund-section">
              <label>Your Polygon Wallet Address</label>
              <div className="deposit-addr-box">
                <code>{walletAddr}</code>
                <button className="copy-btn" onClick={copyDeposit}>{copied2 ? <CheckCircle size={14} /> : <Copy size={14} />}</button>
              </div>
            </div>
            <div className="fund-note-box">
              <div className="fund-note-item"><CheckCircle size={14} /> Send <strong>USDC</strong> on Polygon — contract: <code>0x3c499...3359</code></div>
              <div className="fund-note-item"><AlertTriangle size={14} /> Only send on <strong>Polygon network</strong> — other chains will lose funds</div>
            </div>
          </>) : (<>
            {/* Bridge flow */}
            <p className="fund-desc">Send any supported token from any chain — it auto-converts to USDC on Polygon for your wallet.</p>

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
    const walletAddr = walletAddress;
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
        const updated = await updateUserProfile(uData.id, { displayName: newName.trim(), usernameSet: true });
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
            {walletAddr ? (<>
              <div className="dropdown-wallet">
                <code className="wallet-addr">{walletAddr.slice(0, 10)}...{walletAddr.slice(-8)}</code>
                <button className="copy-btn" onClick={copyAddress} title="Copy address">
                  {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                </button>
              </div>
              <div className="dropdown-balances">
                <div className="balance-row">
                  <span className="balance-token">USDC</span>
                  <span className="balance-amount">{formatBalance(walletBalances.USDC)}</span>
                </div>
                <div className="balance-row balance-row-dim">
                  <span className="balance-token">POL</span>
                  <span className="balance-amount">{formatBalance(walletBalances.POL)}</span>
                </div>
                <button className="balance-refresh" onClick={e => { e.stopPropagation(); refreshBalances(); }} title="Refresh balances">
                  <RefreshCw size={12} className={balLoading ? 'spin' : ''} />
                </button>
              </div>
            </>) : (
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
  // ─── Feedback Form ─────────────────────────────────────────────────────
  const Feedback = () => {
    // Try to get email from Privy — wallet-only users won't have one
    const privyEmail = uData?.email || (typeof user?.email === 'string' ? user.email : user?.email?.address) || '';
    const hasEmail = authenticated && !!privyEmail;
    const [fbEmail, setFbEmail] = useState(privyEmail);
    const [fbName, setFbName] = useState(uData?.displayName || '');
    const [fbType, setFbType] = useState('general');
    const [fbMsg, setFbMsg] = useState('');
    const [fbSending, setFbSending] = useState(false);
    const [fbSent, setFbSent] = useState(false);
    const [fbError, setFbError] = useState('');

    // If logged in with email, use it; otherwise require manual entry
    const finalEmail = hasEmail ? privyEmail : fbEmail.trim();

    const handleFeedbackSubmit = async () => {
      if (!finalEmail || !fbMsg.trim()) return;
      setFbError('');
      setFbSending(true);
      try {
        const feedbackPayload = {
          email: finalEmail,
          name: fbName.trim(),
          type: fbType,
          message: fbMsg.trim(),
          userId: uData?.id || null,
          displayName: uData?.displayName || null,
          timestamp: new Date().toISOString(),
        };
        // Write to Firestore directly (instant)
        await submitFeedback(feedbackPayload);
        setFbSent(true);
        // Fire-and-forget: send email notification via API
        fetch('/api/feedback', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(feedbackPayload),
        }).catch(() => {});
      } catch (e) {
        console.error('Feedback error:', e);
        setFbError(e.message || 'Something went wrong');
      } finally {
        setFbSending(false);
      }
    };

    if (fbSent) return (
      <div className="page feedback-page">
        <div className="feedback-success">
          <CheckCircle size={48} />
          <h2>Thank you!</h2>
          <p>We appreciate you taking the time to share your thoughts. Your feedback helps us build a better GoalOracle.</p>
          <button className="btn btn-primary" onClick={() => nav('landing')}>Back to Home</button>
        </div>
      </div>
    );

    return (
      <div className="page feedback-page">
        <div className="page-header">
          <button className="btn-back" onClick={() => nav('landing')}>← Back</button>
          <h1>Share Your Feedback</h1>
          <p style={{ color: 'var(--text-sec)', fontSize: '0.88rem', marginTop: '0.25rem' }}>GoalOracle is in alpha — your input directly shapes what we build next.</p>
        </div>
        <div className="feedback-form-container">
          {!hasEmail && (
            <div className="form-section">
              <label>Email <span className="required">*</span></label>
              <input type="email" placeholder="your@email.com" value={fbEmail} onChange={e => setFbEmail(e.target.value)} className="input-field" />
            </div>
          )}
          {hasEmail && (
            <div className="feedback-signed-in">
              <CheckCircle size={16} /> Submitting as <strong>{privyEmail}</strong>
            </div>
          )}
          <div className="form-section">
            <label>Name <span className="form-hint-inline">(optional)</span></label>
            <input type="text" placeholder="Your name" value={fbName} onChange={e => setFbName(e.target.value)} className="input-field" />
          </div>
          <div className="form-section">
            <label>Feedback Type</label>
            <div className="feedback-type-grid">
              {[
                { id: 'general', label: 'General', icon: <MessageSquare size={16} /> },
                { id: 'bug', label: 'Bug Report', icon: <AlertTriangle size={16} /> },
                { id: 'feature', label: 'Feature Request', icon: <Sparkles size={16} /> },
                { id: 'ux', label: 'UX / Design', icon: <Eye size={16} /> },
              ].map(t => (
                <button key={t.id} type="button" className={`feedback-type-btn ${fbType === t.id ? 'active' : ''}`} onClick={() => setFbType(t.id)}>
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>
          <div className="form-section">
            <label>Your Feedback <span className="required">*</span></label>
            <textarea placeholder="What's working? What's not? What would you like to see?" value={fbMsg} onChange={e => setFbMsg(e.target.value)} className="input-field feedback-textarea" rows={6} />
          </div>
          {fbError && (
            <div className="feedback-error">
              <AlertTriangle size={16} /> {fbError} — you can also email <a href="mailto:support@goaloracle.io">support@goaloracle.io</a> directly.
            </div>
          )}
          <div className="form-actions">
            <button className="btn btn-secondary" onClick={() => nav('landing')}>Cancel</button>
            <button className="btn btn-primary" onClick={handleFeedbackSubmit} disabled={fbSending || !finalEmail || !fbMsg.trim()}>
              {fbSending ? <><RefreshCw size={18} className="spin" /> Sending...</> : <><Send size={18} /> Submit Feedback</>}
            </button>
          </div>
        </div>
      </div>
    );
  };

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
            a: 'GoalOracle is a free prediction game for the FIFA World Cup 2026. You predict the outcomes of all 104 matches — from the group stage through to the final — and compete against friends and the global community on leaderboards. It\'s free to play — no money involved, just bragging rights.'
          },
          {
            q: 'How do I make predictions?',
            a: 'After signing up and joining a league, go to the Predictions tab. For each match you can predict the winner (home/draw/away) for 3 points, and optionally predict the exact score for 5 bonus points. For knockout matches you can also predict extra time (+1 pt) and penalty shootout outcomes (+2 pts). As you predict group matches, the knockout bracket auto-fills based on your predicted group standings — including the 8 best third-placed teams per FIFA rules.'
          },
          {
            q: 'How does the knockout bracket work?',
            a: 'Once you predict all group stage matches, GoalOracle calculates your predicted group standings (points → head-to-head → goal difference → goals scored). The top 2 from each group plus the 8 best third-placed teams fill the Round of 32. As you predict each knockout round, the next round auto-populates with the winners. The third-place bracket assignment follows the official FIFA Annex C mapping with all 495 possible combinations.'
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
            q: 'Can I create a league for specific groups or rounds?',
            a: 'Yes! When creating a league, choose "Specific Groups" to select one or more groups (A–L), or "By Round" to pick from Group Stage, Round of 32, Round of 16, Quarterfinals, Semifinals, or Final. Members will only see and predict the matches in that scope.'
          },
          {
            q: 'How do I invite friends to a private league?',
            a: 'After creating a private league, go to the league detail page and click "Invite." This shows your league passcode and a "Copy Invite" button that copies a ready-made message with the code and signup link. Share it via text, email, or group chat.'
          },
          {
            q: 'Can the league creator change settings after creation?',
            a: 'Currently, league settings (points system, match scope) are fixed at creation. Admins can delete leagues if needed. We may add editable settings in a future update.'
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
        title: 'Prize Leagues & Future Plans',
        icon: '💰',
        questions: [
          {
            q: 'Do I need crypto or money to play?',
            a: 'No. GoalOracle is completely free to play. All leagues are free — there are no entry fees, no real-money prizes, and no gambling of any kind. You compete for fun and bragging rights only.'
          },
          {
            q: 'Are prize leagues available?',
            a: 'Not yet. We are exploring ways to let leagues offer prizes in the future, but this feature is not currently available. We will announce if and when prize leagues become available.'
          },
          {
            q: 'What about the wallets I see on the platform?',
            a: 'When you sign up, an embedded wallet is automatically created for you via Privy. This is part of our authentication system and may be used for future features. Currently, no funds are collected, held, or managed by GoalOracle.'
          },
          {
            q: 'Is GoalOracle a gambling site?',
            a: 'No. GoalOracle is a free prediction game for entertainment purposes only. There is no real-money wagering, no entry fees, and no cash prizes. It is similar to a fantasy sports bracket challenge among friends.'
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
            a: 'You can sign up with email, Google, Twitter/X, or directly with a crypto wallet (MetaMask, Coinbase Wallet, etc.). All methods create the same account.'
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
            <p className="faq-page-sub">Everything you need to know about GoalOracle — how it works, how scores are verified, and more.</p>
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
        const updated = await updateUserProfile(uData.id, { displayName: trimmed, usernameSet: true });
        if (updated) setUData(updated);
        setShowUsernamePrompt(false);
        notify(`Welcome, ${trimmed}!`);
      } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };

    const handleUseEmail = async () => {
      if (!emailPrefix) return;
      setBusy(true); setErr('');
      try {
        const updated = await updateUserProfile(uData.id, { displayName: emailPrefix, usernameSet: true });
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

  // GoalOracle Logo — Hexagonal GO monogram
  const GoalOracleLogo = ({ size = 24 }) => (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="goLogo" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#00D4FF"/><stop offset="50%" stopColor="#FF2D87"/><stop offset="100%" stopColor="#FFB800"/>
        </linearGradient>
      </defs>
      <path d="M50 4 L88 22 Q96 26 96 35 L96 65 Q96 74 88 78 L50 96 L12 78 Q4 74 4 65 L4 35 Q4 26 12 22 Z" fill="none" stroke="url(#goLogo)" strokeWidth="5"/>
      <path d="M30 38 Q30 28 42 28 L52 28" stroke="url(#goLogo)" strokeWidth="7" strokeLinecap="round" fill="none"/>
      <path d="M30 38 L30 58 Q30 68 42 68 L52 68 L52 55 L44 55" stroke="url(#goLogo)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      <circle cx="66" cy="48" r="18" stroke="url(#goLogo)" strokeWidth="7" fill="none"/>
    </svg>
  );

  const Nav = () => (
    <nav className="navbar"><div className="nav-container">
      <div className="nav-brand" onClick={() => nav('landing')}><GoalOracleLogo size={26} /><span className="gt">GoalOracle</span></div>
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
          <div className="team-picker-wrap" ref={teamPickerRef} onClick={e => e.stopPropagation()}>
            <button type="button" className={`team-picker-btn${homeTeam ? ' has-team' : ''}`} onClick={() => setTeamPickerOpen(!teamPickerOpen)} title={homeTeam || 'Pick your team'}>
              {homeTeam && TEAM_COLORS[homeTeam] ? <><span className="team-picker-flag">{TEAM_COLORS[homeTeam].flag}</span><span className="team-picker-name">{homeTeam}</span></> : <><Globe size={14} /><span className="team-picker-name">My Team</span></>}
              <ChevronDown size={12} />
            </button>
            {teamPickerOpen && (
              <div className="team-picker-dropdown">
                <div className="team-picker-header">Pick your home team</div>
                {homeTeam && <button className="team-picker-item team-picker-clear" onClick={() => { setHomeTeam(''); setTeamPickerOpen(false); }}><X size={14} /><span>Clear selection</span></button>}
                {Object.entries(TEAM_COLORS).map(([name, t]) => (
                  <button key={name} className={`team-picker-item${homeTeam === name ? ' active' : ''}`} onClick={() => { setHomeTeam(name); setTeamPickerOpen(false); }}>
                    <span className="team-picker-flag">{t.flag}</span>
                    <span>{name}</span>
                    <span className="team-picker-swatch" style={{ background: t.primary, boxShadow: `3px 0 0 ${t.secondary}` }} />
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="theme-switcher" onClick={e => e.stopPropagation()}>
            {[
              { id: 'light', icon: <Sun size={13} />, label: 'Light' },
              { id: 'dark', icon: <Moon size={13} />, label: 'Dark' },
              { id: 'fifa2026', icon: <Sparkles size={13} />, label: '2026' },
            ].map(t => (
              <button key={t.id} type="button" className={`theme-opt ${theme === t.id ? 'active' : ''}`}
                title={theme === t.id ? `Current: ${t.label}` : `Switch to ${t.label}`}
                onClick={() => { setTheme(t.id); document.documentElement.setAttribute('data-theme', t.id); if (t.id === 'fifa2026') { setConfetti(true); setTimeout(() => setConfetti(false), 3000); } }}>
                {t.icon}<span className="theme-label">{t.label}</span>
              </button>
            ))}
          </div>
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
      {/* Alpha Testing Banner — persistent across all views */}
      <div className="alpha-banner">
        <div className="alpha-banner-content">
          <div className="alpha-badge"><Sparkles size={14} /> ALPHA</div>
          <span>GoalOracle is in alpha testing — we'd love your feedback to make it better.</span>
          <button className="alpha-link" onClick={() => nav('feedback')}><MessageSquare size={14} /> Share Feedback</button>
        </div>
      </div>
      {view === 'landing' && <Landing />}
      {view === 'dashboard' && <Dash />}
      {view === 'browse' && <Browse key="browse" />}
      {view === 'create' && <Create key="create" />}
      {view === 'detail' && <Detail key={selLeague?.id || 'detail'} />}
      {view === 'faq' && <FAQ />}
      {view === 'feedback' && <Feedback key="feedback" />}
      {view === 'admin' && (role === 'superadmin' || role === 'admin') && <AdminDashboard userData={uData} platformStats={stats} matchResults={results} allLeagues={allLeagues} notify={notify} />}
      {fundModal && <AddFundsModal />}
      {showUsernamePrompt && authenticated && uData && <UsernamePrompt />}
    </div>
  );
};

export default GoalOracle;