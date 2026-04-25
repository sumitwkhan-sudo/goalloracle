import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { usePrivy, useWallets } from '@privy-io/react-auth';
import { track } from './utils/track';
import { Trophy, Users, Coins, Shield, ChevronRight, Menu, X, Globe, Zap, TrendingUp, Award, Lock, Unlock, LogOut, Plus, Search, CheckCircle, Clock, Target, Save, Eye, EyeOff, RefreshCw, UserPlus, AlertTriangle, Copy, Wallet, ChevronDown, User, ArrowRightLeft, ExternalLink, Loader, Moon, Sun, Trash2, Share2, Key, Home, HelpCircle, Sparkles, MessageSquare, Send, LayoutGrid, List, Flame, Star, MapPin, Calendar, RotateCcw } from 'lucide-react';
import WORLD_CUP_MATCHES from './data/matches';
import { getCode } from './utils/countryCodes';
import { getPedigree } from './utils/pedigree';
import { calculatePoints, calculateTotalPoints, sortLeaderboard, getMatchStatus, calculateStreak, getStreakBadge } from './utils/points';
import { computeRankDeltas } from './utils/rankChange';
import { calculateXP, getLevelInfo } from './utils/xp';
import TEAM_COLORS from './data/teamColors';
import { resolveBracket, calcGroupStandings, rankThirdPlaced, groupPredictionsComplete } from './utils/bracket';
import { createOrUpdateUser, updateUserProfile, getUserRole, createLeague, joinLeague, deleteLeague, leaveLeague, subscribeToUserLeagues, fetchAllLeagues, saveBatchPredictions, subscribeToUserPredictions, subscribeToMatchResults, fetchPlatformStats, getLeagueLeaderboard, getSimpleLeaderboard, copyPredictions, copySimplePrediction, resetClassicPredictions, setAuthToken, signIntoFirebase, resetFirebaseAuth, submitFeedback, captureReferralFromUrl } from './utils/db';
import { validateUsername } from './utils/profanity';
import { getWalletBalances, formatBalance } from './utils/wallet';
import AdminDashboard from './components/AdminDashboard';
import SimplePrediction from './pages/SimplePrediction';
import BracketShareModal from './components/BracketShareModal';
import CreateLeagueForm from './components/CreateLeagueForm';
import LiveStandingsDrawer, { LiveStandingsToggle } from './components/LiveStandingsDrawer';
import PublicBracket from './components/PublicBracket';
import './styles.css';

// Per-view <Helmet> tags. Authenticated views are noindex; public views get
// tailored titles and canonicals that reinforce the static meta in index.html.
const VIEW_META = {
  landing: {
    title: 'GoalOracle — Free World Cup 2026 Prediction Game & Bracket Maker',
    description: 'Free World Cup 2026 prediction game. Build your bracket, join leagues, predict every match. No gambling, no entry fees.',
    path: '/',
    index: true,
  },
  faq: {
    title: 'FAQ — GoalOracle',
    description: 'How GoalOracle works: predictions, leagues, scoring, result verification, and our no-gambling policy.',
    path: '/faq',
    index: true,
  },
  dashboard: { title: 'Dashboard — GoalOracle', path: '/dashboard', index: false },
  leagues: { title: 'My Leagues — GoalOracle', path: '/leagues', index: false },
  browse: { title: 'Browse Leagues — GoalOracle', path: '/browse', index: false },
  create: { title: 'Create a League — GoalOracle', path: '/create', index: false },
  detail: { title: 'League — GoalOracle', path: '/league', index: false },
  simplePredict: { title: 'Quick Picks — GoalOracle', path: '/quick-picks', index: false },
  feedback: { title: 'Feedback — GoalOracle', path: '/feedback', index: false },
  admin: { title: 'Admin — GoalOracle', path: '/admin', index: false },
};

function ViewMeta({ view }) {
  const meta = VIEW_META[view] || VIEW_META.landing;
  return (
    <Helmet>
      <title>{meta.title}</title>
      {meta.description && <meta name="description" content={meta.description} />}
      <link rel="canonical" href={`https://goaloracle.io${meta.path}`} />
      <meta name="robots" content={meta.index ? 'index,follow,max-image-preview:large' : 'noindex,nofollow'} />
    </Helmet>
  );
}

// URL <-> view mapping. Top-level views get a 1:1 path; detail/simplePredict
// append the league id. We use history.pushState (not react-router) to keep
// view state as the single source of truth and avoid refactoring ~3800 lines
// of conditional rendering. Query string is always preserved so Privy OAuth
// callback params (e.g. ?privy_oauth_code=) survive.
const PATH_TO_VIEW = {
  '/': 'landing',
  '/faq': 'faq',
  '/dashboard': 'dashboard',
  '/leagues': 'leagues',
  '/browse': 'browse',
  '/create': 'create',
  '/admin': 'admin',
  '/feedback': 'feedback',
};
const VIEW_TO_PATH = Object.fromEntries(Object.entries(PATH_TO_VIEW).map(([p, v]) => [v, p]));

function pathForView(view, league, opts) {
  if (view === 'publicBracket' && opts?.userId) return `/u/${encodeURIComponent(opts.userId)}/bracket`;
  if (view === 'detail' && league?.id) return `/league/${encodeURIComponent(league.id)}`;
  if (view === 'simplePredict' && league?.id) return `/quick-picks/${encodeURIComponent(league.id)}`;
  if (view === 'simplePredict') return '/quick-picks';
  return VIEW_TO_PATH[view] || '/';
}

function parseRoute() {
  if (typeof window === 'undefined') return { view: 'landing', leagueId: null };
  const p = window.location.pathname;
  // Public share page: /u/{userId}/bracket — read-only, no auth required.
  const publicMatch = p.match(/^\/u\/([^/]+)(?:\/bracket)?\/?$/);
  if (publicMatch) return { view: 'publicBracket', publicUserId: decodeURIComponent(publicMatch[1]) };
  if (p.startsWith('/league/')) return { view: 'landing', leagueId: decodeURIComponent(p.slice(8)) || null, deepLinkView: 'detail' };
  if (p.startsWith('/quick-picks/')) return { view: 'landing', leagueId: decodeURIComponent(p.slice(13)) || null, deepLinkView: 'simplePredict' };
  return { view: PATH_TO_VIEW[p] || 'landing', leagueId: null };
}

// Read-only modal that shows another user's Simple Mode picks (group rankings,
// best-third picks, and knockout bracket winners) OR their Classic Mode
// match-by-match predictions.
function PicksViewer({ target, onClose }) {
  const isClassic = target?.mode === 'classic';
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(!isClassic); // classic data comes pre-loaded via target
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!target?.userId || isClassic) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const { getSimplePrediction } = await import('./utils/db');
        const p = await getSimplePrediction(target.userId, target.leagueId || 'global-simple');
        if (!cancelled) setData(p);
      } catch (e) {
        if (!cancelled) setErr(e?.message || 'Could not load picks');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [target?.userId, isClassic]);

  const GROUPS_LOCAL = ['A','B','C','D','E','F','G','H','I','J','K','L'];
  const roundOrder = ['roundOf32','roundOf16','quarterFinals','semiFinals','thirdPlace','final'];
  const roundLabel = {
    roundOf32: 'Round of 32', roundOf16: 'Round of 16', quarterFinals: 'Quarterfinals',
    semiFinals: 'Semifinals', thirdPlace: '3rd Place', final: 'Final',
  };

  const thirdPlace = data?.knockoutPredictions?.thirdPlace?.[0]?.winnerId || null;

  // Classic mode: build a list of match predictions grouped by stage, ordered by date.
  const classicByStage = useMemo(() => {
    if (!isClassic) return null;
    const picks = target.classicPredictions || {};
    const matchesById = {};
    for (const m of WORLD_CUP_MATCHES) matchesById[m.id] = m;
    const grouped = {};
    for (const [matchId, pick] of Object.entries(picks)) {
      if (!pick?.result) continue;
      const m = matchesById[matchId];
      if (!m) continue;
      const stage = m.stage || 'Other';
      if (!grouped[stage]) grouped[stage] = [];
      grouped[stage].push({ match: m, pick });
    }
    for (const s of Object.keys(grouped)) {
      grouped[s].sort((a, b) => a.match.date.localeCompare(b.match.date) || (a.match.time || '').localeCompare(b.match.time || ''));
    }
    const stageOrder = [
      ...Array.from({ length: 12 }, (_, i) => `Group ${String.fromCharCode(65 + i)}`),
      'Round of 32', 'Round of 16', 'Quarterfinal', 'Semifinal', '3rd Place', 'Final',
    ];
    const orderedStages = stageOrder.filter(s => grouped[s]).concat(
      Object.keys(grouped).filter(s => !stageOrder.includes(s))
    );
    return { orderedStages, grouped };
  }, [isClassic, target]);

  // Classic-mode render path: skips the fetch, shows match-by-match picks.
  if (isClassic) {
    const hasPicks = classicByStage && classicByStage.orderedStages.length > 0;
    return (
      <div className="picks-viewer-backdrop" onClick={onClose}>
        <div className="picks-viewer-modal" onClick={(e) => e.stopPropagation()}>
          <div className="picks-viewer-header">
            <div className="picks-viewer-title">
              <div className="picks-viewer-avatar">{target.displayName?.[0]?.toUpperCase() || '?'}</div>
              <div>
                <h3>{target.displayName}&rsquo;s picks</h3>
                <span className="picks-viewer-sub">Classic Predictions · {target.predCount || 0} prediction{target.predCount !== 1 ? 's' : ''}</span>
              </div>
            </div>
            <button type="button" className="picks-viewer-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>

          {!hasPicks ? (
            <div className="empty-state"><p>This user hasn&rsquo;t saved any Classic Predictions yet.</p></div>
          ) : (
            <div className="picks-viewer-body">
              {classicByStage.orderedStages.map((stage) => (
                <div key={stage} className="picks-viewer-section">
                  <h4 className="picks-viewer-h">{stage}</h4>
                  <div className="pv-classic-list">
                    {classicByStage.grouped[stage].map(({ match, pick }) => {
                      const resultLabel = pick.result === 'home' ? `${match.home} win` : pick.result === 'away' ? `${match.away} win` : 'Draw';
                      const scoreHome = pick.score?.home ?? '';
                      const scoreAway = pick.score?.away ?? '';
                      const hasScore = scoreHome !== '' && scoreAway !== '';
                      return (
                        <div key={match.id} className="pv-classic-row">
                          <div className="pv-classic-teams">
                            <span className="pv-flag">{match.homeFlag}</span>
                            <span className="pv-team">{match.home}</span>
                            <span className="pv-vs">vs</span>
                            <span className="pv-flag">{match.awayFlag}</span>
                            <span className="pv-team">{match.away}</span>
                          </div>
                          <div className="pv-classic-pick">
                            {hasScore && (
                              <span className="pv-classic-score">{scoreHome}&ndash;{scoreAway}</span>
                            )}
                            <span className={`pv-classic-result pv-result-${pick.result}`}>{resultLabel}</span>
                            {pick.extraTime && <span className="pv-classic-flag">ET</span>}
                            {pick.penalties && <span className="pv-classic-flag">PK</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="picks-viewer-backdrop" onClick={onClose}>
      <div className="picks-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picks-viewer-header">
          <div className="picks-viewer-title">
            <div className="picks-viewer-avatar">{target.displayName?.[0]?.toUpperCase() || '?'}</div>
            <div>
              <h3>{target.displayName}&rsquo;s picks</h3>
              <span className="picks-viewer-sub">Quick Picks</span>
            </div>
          </div>
          <button type="button" className="picks-viewer-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        {loading ? (
          <div className="loading-state"><RefreshCw size={24} className="spin" /> Loading picks...</div>
        ) : err ? (
          <div className="empty-state"><AlertTriangle size={20} /><p>{err}</p></div>
        ) : !data ? (
          <div className="empty-state"><p>This user hasn&rsquo;t saved any predictions yet.</p></div>
        ) : (
          <div className="picks-viewer-body">
            <div className="picks-viewer-finalists">
              <div className="picks-viewer-podium">
                <div className="podium-slot podium-winner">
                  <Trophy size={20} className="gold" />
                  <span className="podium-label">Champion</span>
                  <span className="podium-team">
                    {target.winner ? <>{_teamFlags[target.winner] || ''} {target.winner}</> : <span className="podium-empty">—</span>}
                  </span>
                </div>
                <div className="podium-slot podium-runner">
                  <Award size={18} className="silver" />
                  <span className="podium-label">Runner-up</span>
                  <span className="podium-team">
                    {target.runnerUp ? <>{_teamFlags[target.runnerUp] || ''} {target.runnerUp}</> : <span className="podium-empty">—</span>}
                  </span>
                </div>
                <div className="podium-slot podium-third">
                  <Award size={16} className="bronze" />
                  <span className="podium-label">3rd place</span>
                  <span className="podium-team">
                    {thirdPlace ? <>{_teamFlags[thirdPlace] || ''} {thirdPlace}</> : <span className="podium-empty">—</span>}
                  </span>
                </div>
              </div>
            </div>

            <div className="picks-viewer-section">
              <h4 className="picks-viewer-h">Group stage rankings</h4>
              <div className="picks-viewer-groups">
                {GROUPS_LOCAL.map(g => {
                  const ranking = data.groupPredictions?.[g]?.ranking || [];
                  if (ranking.length === 0) return null;
                  return (
                    <div key={g} className="picks-viewer-group">
                      <div className="pv-group-title">Group {g}</div>
                      <ol className="pv-group-list">
                        {ranking.map((t, i) => (
                          <li key={`${g}-${t || i}`}><span className="pv-rank">{i + 1}.</span> <span className="pv-flag">{_teamFlags[t] || ''}</span> <span className="pv-team">{t || '—'}</span></li>
                        ))}
                      </ol>
                    </div>
                  );
                })}
                {GROUPS_LOCAL.every(g => !(data.groupPredictions?.[g]?.ranking?.length)) && (
                  <span className="picks-viewer-muted">No group rankings submitted yet.</span>
                )}
              </div>
            </div>

            <div className="picks-viewer-section">
              <h4 className="picks-viewer-h">Best 3rd-place picks</h4>
              {(data.bestThirdPicks || []).length > 0 ? (
                <div className="picks-viewer-chips">
                  {data.bestThirdPicks.map(g => (
                    <span key={g} className="pv-chip">Group {g}</span>
                  ))}
                </div>
              ) : <span className="picks-viewer-muted">Not selected yet.</span>}
            </div>

            <div className="picks-viewer-section">
              <h4 className="picks-viewer-h">Knockout bracket</h4>
              <div className="picks-viewer-rounds">
                {roundOrder.map(r => {
                  const picks = data.knockoutPredictions?.[r] || [];
                  if (picks.length === 0) return null;
                  return (
                    <div key={r} className="pv-round">
                      <div className="pv-round-title">{roundLabel[r]}</div>
                      <div className="pv-round-picks">
                        {picks.map(p => (
                          <span key={p.matchId} className="pv-pick">
                            <span className="pv-flag">{_teamFlags[p.winnerId] || ''}</span>
                            <span className="pv-team">{p.winnerId}</span>
                          </span>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {roundOrder.every(r => !(data.knockoutPredictions?.[r]?.length)) && (
                  <span className="picks-viewer-muted">No knockout picks yet.</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const _teamFlags = (() => {
  const flags = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) continue;
    flags[m.home] = m.homeFlag;
    flags[m.away] = m.awayFlag;
  }
  return flags;
})();

// Country flag emoji from ISO-2 code. Falls back to empty string.
function _countryFlag(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const A = 0x1F1E6;
  const base = 'A'.charCodeAt(0);
  const cc = code.toUpperCase();
  return String.fromCodePoint(A + (cc.charCodeAt(0) - base), A + (cc.charCodeAt(1) - base));
}

// Searchable country combobox. Plain <select> can't be filtered by typing
// across browsers in a useful way, and a 160-row list is painful without it.
// USA is pinned to the top regardless of search since the bulk of users are
// in the US. Pass the same countries array we lazy-load elsewhere.
function CountryPicker({ value, onChange, countries, autoFocus, disabled, id, placeholder = 'Search countries…' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = countries.find(c => c.code === value);
  const inputValue = open ? query : (selected ? `${selected.flag}  ${selected.name}` : '');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (c) => !q
      || c.name.toLowerCase().includes(q)
      || c.code.toLowerCase() === q;
    const usa = countries.find(c => c.code === 'US');
    const rest = countries.filter(c => c.code !== 'US' && matches(c));
    const out = [];
    if (usa && matches(usa)) out.push(usa);
    return out.concat(rest);
  }, [countries, query]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false); setQuery('');
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const pick = (c) => { onChange(c.code); setOpen(false); setQuery(''); inputRef.current?.blur(); };

  return (
    <div className="country-picker" ref={wrapRef}>
      <input
        ref={inputRef}
        id={id}
        type="text"
        className="country-picker-input"
        value={inputValue}
        placeholder={placeholder}
        autoFocus={autoFocus}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => { setOpen(true); setQuery(''); }}
        onChange={e => { setQuery(e.target.value); if (!open) setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); setQuery(''); inputRef.current?.blur(); }
          else if (e.key === 'Enter' && filtered.length > 0) { e.preventDefault(); pick(filtered[0]); }
        }}
        aria-autocomplete="list"
        aria-expanded={open}
        role="combobox"
      />
      {open && (
        <ul className="country-picker-list" role="listbox">
          {filtered.length === 0 ? (
            <li className="country-picker-empty">No matches</li>
          ) : filtered.map(c => (
            <li
              key={c.code}
              role="option"
              aria-selected={c.code === value}
              className={`country-picker-item ${c.code === value ? 'is-selected' : ''} ${c.code === 'US' && !query ? 'is-pinned' : ''}`}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
            >
              <span className="country-picker-flag">{c.flag}</span>
              <span className="country-picker-name">{c.name}</span>
              <span className="country-picker-code">{c.code}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Post-join prompt: offers to copy existing Global predictions into the newly
// joined league (classic only). Simple leagues share a single prediction doc
// across all simple leagues, so this just confirms that.
function JoinSuccessModal({ postJoin, onClose, onGoToLeague, notify, userId }) {
  const [copying, setCopying] = useState(false);
  const [copied, setCopied] = useState(null);
  const isSimple = postJoin.mode === 'simple';
  const sourceLeagueId = isSimple ? 'global-simple' : 'global';
  const sourceLabel = isSimple ? 'Global Quick Picks' : 'Global Classic Predictions';

  const handleCopy = async () => {
    setCopying(true);
    try {
      if (isSimple) {
        if (!userId) throw new Error('Sign in required');
        const res = await copySimplePrediction(userId, sourceLeagueId, postJoin.id);
        if (res?.copied) {
          setCopied({ count: 1 });
          notify(`Predictions submitted for ${postJoin.name}`);
        } else {
          setCopied({ count: 0 });
          notify(`No ${sourceLabel} picks to copy yet — start fresh.`);
        }
      } else {
        const res = await copyPredictions(sourceLeagueId, postJoin.id);
        setCopied({ count: res?.copied || 0, skipped: (res?.skippedLocked || 0) + (res?.skippedExisting || 0) });
        if ((res?.copied || 0) > 0) {
          notify(`Predictions submitted for ${postJoin.name} (${res.copied} pick${res.copied !== 1 ? 's' : ''} copied)`);
        } else {
          notify(`No ${sourceLabel} predictions to copy yet — start fresh.`);
        }
      }
    } catch (e) {
      notify(e.message || 'Copy failed', 'error');
    } finally {
      setCopying(false);
    }
  };

  return (
    <div className="picks-viewer-backdrop" onClick={onClose}>
      <div className="picks-viewer-modal join-success-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picks-viewer-header">
          <div className="picks-viewer-title">
            <div className="picks-viewer-avatar"><CheckCircle size={20} style={{color:'var(--success)'}} /></div>
            <div>
              <h3>Joined {postJoin.name}</h3>
              <span className="picks-viewer-sub">{isSimple ? 'Quick Picks' : 'Classic Predictions'} league</span>
            </div>
          </div>
          <button type="button" className="picks-viewer-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
        </div>

        <div className="picks-viewer-body">
          <div className="copy-flow-card inline">
            <div className="copy-flow-head">
              <Target size={18} />
              <div>
                <h3>Every league is predicted separately</h3>
                <p>Your {sourceLabel} picks don&rsquo;t auto-apply here. Copy them in one click, or start fresh.</p>
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
              <span className="copy-flow-or">or predict fresh in the league</span>
            </div>
          </div>

          <div className="join-success-actions">
            <button className="btn btn-primary btn-lg" onClick={onGoToLeague}>
              Go to {postJoin.name} <ChevronRight size={18} />
            </button>
            <button className="btn btn-ghost" onClick={onClose}>Stay here</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const RankDelta = ({ delta }) => {
  if (delta === undefined || delta === null) return <span className="rank-delta rank-delta-new" title="New this round">—</span>;
  if (delta > 0) return <span className="rank-delta rank-delta-up" title={`Up ${delta}`}>&uarr;{delta}</span>;
  if (delta < 0) return <span className="rank-delta rank-delta-down" title={`Down ${-delta}`}>&darr;{-delta}</span>;
  return <span className="rank-delta rank-delta-flat" title="No change">&mdash;</span>;
};

const SimpleDetail = React.memo(function SimpleDetail({ league, userData, onBack, onSetUsername, authenticated = true, onSignIn, onOpenClassic, initialTab = 'leaderboard', notify, myLeagues = [], lbScope = 'all', lbScopeCountry = '', setLbScope = () => {}, setLbScopeCountry = () => {}, onBrowseLeagues, onCreateLeague }) {
  const [sTab, setSTab] = useState(initialTab);
  const [lbMode, setLbMode] = useState('simple'); // 'simple' | 'classic'
  const [simLb, setSimLb] = useState([]);
  const [simLbl, setSimLbl] = useState(false);
  const [simDeltas, setSimDeltas] = useState({});
  const [classicLb, setClassicLb] = useState([]);
  const [classicLbl, setClassicLbl] = useState(false);
  const [classicDeltas, setClassicDeltas] = useState({});
  const [lbKey, setLbKey] = useState(0);
  const [viewingPicks, setViewingPicks] = useState(null); // { userId, displayName, winner, runnerUp }
  const [shareBracket, setShareBracket] = useState(null); // null | { winner, runnerUp, thirdPlace }
  const [countriesList, setCountriesList] = useState([]);

  // Lazy-load the countries list only when the filter is first used.
  useEffect(() => {
    if (lbScope !== 'country' || countriesList.length > 0) return;
    import('./utils/countries').then(mod => setCountriesList(mod.default || []));
  }, [lbScope]);

  // "Friends" = every userId who shares a non-global league with me.
  const friendIds = useMemo(() => {
    const ids = new Set();
    for (const l of myLeagues || []) {
      if (l.isGlobal || l.id === 'global' || l.id === 'global-simple') continue;
      for (const mid of (l.members || [])) ids.add(mid);
    }
    return ids;
  }, [myLeagues]);

  // Pick a sensible default country the first time the user flips to Country
  // scope: their own ISO-2 on file, else the first country that appears in
  // the leaderboard data. Keeps the filter from rendering an empty list.
  useEffect(() => {
    if (lbScope !== 'country' || lbScopeCountry) return;
    const fallback = userData?.country || simLb.find(e => e.country)?.country || classicLb.find(e => e.country)?.country || '';
    if (fallback) setLbScopeCountry(fallback);
  }, [lbScope, lbScopeCountry, userData?.country, simLb, classicLb, setLbScopeCountry]);

  const filterEntries = (entries) => {
    if (lbScope === 'country') {
      if (!lbScopeCountry) return entries;
      return entries.filter(e => (e.country || '').toUpperCase() === lbScopeCountry.toUpperCase());
    }
    if (lbScope === 'friends') {
      // Always include myself for a useful "me vs friends" comparison.
      return entries.filter(e => friendIds.has(e.userId) || e.userId === userData?.id);
    }
    return entries;
  };
  const visibleSimLb = useMemo(() => filterEntries(simLb), [simLb, lbScope, lbScopeCountry, friendIds, userData?.id]);
  const visibleClassicLb = useMemo(() => filterEntries(classicLb), [classicLb, lbScope, lbScopeCountry, friendIds, userData?.id]);

  const openShareBracket = useCallback(async () => {
    if (!userData?.id || !league?.id) return;
    try {
      const { getSimplePrediction } = await import('./utils/db');
      const { getTeamFlags } = await import('./utils/bracketUtils');
      const doc = await getSimplePrediction(userData.id, league.id);
      const flags = getTeamFlags();
      const ko = doc?.knockoutPredictions || {};
      const finalPick = (ko.final || []).find((p) => p?.matchId === 'final');
      const thirdPick = (ko.thirdPlace || []).find((p) => p?.matchId === '3rd');
      const winnerName = finalPick?.winnerId || null;
      const runnerUpName = finalPick?.loserId || null;
      const thirdName = thirdPick?.winnerId || null;
      if (!winnerName && !runnerUpName && !thirdName) {
        if (notify) notify('Finish your bracket first — no picks to share yet', 'error');
        return;
      }
      setShareBracket({
        winner: winnerName ? { name: winnerName, flag: flags[winnerName] || '🏳️' } : null,
        runnerUp: runnerUpName ? { name: runnerUpName, flag: flags[runnerUpName] || '🏳️' } : null,
        thirdPlace: thirdName ? { name: thirdName, flag: flags[thirdName] || '🏳️' } : null,
      });
    } catch (e) {
      if (notify) notify(e?.message || 'Failed to load bracket', 'error');
    }
  }, [userData?.id, league?.id, notify]);

  // Fetch Simple leaderboard
  useEffect(() => {
    if (sTab !== 'leaderboard' || lbMode !== 'simple' || !league?.id) return;
    let cancelled = false;
    (async () => {
      setSimLbl(true);
      try {
        const data = await getSimpleLeaderboard(league.id);
        if (!cancelled) {
          const entries = data.leaderboard || [];
          setSimLb(entries);
          setSimDeltas(computeRankDeltas(`simple:${league.id}`, entries));
        }
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setSimLbl(false); }
    })();
    return () => { cancelled = true; };
  }, [sTab, lbMode, league?.id, lbKey]);

  // Fetch Classic leaderboard (from the Global classic league) — only
  // relevant when this view is showing the Global Leaderboard. For
  // user-created leagues (single mode), the Classic toggle is hidden
  // and this effect is a no-op.
  useEffect(() => {
    if (sTab !== 'leaderboard' || lbMode !== 'classic') return;
    const isGlobal = league?.id === 'global' || league?.id === 'global-simple' || league?.isGlobal === true;
    if (!isGlobal) return;
    let cancelled = false;
    (async () => {
      setClassicLbl(true);
      try {
        const { leaderboard: bu, userNames, userCountries } = await getLeagueLeaderboard('global');
        if (cancelled) return;
        const entries = Object.entries(bu).map(([uid, preds]) => {
          const predCount = Object.values(preds || {}).filter(p => p?.result).length;
          return {
            userId: uid,
            displayName: userNames[uid] || uid.slice(0, 8),
            country: userCountries?.[uid] || null,
            predictions: predCount,
            rawPredictions: preds || {},
          };
        }).sort((a, b) => b.predictions - a.predictions || a.displayName.localeCompare(b.displayName));
        setClassicLb(entries);
        setClassicDeltas(computeRankDeltas('classic:global', entries));
      } catch (e) { console.error(e); }
      finally { if (!cancelled) setClassicLbl(false); }
    })();
    return () => { cancelled = true; };
  }, [sTab, lbMode, lbKey, league?.id, league?.isGlobal]);

  const needsUsername = userData && !userData.usernameSet;
  const isGlobalView = league?.id === 'global' || league?.id === 'global-simple' || league?.isGlobal === true;
  const title = isGlobalView ? 'Global Leaderboard' : (league?.name || 'Leaderboard');
  const [predMenuOpen, setPredMenuOpen] = useState(false);

  const handleComplete = useCallback(() => {
    setSTab('leaderboard');
    setLbKey(k => k + 1);
  }, []);

  const goToPredictions = useCallback((mode) => {
    setPredMenuOpen(false);
    if (!authenticated) { onSignIn && onSignIn(); return; }
    if (mode === 'simple') {
      // Keep Simple predictions inline inside this detail view.
      setSTab('predictions');
    } else if (onOpenClassic) {
      onOpenClassic();
    }
  }, [authenticated, onSignIn, onOpenClassic]);

  return (
    <div className="league-detail">
      <div className="page-header-compact">
        <div className="phc-left">
          <button className="btn-back-sm" onClick={onBack}>&larr;</button>
          <h1 className="phc-title">{title}</h1>
          <div className="phc-meta">
            <span><Users size={14} /> {(league?.memberCount || league?.members?.length || 0).toLocaleString()} members</span>
            <span className="lv2-mode-pill simple">QUICK PICKS</span>
          </div>
        </div>
        {authenticated && (
          <button
            type="button"
            className="btn btn-secondary btn-sm phc-share"
            onClick={openShareBracket}
            aria-label="Share my bracket"
          >
            <Share2 size={14} /> Share my bracket
          </button>
        )}
      </div>

      {needsUsername && (
        <div className="username-nudge" onClick={onSetUsername}>
          <AlertTriangle size={14} />
          <span>You haven&apos;t set a username yet.</span>
          <button className="btn btn-primary btn-xs">Set Username</button>
        </div>
      )}

      {sTab === 'predictions' && (
        <div className="predict-inline-header">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSTab('leaderboard')}>
            &larr; Back to leaderboard
          </button>
          <span className="predict-inline-title"><Target size={14} /> Quick Picks</span>
        </div>
      )}

      {sTab === 'leaderboard' && (
        <div className="leaderboard">
          {!isGlobalView && (
            <div className="leaderboard-header leaderboard-header-tabs-left">
              <h3>Rankings</h3>
            </div>
          )}

          {isGlobalView && (
            <div className="lb-scope-bar">
              <div className="lb-scope-tabs" role="tablist" aria-label="Leaderboard scope">
                <button type="button" role="tab" aria-selected={lbScope === 'all'} className={`lb-scope-tab ${lbScope === 'all' ? 'active' : ''}`} onClick={() => setLbScope('all')}>
                  <Globe size={12} /> Global
                </button>
                <button type="button" role="tab" aria-selected={lbScope === 'country'} className={`lb-scope-tab ${lbScope === 'country' ? 'active' : ''}`} onClick={() => setLbScope('country')}>
                  <MapPin size={12} /> Country
                </button>
                <button type="button" role="tab" aria-selected={lbScope === 'friends'} className={`lb-scope-tab ${lbScope === 'friends' ? 'active' : ''}`} onClick={() => setLbScope('friends')}>
                  <Users size={12} /> Friends
                </button>
              </div>
              {lbScope === 'country' && (
                <select
                  className="lb-scope-country-select"
                  value={lbScopeCountry}
                  onChange={(e) => setLbScopeCountry(e.target.value)}
                  aria-label="Filter leaderboard by country"
                >
                  <option value="">All countries</option>
                  {countriesList.map(c => (
                    <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
                  ))}
                </select>
              )}
              {lbScope === 'friends' && friendIds.size === 0 && (
                <span className="lb-scope-hint">Join a private league to see friends here.</span>
              )}
            </div>
          )}

          {/* Engagement CTA — sits at the top of the row list so it
              gets surfaced before the user has to scroll. Hidden in
              user-created leagues so we don't push them out. The
              copy-link button uses the user's referral URL so any
              sign-up that lands via the link is attributable. */}
          {isGlobalView && (onBrowseLeagues || onCreateLeague) && userData?.id && (() => {
            const referralUrl = `${typeof window !== 'undefined' ? window.location.origin : 'https://goaloracle.io'}/?ref=${encodeURIComponent(userData.id)}`;
            const copyReferral = async () => {
              try {
                await navigator.clipboard.writeText(referralUrl);
                if (notify) notify('Invite link copied. Share it with friends!');
              } catch {
                if (notify) notify('Could not copy link', 'error');
              }
            };
            return (
              <div className="lb-cta">
                <div className="lb-cta-text">
                  <strong>Beat your friends, not strangers.</strong>
                  <span>Spin up a private league or share your invite — every friend you bring counts.</span>
                </div>
                <div className="lb-cta-actions">
                  <button type="button" className="btn btn-ghost btn-sm" onClick={copyReferral} title={referralUrl}>
                    <Copy size={14} /> Copy invite link
                  </button>
                  {onBrowseLeagues && (
                    <button type="button" className="btn btn-secondary btn-sm" onClick={onBrowseLeagues}>
                      Find a league
                    </button>
                  )}
                  {onCreateLeague && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={onCreateLeague}>
                      Start one
                    </button>
                  )}
                </div>
              </div>
            );
          })()}

          {(simLbl ? (
            <div className="loading-state"><RefreshCw size={24} className="spin" /> Loading...</div>
          ) : visibleSimLb.length === 0 ? (
            <div className="empty-state lb-empty-state">
              {lbScope === 'friends' ? (
                <>
                  <Users size={20} aria-hidden="true" />
                  <p>No friends here yet — invite a few and watch the rankings come alive.</p>
                  {userData?.id && (
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={async () => {
                        const url = `${typeof window !== 'undefined' ? window.location.origin : 'https://goaloracle.io'}/?ref=${encodeURIComponent(userData.id)}`;
                        try { await navigator.clipboard.writeText(url); if (notify) notify('Invite link copied!'); }
                        catch { if (notify) notify('Could not copy link', 'error'); }
                      }}
                    >
                      <Copy size={14} /> Copy invite link
                    </button>
                  )}
                </>
              ) : lbScope === 'country' ? (
                <p>No players in {_countryFlag(lbScopeCountry)} {lbScopeCountry || 'this country'} yet. Be the first.</p>
              ) : (
                <p>No members yet.</p>
              )}
            </div>
          ) : (
            <div className="leaderboard-list">
              {visibleSimLb.map((e, i) => {
                const isYou = e.userId === userData?.id;
                const rowClick = () => {
                  if (isYou) setSTab('predictions');
                  else setViewingPicks({ userId: e.userId, displayName: e.displayName, winner: e.winner, runnerUp: e.runnerUp, leagueId: league?.id || 'global-simple' });
                };
                return (
                <div
                  key={e.userId}
                  className={`leaderboard-item lb-clickable ${isYou ? 'is-you' : ''}`}
                  onClick={rowClick}
                  role="button"
                  tabIndex={0}
                  title={isYou ? 'Edit your picks' : `View ${e.displayName}'s picks`}
                >
                  <div className="rank">
                    {i === 0 && <Trophy size={20} className="gold" />}
                    {i === 1 && <Trophy size={20} className="silver" />}
                    {i === 2 && <Trophy size={20} className="bronze" />}
                    {i > 2 && <span>#{i + 1}</span>}
                    <RankDelta delta={simDeltas[e.userId]} />
                  </div>
                  <div className="player-info">
                    <div className="player-avatar">{e.displayName?.[0]?.toUpperCase() || '?'}</div>
                    <div>
                      <div className="player-name">
                        {e.country && <span className="player-country-flag" title={e.country}>{_countryFlag(e.country)}</span>}
                        {e.displayName}
                        {isYou && <span className="you-badge">You</span>}
                      </div>
                      <div className="player-sub">
                        {e.isComplete ? (
                          <><CheckCircle size={11} style={{color:'var(--success)', verticalAlign:'middle'}} /> Complete</>
                        ) : e.hasSubmitted ? (
                          <>
                            <RefreshCw size={11} style={{color:'var(--amber)', verticalAlign:'middle'}} />{' '}
                            {typeof e.picksLeft === 'number' && e.picksLeft > 0
                              ? `${e.picksLeft} pick${e.picksLeft === 1 ? '' : 's'} left`
                              : 'In progress'}
                          </>
                        ) : (
                          <><Clock size={11} style={{color:'var(--text-sec)', verticalAlign:'middle'}} /> Not started</>
                        )}
                      </div>
                    </div>
                  </div>
                  {(e.winner || e.runnerUp) && (
                    <div className="player-picks">
                      {e.winner && (
                        <span className="player-pick winner-pick" title="Predicted winner">
                          <Trophy size={10} /> {_teamFlags[e.winner] || ''} {e.winner}
                        </span>
                      )}
                      {e.runnerUp && (
                        <span className="player-pick runnerup-pick" title="Predicted runner-up">
                          <Award size={10} /> {_teamFlags[e.runnerUp] || ''} {e.runnerUp}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="player-points">
                    <span className="points">{e.totalAccuracy > 0 ? `${e.totalAccuracy}%` : '—'}</span>
                    <div className="lb-row-actions">
                      {isYou ? (
                        <>
                          <button type="button" className="lb-row-btn lb-row-btn-primary" onClick={(ev) => { ev.stopPropagation(); setSTab('predictions'); }}>
                            <Target size={11} /> Edit
                          </button>
                          <button type="button" className="lb-row-btn" onClick={(ev) => { ev.stopPropagation(); setViewingPicks({ userId: e.userId, displayName: e.displayName, winner: e.winner, runnerUp: e.runnerUp, leagueId: league?.id || 'global-simple' }); }}>
                            <Eye size={11} /> View
                          </button>
                        </>
                      ) : (
                        <span className="lb-row-btn lb-row-btn-view"><Eye size={11} /> View picks</span>
                      )}
                    </div>
                  </div>
                </div>
                );
              })}
            </div>
          ))}

        </div>
      )}

      {viewingPicks && (
        <PicksViewer
          target={viewingPicks}
          onClose={() => setViewingPicks(null)}
        />
      )}

      {sTab === 'predictions' && (
        authenticated ? (
          <SimplePrediction
            key={`simple-${league?.id}`}
            userId={userData?.id}
            league={league}
            onExit={onBack}
            onComplete={handleComplete}
            embedded
          />
        ) : (
          <div className="empty-state guest-prompt">
            <p>Sign in to make your predictions and track your accuracy.</p>
            <button className="btn btn-primary" onClick={onSignIn}>Sign Up or Log In</button>
          </div>
        )
      )}

      <BracketShareModal
        open={!!shareBracket}
        onClose={() => setShareBracket(null)}
        displayName={userData?.displayName}
        leagueName={league?.name}
        leagueId={league?.id}
        userId={userData?.id}
        winner={shareBracket?.winner}
        runnerUp={shareBracket?.runnerUp}
        thirdPlace={shareBracket?.thirdPlace}
        notify={notify}
      />
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

    return () => { obs.disconnect(); };
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
  const initialRouteRef = useRef(parseRoute());
  const [view, setView] = useState(initialRouteRef.current.view);
  const [pendingDeepLink, setPendingDeepLink] = useState(
    initialRouteRef.current.leagueId
      ? { leagueId: initialRouteRef.current.leagueId, targetView: initialRouteRef.current.deepLinkView }
      : null
  );
  // Public-share-page target — populated when the URL is /u/{userId}/bracket.
  const [publicBracketUserId, setPublicBracketUserId] = useState(initialRouteRef.current.publicUserId || null);
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
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    // Fire the celebratory confetti (ported from the retired 2026 theme)
    // each time the user flips into dark mode.
    if (next === 'dark') {
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
  const [showEmailPrompt, setShowEmailPrompt] = useState(false);
  // Email prompt is deferred until the user has actually engaged with
  // the product — stacking it on top of the username prompt the moment
  // they sign in is modal whiplash. This flag carries the intent; the
  // useEffect below decides when to surface it.
  const [pendingEmailPrompt, setPendingEmailPrompt] = useState(false);
  const [shareCard, setShareCard] = useState(null); // { matchId, home, away, homeFlag, awayFlag, homeScore, awayScore, result }
  // Lifted from Detail — survives Firestore re-renders
  const [detailTab, setDetailTab] = useState('predictions');
  const [detailWeek, setDetailWeek] = useState('week1');
  const [detailStage, setDetailStage] = useState('all');
  const [standingsOpen, setStandingsOpen] = useState(false);
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
  // Global Leaderboard scope — 'all' shows every user, 'country' narrows to a
  // selected ISO-2, 'friends' narrows to the user's private-league members.
  // Lifted to App so the landing-page preview tabs can preset it before
  // navigating to the full leaderboard page.
  const [lbScope, setLbScope] = useState('all');
  const [lbScopeCountry, setLbScopeCountry] = useState('');
  // Quick Picks completion summary — lives at App level so Dashboard AND
  // LeaguesList can both read it (Quick Picks share one pick doc across
  // every QP league).
  const [quickPicks, setQuickPicks] = useState(null);

  // Fetch once per user. Max totalRemaining is 12 groups + 8 thirds + 32
  // bracket winners = 52 (sentinel for brand-new users in Dashboard).
  useEffect(() => {
    if (!uData?.id) { setQuickPicks(null); return; }
    let cancelled = false;
    (async () => {
      try {
        const { getSimplePrediction } = await import('./utils/db');
        const docData = await getSimplePrediction(uData.id, 'global-simple');
        if (cancelled) return;
        const groups = docData?.groupPredictions || {};
        const thirds = Array.isArray(docData?.bestThirdPicks) ? docData.bestThirdPicks : [];
        const ko = docData?.knockoutPredictions || {};
        const groupsDone = Object.values(groups).filter(g => Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)).length;
        const BRACKET_ROUNDS = [['roundOf32', 16], ['roundOf16', 8], ['quarterFinals', 4], ['semiFinals', 2], ['final', 1], ['thirdPlace', 1]];
        let bracketFilled = 0, bracketTotal = 0;
        for (const [k, size] of BRACKET_ROUNDS) {
          bracketTotal += size;
          bracketFilled += (ko[k] || []).filter(Boolean).length;
        }
        const groupsRemaining = Math.max(0, 12 - groupsDone);
        const thirdsRemaining = Math.max(0, 8 - thirds.filter(Boolean).length);
        const bracketRemaining = Math.max(0, bracketTotal - bracketFilled);
        const totalRemaining = groupsRemaining + thirdsRemaining + bracketRemaining;
        setQuickPicks({ groupsRemaining, thirdsRemaining, bracketRemaining, totalRemaining, isComplete: totalRemaining === 0 });
      } catch {
        if (!cancelled) setQuickPicks(null);
      }
    })();
    return () => { cancelled = true; };
  }, [uData?.id]);

  const notify = useCallback((msg, type = 'success') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000); }, []);
  const loadAllLeagues = useCallback(() => { fetchAllLeagues().then(setAllLeagues).catch(() => {}); }, []);
  const nav = useCallback((v, l, opts = {}) => {
    if (l) { setSelLeague(l); setDetailTab(opts.tab || 'predictions'); setDetailWeek('week1'); setDetailStage('all'); }
    if (v === 'browse') loadAllLeagues();
    setView(prev => prev === v && !l ? prev : v);
    setMenuOpen(false);
    window.scrollTo(0, 0);
    // Sync URL. Preserve query/hash so Privy OAuth callbacks survive nav().
    try {
      const nextPath = pathForView(v, l);
      const search = window.location.search || '';
      const hash = window.location.hash || '';
      if (window.location.pathname !== nextPath) {
        window.history.pushState({ view: v, leagueId: l?.id || null }, '', nextPath + search + hash);
      }
    } catch { /* no-op — SSR or sandboxed contexts */ }
  }, [loadAllLeagues]);

  // Back/forward button handling — mirror URL into view state. Deep-link to
  // /league/:id or /quick-picks/:id is deferred to the leagues-loaded effect
  // below since we need the league object to render the detail view.
  useEffect(() => {
    const onPopState = () => {
      const route = parseRoute();
      if (route.leagueId) {
        setPendingDeepLink({ leagueId: route.leagueId, targetView: route.deepLinkView });
        setView('landing');
      } else if (route.view === 'publicBracket') {
        setPublicBracketUserId(route.publicUserId || null);
        setView('publicBracket');
      } else {
        setPublicBracketUserId(null);
        setView(route.view);
      }
      window.scrollTo(0, 0);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => { fetchPlatformStats().then(setStats).catch(() => {}); }, []);
  useEffect(() => subscribeToMatchResults(setResults), []);
  // Capture any ?ref=... param early so it survives Privy's OAuth
  // round-trip and is available when createOrUpdateUser writes the
  // new user doc.
  useEffect(() => { captureReferralFromUrl(); }, []);
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
      // Wallet-only sign-ups have no email on file. We still want to
      // capture an email for reminders + targeted outreach, but not
      // immediately on login — that's modal whiplash. Mark it pending
      // and the deferred-prompt effect will surface it after a
      // meaningful first pick.
      else if (!u.email && !u.emailSkipped) setPendingEmailPrompt(true);

      // Backfill country for existing users who signed up before we required
      // it. Product directive: known overrides go first, then IP geolocation,
      // then default to US so the leaderboard flag is never blank.
      if (u.usernameSet && !u.country) {
        (async () => {
          try {
            const { detectCountryByIP } = await import('./utils/countries');
            const OVERRIDES = { 'lebida2352': 'PK', 'Sumit': 'BD' };
            const hardcoded = OVERRIDES[u.displayName];
            const detected = hardcoded || (await detectCountryByIP()) || 'US';
            const updated = await updateUserProfile(u.id, { country: detected });
            if (updated) setUData(updated);
          } catch (e) {
            console.warn('[auth] country backfill failed:', e.message);
          }
        })();
      }
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
  useEffect(loadAllLeagues, [loadAllLeagues]);

  // Auto-redirect from landing → dashboard on first successful sign-in
  // (only once; user can still navigate back to landing via the Home link).
  const autoRedirectedRef = useRef(false);
  useEffect(() => {
    if (!authenticated || !uData?.id) return;
    if (autoRedirectedRef.current) return;
    autoRedirectedRef.current = true;
    setView(prev => (prev === 'landing' ? 'dashboard' : prev));
  }, [authenticated, uData?.id]);

  // Surface the deferred email prompt once the user has engaged with the
  // product — i.e. they've placed at least one Quick Picks selection or
  // saved a classic prediction. Falls back to a 90s grace timer so we
  // still capture the email from users who poke around without picking.
  useEffect(() => {
    if (!pendingEmailPrompt) return;
    if (showUsernamePrompt) return; // never stack on top of the username modal
    const qpStarted = !!quickPicks && quickPicks.totalRemaining < 52;
    const classicStarted = Object.values(preds).some(p => p?.result);
    if (qpStarted || classicStarted) {
      setShowEmailPrompt(true);
      setPendingEmailPrompt(false);
      return;
    }
    const t = setTimeout(() => {
      setShowEmailPrompt(true);
      setPendingEmailPrompt(false);
    }, 90000);
    return () => clearTimeout(t);
  }, [pendingEmailPrompt, showUsernamePrompt, quickPicks, preds]);
  // Keep selLeague synced with live Firestore data (e.g. memberCount changes) without remounting Detail
  useEffect(() => {
    if (!selLeague?.id) return;
    const fresh = [...leagues, ...allLeagues].find(l => l.id === selLeague.id);
    if (fresh && JSON.stringify(fresh) !== JSON.stringify(selLeague)) {
      setSelLeague(fresh);
    }
  }, [leagues, allLeagues]);

  // Resolve /league/:id or /quick-picks/:id deep links once leagues data arrives.
  // Runs after auth completes and leagues/allLeagues populate; navigates to the
  // matching league and clears the pending marker. If the id doesn't resolve
  // (private league, unauth user, or bad id), the user stays on whatever view
  // the auto-redirect placed them on — URL cleanup happens when they nav next.
  useEffect(() => {
    if (!pendingDeepLink) return;
    const all = [...(leagues || []), ...(allLeagues || [])];
    if (all.length === 0) return;
    const match = all.find(l => l?.id === pendingDeepLink.leagueId);
    if (!match) {
      // Only give up after we've had a chance to load everything; keep trying
      // while leagues stream in. If we've tried browse and still no match,
      // drop the pending marker to avoid loops.
      if (allLeagues.length > 0 && leagues.length >= 0) {
        setPendingDeepLink(null);
      }
      return;
    }
    setPendingDeepLink(null);
    nav(pendingDeepLink.targetView || 'detail', match);
  }, [pendingDeepLink, leagues, allLeagues, nav]);

  // Kick off a public-league fetch so deep links to listed leagues resolve
  // even when the visitor hasn't logged in.
  useEffect(() => {
    if (pendingDeepLink && allLeagues.length === 0) loadAllLeagues();
  }, [pendingDeepLink, allLeagues.length, loadAllLeagues]);
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
          {p.result && (locked || res?.completed) && <button type="button" className="pred-share-btn-sm" title="Share prediction" onClick={() => setShareCard({ matchId: match.id, home: match.home, away: match.away, homeFlag: match.homeFlag, awayFlag: match.awayFlag, homeScore: p.score?.home, awayScore: p.score?.away, result: p.result, stage: match.stage })}><Share2 size={12} /></button>}
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
            {p.result && <button type="button" className="pred-share-btn" title="Share this prediction" onClick={() => setShareCard({ matchId: match.id, home: match.home, away: match.away, homeFlag: match.homeFlag, awayFlag: match.awayFlag, homeScore: p.score?.home, awayScore: p.score?.away, result: p.result, stage: match.stage })}><Share2 size={14} /></button>}
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

    // Hero CTAs are state-aware so a logged-in user sees their next
    // useful action (finish bracket / leaderboard / invite friends)
    // instead of the generic "Start Predicting" pitch. Mirrors the
    // dashboard's continueCard logic. While quickPicks is still loading
    // (authenticated && quickPicks === null), fall back to a neutral
    // "Continue predicting" so the primary doesn't flash a number that
    // might be wrong.
    const goLeaderboardLanding = () => {
      const gs = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || {
        id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true,
      };
      nav('detail', gs, { tab: 'leaderboard' });
    };

    // "Start Predicting" buttons: route straight to Global Quick Picks flow
    const startSimplePredicting = () => {
      track('bracket_start', { league_id: 'global-simple', authenticated });
      if (!authenticated) { login(); return; }
      const globalSimple = leagues.find(l => l.id === 'global-simple') || {
        id: 'global-simple', name: 'Global Quick Picks', type: 'free',
        predictionMode: 'simple', isGlobal: true,
      };
      nav('detail', globalSimple);
    };

    const heroCtas = useMemo(() => {
      // Anonymous: keep the original sign-up pitch.
      if (!authenticated) {
        return {
          primary: { label: <>Start Predicting &mdash; It&rsquo;s Free</>, onClick: startSimplePredicting },
          secondary: { label: 'Create a League', onClick: () => login() },
        };
      }
      // Authenticated but Quick Picks fetch still in flight — neutral copy.
      if (quickPicks === null) {
        return {
          primary: { label: 'Continue predicting', onClick: startSimplePredicting },
          secondary: { label: 'View leaderboard', onClick: goLeaderboardLanding },
        };
      }
      const hasPrivateLeagues = leagues.some(l => !l.isGlobal && l.id !== 'global' && l.id !== 'global-simple');
      // Mid-bracket: surface exactly how many picks are left.
      if (!quickPicks.isComplete) {
        const n = quickPicks.totalRemaining;
        return {
          primary: {
            label: `Finish your bracket — ${n} pick${n === 1 ? '' : 's'} left`,
            onClick: startSimplePredicting,
          },
          secondary: { label: 'View leaderboard', onClick: goLeaderboardLanding },
        };
      }
      // Done with QP and only competing in the global pool — push them
      // to spin up a private league with friends.
      if (!hasPrivateLeagues) {
        return {
          primary: { label: 'Invite friends to a league', onClick: () => nav('create') },
          secondary: { label: 'View leaderboard', onClick: goLeaderboardLanding },
        };
      }
      // Done + already has private leagues: leaderboard is the most
      // useful primary; keep an Invite secondary for growth.
      return {
        primary: { label: 'View leaderboard', onClick: goLeaderboardLanding },
        secondary: { label: 'Invite friends', onClick: () => nav('create') },
      };
    }, [authenticated, quickPicks, leagues]);

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
          <WorldCupCountdown />
          <div className="hero-split-inner" ref={el => { if (el && !heroAnimated) heroAnimated = true; }}>
            <div className="hero-left">
              <h1 className="hero-title">Predict the<br/><span className="highlight">World Cup.</span></h1>
              <p className="hero-subtitle">Compete with friends. Climb the leaderboard. Win rewards. Become the Oracle.</p>
              <div className="hero-cta">
                <button className="btn btn-primary btn-lg" onClick={heroCtas.primary.onClick}>{heroCtas.primary.label}</button>
                <button className="btn btn-secondary btn-lg" onClick={heroCtas.secondary.onClick}>{heroCtas.secondary.label}</button>
              </div>
              <div className="hero-social-proof">
                <div className="hero-avatars">
                  {['🇧🇷','🇩🇪','🇦🇷','🇫🇷'].map((f,i) => <span key={i} className="hero-avatar">{f}</span>)}
                </div>
                <span className="hero-proof-text"><AnimatedCounter value={stats.totalPlayers ? stats.totalPlayers * 12 : 13402} /> predictions made today &middot; 82 countries &middot; Free to play</span>
              </div>
              <p className="hero-compliance"><Shield size={12} /> GoalOracle&rsquo;s prediction engine is compliant with the official FIFA World Cup 26&trade; rulebook</p>
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
                  <button className="btn btn-secondary nmc-btn" onClick={goToPredict} disabled={isLocked}>
                    {isLocked ? <><Lock size={16} /> Predictions Locked</> : <>Preview this match <ChevronRight size={14} /></>}
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

        {/* ─── 2b. THE LEDGER — SCORING BREAKDOWN ─── */}
        <section className="ledger-section"><div className="container">
          <div className="editorial-head reveal">
            <div className="editorial-eyebrow">The Ledger</div>
            <h2 className="editorial-title">Seventy-six points.<br/><span className="editorial-em">One tournament.</span></h2>
            <div className="editorial-num">Quick Picks scoring</div>
          </div>
          <div className="ledger-grid">
            <article className="ledger-card reveal-float stagger-1">
              <header><span className="ledger-idx">I.</span><span className="ledger-stage">Group stage</span></header>
              <div className="ledger-points"><span className="ledger-num">36</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">Twelve groups, four teams each. <strong>1 point</strong> for each correctly ranked 1st or 2nd place, <strong>0.5</strong> for 3rd and 4th.</p>
              <div className="ledger-math"><span>12 groups</span><i>×</i><span>4 positions</span></div>
            </article>
            <article className="ledger-card ledger-accent reveal-float stagger-2">
              <header><span className="ledger-idx">II.</span><span className="ledger-stage">Best thirds</span></header>
              <div className="ledger-points"><span className="ledger-num">8</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">Eight third-place finishers advance to the Round of 32. <strong>1 point</strong> for each correct pick.</p>
              <div className="ledger-math"><span>8 slots</span><i>×</i><span>1 pt</span></div>
            </article>
            <article className="ledger-card reveal-float stagger-3">
              <header><span className="ledger-idx">III.</span><span className="ledger-stage">Knockout rounds</span></header>
              <div className="ledger-points"><span className="ledger-num">32</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">Round of 32 through the Final. <strong>1 point</strong> per correct winner across all 32 knockout fixtures.</p>
              <div className="ledger-math"><span>R32: 16</span><i>·</i><span>R16: 8</span><i>·</i><span>QF: 4</span><i>·</i><span>SF+: 4</span></div>
            </article>
            <article className="ledger-card ledger-total reveal-float stagger-4">
              <header><span className="ledger-idx">&Sigma;</span><span className="ledger-stage">Perfect ledger</span></header>
              <div className="ledger-points"><span className="ledger-num">76</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">The upper bound. Tiebreaker: earliest submission wins.</p>
              <div className="ledger-math ledger-math-all"><span>36</span><i>+</i><span>8</span><i>+</i><span>32</span><i>=</i><span className="ledger-sum">76</span></div>
            </article>
          </div>
        </div></section>

        {/* ─── 2c. THE CLIMB — XP TIER LADDER ─── */}
        <section className="climb-section"><div className="container">
          <div className="editorial-head reveal">
            <div className="editorial-eyebrow">The Climb</div>
            <h2 className="editorial-title">From fan to legend,<br/><span className="editorial-em">in thirty levels.</span></h2>
            <div className="editorial-num">XP ladder &middot; 9,300 total</div>
          </div>
          <div className="climb-ladder reveal">
            <div className="climb-track">
              <div className="climb-fill" style={{ width: '26%' }}></div>
              <span className="climb-tick" style={{ left: '0%' }} data-label="Lv 1"></span>
              <span className="climb-tick" style={{ left: '13.3%' }} data-label="Lv 5"></span>
              <span className="climb-tick" style={{ left: '33.3%' }} data-label="Lv 10"></span>
              <span className="climb-tick" style={{ left: '83.3%' }} data-label="Lv 25"></span>
              <span className="climb-tick" style={{ left: '100%' }} data-label="Lv 30"></span>
            </div>
          </div>
          <div className="climb-grid">
            {[
              { key: 'fan', tier: 'Fan', range: 'Lv 01 — 04', xp: '0 — 200', lede: 'Learning the form book.', perks: 'Daily pick · streaks', badge: 'Whistle' },
              { key: 'analyst', tier: 'Analyst', range: 'Lv 05 — 09', xp: '300 — 900', lede: 'Reading the xG, trusting the tape.', perks: 'Confidence · odds chips', badge: 'Silver clipboard' },
              { key: 'oracle', tier: 'Oracle', range: 'Lv 10 — 24', xp: '1.1k — 6.0k', lede: 'The board starts to listen.', perks: 'Pool heatmap · private leagues', badge: 'Gold sextant' },
              { key: 'legend', tier: 'Legend', range: 'Lv 25 — 30', xp: '6.5k — 9.3k', lede: 'Engraved into the Pantheon.', perks: 'Name in Almanac · custom seal', badge: 'Laurel wreath' },
            ].map((t, i) => (
              <article key={t.key} className={`climb-tier reveal-float stagger-${i+1}`} data-tier={t.key}>
                <div className="climb-tier-band"><span>{t.range}</span></div>
                <h3 className="climb-tier-name">{t.tier}</h3>
                <p className="climb-tier-lede">{t.lede}</p>
                <ul className="climb-tier-list">
                  <li><span>XP range</span><em>{t.xp}</em></li>
                  <li><span>Perks</span><em>{t.perks}</em></li>
                  <li><span>Badge</span><em>{t.badge}</em></li>
                </ul>
              </article>
            ))}
          </div>
        </div></section>

        {/* ─── 3. LEADERBOARD + STREAKS ─── */}
        <section className="lb-streaks-section"><div className="container">
          <div className="lb-streaks-grid">
            {/* Leaderboard */}
            <div className="lb-panel reveal">
              <div className="lb-panel-head">
                <h3>Global Leaderboard</h3>
                <a className="lb-view-all" onClick={() => {
                  const gs = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true };
                  nav('detail', gs);
                  setDetailTab('leaderboard');
                }}>View Full Leaderboard <ChevronRight size={14} /></a>
              </div>
              <div className="lb-tabs">
                {['global','country','friends'].map(t => (
                  <button
                    key={t}
                    className={`lb-tab ${lbTab === t ? 'active' : ''}`}
                    onClick={() => {
                      setLbTab(t);
                      // Preset the real leaderboard scope + country so the full
                      // view opens already filtered the way the user asked for.
                      const scope = t === 'global' ? 'all' : t;
                      setLbScope(scope);
                      if (scope === 'country') setLbScopeCountry(uData?.country || '');
                      const gs = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true };
                      // nav() resets detailTab to 'predictions' by default
                      // — pass tab:'leaderboard' so SimpleDetail opens on the
                      // leaderboard, not the Quick Picks wizard.
                      nav('detail', gs, { tab: 'leaderboard' });
                    }}
                  >{t.charAt(0).toUpperCase() + t.slice(1)}</button>
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

            {/* Next match teaser — replaces the prior mock community-pick
                percentages. Pre-kickoff we don't have aggregated pick
                data yet, so showing fake bars was filler. The card now
                points at the actual opening match with venue + kickoff
                and a CTA to start predicting. Once tournament data is
                live we can re-introduce real community percentages. */}
            <div className="community-panel reveal">
              <h3>Next match</h3>
              {communityMatch && (
                <>
                  <div className="comm-match">
                    <span>{communityMatch.homeFlag} {communityMatch.home}</span>
                    <span className="comm-vs">vs</span>
                    <span>{communityMatch.awayFlag} {communityMatch.away}</span>
                  </div>
                  <div className="comm-meta">
                    <div><MapPin size={12} aria-hidden="true" /> {communityMatch.venue}, {communityMatch.city}</div>
                    <div><Calendar size={12} aria-hidden="true" /> {new Date(communityMatch.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {communityMatch.time} ET</div>
                  </div>
                </>
              )}
              <div className="comm-cta">
                <p>Predictions are open. Make yours before kickoff and your bracket joins the leaderboard the moment results post.</p>
                <button type="button" className="btn btn-primary btn-sm" onClick={startSimplePredicting}>
                  {authenticated ? 'Continue predicting' : 'Start your bracket'} <ChevronRight size={14} />
                </button>
              </div>
            </div>
          </div>
        </div></section>

        {/* ─── 5. FINAL CTA STRIP (compact, footer-adjacent) ─── */}
        <section className="final-cta-strip">
          <div className="container">
            <div className="final-cta-strip-inner reveal">
              <span className="final-cta-strip-text">Ready to predict?</span>
              <button className="btn btn-primary" onClick={startSimplePredicting}>Start Predicting &mdash; It&rsquo;s Free</button>
            </div>
          </div>
        </section>

        <footer className="site-footer">
          <div className="footer-content">
            <div className="footer-top">
              <div className="footer-proof"><Globe size={14} /> Trusted by football fans in 82 countries &middot; <AnimatedCounter value={stats.totalPlayers ? stats.totalPlayers * 30 : 32000} suffix="+" /> predictions this week</div>
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
      { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', memberCount: stats.totalPlayers },
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

    // Matches needing prediction (Classic)
    const needsPrediction = useMemo(() =>
      WORLD_CUP_MATCHES.filter(m => getMatchStatus(m.date, m.time) === 'open' && !results[m.id]?.completed && !preds[m.id]?.result).slice(0, 4),
    [preds, results]);

    // User's Quick Picks leagues (shared across all simple leagues — one pick doc)
    const simpleLeagues = useMemo(() => ml.filter(l => l.predictionMode === 'simple'), [ml]);

    // Don't flag "first time" until the Quick Picks fetch has resolved once —
    // otherwise returning users briefly see the onboard banner flash before
    // their picks arrive from Firestore, then watch it get replaced by stats.
    // `quickPicks === null` means "not loaded yet"; max totalRemaining is
    // 12 groups + 8 thirds + 32 bracket winners = 52. State lives on App.
    const isFirstTime = quickPicks !== null
      && quickPicks.totalRemaining === 52
      && Object.keys(preds).length === 0
      && totalCompleted === 0;

    const quickPicksIncomplete = !!quickPicks && !quickPicks.isComplete && simpleLeagues.length > 0;
    const firstMatch = useMemo(() => WORLD_CUP_MATCHES.find(m => getMatchStatus(m.date, m.time) === 'open') || WORLD_CUP_MATCHES[0], []);

    // Pick the single highest-priority "do this next" action for the hero
    // card. Priority order: finish Quick Picks → a Classic match locking
    // soon → rank teaser (if there's competition) → fallback explore card.
    // Pre-kickoff (Apr 2026) the Quick Picks branch dominates; as we get
    // closer to June 11 the match-lock branch takes over.
    const continueCard = useMemo(() => {
      if (quickPicks === null) return null; // still loading

      if (quickPicksIncomplete) {
        const etaMin = Math.max(1, Math.round(quickPicks.totalRemaining * 8 / 60));
        const qpLeague = simpleLeagues[0];
        return {
          kind: 'quickpicks',
          eyebrow: 'Quick Picks',
          title: `Finish your bracket — ${quickPicks.totalRemaining} pick${quickPicks.totalRemaining === 1 ? '' : 's'} left`,
          sub: `About ${etaMin} min · locks when the opener kicks off`,
          cta: 'Continue picking',
          onClick: () => { if (qpLeague) { setDetailTab('predictions'); nav('detail', qpLeague); } else { nav('simplePredict'); } },
        };
      }

      // Classic match locking within 24h that the user hasn't predicted.
      const now = Date.now();
      const LOCK_BUFFER_MS = 5 * 60 * 1000;
      const SOON_MS = 24 * 60 * 60 * 1000;
      const soon = needsPrediction.find(m => {
        const [hh, mm] = (m.time || '15:00').split(':').map(Number);
        const kick = new Date(`${m.date}T00:00:00Z`);
        kick.setUTCHours(hh + 4, mm, 0, 0);
        const diff = kick.getTime() - LOCK_BUFFER_MS - now;
        return diff > 0 && diff < SOON_MS;
      });
      if (soon) {
        const classicLeague = ml.find(l => l.predictionMode === 'classic') || ml[0];
        return {
          kind: 'match',
          eyebrow: 'Locks soon',
          title: `${soon.home} vs ${soon.away}`,
          sub: `Predict before kickoff to keep your streak alive.`,
          cta: 'Predict match',
          onClick: () => { if (classicLeague) { setDetailTab('predictions'); nav('detail', classicLeague); } },
        };
      }

      // Rank teaser — show Global Quick Picks standing once the user is
      // done picking. Avoids the empty "0 pts" pre-kickoff bragging.
      const qpGlobalRk = leagueRanks['global-simple'];
      if (qpGlobalRk && qpGlobalRk.total > 1) {
        const leading = qpGlobalRk.rank === 1;
        return {
          kind: 'rank',
          eyebrow: 'Global Quick Picks',
          title: leading
            ? `You're #1 of ${qpGlobalRk.total.toLocaleString()}`
            : `You're #${qpGlobalRk.rank.toLocaleString()} of ${qpGlobalRk.total.toLocaleString()}`,
          sub: leading ? `Hold the top spot until June 11.` : `See who's ahead of you and why.`,
          cta: 'Open leaderboard',
          onClick: () => {
            const qpLeague = simpleLeagues[0] || leagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true };
            nav('detail', qpLeague, { tab: 'leaderboard' });
          },
        };
      }

      return {
        kind: 'idle',
        eyebrow: 'All set',
        title: `You're all caught up`,
        sub: `Come back when a match is close to kickoff — or go find a league to join.`,
        cta: 'Browse leagues',
        onClick: () => nav('browse'),
      };
    }, [quickPicks, quickPicksIncomplete, simpleLeagues, needsPrediction, ml, leagueRanks, leagues]);

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
        for (const league of ml.slice(0, 20)) {
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
              // Count my own predictions for this league so the Your Leagues
              // page can show a "X picks left · ~Y min" status line.
              const myPreds = bu[uData.id] || {};
              const myPredCount = Object.values(myPreds).filter(p => p?.result).length;
              if (!cancelled) setLeagueRanks(prev => ({ ...prev, [league.id]: { rank: myIdx + 1, total: sorted.length, leaderPts: sorted[0]?.totalPoints || 0, myPts: sorted[myIdx]?.totalPoints || 0, myPredCount } }));
            }
          } catch {}
        }
      })();
      return () => { cancelled = true; };
    }, [uData?.id, ml.length, results]);

    // Greeting
    const hour = new Date().getHours();
    const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    // Countdown helper — compute initial value synchronously so the card
    // doesn't flash an empty string between mount and the first tick.
    const computeCountdown = (match) => {
      const [hh, mm] = (match.time || '15:00').split(':').map(Number);
      const kick = new Date(`${match.date}T00:00:00Z`);
      kick.setUTCHours(hh + 4, mm, 0, 0);
      const lockMs = kick.getTime() - 5 * 60 * 1000;
      const diff = lockMs - Date.now();
      if (diff <= 0) return 'LOCKED';
      const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), mi = Math.floor((diff % 3600000) / 60000);
      return d > 0 ? `${d}d ${h}h` : `${h}h ${mi}m`;
    };
    const Countdown = ({ match }) => {
      const [ct, setCt] = useState(() => computeCountdown(match));
      useEffect(() => {
        setCt(computeCountdown(match));
        const iv = setInterval(() => setCt(computeCountdown(match)), 60000);
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
            <p className="dv2-sub">
              {quickPicks === null ? (
                <span className="dv2-sub-loading" aria-hidden="true">&nbsp;</span>
              ) : (
                <>
                  {(needsPrediction.length + (quickPicksIncomplete ? 1 : 0)) > 0 ? (() => {
                    const bits = [];
                    if (needsPrediction.length > 0) bits.push(`${needsPrediction.length} match pick${needsPrediction.length > 1 ? 's' : ''}`);
                    if (quickPicksIncomplete) bits.push(`${quickPicks.totalRemaining} Quick Picks left`);
                    return <>{bits.join(' · ')} due before kickoff</>;
                  })() : <>You&rsquo;re all caught up</>}
                  &nbsp;&middot;&nbsp;
                </>
              )}
              <span className="dv2-level"><Star size={12} /> Level {lvl.level} &mdash; {lvl.title}</span>
            </p>
          </div>
          <div className="dv2-actions">
            <button className="btn btn-secondary btn-sm" onClick={() => nav('browse')}><Search size={16} /> Browse</button>
            <button className="btn btn-primary btn-sm" onClick={() => nav('create')}><Plus size={16} /> Create</button>
          </div>
        </div>

        {/* Onboarding card (first-time) or 3 Stat Cards */}
        {isFirstTime ? (
          <div className="dv2-onboard">
            <div className="dv2-onboard-inner">
              <div className="dv2-onboard-text">
                <h2>Make your first pick</h2>
                <p>Takes about 3 minutes. Rank the groups, pick your best thirds, fill the bracket. Your picks auto-save as you go.</p>
              </div>
              <button className="btn btn-primary btn-lg" onClick={() => {
                const simpleL = ml.find(l => l.predictionMode === 'simple') || ml[0];
                nav('detail', simpleL);
              }}>
                Start predicting <ChevronRight size={16} />
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Context-aware "Continue" hero — picks the single most useful
                next action for this user right now. */}
            {continueCard && (
              <div
                className={`dv2-continue dv2-continue-${continueCard.kind}`}
                onClick={continueCard.onClick}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); continueCard.onClick(); } }}
              >
                <div className="dv2-continue-body">
                  <div className="dv2-continue-eyebrow">{continueCard.eyebrow}</div>
                  <h2 className="dv2-continue-title">{continueCard.title}</h2>
                  <p className="dv2-continue-sub">{continueCard.sub}</p>
                </div>
                <div className="dv2-continue-cta">
                  <span>{continueCard.cta}</span>
                  <ChevronRight size={18} />
                </div>
              </div>
            )}

            {/* Compact stats strip — secondary reference, not the hero. */}
            <div className="dv2-stats-strip">
              <div className="dv2-strip-cell">
                <span className="dv2-strip-label">Points</span>
                <span className="dv2-strip-val"><AnimatedCounter value={totalStats.totalPoints} /></span>
                <span className="dv2-strip-sub">{totalStats.correctResults} correct</span>
              </div>
              <div className="dv2-strip-cell">
                <span className="dv2-strip-label">Accuracy</span>
                <span className="dv2-strip-val"><AnimatedCounter value={accuracy} suffix="%" /></span>
                <span className="dv2-strip-sub">{totalCompleted} played</span>
              </div>
              <div className="dv2-strip-cell">
                <span className="dv2-strip-label">Best Rank</span>
                {(() => {
                  const ranksLoaded = Object.keys(leagueRanks).length > 0;
                  if (!ranksLoaded) return <span className="dv2-strip-val dv2-stat-skeleton" aria-hidden="true">&nbsp;</span>;
                  const best = Object.values(leagueRanks).reduce((b, r) => (!b || r.rank < b.rank) ? r : b, null);
                  const bestL = ml.find(l => leagueRanks[l.id] && Object.values(leagueRanks).every(r => leagueRanks[l.id].rank <= r.rank));
                  return (
                    <>
                      <span className="dv2-strip-val">{best ? `#${best.rank}` : '—'}</span>
                      <span className="dv2-strip-sub">{bestL?.name || ''}</span>
                    </>
                  );
                })()}
              </div>
            </div>
          </>
        )}

        {/* Prediction flow explainer — how the two modes work per league */}
        <div className="dv2-section">
          <div className="dv2-section-head">
            <h3 className="dv2-section-title">Your Prediction Flow</h3>
            <span className="dv2-section-sub">Two modes · One set of picks per league</span>
          </div>
          <div className="dv2-flow-grid">
            <div
              className="dv2-flow-card dv2-flow-simple"
              onClick={() => {
                const gs = leagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true };
                setDetailTab('predictions');
                nav('detail', gs);
              }}
            >
              <div className="dv2-flow-head">
                <div className="dv2-flow-icon"><Target size={20} /></div>
                <div className="dv2-flow-title">Quick Picks</div>
                <span className="dv2-flow-badge">Shared</span>
              </div>
              <p className="dv2-flow-desc">
                Rank each group, pick the best thirds, and call the knockout bracket. <strong>Your picks apply to every Quick Picks league you belong to</strong> — make them once, compete everywhere.
              </p>
              <div className="dv2-flow-cta">Continue your Quick Picks <ChevronRight size={14} /></div>
            </div>
            <div
              className="dv2-flow-card dv2-flow-classic"
              onClick={() => {
                const g = leagues.find(l => l.id === 'global') || { id: 'global', name: 'Global League', type: 'free', predictionMode: 'classic', pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 }, isGlobal: true };
                setDetailTab('predictions');
                nav('detail', g);
              }}
            >
              <div className="dv2-flow-head">
                <div className="dv2-flow-icon dv2-flow-icon-classic"><Trophy size={20} /></div>
                <div className="dv2-flow-title">Classic Predictions</div>
                <span className="dv2-flow-badge dv2-flow-badge-per-league">Per-league</span>
              </div>
              <p className="dv2-flow-desc">
                Pick the score and result of each fixture. <strong>Each Classic Predictions league stores its own set of picks</strong>. Copy from your Global Classic Predictions when you create or join a new one.
              </p>
              <div className="dv2-flow-cta">Continue your Classic Predictions <ChevronRight size={14} /></div>
            </div>
            <div
              className="dv2-flow-card dv2-flow-join"
              onClick={() => nav('browse')}
            >
              <div className="dv2-flow-head">
                <div className="dv2-flow-icon dv2-flow-icon-join"><Users size={20} /></div>
                <div className="dv2-flow-title">Join a League</div>
                <span className="dv2-flow-badge dv2-flow-badge-join">Public + code</span>
              </div>
              <p className="dv2-flow-desc">
                Browse public leagues to find one that fits, or <strong>enter a private passcode from a friend</strong> to jump straight in. One click takes you both places.
              </p>
              <div className="dv2-flow-cta">Browse or enter a code <ChevronRight size={14} /></div>
            </div>
          </div>
          <div className="dv2-flow-actions">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => nav('create')}><Plus size={14} /> Create a league</button>
          </div>
        </div>

        {/* Needs Prediction — only render once quickPicks has loaded so the
            section doesn't flicker between "All caught up" and the action
            cards as the QP fetch resolves. */}
        {quickPicks === null ? (
          <div className="dv2-section"><div className="dv2-section-placeholder" aria-hidden="true" /></div>
        ) : (needsPrediction.length > 0 || quickPicksIncomplete) ? (
          <div className="dv2-section">
            <h3 className="dv2-section-title">Needs Your Prediction</h3>
            <div className="dv2-action-cards">
              {/* One Quick Picks card per league the user is in. All QP
                  leagues share the same /simplePredictions doc, so the
                  remaining count is the same on every card — but the
                  user asked for each league to have its own row so they
                  can jump directly to that league. */}
              {quickPicksIncomplete && simpleLeagues.map(qpLeague => {
                const remainingBits = [];
                if (quickPicks.groupsRemaining > 0) remainingBits.push(`${quickPicks.groupsRemaining} group${quickPicks.groupsRemaining > 1 ? 's' : ''}`);
                if (quickPicks.thirdsRemaining > 0) remainingBits.push(`${quickPicks.thirdsRemaining} best-third${quickPicks.thirdsRemaining > 1 ? 's' : ''}`);
                if (quickPicks.bracketRemaining > 0) remainingBits.push(`${quickPicks.bracketRemaining} bracket winner${quickPicks.bracketRemaining > 1 ? 's' : ''}`);
                const summary = remainingBits.length > 0 ? remainingBits.join(' · ') : 'Finish your picks';
                const estMin = Math.max(1, Math.round(quickPicks.totalRemaining * 8 / 60));
                return (
                  <div key={qpLeague.id} className="dv2-action-card dv2-action-card-qp" onClick={() => { setDetailTab('predictions'); nav('detail', qpLeague); }}>
                    <div className="dv2-ac-body">
                      <div className="dv2-ac-tags">
                        <span className="dv2-ac-tag dv2-ac-tag-qp"><Target size={10} /> Quick Picks</span>
                        <span className="dv2-ac-league">{qpLeague.name}</span>
                      </div>
                      <div className="dv2-ac-summary">{summary} <span className="dv2-ac-eta">· ~{estMin} min</span></div>
                    </div>
                    {firstMatch && <Countdown match={firstMatch} />}
                  </div>
                );
              })}
              {needsPrediction.map(m => {
                const classicLeague = ml.find(l => l.predictionMode === 'classic') || ml[0];
                return (
                  <div key={m.id} className="dv2-action-card" onClick={() => nav('detail', classicLeague)}>
                    <div className="dv2-ac-body">
                      <div className="dv2-ac-tags">
                        <span className="dv2-ac-tag dv2-ac-tag-cl"><Trophy size={10} /> Classic Predictions</span>
                        {classicLeague?.name && <span className="dv2-ac-league">{classicLeague.name}</span>}
                      </div>
                      <div className="dv2-ac-teams">
                        <span className="dv2-ac-flag">{m.homeFlag}</span>
                        <span className="dv2-ac-name">{m.home}</span>
                        <span className="dv2-ac-vs">vs</span>
                        <span className="dv2-ac-name">{m.away}</span>
                        <span className="dv2-ac-flag">{m.awayFlag}</span>
                      </div>
                    </div>
                    <Countdown match={m} />
                  </div>
                );
              })}
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
      { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true, memberCount: stats.totalPlayers },
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

    // Returns { done, remaining, etaMin, text } or null if data isn't loaded yet.
    // Quick Picks share one pick doc across all QP leagues, so every QP row
    // shows the same status. Classic leagues use per-league myPredCount from
    // the leagueRanks fetch.
    const predStatus = (league) => {
      if (league.predictionMode === 'simple') {
        if (!quickPicks) return null;
        if (quickPicks.isComplete) return { done: true, remaining: 0, text: 'All picks in' };
        const etaMin = Math.max(1, Math.round(quickPicks.totalRemaining * 8 / 60));
        return { done: false, remaining: quickPicks.totalRemaining, etaMin, text: `${quickPicks.totalRemaining} picks left · ~${etaMin} min` };
      }
      const rk = leagueRanks[league.id];
      if (!rk || typeof rk.myPredCount !== 'number') return null;
      const total = WORLD_CUP_MATCHES.length;
      const remaining = Math.max(0, total - rk.myPredCount);
      if (remaining === 0) return { done: true, remaining: 0, text: `All ${total} picks in` };
      const etaMin = Math.max(1, Math.round(remaining * 20 / 60));
      return { done: false, remaining, etaMin, text: `${remaining} pick${remaining !== 1 ? 's' : ''} left · ~${etaMin} min` };
    };

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
                const gStatus = predStatus(gl);
                return (
                  <div key={gl.id} className="lv2-row lv2-row-global">
                    <div className="lv2-row-top" onClick={() => nav('detail', gl)}>
                      <div className="lv2-row-info">
                        <h3 className="lv2-row-name">
                          {gl.name} <span className="lv2-global-pill">GLOBAL</span>
                          {gl.predictionMode === 'simple' && <span className="lv2-mode-pill simple">QUICK PICKS</span>}
                          {gl.predictionMode !== 'simple' && <span className="lv2-mode-pill classic">CLASSIC</span>}
                        </h3>
                        <span className="lv2-row-meta"><Users size={12} /> {(gl.memberCount || 0).toLocaleString()} members</span>
                        {gStatus && (
                          <span className={`lv2-pred-status ${gStatus.done ? 'lv2-pred-done' : 'lv2-pred-open'}`}>
                            {gStatus.done ? <CheckCircle size={12} /> : <Target size={12} />} {gStatus.text}
                          </span>
                        )}
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

              const pStatus = predStatus(l);
              return (
                <div key={l.id} className="lv2-row">
                  <div className="lv2-row-top" onClick={() => toggleExpand(l.id)}>
                    <div className="lv2-row-info">
                      <h3 className="lv2-row-name">
                        {l.name}
                        {l.predictionMode === 'simple' && <span className="lv2-mode-pill simple">QUICK PICKS</span>}
                        {l.predictionMode !== 'simple' && <span className="lv2-mode-pill classic">CLASSIC</span>}
                      </h3>
                      <span className="lv2-row-meta"><Users size={12} /> {(l.memberCount || l.members?.length || 0).toLocaleString()} members</span>
                      {pStatus && (
                        <span className={`lv2-pred-status ${pStatus.done ? 'lv2-pred-done' : 'lv2-pred-open'}`}>
                          {pStatus.done ? <CheckCircle size={12} /> : <Target size={12} />} {pStatus.text}
                        </span>
                      )}
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
    const [postJoin, setPostJoin] = useState(null); // { id, name, mode } after successful join
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
        // Quick Picks leagues route straight into the league — the in-league
        // gate (copy-banner) handles the fresh-vs-copy choice. Classic
        // leagues keep the legacy success modal for now since they don't
        // have an equivalent in-league gate yet.
        const isSimple = league.predictionMode === 'simple';
        if (isSimple) {
          // Tiny delay so the leagues subscription delivers the new
          // membership before nav() picks up the league.
          setTimeout(() => {
            const fresh = leagues.find(x => x.id === league.id) || allLeagues.find(x => x.id === league.id) || league;
            nav('detail', fresh);
          }, 150);
        } else {
          setPostJoin({ id: league.id, name: league.name, mode: league.predictionMode || 'classic' });
        }
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
        {f.length === 0 ? (
          <div className="empty-state"><p>No public leagues found.</p><button className="btn btn-primary" onClick={() => nav('create')}><Plus size={18} /> Create</button></div>
        ) : (
          <div className="leagues-table-wrap">
            <table className="leagues-table">
              <thead>
                <tr>
                  <th>League</th>
                  <th className="lt-col-mode">Mode</th>
                  <th className="lt-col-members">Members</th>
                  <th className="lt-col-entry">Entry</th>
                  <th className="lt-col-action" aria-label="Action" />
                </tr>
              </thead>
              <tbody>
                {f.map((l) => {
                  // Membership flips live via the user's leagues subscription
                  // (the cached `allLeagues.members` array doesn't refresh
                  // after a join, which left the button stuck on "Join").
                  const mem = leagues.some(ml => ml.id === l.id) || l.members?.includes(uData?.id);
                  const isQuickPicks = l.predictionMode === 'simple';
                  return (
                    <tr key={l.id} className="leagues-row">
                      <td>
                        <div className="lt-name">
                          <Trophy size={14} />
                          <span>{l.name}</span>
                        </div>
                      </td>
                      <td className="lt-col-mode">
                        <span className={`lt-mode-pill ${isQuickPicks ? 'is-simple' : 'is-classic'}`}>
                          {isQuickPicks ? 'Quick Picks' : 'Classic'}
                        </span>
                      </td>
                      <td className="lt-col-members">
                        <span className="lt-members"><Users size={12} /> {l.memberCount || 0}</span>
                      </td>
                      <td className="lt-col-entry">
                        {l.type === 'paid'
                          ? <span className="badge badge-premium"><Coins size={12} /> {l.entryFee} {l.currency}</span>
                          : <span className="badge badge-free">Free</span>}
                      </td>
                      <td className="lt-col-action">
                        {mem
                          ? <button className="btn btn-secondary btn-sm" onClick={() => nav('detail', l)}><Eye size={14} /> View</button>
                          : <button className="btn btn-primary btn-sm" onClick={() => handleJoin(l)}><UserPlus size={14} /> Join</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {postJoin && (
          <JoinSuccessModal
            postJoin={postJoin}
            userId={uData?.id}
            onClose={() => setPostJoin(null)}
            onGoToLeague={() => {
              const l = allLeagues.find(x => x.id === postJoin.id) || leagues.find(x => x.id === postJoin.id);
              setPostJoin(null);
              if (l) nav('detail', l); else nav('dashboard');
            }}
            notify={notify}
          />
        )}
      </div>
    );
  };


  const Detail = () => {
    const tab = detailTab, setTab = setDetailTab;
    const sf = detailWeek, setSf = setDetailWeek;
    const stageFilter = detailStage, setStageFilter = setDetailStage;
    const [lbRaw, setLbRaw] = useState(null); // { leagueId, bu, userNames } — raw server data, recomputed into sorted `lb` whenever results or points change
    const [lbl, setLbl] = useState(false);
    const [lbDeltas, setLbDeltas] = useState({});
    const [lbSort, setLbSort] = useState('points'); // 'points' | 'xp' | 'streak'
    const [showDelete, setShowDelete] = useState(false);
    const [showInvite, setShowInvite] = useState(false);
    const [inviteCopied, setInviteCopied] = useState(false);
    const [resettingPicks, setResettingPicks] = useState(false);
    const weekCelebratedRef = useRef({});

    const handleResetClassicPicks = async () => {
      if (!uData?.id || !selLeague?.id) return;
      const leagueLabel = selLeague.name || 'this league';
      const ok = window.confirm(
        `Reset ALL your Classic Predictions for "${leagueLabel}"?\n\n`
        + `Every score + result you've picked in this league will be deleted. `
        + `Match results that have already been played and graded stay on the leaderboard.\n\n`
        + `This can't be undone.`,
      );
      if (!ok) return;
      setResettingPicks(true);
      try {
        const out = await resetClassicPredictions(selLeague.id);
        // Clear local state — the subscription will reconcile, but update
        // optimistically so the UI jumps to zero immediately.
        setPreds({});
        notify(`Cleared ${out?.deleted ?? 0} prediction${out?.deleted === 1 ? '' : 's'}`);
      } catch (e) {
        notify(e?.message || 'Reset failed', 'error');
      } finally {
        setResettingPicks(false);
      }
    };
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

    // Fetch the raw leaderboard once per (tab, league) pair. Previously this
    // effect also depended on `results`, but the matchResults Firestore
    // snapshot callback emits a fresh object on every event — including
    // metadata-only events — which re-ran the fetch in a tight loop and
    // left the view stuck on "Loading…". Result-driven point recalcs now
    // live in the useMemo below, so fetch runs exactly once per league.
    useEffect(() => {
      if (tab !== 'leaderboard' || !selLeague?.id) return;
      let cancelled = false;
      (async () => {
        setLbl(true);
        try {
          const { leaderboard: bu, userNames } = await getLeagueLeaderboard(selLeague.id);
          if (cancelled) return;
          setLbRaw({ leagueId: selLeague.id, bu, userNames });
        } catch (e) { console.error(e); }
        finally { if (!cancelled) setLbl(false); }
      })();
      return () => { cancelled = true; };
    }, [tab, selLeague?.id]);

    // Derive the sorted leaderboard from raw data + latest results. Cheap
    // client-side recompute whenever `results` changes — no refetch.
    const lb = useMemo(() => {
      if (!lbRaw || !selLeague || lbRaw.leagueId !== selLeague.id) return [];
      const p = selLeague.pointsSystem || {};
      const entries = Object.entries(lbRaw.bu).map(([uid, pr]) => {
        const stats = calculateTotalPoints(pr, results, p);
        const xp = calculateXP(pr, results, 1);
        return { userId: uid, displayName: lbRaw.userNames[uid] || uid.slice(0, 8), ...stats, xp, levelInfo: getLevelInfo(xp) };
      });
      return sortLeaderboard(entries);
    }, [lbRaw, results, selLeague]);

    // Rank deltas only update when the sorted order actually changes.
    useEffect(() => {
      if (!selLeague?.id || lb.length === 0) return;
      setLbDeltas(computeRankDeltas(`classic:${selLeague.id}`, lb));
    }, [lb, selLeague?.id]);

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
                // Prefer the highest-stage predicted match so clicking Share
                // on the Finals tab actually surfaces the Final, not whatever
                // happens to be the last entry in Object.entries(preds).
                // Ranking: Final > 3rd Place > SF > QF > R16 > R32 > Group.
                const stageRank = (s) => s === 'Final' ? 7 : s === '3rd Place' ? 6 : s === 'Semifinal' ? 5 : s === 'Quarterfinal' ? 4 : s === 'Round of 16' ? 3 : s === 'Round of 32' ? 2 : 1;
                let best = null;
                for (const [mId, p] of Object.entries(preds)) {
                  if (!p?.result) continue;
                  const match = augmentedMatches.find(m => m.id === mId);
                  if (!match) continue;
                  const rank = stageRank(match.stage);
                  if (!best || rank > best.rank) best = { mId, p, match, rank };
                }
                if (!best) return;
                const { mId, p, match } = best;
                setShareCard({ matchId: mId, home: match.home, away: match.away, homeFlag: match.homeFlag, awayFlag: match.awayFlag, homeScore: p.score?.home, awayScore: p.score?.away, result: p.result, stage: match.stage });
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
            {Object.keys(preds).length > 0 && (
              <button
                type="button"
                className="btn btn-ghost btn-xs pib-reset"
                onClick={handleResetClassicPicks}
                disabled={resettingPicks}
                title="Reset all of my Classic Predictions for this league"
              >
                {resettingPicks ? <RefreshCw size={11} className="spin" /> : <RotateCcw size={11} />} Reset my picks
              </button>
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
                <div className="rank">{i === 0 && <Trophy size={20} className="gold" />}{i === 1 && <Trophy size={20} className="silver" />}{i === 2 && <Trophy size={20} className="bronze" />}{i > 2 && <span>#{i+1}</span>}{lbSort === 'points' && <RankDelta delta={lbDeltas[e.userId]} />}</div>
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
      loadAllLeagues();
      notify('League created!');
      nav('dashboard');
    } catch (e) {
      console.error('[create] failed:', e);
      notify(e.message || 'Failed to create league', 'error');
    }
  }, [uData?.id, nav, notify, loadAllLeagues]);
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
    const [editingCountry, setEditingCountry] = useState(false);
    const [newCountry, setNewCountry] = useState(uData?.country || '');
    const [savingCountry, setSavingCountry] = useState(false);
    const [countriesList, setCountriesList] = useState([]);
    // Wallet section is collapsed by default — most users never need it.
    // Will surface meaningfully when sweepstakes / paid leagues ship.
    const [walletOpen, setWalletOpen] = useState(false);
    const walletAddr = walletAddress;
    const displayEmail = uData?.email || '';
    const displayName = uData?.displayName || displayEmail?.split('@')[0] || 'Player';
    const userCountryCode = uData?.country || '';
    const userCountryFlag = _countryFlag(userCountryCode);

    useEffect(() => {
      if (!editingCountry || countriesList.length > 0) return;
      import('./utils/countries').then(mod => setCountriesList(mod.default || []));
    }, [editingCountry]);

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

    const saveCountry = async () => {
      if (!newCountry || newCountry === userCountryCode) { setEditingCountry(false); return; }
      setSavingCountry(true);
      try {
        const updated = await updateUserProfile(uData.id, { country: newCountry });
        if (updated) setUData(updated);
        setEditingCountry(false);
        notify('Country updated!');
      } catch(e) { notify('Failed to update country', 'error'); }
      finally { setSavingCountry(false); }
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
              {!editingCountry ? (
                <div className="dropdown-name-row dropdown-country-row">
                  <div className="dropdown-country">
                    {userCountryCode ? (
                      <><span className="dropdown-country-flag">{userCountryFlag}</span><span className="dropdown-country-code">{userCountryCode}</span></>
                    ) : (
                      <span className="dropdown-country-empty">No country set</span>
                    )}
                  </div>
                  <button type="button" className="edit-name-btn" onClick={() => { setNewCountry(userCountryCode); setEditingCountry(true); }} title="Edit home country">✏️</button>
                </div>
              ) : (
                <div className="edit-country-row">
                  <div style={{flex:1, minWidth:0}}>
                    <CountryPicker
                      value={newCountry}
                      countries={countriesList}
                      onChange={(code) => setNewCountry(code)}
                      autoFocus
                      disabled={savingCountry}
                    />
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={saveCountry} disabled={savingCountry || !newCountry} style={{padding:'0.3rem 0.6rem',fontSize:'0.7rem'}}>Save</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingCountry(false)} disabled={savingCountry} style={{padding:'0.3rem 0.6rem',fontSize:'0.7rem'}}>✕</button>
                </div>
              )}
              {displayEmail && <div className="dropdown-email">{displayEmail}</div>}
              {(() => { const xp = calculateXP(preds, results, leagues.length); const li = getLevelInfo(xp); return <div className="dropdown-xp"><Star size={13} style={{color:'var(--primary)'}} /> Level {li.level} — {li.title} <span className="dropdown-xp-num">({li.totalXP.toLocaleString()} XP)</span></div>; })()}
              {(() => { const { streak: s } = calculateStreak(preds, results); const b = getStreakBadge(s); return s > 0 ? <div className="dropdown-streak"><Flame size={13} style={{color:'var(--amber)'}} /> Streak: {s}{b && <span className={`streak-badge streak-badge-${b.tier}`}>{b.emoji} {b.name}</span>}</div> : null; })()}
            </div>
            <div className="dropdown-divider"></div>
            {/* Wallet section is intentionally quiet — collapsed by default
                so the dropdown reads as a profile menu, not a crypto app.
                The wallet stays available for the upcoming sweepstakes /
                prize features but doesn't dominate the chrome today. */}
            <button
              type="button"
              className={`dropdown-wallet-toggle ${walletOpen ? 'is-open' : ''}`}
              onClick={(e) => { e.stopPropagation(); setWalletOpen(v => !v); }}
              aria-expanded={walletOpen}
            >
              <Wallet size={14} />
              <span className="dropdown-wallet-toggle-label">Wallet</span>
              {walletAddr && (
                <code className="dropdown-wallet-toggle-addr">{walletAddr.slice(0, 6)}…{walletAddr.slice(-4)}</code>
              )}
              <ChevronDown size={14} className={`dropdown-wallet-toggle-chev ${walletOpen ? 'flip' : ''}`} />
            </button>
            {walletOpen && (
              <div className="dropdown-wallet-section">
                <div className="dropdown-section-label">Network</div>
                <div className="chain-selector">
                  {CHAINS.map(c => (
                    <button key={c.id} className={`chain-option ${activeChain.id === c.id ? 'active' : ''}`} onClick={() => setActiveChain(c)}>
                      <span className="chain-dot" style={{ background: c.color }}></span>
                      <span>{c.name}</span>
                    </button>
                  ))}
                </div>
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
              </div>
            )}
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
    const { matchId, homeScore, awayScore, result, stage } = shareCard;
    let { home, away, homeFlag, awayFlag } = shareCard;

    // The match in shareCard was captured at click time. If the user hasn't
    // predicted earlier rounds yet, knockout matches store placeholders like
    // "W QF-03" / flag '🏳️'. Re-resolve using the current preds state in case
    // enough picks have been made in the meantime.
    try {
      const { resolved } = resolveBracket(preds);
      const r = matchId && resolved?.[matchId];
      if (r) { home = r.home; away = r.away; homeFlag = r.homeFlag; awayFlag = r.awayFlag; }
    } catch {}

    // If a knockout name is still a placeholder (e.g. "W QF-03", "L SF-01"),
    // fall back to a friendlier stage label so the share card doesn't expose
    // our internal bracket IDs to the audience.
    const isPlaceholder = (n) => /^[WL]\s+[A-Z]+-\d+$/i.test(n || '');
    if (isPlaceholder(home)) { home = 'TBD'; homeFlag = ''; }
    if (isPlaceholder(away)) { away = 'TBD'; awayFlag = ''; }

    const { streak } = calculateStreak(preds, results);
    const streakBadge = getStreakBadge(streak);
    const displayName = uData?.displayName || 'Player';
    const hasScore = homeScore !== '' && awayScore !== '' && homeScore != null && awayScore != null;
    const resultLabel = result === 'home' ? `${home} Win` : result === 'away' ? `${away} Win` : 'Draw';
    const bothTBD = home === 'TBD' && away === 'TBD';
    const stageLabel = stage || 'My Prediction';

    // Final match gets a tailored Winner / Runner-up framing.
    const isFinal = matchId === 'final';
    const winner = isFinal ? (result === 'home' ? home : result === 'away' ? away : null) : null;
    const runnerUp = isFinal ? (result === 'home' ? away : result === 'away' ? home : null) : null;
    const winnerFlag = isFinal ? (result === 'home' ? homeFlag : result === 'away' ? awayFlag : '') : '';
    const runnerFlag = isFinal ? (result === 'home' ? awayFlag : result === 'away' ? homeFlag : '') : '';
    const finalScore = isFinal && hasScore
      ? (result === 'home' ? `${homeScore}–${awayScore}` : result === 'away' ? `${awayScore}–${homeScore}` : `${homeScore}–${awayScore}`)
      : '';

    const shareText = isFinal && winner && runnerUp && !bothTBD
      ? `🏆 My World Cup 26 Final prediction: ${winnerFlag} ${winner} beats ${runnerFlag} ${runnerUp}${finalScore ? ` ${finalScore}` : ''}\n\nCan you beat me? goaloracle.io\n#GoalOracle #WorldCupFinal`
      : bothTBD
        ? `My ${stageLabel} pick: ${hasScore ? `${homeScore}–${awayScore}` : resultLabel}${streak > 0 ? ` | 🔥 Streak: ${streak}` : ''}\n\nCan you beat me? goaloracle.io\n#GoalOracle #WorldCup`
        : `${homeFlag} ${home} ${hasScore ? `${homeScore}–${awayScore}` : resultLabel} ${awayFlag} ${away}${streak > 0 ? ` | 🔥 Streak: ${streak}` : ''}\n\nCan you beat me? goaloracle.io\n#GoalOracle #WorldCup`;

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
            <div className="spc-label">
              {isFinal ? '🏆 World Cup 26 Final' : `My Prediction${stage ? ` · ${stage}` : ''}`}
            </div>
            {isFinal && winner && !bothTBD ? (
              <div className="spc-final-stack">
                <div className="spc-final-row spc-final-winner">
                  <span className="spc-final-role">Winner</span>
                  <div className="spc-team">{winnerFlag && <span className="spc-flag">{winnerFlag}</span>}<span>{winner}</span></div>
                </div>
                <div className="spc-final-row spc-final-runner">
                  <span className="spc-final-role">Runner-up</span>
                  <div className="spc-team">{runnerFlag && <span className="spc-flag">{runnerFlag}</span>}<span>{runnerUp}</span></div>
                </div>
                {hasScore && <div className="spc-final-score">{finalScore}</div>}
              </div>
            ) : bothTBD ? (
              <div className="spc-match-row spc-match-tbd">
                {hasScore ? (
                  <div className="spc-score">{homeScore} – {awayScore}</div>
                ) : (
                  <div className="spc-result-tag">{resultLabel}</div>
                )}
              </div>
            ) : (
              <div className="spc-match-row">
                <div className="spc-team">{homeFlag && <span className="spc-flag">{homeFlag}</span>}<span>{home}</span></div>
                {hasScore ? (
                  <div className="spc-score">{homeScore} – {awayScore}</div>
                ) : (
                  <div className="spc-result-tag">{resultLabel}</div>
                )}
                <div className="spc-team"><span>{away}</span>{awayFlag && <span className="spc-flag">{awayFlag}</span>}</div>
              </div>
            )}
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
    const [country, setCountry] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);
    const email = uData?.email || '';
    const emailPrefix = email?.split('@')[0] || '';

    // Pre-fill the country dropdown with the user's IP-detected country so
    // they usually only need to confirm, not hunt through a 160-row list.
    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const { detectCountryByIP } = await import('./utils/countries');
          const detected = await detectCountryByIP();
          if (!cancelled && detected && !country) setCountry(detected);
        } catch {}
      })();
      return () => { cancelled = true; };
    }, []);

    const saveBoth = async (chosenName) => {
      const trimmed = chosenName.trim();
      const validErr = validateUsername(trimmed);
      if (validErr) { setErr(validErr); return; }
      if (!country) { setErr('Please select your home country.'); return; }
      setBusy(true); setErr('');
      try {
        // Manual override: if the entered name matches one of the product
        // directives for legacy test users, honor the override instead of
        // their picker choice. Keeps Sumit → BD / lebida2352 → PK stable
        // even if the account is recreated via the sign-up flow.
        const OVERRIDES = { 'lebida2352': 'PK', 'Sumit': 'BD' };
        const finalCountry = OVERRIDES[trimmed] || country;
        const updated = await updateUserProfile(uData.id, { displayName: trimmed, usernameSet: true, country: finalCountry });
        if (updated) setUData(updated);
        setShowUsernamePrompt(false);
        // Email prompt is deferred — we mark it pending and surface it
        // later, after the user has placed their first pick. Stacking
        // it on top of the username prompt was modal whiplash.
        if (updated && !updated.email && !updated.emailSkipped) setPendingEmailPrompt(true);
        notify(`Welcome, ${trimmed}!`);
        // New users go straight to the Quick Picks wizard. They've just
        // spent time picking a username and country — don't make them
        // click through a dashboard before placing their first pick.
        const globalSimple = leagues.find(l => l.id === 'global-simple')
          || allLeagues.find(l => l.id === 'global-simple')
          || { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true };
        nav('detail', globalSimple, { tab: 'predictions' });
      } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };

    const handleSubmit = (chosenName) => saveBoth(chosenName);
    const handleUseEmail = () => { if (emailPrefix) saveBoth(emailPrefix); };

    // Lazy-load the countries list so the first-paint bundle stays small.
    const [countries, setCountries] = useState([]);
    useEffect(() => {
      import('./utils/countries').then(mod => setCountries(mod.default || []));
    }, []);

    return (
      <div className="modal-overlay" style={{zIndex: 2000}}>
        <div className="username-modal">
          <div className="username-modal-icon">👋</div>
          <h2 className="username-modal-title">Welcome to GoalOracle</h2>
          <p className="username-modal-desc">Pick a username and your home country — both show up on the leaderboard.</p>

          <div className="username-input-wrap">
            <User size={16} className="username-input-icon" />
            <input
              type="text" value={username}
              onChange={e => { setUsername(e.target.value); setErr(''); }}
              onKeyDown={e => e.key === 'Enter' && username.trim() && country && handleSubmit(username)}
              className="username-input" placeholder="e.g., GoalKing99"
              maxLength={20} autoFocus
            />
          </div>
          <div className="username-rules">3–20 characters · Letters, numbers, _ . - only</div>

          <div className="username-country-wrap">
            <label className="username-country-label" htmlFor="home-country">Home country</label>
            <CountryPicker
              id="home-country"
              value={country}
              countries={countries}
              onChange={(code) => { setCountry(code); setErr(''); }}
            />
          </div>

          {err && <div className="username-error"><AlertTriangle size={14} /> {err}</div>}

          <button type="button" className="btn btn-primary btn-lg username-submit" onClick={() => handleSubmit(username)} disabled={busy || !username.trim() || !country}>
            {busy ? <><RefreshCw size={16} className="spin" /> Setting up...</> : <>Set Username <ChevronRight size={16} /></>}
          </button>

          {emailPrefix && (
            <div className="username-divider"><span>or</span></div>
          )}
          {emailPrefix && (
            <button type="button" className="btn btn-secondary username-email-btn" onClick={handleUseEmail} disabled={busy || !country}>
              Use <strong>{emailPrefix}</strong> as my username
            </button>
          )}
        </div>
      </div>
    );
  };

  // ================================
  // EMAIL PROMPT (shown once to wallet-only users — we need an email so we
  // can send match reminders + result notifications)
  // ================================
  const EmailPrompt = () => {
    const [email, setEmail] = useState('');
    const [err, setErr] = useState('');
    const [busy, setBusy] = useState(false);

    const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

    const handleSave = async () => {
      const trimmed = email.trim();
      if (!validEmail(trimmed)) { setErr('Please enter a valid email address.'); return; }
      setBusy(true); setErr('');
      try {
        const updated = await updateUserProfile(uData.id, { email: trimmed });
        if (updated) setUData(updated);
        setShowEmailPrompt(false);
        notify('Email saved — we\'ll send you match reminders.');
      } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };

    const handleSkip = async () => {
      setBusy(true); setErr('');
      try {
        const updated = await updateUserProfile(uData.id, { emailSkipped: true });
        if (updated) setUData(updated);
        setShowEmailPrompt(false);
      } catch(e) { setErr(e.message); } finally { setBusy(false); }
    };

    return (
      <div className="modal-overlay" style={{zIndex: 2000}}>
        <div className="username-modal">
          <div className="username-modal-icon">✉️</div>
          <h2 className="username-modal-title">Add your email</h2>
          <p className="username-modal-desc">We&rsquo;ll only use it to send match reminders before kickoff and result notifications after. No spam — you can unsubscribe anytime.</p>

          <div className="username-input-wrap">
            <input
              type="email" value={email}
              onChange={e => { setEmail(e.target.value); setErr(''); }}
              onKeyDown={e => e.key === 'Enter' && handleSave()}
              className="username-input" placeholder="you@example.com"
              maxLength={120} autoFocus
            />
          </div>
          {err && <div className="username-error"><AlertTriangle size={14} /> {err}</div>}

          <button type="button" className="btn btn-primary btn-lg username-submit" onClick={handleSave} disabled={busy || !email.trim()}>
            {busy ? <><RefreshCw size={16} className="spin" /> Saving...</> : <>Save email <ChevronRight size={16} /></>}
          </button>

          <button type="button" className="btn btn-ghost username-email-btn" onClick={handleSkip} disabled={busy}>
            Skip for now
          </button>
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

  const WorldCupCountdown = () => {
    // Kick-off of the opening match (Mexico vs South Africa): 11 June 2026, 15:00 ET.
    // ET (EDT) during June = UTC−4, so 15:00 ET = 19:00 UTC.
    const KICKOFF_MS = Date.UTC(2026, 5, 11, 19, 0, 0);
    const compute = () => {
      const diff = KICKOFF_MS - Date.now();
      if (diff <= 0) return null;
      const days = Math.floor(diff / 86400000);
      const hours = Math.floor((diff % 86400000) / 3600000);
      const minutes = Math.floor((diff % 3600000) / 60000);
      return { days, hours, minutes };
    };
    const [t, setT] = useState(compute);
    useEffect(() => {
      const id = setInterval(() => setT(compute()), 30000);
      return () => clearInterval(id);
    }, []);
    if (!t) return null;
    return (
      <div className="wc-countdown-wrap">
        <div className="wc-countdown" role="status" aria-live="polite">
          <span className="wc-countdown-pulse" aria-hidden="true" />
          <span className="wc-countdown-label">World Cup kicks off in</span>
          <span className="wc-countdown-value">
            <strong>{t.days}</strong>d <strong>{t.hours}</strong>h <strong>{t.minutes}</strong>m
          </span>
        </div>
      </div>
    );
  };

  const Nav = () => (
    <nav className="navbar"><div className="nav-container">
      <div className="nav-brand" onClick={() => nav('landing')}><GoalOracleLogo size={26} /><span className="gt">GoalOracle</span></div>
      <button type="button" className="mobile-toggle" onClick={e => { e.stopPropagation(); setMenuOpen(!menuOpen); }}>{menuOpen ? <X size={24} /> : <Menu size={24} />}</button>
      <div className={`nav-menu ${menuOpen ? 'active' : ''}`} onClick={e => e.stopPropagation()}>
        <a className="nav-link" onClick={() => nav('landing')}><Home size={14} /><span>Home</span></a>
        <a className="nav-link" onClick={() => {
          const simpleLeague = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global Quick Picks', type: 'free', predictionMode: 'simple', isGlobal: true };
          nav('detail', simpleLeague);
          setDetailTab('leaderboard');
        }}><TrendingUp size={14} /><span>Leaderboard</span></a>
        {authenticated && <>
          <a className="nav-link" onClick={() => nav('dashboard')}><Trophy size={14} /><span>Dashboard</span></a>
          <a className="nav-link" onClick={() => nav('leagues')}><Users size={14} /><span>My Leagues</span></a>
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
            {(() => {
              const themes = { light: { icon: <Sun size={14} />, label: 'Light' }, dark: { icon: <Moon size={14} />, label: 'Dark' } };
              const nextId = theme === 'dark' ? 'light' : 'dark';
              const cur = themes[theme] || themes.light;
              const nxt = themes[nextId];
              return (
                <button type="button" className="theme-opt theme-cycle active" title={`Theme: ${cur.label} — click for ${nxt.label}`} aria-label={`Theme: ${cur.label}. Click to switch to ${nxt.label}`} onClick={cycleTheme}>
                  {cur.icon}
                </button>
              );
            })()}
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
      <ViewMeta view={view} />

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
          authenticated={authenticated}
          onSignIn={login}
          onBack={() => nav(authenticated ? 'leagues' : 'landing')}
          onSetUsername={() => setShowUsernamePrompt(true)}
          notify={notify}
          onBrowseLeagues={() => nav('browse')}
          onCreateLeague={() => nav('create')}
          onOpenClassic={() => {
            const classic = leagues.find((l) => l.id === 'global') || allLeagues.find((l) => l.id === 'global') || { id: 'global', name: 'Global League', type: 'free', predictionMode: 'classic', isGlobal: true, pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 } };
            setDetailTab('predictions');
            nav('detail', classic);
          }}
          initialTab={detailTab === 'predictions' ? 'predictions' : 'leaderboard'}
          myLeagues={leagues}
          lbScope={lbScope}
          lbScopeCountry={lbScopeCountry}
          setLbScope={setLbScope}
          setLbScopeCountry={setLbScopeCountry}
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
      {view === 'publicBracket' && (
        <PublicBracket
          userId={publicBracketUserId}
          onSignUp={() => {
            if (authenticated) { nav('dashboard'); }
            else { login(); }
          }}
        />
      )}
      {view === 'feedback' && <Feedback key="feedback" />}
      {view === 'admin' && (role === 'superadmin' || role === 'admin') && <AdminDashboard userData={uData} platformStats={stats} matchResults={results} allLeagues={allLeagues} notify={notify} />}
      {fundModal && <AddFundsModal />}
      {sendModal && <SendModal />}
      {showUsernamePrompt && authenticated && uData && <UsernamePrompt />}
      {showEmailPrompt && !showUsernamePrompt && authenticated && uData && <EmailPrompt />}
      <ShareCardModal />
      {/* Live Standings drawer — rendered at App root so it survives Detail's
          re-mount cycle (every preds update re-creates the Detail function,
          which would otherwise destroy the drawer's DOM and reset its scroll
          position). Toggle is visible only on Classic leagues' predictions
          tab; drawer can always render (hidden off-canvas when closed). */}
      {view === 'detail' && selLeague?.predictionMode !== 'simple' && detailTab === 'predictions' && (
        <LiveStandingsToggle
          open={standingsOpen}
          onToggle={() => setStandingsOpen(v => !v)}
          count={Object.values(preds).filter(p => p?.result).length}
        />
      )}
      <LiveStandingsDrawer
        open={standingsOpen && view === 'detail' && selLeague?.predictionMode !== 'simple'}
        onClose={() => setStandingsOpen(false)}
        predictions={preds}
      />
    </div>
  );
};

export default GoalOracle;