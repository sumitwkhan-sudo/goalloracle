import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { Trophy, Users, Coins, Shield, ChevronRight, Menu, X, Globe, Zap, TrendingUp, Award, Lock, Unlock, LogOut, Plus, Search, CheckCircle, Clock, Target, Save, Eye, EyeOff, RefreshCw, UserPlus, AlertTriangle, Copy, Wallet, ChevronDown, User, ArrowRightLeft, ExternalLink, Loader, Moon, Sun, Trash2, Share2, Key, Home, HelpCircle, Sparkles, MessageSquare, Send, LayoutGrid, List, Flame, Star, Gift, MapPin, Calendar } from 'lucide-react';
import WORLD_CUP_MATCHES from './data/matches';
import { getCode } from './utils/countryCodes';
import { getPedigree, FINALS, CHAMPIONS } from './utils/pedigree';
import { calculatePoints, calculateTotalPoints, sortLeaderboard, getMatchStatus, calculateStreak, getStreakBadge } from './utils/points';
import { calculateXP, getLevelInfo } from './utils/xp';
import TEAM_COLORS from './data/teamColors';
import { resolveBracket, calcGroupStandings, rankThirdPlaced, groupPredictionsComplete } from './utils/bracket';
import { createOrUpdateUser, updateUserProfile, getUserRole, createLeague, joinLeague, deleteLeague, leaveLeague, subscribeToUserLeagues, subscribeToAllLeagues, saveBatchPredictions, subscribeToUserPredictions, subscribeToMatchResults, subscribeToPlatformStats, getLeagueLeaderboard, getSimpleLeaderboard, setAuthToken, signIntoFirebase, resetFirebaseAuth, submitFeedback } from './utils/db';
import { validateUsername } from './utils/profanity';
import { getWalletBalances, formatBalance } from './utils/wallet';
import AdminDashboard from './components/AdminDashboard';
import SimplePrediction from './pages/SimplePrediction';
import CreateLeagueForm from './components/CreateLeagueForm';
import './styles.css';

const SimpleDetail = React.memo(function SimpleDetail({ league, userData, onBack, onSetUsername }) {
  const [sTab, setSTab] = useState('leaderboard');
  const [simLb, setSimLb] = useState([]);
  const [simLbl, setSimLbl] = useState(false);

  useEffect(() => {
    if (sTab !== 'leaderboard' || !league?.id) return;
    let cancelled = false;
    (async () => {
      setSimLbl(true);
      try {
        const data = await getSimpleLeaderboard(league.id);
        if (!cancelled) setSimLb(data.leaderboard || []);
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setSimLbl(false); }
    })();
    return () => { cancelled = true; };
  }, [sTab, league?.id]);

  const needsUsername = userData && !userData.usernameSet;

  return (
    <div className="league-detail">
      <div className="page-header-compact">
        <div className="phc-left">
          <button className="btn-back-sm" onClick={onBack}>&larr;</button>
          <h1 className="phc-title">{league?.name}</h1>
          <div className="phc-meta">
            <span><Users size={14} /> {(league?.memberCount || league?.members?.length || 0).toLocaleString()} members</span>
            <span className="lv2-mode-pill simple">SIMPLE</span>
          </div>
        </div>
      </div>

      {needsUsername && (
        <div className="username-nudge" onClick={onSetUsername}>
          <AlertTriangle size={14} />
          <span>You haven&apos;t set a username yet.</span>
          <button className="btn btn-primary btn-xs">Set Username</button>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${sTab === 'leaderboard' ? 'active' : ''}`} onClick={() => setSTab('leaderboard')}><TrendingUp size={16} /> Leaderboard</button>
        <button className={`tab ${sTab === 'predictions' ? 'active' : ''}`} onClick={() => setSTab('predictions')}><Target size={16} /> Predictions</button>
      </div>

      {sTab === 'leaderboard' && (
        <div className="leaderboard">
          <div className="leaderboard-header"><h3>Rankings</h3></div>
          {simLbl ? (
            <div className="loading-state"><RefreshCw size={24} className="spin" /> Loading...</div>
          ) : simLb.length === 0 ? (
            <div className="empty-state"><p>No members yet.</p></div>
          ) : (
            <div className="leaderboard-list">
              {simLb.map((e, i) => (
                <div key={e.userId} className={`leaderboard-item ${e.userId === userData?.id ? 'is-you' : ''}`}>
                  <div className="rank">
                    {i === 0 && <Trophy size={20} className="gold" />}
                    {i === 1 && <Trophy size={20} className="silver" />}
                    {i === 2 && <Trophy size={20} className="bronze" />}
                    {i > 2 && <span>#{i + 1}</span>}
                  </div>
                  <div className="player-info">
                    <div className="player-avatar">{e.displayName?.[0]?.toUpperCase() || '?'}</div>
                    <div>
                      <div className="player-name">
                        {e.displayName}
                        {e.userId === userData?.id && <span className="you-badge">You</span>}
                      </div>
                      <div className="player-sub">
                        {e.isComplete ? (
                          <><CheckCircle size={11} style={{color:'var(--success)', verticalAlign:'middle'}} /> Complete</>
                        ) : e.hasSubmitted ? (
                          <><RefreshCw size={11} style={{color:'var(--amber)', verticalAlign:'middle'}} /> In progress</>
                        ) : (
                          <><Clock size={11} style={{color:'var(--text-sec)', verticalAlign:'middle'}} /> Not started</>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="player-points">
                    <span className="points">{e.isComplete ? 'Ready' : e.hasSubmitted ? 'Partial' : '—'}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sTab === 'predictions' && (
        <SimplePrediction
          key={`simple-${league?.id}`}
          userId={userData?.id}
          league={league}
          onExit={onBack}
          embedded
        />
      )}
    </div>
  );
});

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
  const { wallets } = useWallets();
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
  const [shareCard, setShareCard] = useState(null); // { matchId, home, away, homeFlag, awayFlag, homeScore, awayScore, result }
  // Lifted from Detail — survives Firestore re-renders
  const [detailTab, setDetailTab] = useState('predictions');
  const [detailWeek, setDetailWeek] = useState('week1');
  const [detailStage, setDetailStage] = useState('all');
  const [detailPredView, setDetailPredView] = useState(() => {
    // Default to 'rows' on mobile, 'rows' on desktop (user can toggle)
    // But on desktop, rows will render in 2 columns via CSS
    return 'rows';
  });
  // Lifted from Create — survives parent re-renders from Firestore subscriptions
  const [createName, setCreateName] = useState('');
  const [createVis, setCreateVis] = useState('public');
  const [createPasscode, setCreatePasscode] = useState('');
  const [createSuccess, setCreateSuccess] = useState(null); // null or { name, id }
  const [createTp, setCreateTp] = useState('free');
  const [createFe, setCreateFe] = useState('');
  const [createDi, setCreateDi] = useState({ first: 50, second: 30, third: 20 });
  const [createPs, setCreatePs] = useState({ correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 });
  const [createScope, setCreateScope] = useState('all');
  const [createGroups, setCreateGroups] = useState([]);
  const [createRounds, setCreateRounds] = useState([]);
  const [createBusy, setCreateBusy] = useState(false);
  const [createErr, setCreateErr] = useState('');
  const [createMode, setCreateMode] = useState('simple');

  // Lifted from Dashboard/Leagues — survives Firestore re-renders
  const [dashLeagueFilter, setDashLeagueFilter] = useState('all');
  const [expandedLeagues, setExpandedLeagues] = useState({});
  const [leagueRanks, setLeagueRanks] = useState({});

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
          {p.result && (locked || res?.completed) && <button type="button" className="pred-share-btn-sm" title="Share prediction" onClick={() => setShareCard({ matchId: match.id, home: match.home, away: match.away, homeFlag: match.homeFlag, awayFlag: match.awayFlag, homeScore: p.score?.home, awayScore: p.score?.away, result: p.result })}><Share2 size={12} /></button>}
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
            {p.result && <button type="button" className="pred-share-btn" title="Share this prediction" onClick={() => setShareCard({ matchId: match.id, home: match.home, away: match.away, homeFlag: match.homeFlag, awayFlag: match.awayFlag, homeScore: p.score?.home, awayScore: p.score?.away, result: p.result })}><Share2 size={14} /></button>}
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
    const [lbTab, setLbTab] = useState('global');

    // Find next upcoming match (any match, including knockout)
    const now = Date.now();
    const nextMatch = useMemo(() => {
      const sorted = [...WORLD_CUP_MATCHES].sort((a, b) => {
        const toMs = m => {
          const [hh, mm] = (m.time || '15:00').split(':').map(Number);
          const d = new Date(`${m.date}T00:00:00Z`);
          d.setUTCHours(hh + 4, mm, 0, 0);
          return d.getTime();
        };
        return toMs(a) - toMs(b);
      });
      return sorted.find(m => {
        const [hh, mm] = (m.time || '15:00').split(':').map(Number);
        const d = new Date(`${m.date}T00:00:00Z`);
        d.setUTCHours(hh + 4, mm, 0, 0);
        return d.getTime() > now;
      }) || null;
    }, []);

    // Countdown timer — locks 5 min before kickoff
    const [countdown, setCountdown] = useState('');
    const [isLocked, setIsLocked] = useState(false);
    useEffect(() => {
      if (!nextMatch) return;
      const [hh, mm] = (nextMatch.time || '15:00').split(':').map(Number);
      const kick = new Date(`${nextMatch.date}T00:00:00Z`);
      kick.setUTCHours(hh + 4, mm, 0, 0);
      const lockMs = kick.getTime() - 5 * 60 * 1000;
      const tick = () => {
        const diff = lockMs - Date.now();
        if (diff <= 0) { setCountdown('LOCKED'); setIsLocked(true); return; }
        setIsLocked(false);
        const d = Math.floor(diff / 86400000);
        const h = Math.floor((diff % 86400000) / 3600000);
        const mi = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        setCountdown(d > 0 ? `${d}d ${h}h ${mi}m ${s}s` : `${h}h ${mi}m ${s}s`);
      };
      tick();
      const iv = setInterval(tick, 1000);
      return () => clearInterval(iv);
    }, [nextMatch]);

    // Navigate to predictions for this match
    const goToPredict = () => {
      if (!authenticated) { login(); return; }
      // Route to the global league detail view on the predictions tab
      const globalLeague = leagues.find(l => l.id === 'global') || { id: 'global', name: 'Global League', type: 'free', pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 } };
      nav('detail', globalLeague);
    };

    // Mock leaderboard data
    const mockLb = [
      { rank: 1, name: 'LeoM', pts: 78, level: 12 },
      { rank: 2, name: 'SamNYC', pts: 74, level: 9 },
      { rank: 3, name: 'MariaFutbol', pts: 71, level: 10 },
      { rank: 4, name: 'You', pts: 68, level: 7, isYou: true },
    ];

    // Community predictions mock
    const communityMatch = WORLD_CUP_MATCHES.find(m => m.id === 'gs17');

    return (
      <div className="landing-page">
        <div className="grad-mesh"></div>

        {/* ─── 1. HERO + NEXT MATCH ─── */}
        <section className={`hero hero-split ${heroAnimated ? 'hero-no-anim' : ''}`}>
          <div className="hero-stadium-bg"></div>
          <div className="hero-stadium-overlay"></div>
          <div className="hero-split-inner" ref={el => { if (el && !heroAnimated) heroAnimated = true; }}>
            <div className="hero-left">
              <h1 className="hero-title">Predict the<br/><span className="highlight">World Cup.</span></h1>
              <p className="hero-subtitle">Compete with friends. Climb the leaderboard. Win rewards. Become the Oracle.</p>
              <div className="hero-cta">
                <button className="btn btn-primary btn-lg" onClick={() => authenticated ? nav('dashboard') : login()}>Start Predicting &mdash; It&rsquo;s Free</button>
                <button className="btn btn-secondary btn-lg" onClick={() => authenticated ? nav('create') : login()}>Create a League</button>
              </div>
              <div className="hero-social-proof">
                <div className="hero-avatars">
                  {['🇧🇷','🇩🇪','🇦🇷','🇫🇷'].map((f,i) => <span key={i} className="hero-avatar">{f}</span>)}
                </div>
                <span className="hero-proof-text"><AnimatedCounter value={stats.totalPlayers ? stats.totalPlayers * 12 : 13402} /> predictions made today &middot; 82 countries &middot; Free to play</span>
              </div>
            </div>
            <div className="hero-right">
              {nextMatch ? (
                <div className={`next-match-card ${isLocked ? 'nmc-locked' : ''}`}>
                  <div className="nmc-header">
                    <span className="nmc-label">{nextMatch.stage || 'Next Match'}</span>
                    <span className={`nmc-countdown ${isLocked ? 'nmc-countdown-locked' : ''}`}>
                      {isLocked ? <><Lock size={12} /> Predictions locked</> : <><Clock size={12} /> Predictions close in: <strong>{countdown}</strong></>}
                    </span>
                  </div>
                  <div className="nmc-teams">
                    <div className="nmc-team"><span className="nmc-flag">{nextMatch.homeFlag}</span><span className="nmc-name">{nextMatch.home}</span></div>
                    <span className="nmc-vs">VS</span>
                    <div className="nmc-team"><span className="nmc-flag">{nextMatch.awayFlag}</span><span className="nmc-name">{nextMatch.away}</span></div>
                  </div>
                  <div className="nmc-meta">
                    <span><Calendar size={12} /> {new Date(nextMatch.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</span>
                    <span>&middot;</span>
                    <span>{nextMatch.time} ET</span>
                    <span>&middot;</span>
                    <span><MapPin size={12} /> {nextMatch.venue}</span>
                  </div>
                  <button className={`btn ${isLocked ? 'btn-secondary' : 'btn-primary'} nmc-btn`} onClick={goToPredict} disabled={isLocked}>
                    {isLocked ? <><Lock size={16} /> Predictions Locked</> : 'Make Your Prediction'}
                  </button>
                </div>
              ) : (
                <div className="next-match-card nmc-empty">
                  <div className="nmc-empty-inner">
                    <Clock size={32} />
                    <p>No matches available for prediction right now.</p>
                    <button className="btn btn-secondary" onClick={() => authenticated ? nav('dashboard') : login()}>View Leaderboard</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* ─── 2. HOW IT WORKS ─── */}
        <section className="hiw-section"><div className="container">
          <div className="hiw-eyebrow reveal">How It Works</div>
          <h2 className="hiw-title reveal">3 Simple Steps to Glory</h2>
          <div className="hiw-grid">
            <div className="hiw-card reveal-float stagger-1 glow-hover">
              <div className="hiw-num">1</div>
              <h3>Predict</h3>
              <p>Predict match scores, results, and your confidence before kickoff.</p>
              <div className="hiw-preview">
                <div className="hiw-mini-match">
                  <span>{WORLD_CUP_MATCHES[18]?.homeFlag} {WORLD_CUP_MATCHES[18]?.home}</span>
                  <span className="hiw-score">2 - 1</span>
                  <span>{WORLD_CUP_MATCHES[18]?.awayFlag} {WORLD_CUP_MATCHES[18]?.away}</span>
                </div>
                <div className="hiw-confidence"><div className="hiw-conf-bar"><div className="hiw-conf-fill" style={{width:'86%'}}></div></div><span>Confidence: 86%</span></div>
              </div>
            </div>
            <div className="hiw-card reveal-float stagger-2 glow-hover">
              <div className="hiw-num">2</div>
              <h3>Compete</h3>
              <p>Join or create leagues with friends, fans, or your community.</p>
              <div className="hiw-preview">
                <div className="hiw-league-row">
                  <div className="hiw-league-avatars">{['🇲🇽','🇺🇸','🇧🇷'].map((f,i) => <span key={i}>{f}</span>)}<span className="hiw-plus-badge"><Plus size={10} /></span></div>
                  <div><strong>Your League</strong><br/><span className="hiw-dim">12 members</span></div>
                </div>
              </div>
            </div>
            <div className="hiw-card reveal-float stagger-3 glow-hover">
              <div className="hiw-num">3</div>
              <h3>Climb</h3>
              <p>Earn XP, build streaks, climb leaderboards, win rewards.</p>
              <div className="hiw-preview">
                <div className="hiw-level-row">
                  <div className="hiw-level-badge"><Star size={14} /> Level 7 &mdash; Analyst</div>
                  <div className="hiw-xp-bar"><div className="hiw-xp-fill" style={{width:'62.5%'}}></div></div>
                  <span className="hiw-dim">1,250 / 2,000 XP</span>
                </div>
              </div>
            </div>
          </div>
        </div></section>

        {/* ─── 3. LEADERBOARD + STREAKS ─── */}
        <section className="lb-streaks-section"><div className="container">
          <div className="lb-streaks-grid">
            {/* Leaderboard */}
            <div className="lb-panel reveal">
              <div className="lb-panel-head">
                <h3>Global Leaderboard</h3>
                <a className="lb-view-all" onClick={() => authenticated ? nav('dashboard') : login()}>View Full Leaderboard <ChevronRight size={14} /></a>
              </div>
              <div className="lb-tabs">
                {['global','country','friends'].map(t => (
                  <button key={t} className={`lb-tab ${lbTab === t ? 'active' : ''}`} onClick={() => setLbTab(t)}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>
                ))}
              </div>
              <div className="lb-rows">
                {mockLb.map(p => (
                  <div key={p.rank} className={`lb-row ${p.isYou ? 'lb-row-you' : ''}`}>
                    <span className={`lb-rank lb-rank-${p.rank}`}>{p.rank <= 3 ? ['','🥇','🥈','🥉'][p.rank] : p.rank}</span>
                    <span className="lb-name">{p.name}</span>
                    <span className="lb-pts">{p.pts} pts</span>
                    <span className="lb-level"><Star size={12} /> Level {p.level}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Streaks & Badges */}
            <div className="streaks-panel reveal">
              <div className="lb-panel-head">
                <h3>Streaks &amp; Badges</h3>
                <a className="lb-view-all" onClick={() => authenticated ? nav('dashboard') : login()}>View All <ChevronRight size={14} /></a>
              </div>
              <div className="streak-current">
                <div className="streak-label">Current Streak</div>
                <div className="streak-num">6</div>
                <div className="streak-sub">correct predictions</div>
                <div className="streak-flames">{[1,2,3,4,5,6].map(i => <Flame key={i} size={20} className="streak-flame" />)}</div>
              </div>
              <div className="badges-grid">
                <div className="badge-item"><div className="badge-icon badge-bronze"><Award size={20} /></div><div className="badge-count">3</div><div className="badge-label">Bronze</div></div>
                <div className="badge-item"><div className="badge-icon badge-silver"><Award size={20} /></div><div className="badge-count">5</div><div className="badge-label">Silver</div></div>
                <div className="badge-item"><div className="badge-icon badge-gold"><Award size={20} /></div><div className="badge-count">10</div><div className="badge-label">Golden Oracle</div></div>
              </div>
            </div>
          </div>
        </div></section>

        {/* ─── 4. SHARE + COMMUNITY ─── */}
        <section className="share-section"><div className="container">
          <div className="share-grid">
            {/* Share card preview */}
            <div className="share-left reveal">
              <div className="share-card-preview">
                <div className="scp-brand"><span className="gt">GoalOracle</span></div>
                <div className="scp-label">My Prediction</div>
                <div className="scp-match">
                  <span>{WORLD_CUP_MATCHES[18]?.homeFlag} {WORLD_CUP_MATCHES[18]?.home}</span>
                  <strong>2 - 1</strong>
                  <span>{WORLD_CUP_MATCHES[18]?.awayFlag} {WORLD_CUP_MATCHES[18]?.away}</span>
                </div>
                <div className="scp-meta"><CheckCircle size={12} /> Confidence: 72% &middot; <Flame size={12} /> Streak: 4 Correct</div>
                <div className="scp-invite">Can you beat me? goaloracle.io</div>
                <div className="scp-tags">#GoalOracle #WorldCup</div>
              </div>
              <div className="share-text">
                <h3>Share Your Predictions</h3>
                <p>Show off your predictions. Challenge your friends. Grow your league.</p>
                <div className="share-icons">
                  {['X','WhatsApp','Instagram','Discord'].map(s => (
                    <div key={s} className="share-icon-item"><Share2 size={18} /><span>{s}</span></div>
                  ))}
                </div>
                <button className="btn btn-primary">Share Prediction</button>
              </div>
            </div>

            {/* Community predictions */}
            <div className="community-panel reveal">
              <h3>Community Predictions</h3>
              {communityMatch && (
                <div className="comm-match">
                  <span>{communityMatch.homeFlag} {communityMatch.home}</span>
                  <span className="comm-vs">vs</span>
                  <span>{communityMatch.awayFlag} {communityMatch.away}</span>
                </div>
              )}
              <div className="comm-bars">
                <div className="comm-bar-row"><span className="comm-bar-label">{communityMatch?.home} Win</span><div className="comm-bar"><div className="comm-bar-fill comm-fill-home" style={{width:'52%'}}></div></div><span>52%</span></div>
                <div className="comm-bar-row"><span className="comm-bar-label">Draw</span><div className="comm-bar"><div className="comm-bar-fill comm-fill-draw" style={{width:'28%'}}></div></div><span>28%</span></div>
                <div className="comm-bar-row"><span className="comm-bar-label">{communityMatch?.away} Win</span><div className="comm-bar"><div className="comm-bar-fill comm-fill-away" style={{width:'20%'}}></div></div><span>20%</span></div>
              </div>
              <div className="comm-total">12,843 predictions</div>
            </div>
          </div>
        </div></section>

        {/* ─── 5. REWARDS & LEVELS ─── */}
        <section className="rewards-section"><div className="container">
          <h2 className="rewards-title reveal">Rewards &amp; Levels</h2>
          <div className="rewards-grid">
            {[
              { icon: <TrendingUp size={28} />, title: 'XP & Levels', sub: 'Climb from Fan to Legend' },
              { icon: <Gift size={28} />, title: 'Jerseys', sub: 'Win signed jerseys' },
              { icon: <Award size={28} />, title: 'Badges', sub: 'Show off your achievements' },
              { icon: <Trophy size={28} />, title: 'Tournaments', sub: 'Invite-only competitions' },
            ].map((r, i) => (
              <div key={i} className={`reward-card reveal-float stagger-${i+1} glow-hover`}>
                <div className="reward-icon">{r.icon}</div>
                <h4>{r.title}</h4>
                <p>{r.sub}</p>
              </div>
            ))}
          </div>
        </div></section>

        {/* ─── 6. FINAL CTA ─── */}
        <section className="final-cta-section">
          <div className="container">
            <div className="final-cta reveal">
              <h2>Ready to Become the Oracle?</h2>
              <p>Join thousands of football fans already predicting, competing, and winning.</p>
              <div className="final-cta-btns">
                <button className="btn btn-primary btn-lg" onClick={() => authenticated ? nav('dashboard') : login()}>Start Predicting &mdash; It&rsquo;s Free</button>
                <button className="btn btn-secondary btn-lg" onClick={() => authenticated ? nav('create') : login()}>Create a League</button>
              </div>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <div className="footer-content">
            <div className="footer-top">
              <div className="footer-proof"><Globe size={14} /> Trusted by football fans in 82 countries &middot; <AnimatedCounter value={stats.totalPlayers ? stats.totalPlayers * 30 : 32000} suffix="+" /> predictions this week</div>
              <div className="footer-socials">
                {['X','Instagram','Discord'].map(s => <span key={s} className="footer-social-icon"><Share2 size={14} /></span>)}
              </div>
            </div>
            <div className="footer-links">
              <a onClick={() => authenticated ? nav('dashboard') : login()}>Predict</a>
              <a onClick={() => authenticated ? nav('browse') : login()}>Leagues</a>
              <a onClick={() => nav('faq')}>FAQ</a>
              <a onClick={() => nav('feedback')}>Feedback</a>
            </div>
            <div className="footer-copy">A free prediction game for the FIFA World Cup 2026 &middot; Not affiliated with FIFA &middot; For entertainment purposes only</div>
            <div className="footer-disclaimer" style={{fontSize: '11px', opacity: 0.5, maxWidth: '600px', margin: '8px auto 0', lineHeight: 1.4}}>
              GoalOracle is a free entertainment platform. No real money is wagered, collected, or distributed. This is not a gambling service. &ldquo;FIFA World Cup&rdquo; and related marks are trademarks of FIFA. GoalOracle is not endorsed by or affiliated with FIFA.
            </div>
          </div>
        </footer>
      </div>
    );
  };

  const Dash = () => {
    const ml = leagues.length > 0 ? leagues : [
      { id: 'global', name: 'Global League', type: 'free', predictionMode: 'classic', memberCount: stats.totalPlayers, pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 } },
      { id: 'global-simple', name: 'Global League Simple', type: 'free', predictionMode: 'simple', memberCount: stats.totalPlayers },
    ];
    const defaultPS = { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 };
    const ps = ml[0]?.pointsSystem || defaultPS;

    // Computed stats
    const { streak, bestStreak } = useMemo(() => calculateStreak(preds, results), [preds, results]);
    const streakBadge = getStreakBadge(streak);
    const totalStats = useMemo(() => calculateTotalPoints(preds, results, ps), [preds, results, ps]);
    const xpTotal = useMemo(() => calculateXP(preds, results, leagues.length), [preds, results, leagues.length]);
    const lvl = useMemo(() => getLevelInfo(xpTotal), [xpTotal]);
    const totalCompleted = useMemo(() => Object.entries(preds).filter(([id]) => results[id]?.completed).length, [preds, results]);
    const accuracy = totalCompleted > 0 ? Math.round((totalStats.correctResults / totalCompleted) * 100) : 0;

    // Matches needing prediction
    const needsPrediction = useMemo(() =>
      WORLD_CUP_MATCHES.filter(m => getMatchStatus(m.date, m.time) === 'open' && !results[m.id]?.completed && !preds[m.id]?.result).slice(0, 4),
    [preds, results]);

    // Recent completed results
    const recentResults = useMemo(() =>
      WORLD_CUP_MATCHES.filter(m => results[m.id]?.completed).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
    [results]);

    // Streak dots — last 10 completed matches in chronological order
    const streakDots = useMemo(() => {
      const completed = [];
      for (const [matchId, pred] of Object.entries(preds)) {
        const res = results[matchId];
        if (!res?.completed || !pred?.result) continue;
        let actual;
        if (res.homeScore > res.awayScore) actual = 'home';
        else if (res.homeScore < res.awayScore) actual = 'away';
        else actual = 'draw';
        completed.push({ matchId, correct: pred.result === actual });
      }
      const toNum = id => { if (id.startsWith('gs')) return parseInt(id.slice(2)); if (id.startsWith('r32-')) return 100 + parseInt(id.slice(4)); if (id.startsWith('r16-')) return 200 + parseInt(id.slice(4)); if (id.startsWith('qf-')) return 300 + parseInt(id.slice(3)); if (id.startsWith('sf-')) return 400 + parseInt(id.slice(3)); if (id === '3rd') return 500; if (id === 'final') return 501; return 999; };
      completed.sort((a, b) => toNum(a.matchId) - toNum(b.matchId));
      return completed.slice(-10);
    }, [preds, results]);

    // Fetch league ranks on mount
    useEffect(() => {
      if (!uData?.id || ml.length === 0) return;
      let cancelled = false;
      (async () => {
        for (const league of ml.slice(0, 6)) {
          if (leagueRanks[league.id] || cancelled) continue;
          try {
            if (league.predictionMode === 'simple') {
              const data = await getSimpleLeaderboard(league.id);
              const lb = data.leaderboard || [];
              const myIdx = lb.findIndex(e => e.userId === uData.id);
              if (!cancelled) setLeagueRanks(prev => ({ ...prev, [league.id]: { rank: myIdx >= 0 ? myIdx + 1 : lb.length + 1, total: lb.length } }));
            } else {
              const { leaderboard: bu, userNames } = await getLeagueLeaderboard(league.id);
              const entries = Object.entries(bu).map(([uid, pr]) => ({ userId: uid, ...calculateTotalPoints(pr, results, league.pointsSystem || defaultPS) }));
              const sorted = sortLeaderboard(entries);
              const myIdx = sorted.findIndex(e => e.userId === uData.id);
              if (!cancelled) setLeagueRanks(prev => ({ ...prev, [league.id]: { rank: myIdx + 1, total: sorted.length, leaderPts: sorted[0]?.totalPoints || 0, myPts: sorted[myIdx]?.totalPoints || 0 } }));
            }
          } catch {}
        }
      })();
      return () => { cancelled = true; };
    }, [uData?.id, ml.length, results]);

    // Greeting
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    // Countdown helper
    const Countdown = ({ match }) => {
      const [ct, setCt] = useState('');
      useEffect(() => {
        const [hh, mm] = (match.time || '15:00').split(':').map(Number);
        const kick = new Date(`${match.date}T00:00:00Z`);
        kick.setUTCHours(hh + 4, mm, 0, 0);
        const lockMs = kick.getTime() - 5 * 60 * 1000;
        const tick = () => {
          const diff = lockMs - Date.now();
          if (diff <= 0) { setCt('LOCKED'); return; }
          const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), mi = Math.floor((diff % 3600000) / 60000);
          setCt(d > 0 ? `${d}d ${h}h` : `${h}h ${mi}m`);
        };
        tick();
        const iv = setInterval(tick, 60000);
        return () => clearInterval(iv);
      }, [match.date, match.time]);
      return <span className="dv2-countdown">{ct === 'LOCKED' ? <><Lock size={10} /> Locked</> : <><Clock size={10} /> Closes in {ct}</>}</span>;
    };

    return (
      <div className="dashboard-v2">
        {/* Greeting */}
        <div className="dv2-header">
          <div>
            <h1 className="dv2-greeting">{greeting}, <span className="dv2-name">{uData?.displayName || 'Player'}</span></h1>
            <p className="dv2-sub">{needsPrediction.length > 0 ? <>{needsPrediction.length} prediction{needsPrediction.length > 1 ? 's' : ''} due before kickoff</> : <>You&rsquo;re all caught up</>} &middot; <span className="dv2-level"><Star size={12} /> Level {lvl.level} &mdash; {lvl.title}</span></p>
          </div>
          <div className="dv2-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => nav('browse')}><Search size={16} /> Browse</button>
            <button className="btn btn-primary btn-sm" onClick={() => nav('create')}><Plus size={16} /> Create</button>
          </div>
        </div>

        {/* 3 Stat Cards */}
        <div className="dv2-stats">
          <div className="dv2-stat-card dv2-anim-1">
            <span className="dv2-stat-label">Total Points</span>
            <span className="dv2-stat-value"><AnimatedCounter value={totalStats.totalPoints} /></span>
            <span className="dv2-stat-sub">{totalStats.correctResults} correct result{totalStats.correctResults !== 1 ? 's' : ''}</span>
          </div>
          <div className="dv2-stat-card dv2-anim-2">
            <span className="dv2-stat-label">Accuracy</span>
            <span className="dv2-stat-value"><AnimatedCounter value={accuracy} suffix="%" /></span>
            <span className="dv2-stat-sub">{totalCompleted} match{totalCompleted !== 1 ? 'es' : ''} completed</span>
          </div>
          <div className="dv2-stat-card dv2-anim-3">
            <span className="dv2-stat-label">Best Rank</span>
            <span className="dv2-stat-value">{(() => { const best = Object.values(leagueRanks).reduce((b, r) => (!b || r.rank < b.rank) ? r : b, null); return best ? `#${best.rank}` : '—'; })()}</span>
            <span className="dv2-stat-sub">{(() => { const bestL = ml.find(l => leagueRanks[l.id] && Object.values(leagueRanks).every(r => leagueRanks[l.id].rank <= r.rank)); return bestL?.name || 'Loading...'; })()}</span>
          </div>
        </div>

        {/* Needs Prediction */}
        {needsPrediction.length > 0 ? (
          <div className="dv2-section">
            <h3 className="dv2-section-title">Needs Your Prediction</h3>
            <div className="dv2-action-cards">
              {needsPrediction.map(m => (
                <div key={m.id} className="dv2-action-card" onClick={() => nav('detail', ml[0])}>
                  <div className="dv2-ac-teams">
                    <span className="dv2-ac-flag">{m.homeFlag}</span>
                    <span className="dv2-ac-name">{m.home}</span>
                    <span className="dv2-ac-vs">vs</span>
                    <span className="dv2-ac-name">{m.away}</span>
                    <span className="dv2-ac-flag">{m.awayFlag}</span>
                  </div>
                  <Countdown match={m} />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="dv2-section"><div className="dv2-caught-up"><CheckCircle size={18} /> All caught up for this round</div></div>
        )}

        {/* Recent Results */}
        {recentResults.length > 0 && (
          <div className="dv2-section">
            <h3 className="dv2-section-title">Recent Results</h3>
            <div className="dv2-results">
              {recentResults.map(m => {
                const res = results[m.id];
                const pred = preds[m.id];
                const pts = pred ? calculatePoints(pred, res, ps) : 0;
                return (
                  <div key={m.id} className="dv2-result-card">
                    <div className="dv2-rc-top">
                      <span className="dv2-rc-date">{new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      <span className={`dv2-rc-pts ${pts > 0 ? 'dv2-pts-pos' : 'dv2-pts-zero'}`}>+{pts} pts</span>
                    </div>
                    <div className="dv2-rc-score">
                      <span>{m.homeFlag} {m.home}</span>
                      <strong>{res.homeScore} – {res.awayScore}</strong>
                      <span>{m.away} {m.awayFlag}</span>
                    </div>
                    {pred?.result && <div className="dv2-rc-pred">Your pick: {pred.result === 'home' ? m.home : pred.result === 'away' ? m.away : 'Draw'} {pts > 0 ? <span className="dv2-correct">correct</span> : <span className="dv2-wrong">wrong</span>}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Streak Dots */}
        <div className="dv2-section">
          <h3 className="dv2-section-title"><Flame size={16} /> Streak: {streak} {streakBadge && <span className={`streak-badge streak-badge-${streakBadge.tier}`}>{streakBadge.emoji} {streakBadge.name}</span>}</h3>
          <div className="dv2-streak-dots">
            {[...Array(10)].map((_, i) => {
              const dot = streakDots[i];
              return <div key={i} className={`dv2-dot ${dot ? (dot.correct ? 'dv2-dot-win' : 'dv2-dot-loss') : 'dv2-dot-pending'}`} />;
            })}
          </div>
          <span className="dv2-streak-caption">Last {streakDots.length} prediction{streakDots.length !== 1 ? 's' : ''} &middot; Best: {bestStreak}</span>
        </div>

        {/* League Snapshot */}
        <div className="dv2-section">
          <div className="dv2-section-head"><h3 className="dv2-section-title">Your Leagues</h3><a className="dv2-view-all" onClick={() => nav('leagues')}>View all <ChevronRight size={14} /></a></div>
          <div className="dv2-league-snap">
            {ml.slice(0, 3).map(l => {
              const rk = leagueRanks[l.id];
              return (
                <div key={l.id} className="dv2-league-row" onClick={() => nav('detail', l)}>
                  <div className="dv2-lr-info">
                    <span className="dv2-lr-name">{l.name}</span>
                    <span className="dv2-lr-members"><Users size={12} /> {(l.memberCount || l.members?.length || 0).toLocaleString()}</span>
                  </div>
                  <div className="dv2-lr-rank">{rk ? `#${rk.rank}` : '—'}</div>
                </div>
              );
            })}
          </div>
        </div>

        {/* XP Progress */}
        <div className="dv2-xp-strip">
          <Star size={14} /> Level {lvl.level} &mdash; {lvl.title}
          <div className="dv2-xp-bar"><div className="dv2-xp-fill" style={{width:`${lvl.progress*100}%`}} /></div>
          <span className="dv2-xp-num">{lvl.totalXP.toLocaleString()} / {lvl.isMaxLevel ? 'MAX' : lvl.nextLevelXP.toLocaleString()} XP</span>
        </div>
      </div>
    );
  };

  const LeaguesList = () => {
    const allMine = leagues.length > 0 ? leagues : [
      { id: 'global', name: 'Global League', type: 'free', predictionMode: 'classic', isGlobal: true, memberCount: stats.totalPlayers, pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 } },
      { id: 'global-simple', name: 'Global League Simple', type: 'free', predictionMode: 'simple', isGlobal: true, memberCount: stats.totalPlayers },
    ];
    const isGlobalLeague = (l) => l.id === 'global' || l.id === 'global-simple' || l.isGlobal === true;
    const globalLeagues = allMine.filter(isGlobalLeague);
    const privateLeagues = allMine.filter(l => !isGlobalLeague(l));
    const defaultPS = { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 };
    const [lbCache, setLbCache] = useState({});

    const filtered = useMemo(() => {
      if (dashLeagueFilter === 'all') return privateLeagues;
      return privateLeagues.filter(l => {
        const hasCompleted = Object.keys(results).length > 0;
        if (dashLeagueFilter === 'ended') return hasCompleted;
        return !hasCompleted || dashLeagueFilter === 'active';
      });
    }, [privateLeagues, dashLeagueFilter, results]);

    const toggleExpand = (id) => setExpandedLeagues(prev => ({ ...prev, [id]: !prev[id] }));

    const fetchLb = async (league) => {
      if (lbCache[league.id]) return;
      try {
        const { leaderboard: bu, userNames } = await getLeagueLeaderboard(league.id);
        const entries = Object.entries(bu).map(([uid, pr]) => ({ userId: uid, displayName: userNames[uid] || uid.slice(0, 8), ...calculateTotalPoints(pr, results, league.pointsSystem || defaultPS) }));
        const sorted = sortLeaderboard(entries);
        setLbCache(prev => ({ ...prev, [league.id]: sorted }));
      } catch {}
    };

    return (
      <div className="leagues-v2">
        <div className="lv2-header">
          <div><button className="btn-back" onClick={() => nav('dashboard')}>&larr; Back</button><h1 className="lv2-title">Your Leagues</h1><span className="lv2-count">{allMine.length} league{allMine.length !== 1 ? 's' : ''}</span></div>
          <div className="dv2-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => nav('browse')}><Search size={16} /> Browse</button>
            <button className="btn btn-primary btn-sm" onClick={() => nav('create')}><Plus size={16} /> Create</button>
          </div>
        </div>

        {globalLeagues.length > 0 && (
          <>
            <h2 className="lv2-section-title">Global</h2>
            <div className="lv2-list lv2-list-global">
              {globalLeagues.map(gl => {
                const gRk = leagueRanks[gl.id];
                return (
                  <div key={gl.id} className="lv2-row lv2-row-global">
                    <div className="lv2-row-top" onClick={() => nav('detail', gl)}>
                      <div className="lv2-row-info">
                        <h3 className="lv2-row-name">
                          {gl.name} <span className="lv2-global-pill">GLOBAL</span>
                          {gl.predictionMode === 'simple' && <span className="lv2-mode-pill simple">SIMPLE</span>}
                          {gl.predictionMode !== 'simple' && <span className="lv2-mode-pill classic">CLASSIC</span>}
                        </h3>
                        <span className="lv2-row-meta"><Users size={12} /> {(gl.memberCount || 0).toLocaleString()} members</span>
                      </div>
                      <div className="lv2-row-rank-area">
                        {gRk ? <><span className="lv2-rank-num">#{gRk.rank.toLocaleString()}</span><span className="lv2-rank-label">of {(gl.memberCount || 0).toLocaleString()}</span></> : <span className="lv2-rank-num">&mdash;</span>}
                      </div>
                      <ChevronRight size={16} className="lv2-chevron" />
                    </div>
                  </div>
                );
              })}
            </div>
            {privateLeagues.length > 0 && <h2 className="lv2-section-title">Your Leagues</h2>}
          </>
        )}

        <div className="lv2-filters">
          {['all', 'active', 'ended'].map(f => (
            <button key={f} className={`lv2-pill ${dashLeagueFilter === f ? 'lv2-pill-active' : ''}`} onClick={() => setDashLeagueFilter(f)}>{f.charAt(0).toUpperCase() + f.slice(1)}</button>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="lv2-empty"><Trophy size={32} /><p>No leagues match this filter</p><button className="btn btn-primary btn-sm" onClick={() => setDashLeagueFilter('all')}>Show all</button></div>
        ) : (
          <div className="lv2-list">
            {filtered.map(l => {
              const rk = leagueRanks[l.id];
              const expanded = expandedLeagues[l.id];
              const lb = lbCache[l.id];
              if (expanded && !lb) fetchLb(l);

              // Mini leaderboard: 5 rows centered on user
              let miniRows = [];
              if (lb && uData?.id) {
                const myIdx = lb.findIndex(e => e.userId === uData.id);
                let start = Math.max(0, myIdx - 2);
                if (start + 5 > lb.length) start = Math.max(0, lb.length - 5);
                miniRows = lb.slice(start, start + 5).map((e, i) => ({ ...e, pos: start + i + 1 }));
              }

              const leaderPts = lb?.[0]?.totalPoints || rk?.leaderPts || 0;
              const myPts = rk?.myPts || 0;
              const gapPct = leaderPts > 0 ? Math.min((myPts / leaderPts) * 100, 100) : 0;

              return (
                <div key={l.id} className="lv2-row">
                  <div className="lv2-row-top" onClick={() => toggleExpand(l.id)}>
                    <div className="lv2-row-info">
                      <h3 className="lv2-row-name">{l.name}</h3>
                      <span className="lv2-row-meta"><Users size={12} /> {(l.memberCount || l.members?.length || 0).toLocaleString()} members</span>
                    </div>
                    <div className="lv2-row-rank-area">
                      {rk ? <><span className="lv2-rank-num">#{rk.rank}</span><span className="lv2-rank-label">your rank</span></> : <span className="lv2-rank-num">&mdash;</span>}
                    </div>
                    <ChevronDown size={16} className={`lv2-chevron ${expanded ? 'lv2-chevron-open' : ''}`} />
                  </div>

                  <div className={`lv2-row-expand ${expanded ? 'lv2-row-expanded' : ''}`}>
                    {expanded && (
                      <>
                        {lb ? (
                          <div className="lv2-mini-lb">
                            {miniRows.map(e => (
                              <div key={e.userId} className={`lv2-mini-row ${e.userId === uData?.id ? 'lv2-mini-you' : ''}`}>
                                <span className="lv2-mini-pos">{e.pos}</span>
                                <span className="lv2-mini-name">{e.displayName} {e.userId === uData?.id && <span className="lv2-you-pill">YOU</span>}</span>
                                <span className="lv2-mini-pts">{e.totalPoints}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="lv2-mini-loading"><RefreshCw size={16} className="spin" /> Loading leaderboard...</div>
                        )}
                        <div className="lv2-gap-bar-wrap">
                          <span className="lv2-gap-label">Gap to 1st</span>
                          <div className="lv2-gap-track"><div className="lv2-gap-fill" style={{width: `${gapPct}%`}} /></div>
                          <span className="lv2-gap-text">{myPts >= leaderPts ? 'Leading' : `${leaderPts - myPts} pts back`}</span>
                        </div>
                        <button className="btn btn-primary btn-sm lv2-enter-btn" onClick={() => nav('detail', l)}>Enter League <ChevronRight size={14} /></button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
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


  const Detail = () => {
    const tab = detailTab, setTab = setDetailTab;
    const sf = detailWeek, setSf = setDetailWeek;
    const stageFilter = detailStage, setStageFilter = setDetailStage;
    const [lb, setLb] = useState([]);
    const [lbl, setLbl] = useState(false);
    const [lbSort, setLbSort] = useState('points'); // 'points' | 'xp' | 'streak'
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

    useEffect(() => { if (tab !== 'leaderboard' || !selLeague?.id) return; (async () => { setLbl(true); try { const { leaderboard: bu, userNames } = await getLeagueLeaderboard(selLeague.id); const p = selLeague.pointsSystem || {}; const e = Object.entries(bu).map(([uid, pr]) => { const stats = calculateTotalPoints(pr, results, p); const xp = calculateXP(pr, results, 1); return { userId: uid, displayName: userNames[uid] || uid.slice(0, 8), ...stats, xp, levelInfo: getLevelInfo(xp) }; }); setLb(sortLeaderboard(e)); } catch(e){console.error(e);} finally{setLbl(false);} })(); }, [tab, selLeague?.id, results]);

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
            {viewPredicted > 0 && (
              <button type="button" className="btn btn-share-preds" onClick={() => {
                const predEntries = Object.entries(preds).filter(([, p]) => p.result);
                if (predEntries.length === 0) return;
                const [mId, p] = predEntries[predEntries.length - 1];
                const match = WORLD_CUP_MATCHES.find(m => m.id === mId);
                if (match) setShareCard({ matchId: mId, home: match.home, away: match.away, homeFlag: match.homeFlag, awayFlag: match.awayFlag, homeScore: p.score?.home, awayScore: p.score?.away, result: p.result });
              }}>
                <Share2 size={13} /> Share
              </button>
            )}
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

        {tab === 'leaderboard' && <div className="leaderboard">
          {uData && !uData.usernameSet && (
            <div className="username-nudge" onClick={() => setShowUsernamePrompt(true)}>
              <AlertTriangle size={14} />
              <span>You haven't set a username yet.</span>
              <button className="btn btn-primary btn-xs">Set Username</button>
            </div>
          )}
          <div className="leaderboard-header">
            <h3>Rankings</h3>
            <div className="lb-sort-tabs">
              <button className={`lb-sort-tab ${lbSort === 'points' ? 'active' : ''}`} onClick={() => setLbSort('points')}>Points</button>
              <button className={`lb-sort-tab ${lbSort === 'xp' ? 'active' : ''}`} onClick={() => setLbSort('xp')}><Star size={12} /> XP</button>
              <button className={`lb-sort-tab ${lbSort === 'streak' ? 'active' : ''}`} onClick={() => setLbSort('streak')}><Flame size={12} /> Streak</button>
            </div>
          </div>
          {lbl ? <div className="loading-state"><RefreshCw size={24} className="spin" /> Loading...</div>
            : lb.length === 0 ? <div className="empty-state"><p>No predictions yet.</p></div>
            : <div className="leaderboard-list">{[...lb].sort((a, b) => lbSort === 'xp' ? (b.xp || 0) - (a.xp || 0) : lbSort === 'streak' ? (b.streak || 0) - (a.streak || 0) : 0).map((e, i) => (
              <div key={e.userId} className={`leaderboard-item ${e.userId === uData?.id ? 'is-you' : ''}`}>
                <div className="rank">{i === 0 && <Trophy size={20} className="gold" />}{i === 1 && <Trophy size={20} className="silver" />}{i === 2 && <Trophy size={20} className="bronze" />}{i > 2 && <span>#{i+1}</span>}</div>
                <div className="player-info"><div className="player-avatar">{e.displayName[0]?.toUpperCase()}</div><div><div className="player-name">{e.displayName} {e.userId === uData?.id && <span className="you-badge">You</span>}</div><div className="player-sub">{e.correctResults} correct • {e.exactScores} exact{e.streak > 0 && <> • <Flame size={11} style={{verticalAlign:'middle',color:'var(--amber)'}} /> {e.streak}</>}</div></div></div>
                <div className="player-points">
                  {lbSort === 'xp' ? <span className="points">{(e.xp || 0).toLocaleString()} XP</span> : lbSort === 'streak' ? <span className="points"><Flame size={14} style={{color:'var(--amber)'}} /> {e.streak || 0}</span> : <span className="points">{e.totalPoints} pts</span>}
                  <span className="lb-level-tag"><Star size={10} /> Lv.{e.levelInfo?.level || 1}</span>
                  {e.streak >= 3 && lbSort !== 'streak' && <span className={`lb-streak-badge lb-streak-${getStreakBadge(e.streak)?.tier || ''}`}><Flame size={12} /> {e.streak}</span>}
                </div>
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
  const [sendModal, setSendModal] = useState(false);
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

  const SendModal = () => {
    const [step, setStep] = useState('form'); // 'form' | 'confirm' | 'sending' | 'success' | 'error'
    const [token, setToken] = useState('USDC');
    const [recipient, setRecipient] = useState('');
    const [amount, setAmount] = useState('');
    const [txHash, setTxHash] = useState(null);
    const [err, setErr] = useState('');
    const [acknowledged, setAcknowledged] = useState(false);

    // Pick the embedded wallet (Privy-created); falls back to first connected wallet
    const embeddedWallet = wallets.find(w => w.walletClientType === 'privy') || wallets[0];
    const fromAddr = embeddedWallet?.address || walletAddress;

    const usdcBalance = parseFloat(walletBalances.USDC || '0');
    const polBalance = parseFloat(walletBalances.POL || '0');
    const currentBalance = token === 'USDC' ? usdcBalance : polBalance;

    const isValidAddress = /^0x[a-fA-F0-9]{40}$/.test(recipient);
    const isSelfAddress = fromAddr && recipient.toLowerCase() === fromAddr.toLowerCase();
    const amountNum = parseFloat(amount || '0');
    const hasPolForGas = polBalance > 0.001;
    const canContinue = isValidAddress && !isSelfAddress && amountNum > 0 && amountNum <= currentBalance;

    const setMax = () => {
      if (token === 'POL') {
        // Leave ~0.01 POL as gas buffer
        const remaining = Math.max(0, polBalance - 0.01);
        setAmount(remaining > 0 ? remaining.toFixed(4) : '0');
      } else {
        setAmount(String(currentBalance));
      }
    };

    const handleContinue = () => {
      setErr('');
      if (!isValidAddress) { setErr('Invalid wallet address'); return; }
      if (isSelfAddress) { setErr('You can\u2019t send to your own wallet'); return; }
      if (amountNum <= 0) { setErr('Amount must be greater than 0'); return; }
      if (amountNum > currentBalance) { setErr(`Insufficient ${token} balance`); return; }
      if (!hasPolForGas) { setErr('You need some POL to pay for gas fees'); return; }
      setAcknowledged(false);
      setStep('confirm');
    };

    const handleSend = async () => {
      if (!embeddedWallet) { setErr('No wallet available'); return; }
      setErr('');
      setStep('sending');
      try {
        if (typeof embeddedWallet.switchChain === 'function') {
          try { await embeddedWallet.switchChain(137); } catch {}
        }
        const provider = await embeddedWallet.getEthereumProvider();

        let txParams;
        if (token === 'USDC') {
          const USDC_ADDR = '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359';
          const decimals = 6;
          // Convert amount string to smallest units preserving up to `decimals` fractional digits
          const parts = amount.split('.');
          const whole = parts[0] || '0';
          const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
          const amountUnits = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
          // transfer(address,uint256) — selector 0xa9059cbb
          const paddedAddr = recipient.slice(2).toLowerCase().padStart(64, '0');
          const paddedAmt = amountUnits.toString(16).padStart(64, '0');
          const data = '0xa9059cbb' + paddedAddr + paddedAmt;
          txParams = { from: fromAddr, to: USDC_ADDR, data, value: '0x0' };
        } else {
          const decimals = 18;
          const parts = amount.split('.');
          const whole = parts[0] || '0';
          const frac = (parts[1] || '').padEnd(decimals, '0').slice(0, decimals);
          const amountWei = BigInt(whole) * BigInt(10 ** decimals) + BigInt(frac);
          txParams = { from: fromAddr, to: recipient, value: '0x' + amountWei.toString(16) };
        }

        const hash = await provider.request({
          method: 'eth_sendTransaction',
          params: [txParams],
        });

        setTxHash(hash);
        setStep('success');
        setTimeout(() => refreshBalances(), 8000);
      } catch (e) {
        console.error('[send] Error:', e);
        const msg = e?.message || '';
        if (msg.toLowerCase().includes('user rejected') || msg.toLowerCase().includes('user denied')) {
          setErr('Transaction cancelled');
        } else {
          setErr(msg || 'Transaction failed');
        }
        setStep('error');
      }
    };

    const closeModal = () => { if (step !== 'sending') setSendModal(false); };

    return (
      <div className="modal-overlay" onClick={closeModal}>
        <div className="fund-modal" onClick={e => e.stopPropagation()}>
          <div className="fund-modal-header">
            <h3><Send size={20} /> Send Crypto</h3>
            <button className="modal-close" onClick={closeModal} disabled={step === 'sending'}><X size={20} /></button>
          </div>

          {step === 'form' && (<>
            <div className="fund-balance-bar">
              <div className="fund-bal-item"><span className="fund-bal-label">USDC</span><span className="fund-bal-val">{formatBalance(walletBalances.USDC)}</span></div>
              <div className="fund-bal-item fund-bal-dim"><span className="fund-bal-label">POL</span><span className="fund-bal-val">{formatBalance(walletBalances.POL)}</span></div>
              <button className="balance-refresh" onClick={refreshBalances} title="Refresh"><RefreshCw size={12} className={balLoading ? 'spin' : ''} /></button>
            </div>

            <div className="fund-section">
              <label>Token</label>
              <div className="fund-tabs">
                <button className={`fund-tab ${token === 'USDC' ? 'active' : ''}`} onClick={() => { setToken('USDC'); setAmount(''); }}>USDC</button>
                <button className={`fund-tab ${token === 'POL' ? 'active' : ''}`} onClick={() => { setToken('POL'); setAmount(''); }}>POL</button>
              </div>
            </div>

            <div className="fund-section">
              <label>Recipient wallet address</label>
              <input
                type="text"
                className="fund-input send-addr-input"
                placeholder="0x..."
                value={recipient}
                onChange={e => setRecipient(e.target.value.trim())}
                spellCheck={false}
                autoComplete="off"
              />
              {recipient && !isValidAddress && (
                <div className="send-field-err"><AlertTriangle size={12} /> Not a valid Ethereum address</div>
              )}
              {isSelfAddress && (
                <div className="send-field-err"><AlertTriangle size={12} /> This is your own wallet</div>
              )}
            </div>

            <div className="fund-section">
              <label>Amount</label>
              <div className="send-amount-wrap">
                <input
                  type="number"
                  className="fund-input"
                  placeholder={`0.00 ${token}`}
                  value={amount}
                  onChange={e => setAmount(e.target.value)}
                  min="0"
                  step="any"
                />
                <button type="button" className="send-max-btn" onClick={setMax}>MAX</button>
              </div>
              <div className="send-balance-info">
                Available: {formatBalance(currentBalance)} {token}
                {token === 'POL' && <span className="send-gas-hint"> &middot; MAX leaves 0.01 POL for gas</span>}
              </div>
            </div>

            <div className="fund-note-box fund-note-danger">
              <div className="fund-note-item">
                <AlertTriangle size={14} />
                <span><strong>Polygon network only.</strong> Confirm the recipient's wallet supports <strong>{token} on Polygon</strong>. Sending to an incompatible address or wrong network will result in <strong>permanent loss of funds</strong>.</span>
              </div>
              <div className="fund-note-item">
                <AlertTriangle size={14} />
                <span>Double-check the recipient address — crypto transactions are <strong>irreversible</strong>.</span>
              </div>
              {!hasPolForGas && (
                <div className="fund-note-item">
                  <AlertTriangle size={14} />
                  <span>You have no POL for gas. Add POL to your wallet before sending.</span>
                </div>
              )}
            </div>

            {err && <div className="fund-error"><AlertTriangle size={14} /> {err}</div>}

            <button className="btn btn-primary fund-btn" onClick={handleContinue} disabled={!canContinue || !hasPolForGas}>
              Review Transaction <ChevronRight size={16} />
            </button>
          </>)}

          {step === 'confirm' && (<>
            <p className="fund-desc">Review carefully. This cannot be reversed.</p>

            <div className="send-review">
              <div className="send-review-row"><span>Network</span><strong>Polygon</strong></div>
              <div className="send-review-row"><span>Token</span><strong>{token}</strong></div>
              <div className="send-review-row send-review-amount"><span>Amount</span><strong>{amount} {token}</strong></div>
              <div className="send-review-row"><span>From</span><code className="send-review-addr">{fromAddr ? `${fromAddr.slice(0,10)}...${fromAddr.slice(-8)}` : '—'}</code></div>
              <div className="send-review-row send-review-to"><span>To</span><code className="send-review-addr send-review-addr-full">{recipient}</code></div>
            </div>

            <div className="fund-note-box fund-note-danger">
              <div className="fund-note-item">
                <AlertTriangle size={14} />
                <span><strong>Warning:</strong> If the recipient's wallet does not support <strong>{token} on Polygon</strong>, your funds will be <strong>permanently lost</strong>. Verify both the address and network compatibility before continuing.</span>
              </div>
            </div>

            <label className="send-ack">
              <input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)} />
              <span>I have verified the recipient address and confirmed it supports {token} on Polygon. I understand this transaction cannot be undone.</span>
            </label>

            {err && <div className="fund-error"><AlertTriangle size={14} /> {err}</div>}

            <div className="send-confirm-actions">
              <button className="btn btn-secondary" onClick={() => setStep('form')}>
                <ChevronDown size={16} style={{transform:'rotate(90deg)'}} /> Back
              </button>
              <button className="btn btn-primary" onClick={handleSend} disabled={!acknowledged}>
                <Send size={14} /> Send {amount} {token}
              </button>
            </div>
          </>)}

          {step === 'sending' && (
            <div className="send-status-view">
              <Loader size={36} className="spin" />
              <h4>Sending transaction...</h4>
              <p>Confirm in your wallet if prompted. This may take up to a minute.</p>
            </div>
          )}

          {step === 'success' && (
            <div className="send-status-view">
              <CheckCircle size={44} style={{color: 'var(--success, #00c853)'}} />
              <h4>Transaction sent!</h4>
              <p>Your transaction has been broadcast to Polygon. It usually confirms in a few seconds.</p>
              {txHash && (
                <a href={`https://polygonscan.com/tx/${txHash}`} target="_blank" rel="noopener noreferrer" className="tx-link">
                  View on Polygonscan <ExternalLink size={14} />
                </a>
              )}
              <button className="btn btn-primary" onClick={() => setSendModal(false)} style={{marginTop: '1rem'}}>Done</button>
            </div>
          )}

          {step === 'error' && (
            <div className="send-status-view">
              <AlertTriangle size={44} style={{color: 'var(--danger, #ff3b5c)'}} />
              <h4>Transaction failed</h4>
              <p>{err || 'Something went wrong.'}</p>
              <div className="send-confirm-actions">
                <button className="btn btn-secondary" onClick={() => { setErr(''); setStep('form'); }}>Try again</button>
                <button className="btn btn-primary" onClick={() => setSendModal(false)}>Close</button>
              </div>
            </div>
          )}
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
              {(() => { const xp = calculateXP(preds, results, leagues.length); const li = getLevelInfo(xp); return <div className="dropdown-xp"><Star size={13} style={{color:'var(--primary)'}} /> Level {li.level} — {li.title} <span className="dropdown-xp-num">({li.totalXP.toLocaleString()} XP)</span></div>; })()}
              {(() => { const { streak: s } = calculateStreak(preds, results); const b = getStreakBadge(s); return s > 0 ? <div className="dropdown-streak"><Flame size={13} style={{color:'var(--amber)'}} /> Streak: {s}{b && <span className={`streak-badge streak-badge-${b.tier}`}>{b.emoji} {b.name}</span>}</div> : null; })()}
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
                <div className="dropdown-item-title">Receive / Add Funds</div>
                <div className="dropdown-item-sub">Bridge any token to USDC on Polygon</div>
              </div>
            </button>
            <button type="button" className="dropdown-item" onClick={e => { e.stopPropagation(); setOpen(false); setSendModal(true); }} disabled={!walletAddr}>
              <Send size={16} />
              <div>
                <div className="dropdown-item-title">Send</div>
                <div className="dropdown-item-sub">Transfer USDC or POL to another wallet</div>
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
          <p style={{ color: 'var(--text-sec)', fontSize: '0.88rem', marginTop: '0.25rem' }}>Your input directly shapes what we build next.</p>
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

  // ─── Share Card Modal ───
  const ShareCardModal = () => {
    if (!shareCard) return null;
    const { home, away, homeFlag, awayFlag, homeScore, awayScore, result } = shareCard;
    const { streak } = calculateStreak(preds, results);
    const streakBadge = getStreakBadge(streak);
    const displayName = uData?.displayName || 'Player';
    const hasScore = homeScore !== '' && awayScore !== '' && homeScore != null && awayScore != null;
    const resultLabel = result === 'home' ? `${home} Win` : result === 'away' ? `${away} Win` : 'Draw';

    const shareText = `${homeFlag} ${home} ${hasScore ? `${homeScore}–${awayScore}` : resultLabel} ${awayFlag} ${away}${streak > 0 ? ` | 🔥 Streak: ${streak}` : ''}\n\nCan you beat me? goaloracle.io\n#GoalOracle #WorldCup`;

    const shareTwitter = () => { window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`, '_blank'); };
    const shareWhatsApp = () => { window.open(`https://wa.me/?text=${encodeURIComponent(shareText)}`, '_blank'); };
    const copyLink = () => { navigator.clipboard.writeText(shareText).then(() => notify('Copied to clipboard!')); };

    return (
      <div className="modal-overlay" onClick={() => setShareCard(null)}>
        <div className="share-modal" onClick={e => e.stopPropagation()}>
          <button className="modal-close" onClick={() => setShareCard(null)}><X size={20} /></button>
          {/* Preview card */}
          <div className="share-preview-card" id="share-card">
            <div className="spc-brand"><span className="gt">GoalOracle</span> <span>⚽</span></div>
            <div className="spc-label">My Prediction</div>
            <div className="spc-match-row">
              <div className="spc-team"><span className="spc-flag">{homeFlag}</span><span>{home}</span></div>
              {hasScore ? (
                <div className="spc-score">{homeScore} – {awayScore}</div>
              ) : (
                <div className="spc-result-tag">{resultLabel}</div>
              )}
              <div className="spc-team"><span>{away}</span><span className="spc-flag">{awayFlag}</span></div>
            </div>
            {streak > 0 && (
              <div className="spc-streak">
                <Flame size={14} /> Streak: {streak} Correct
                {streakBadge && <span className={`streak-badge streak-badge-${streakBadge.tier}`}>{streakBadge.emoji} {streakBadge.name}</span>}
              </div>
            )}
            <div className="spc-footer">
              <span>Can you beat me?</span>
              <strong>goaloracle.io</strong>
            </div>
            <div className="spc-tags">#GoalOracle #WorldCup</div>
          </div>
          {/* Share buttons */}
          <div className="share-buttons">
            <button className="share-btn share-btn-x" onClick={shareTwitter}><ExternalLink size={16} /> Share on X</button>
            <button className="share-btn share-btn-wa" onClick={shareWhatsApp}><Send size={16} /> WhatsApp</button>
            <button className="share-btn share-btn-copy" onClick={copyLink}><Copy size={16} /> Copy</button>
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
          <a className="nav-link" onClick={() => nav('leagues')}><Users size={14} /><span>My Leagues</span></a>
          <a className="nav-link" onClick={() => nav('browse')}><Search size={14} /><span>Browse</span></a>
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

      {view === 'landing' && <Landing />}
      {view === 'dashboard' && <Dash />}
      {view === 'leagues' && <LeaguesList />}
      {view === 'browse' && <Browse key="browse" />}
      {view === 'create' && (
        <CreateLeagueForm
          createName={createName} setCreateName={setCreateName}
          createTp={createTp} setCreateTp={setCreateTp}
          createVis={createVis} setCreateVis={setCreateVis}
          createPasscode={createPasscode} setCreatePasscode={setCreatePasscode}
          createFe={createFe} setCreateFe={setCreateFe}
          createDi={createDi} setCreateDi={setCreateDi}
          createPs={createPs} setCreatePs={setCreatePs}
          createScope={createScope} setCreateScope={setCreateScope}
          createGroups={createGroups} setCreateGroups={setCreateGroups}
          createRounds={createRounds} setCreateRounds={setCreateRounds}
          createBusy={createBusy} setCreateBusy={setCreateBusy}
          createErr={createErr} setCreateErr={setCreateErr}
          createMode={createMode} setCreateMode={setCreateMode}
          createSuccess={createSuccess} setCreateSuccess={setCreateSuccess}
          uData={uData}
          leagues={leagues}
          nav={nav}
          notify={notify}
          createLeague={createLeague}
        />
      )}
      {view === 'detail' && selLeague?.predictionMode === 'simple' && (
        <SimpleDetail
          key={`simple-detail-${selLeague.id}`}
          league={selLeague}
          userData={uData}
          onBack={() => nav('leagues')}
          onSetUsername={() => setShowUsernamePrompt(true)}
        />
      )}
      {view === 'detail' && selLeague?.predictionMode !== 'simple' && <Detail key={selLeague?.id || 'detail'} />}
      {view === 'simplePredict' && (
        <SimplePrediction
          key={`simple-${selLeague?.id || 'solo'}`}
          userId={uData?.id}
          league={selLeague}
          onExit={() => nav('leagues')}
        />
      )}
      {view === 'faq' && <FAQ />}
      {view === 'feedback' && <Feedback key="feedback" />}
      {view === 'admin' && (role === 'superadmin' || role === 'admin') && <AdminDashboard userData={uData} platformStats={stats} matchResults={results} allLeagues={allLeagues} notify={notify} />}
      {fundModal && <AddFundsModal />}
      {sendModal && <SendModal />}
      {showUsernamePrompt && authenticated && uData && <UsernamePrompt />}
      <ShareCardModal />
    </div>
  );
};

export default GoalOracle;