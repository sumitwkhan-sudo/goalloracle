import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Helmet } from 'react-helmet-async';
import { onAuthStateChanged } from 'firebase/auth';
import { auth as fbAuth } from './config/firebase';
import { signOut as authSignOut, isAuthSwapInFlight, completeGoogleRedirectIfNeeded } from './utils/auth';
import LoginScreen from './components/auth/LoginScreen';
import { track } from './utils/track';
import { Trophy, Users, Coins, Shield, ChevronRight, Menu, X, Globe, Zap, TrendingUp, Award, Lock, Unlock, LogOut, Plus, Search, CheckCircle, Clock, Target, Save, Eye, EyeOff, RefreshCw, UserPlus, AlertTriangle, Copy, Wallet, ChevronDown, User, ArrowRightLeft, ExternalLink, Loader, Moon, Sun, Trash2, Share2, Key, Home, HelpCircle, Sparkles, MessageSquare, Send, LayoutGrid, List, Flame, Star, MapPin, Calendar, RotateCcw, Pencil } from 'lucide-react';
import WORLD_CUP_MATCHES from './data/matches';
import { getCode } from './utils/countryCodes';
import { getPedigree } from './utils/pedigree';
import { teamFlags } from './utils/flags';
import { getRank as getFifaRank } from './data/fifaRankings';
import { calculateSimpleScore, TOTAL_MAX, GROUP_STAGE_MAX, BEST_THIRD_MAX, KNOCKOUT_MAX } from './utils/scoringSimple';
import { calculatePoints, calculateTotalPoints, sortLeaderboard, getMatchStatus, calculateStreak, getStreakBadge } from './utils/points';
import { computeRankDeltas } from './utils/rankChange';
import { calculateXP, getLevelInfo } from './utils/xp';
import TEAM_COLORS from './data/teamColors';
import { resolveBracket, calcGroupStandings, rankThirdPlaced, groupPredictionsComplete } from './utils/bracket';
import { createOrUpdateUser, updateUserProfile, getUserRole, createLeague, joinLeague, deleteLeague, leaveLeague, subscribeToUserLeagues, fetchAllLeagues, saveBatchPredictions, subscribeToUserPredictions, subscribeToMatchResults, fetchPlatformStats, getLeagueLeaderboard, getSimpleLeaderboard, getSimpleConsensus, copyPredictions, copySimplePrediction, resetClassicPredictions, setAuthToken, resetFirebaseAuth, submitFeedback, captureReferralFromUrl, consumePendingJoin, fetchFeatureFlags, subscribeToFeatureFlags, DEFAULT_FEATURE_FLAGS } from './utils/db';
import { validateUsername } from './utils/profanity';
import { getWalletBalances, formatBalance } from './utils/wallet';
import AdminDashboard from './components/AdminDashboard';
import Dashboard from './components/Dashboard';
import AnimatedCounter from './components/AnimatedCounter';
import LeagueLeaderboardLayout from './components/LeagueLeaderboardLayout';
import LeagueListRow from './components/LeagueListRow';
import SimplePrediction from './pages/SimplePrediction';
import BracketShareModal from './components/BracketShareModal';
import InviteFriendsModal from './components/InviteFriendsModal';
import PasscodePromptModal from './components/PasscodePromptModal';
import WelcomeFlow from './components/onboarding/WelcomeFlow';
import HeroLeaderboardPreview from './components/HeroLeaderboardPreview';
import MyPicksCard from './components/MyPicksCard';
import HomeHeroCard from './components/HomeHeroCard';
import QuickActionsTiles from './components/QuickActionsTiles';
import CreateLeagueForm from './components/CreateLeagueForm';
import LiveStandingsDrawer, { LiveStandingsToggle } from './components/LiveStandingsDrawer';
import PublicBracket from './components/PublicBracket';
import NewsTicker from './components/NewsTicker';
import BracketDesktop from './components/simple/BracketDesktop';
import BracketMobile from './components/simple/BracketMobile';
import useBracketState from './hooks/useBracketState';
import useBracketLayout from './hooks/useBracketLayout';
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
  simplePredict: { title: 'Predictions — GoalOracle', path: '/quick-picks', index: false },
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
function PicksViewer({ target, onClose, onEdit, onShare, isOwn = false }) {
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
    <PicksViewerBody
      target={target}
      onClose={onClose}
      data={data}
      loading={loading}
      err={err}
      thirdPlace={thirdPlace}
      groupsLocal={GROUPS_LOCAL}
      roundOrder={roundOrder}
      roundLabel={roundLabel}
      onEdit={onEdit}
      onShare={onShare}
      isOwn={isOwn}
    />
  );
}

// Tabbed body for Quick Picks predictions: a Group stage tab (12 group
// rankings + best-thirds) and a Knockout bracket tab that re-uses the
// real BracketDesktop / BracketMobile in read-only mode so other users'
// brackets render with the same branch-style tree the owner sees while
// editing. Extracted into its own component so we can use hooks
// (useBracketState, useBracketLayout) that the outer PicksViewer can't
// call before the early classic-mode return.
function PicksViewerBody({ target, onClose, data, loading, err, thirdPlace, groupsLocal, roundOrder, roundLabel, onEdit, onShare, isOwn }) {
  const [tab, setTab] = useState('groups');
  const layout = useBracketLayout();

  // Pick completeness — computed from the prediction doc itself, so this
  // works pre-tournament without any results data. Post-kickoff we'll
  // also surface running scores in the same card via calculateSimpleScore.
  const completeness = useMemo(() => {
    const groupsRanked = groupsLocal.filter(
      (g) => Array.isArray(data?.groupPredictions?.[g]?.ranking) && data.groupPredictions[g].ranking.filter(Boolean).length === 4,
    ).length;
    const thirdsPicked = Array.isArray(data?.bestThirdPicks) ? data.bestThirdPicks.length : 0;
    let knockoutPicks = 0;
    for (const r of roundOrder) {
      const arr = data?.knockoutPredictions?.[r] || [];
      knockoutPicks += arr.filter((p) => p?.winnerId).length;
    }
    const total = groupsRanked + thirdsPicked + knockoutPicks; // out of 52
    return { groupsRanked, thirdsPicked, knockoutPicks, total, max: 52 };
  }, [data, groupsLocal, roundOrder]);

  // Days until tournament kickoff. Stays positive pre-tournament, hits 0
  // on/after kickoff at which point the card flips into live-scoring mode.
  const daysToKickoff = useMemo(() => {
    const ms = Date.UTC(2026, 5, 11, 19, 0, 0) - Date.now();
    return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
  }, []);
  const tournamentStarted = daysToKickoff === 0;

  const matchLookup = useMemo(() => {
    const out = {};
    for (const m of WORLD_CUP_MATCHES) out[m.id] = m;
    return out;
  }, []);

  // Compute the bracket structure from the viewed user's stored picks
  // using the same hook the owner uses while editing — all the
  // round-of-32 seed math + best-third routing happens for free. We
  // pass a no-op onChange because we'll only read bracketState.bracket.
  const bracketState = useBracketState({
    groupPredictions: data?.groupPredictions,
    bestThirdPicks: data?.bestThirdPicks,
    knockoutPredictions: data?.knockoutPredictions,
    onChange: () => {},
  });

  const hasGroups = groupsLocal.some((g) => (data?.groupPredictions?.[g]?.ranking || []).length > 0);
  const hasKnockout = roundOrder.some((r) => (data?.knockoutPredictions?.[r] || []).length > 0);

  return (
    <div className="picks-viewer-backdrop" onClick={onClose}>
      <div className="picks-viewer-modal" onClick={(e) => e.stopPropagation()}>
        <div className="picks-viewer-header">
          <div className="picks-viewer-title">
            <div className="picks-viewer-avatar">{target.displayName?.[0]?.toUpperCase() || '?'}</div>
            <div>
              <h3>{isOwn ? 'Your bracket' : `${target.displayName}'s picks`}</h3>
              <span className="picks-viewer-sub">{target.leagueName || 'Bracket'}</span>
            </div>
          </div>
          <div className="picks-viewer-actions">
            {isOwn && onEdit && (
              <button type="button" className="picks-viewer-action" onClick={onEdit} title="Edit your picks">
                <Pencil size={14} aria-hidden="true" /> Edit
              </button>
            )}
            {isOwn && onShare && (
              <button type="button" className="picks-viewer-action picks-viewer-action-primary" onClick={onShare} title="Share your bracket">
                <Share2 size={14} aria-hidden="true" /> Share
              </button>
            )}
            <button type="button" className="picks-viewer-close" onClick={onClose} aria-label="Close"><X size={20} /></button>
          </div>
        </div>

        {loading ? (
          <div className="loading-state"><RefreshCw size={24} className="spin" /> Loading picks...</div>
        ) : err ? (
          <div className="empty-state"><AlertTriangle size={20} /><p>{err}</p></div>
        ) : !data ? (
          <div className="empty-state"><p>This user hasn&rsquo;t saved any predictions yet.</p></div>
        ) : (
          <div className="picks-viewer-body">
            {/* Champion / runner-up / 3rd place podium kept above the
                tabs — that's the headline summary. Tabs swap below.
                Own-bracket views skip the pre-fetched target.winner /
                runnerUp (which the leaderboard supplies) and derive
                directly from the loaded prediction doc instead. */}
            {(() => {
              const finalSlot = data?.knockoutPredictions?.final?.[0];
              const winner = target.winner || finalSlot?.winnerId || null;
              const runnerUp = target.runnerUp || finalSlot?.loserId || null;
              return (
                <div className="picks-viewer-finalists">
                  <div className="picks-viewer-podium">
                    <div className="podium-slot podium-winner">
                      <Trophy size={20} className="gold" />
                      <span className="podium-label">Champion</span>
                      <span className="podium-team">
                        {winner ? <>{_teamFlags[winner] || ''} {winner}</> : <span className="podium-empty">—</span>}
                      </span>
                    </div>
                    <div className="podium-slot podium-runner">
                      <Award size={18} className="silver" />
                      <span className="podium-label">Runner-up</span>
                      <span className="podium-team">
                        {runnerUp ? <>{_teamFlags[runnerUp] || ''} {runnerUp}</> : <span className="podium-empty">—</span>}
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
              );
            })()}

            {/* Progress card — shows pick completeness always, and either
                a kickoff countdown (pre-tournament) or live-scoring
                breakdown (post-tournament). Always visible above the
                tabs so the headline answer to "how am I doing?" is the
                first thing the viewer sees. */}
            <section className="pv-progress" aria-labelledby="pv-progress-heading">
              <header className="pv-progress-head">
                <h4 id="pv-progress-heading" className="pv-progress-title">
                  {tournamentStarted ? 'Live scoring' : 'Picks & progress'}
                </h4>
                <span className="pv-progress-eyebrow">
                  {tournamentStarted
                    ? `Tournament live`
                    : `Kicks off in ${daysToKickoff} day${daysToKickoff === 1 ? '' : 's'}`}
                </span>
              </header>
              <div className="pv-progress-stats">
                <div className="pv-progress-stat">
                  <span className="pv-progress-stat-label">Groups ranked</span>
                  <span className="pv-progress-stat-value">{completeness.groupsRanked}<span className="pv-progress-stat-of"> / 12</span></span>
                </div>
                <div className="pv-progress-stat">
                  <span className="pv-progress-stat-label">Best 3rds picked</span>
                  <span className="pv-progress-stat-value">{completeness.thirdsPicked}<span className="pv-progress-stat-of"> / 8</span></span>
                </div>
                <div className="pv-progress-stat">
                  <span className="pv-progress-stat-label">Bracket picks</span>
                  <span className="pv-progress-stat-value">{completeness.knockoutPicks}<span className="pv-progress-stat-of"> / 32</span></span>
                </div>
                <div className="pv-progress-stat pv-progress-stat-total">
                  <span className="pv-progress-stat-label">Picks complete</span>
                  <span className="pv-progress-stat-value">{completeness.total}<span className="pv-progress-stat-of"> / {completeness.max}</span></span>
                </div>
              </div>
              <div className="pv-progress-bar" aria-hidden="true">
                <div
                  className="pv-progress-bar-fill"
                  style={{ width: `${Math.min(100, Math.round((completeness.total / completeness.max) * 100))}%` }}
                />
              </div>
              <p className="pv-progress-note">
                {tournamentStarted
                  ? <>Live score updates as matches finish. Max possible: <strong>{TOTAL_MAX} pts</strong> ({GROUP_STAGE_MAX} groups · {BEST_THIRD_MAX} thirds · {KNOCKOUT_MAX} bracket).</>
                  : <>Live scoring opens at kickoff. Until then, lock in your picks — max possible is <strong>{TOTAL_MAX} pts</strong>.</>}
              </p>
            </section>

            <div className="pv-tabs" role="tablist" aria-label="Picks view">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'groups'}
                className={`pv-tab ${tab === 'groups' ? 'active' : ''}`}
                onClick={() => setTab('groups')}
              >
                <Users size={13} /> Group stage
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'bracket'}
                className={`pv-tab ${tab === 'bracket' ? 'active' : ''}`}
                onClick={() => setTab('bracket')}
              >
                <Trophy size={13} /> Knockout bracket
              </button>
            </div>

            {tab === 'groups' && (
              <>
                <div className="picks-viewer-section">
                  <h4 className="picks-viewer-h">Group stage rankings</h4>
                  <div className="picks-viewer-groups">
                    {groupsLocal.map(g => {
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
                    {!hasGroups && (
                      <span className="picks-viewer-muted">No group rankings submitted yet.</span>
                    )}
                  </div>
                </div>

                <div className="picks-viewer-section">
                  <h4 className="picks-viewer-h">Best 3rd-place picks</h4>
                  {(data.bestThirdPicks || []).length > 0 ? (
                    <div className="picks-viewer-chips">
                      {data.bestThirdPicks.map(g => {
                        const team = data.groupPredictions?.[g]?.ranking?.[2] || null;
                        const flag = team ? teamFlags[team] : '';
                        return (
                          <span key={g} className="pv-chip pv-chip-third">
                            <span className="pv-chip-group">{g}</span>
                            {team ? (
                              <>
                                <span className="pv-chip-flag" aria-hidden="true">{flag}</span>
                                <span className="pv-chip-team">{team}</span>
                              </>
                            ) : (
                              <span className="pv-chip-team pv-chip-team-empty">— rank Group {g} to see</span>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  ) : <span className="picks-viewer-muted">Not selected yet.</span>}
                </div>
              </>
            )}

            {tab === 'bracket' && (
              <div className="picks-viewer-section pv-bracket-section">
                {!hasKnockout ? (
                  <span className="picks-viewer-muted">No knockout picks yet.</span>
                ) : layout === 'desktop' ? (
                  <BracketDesktop
                    bracket={bracketState.bracket}
                    pickWinner={() => {}}
                    isMatchLocked={() => false}
                    matchLookup={matchLookup}
                    readOnly
                  />
                ) : (
                  <BracketMobile
                    bracket={bracketState.bracket}
                    pickWinner={() => {}}
                    isRoundComplete={bracketState.isRoundComplete}
                    isRoundUnlocked={bracketState.isRoundUnlocked}
                    isMatchLocked={() => false}
                    matchLookup={matchLookup}
                    readOnly
                  />
                )}
              </div>
            )}
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
  const sourceLabel = isSimple ? 'Global League' : 'Global Classic Predictions';

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
              <span className="picks-viewer-sub">{isSimple ? 'Bracket' : 'Classic Predictions'} league</span>
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

const SimpleDetail = React.memo(function SimpleDetail({ league, userData, onBack, onSetUsername, authenticated = true, onSignIn, onOpenClassic, initialTab = 'leaderboard', notify, myLeagues = [], lbScope = 'all', lbScopeCountry = '', setLbScope = () => {}, setLbScopeCountry = () => {}, onBrowseLeagues, onCreateLeague, onLeaveLeague }) {
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
  // Crowd consensus for the active league. Used in two places:
  //  1. The share-modal caption (rarity), lazy-fetched on open.
  //  2. The leaderboard table's per-row "uniqueness" chip — fetched
  //     eagerly when the leaderboard tab is active so every row can
  //     show how rare its champion+runner-up pair is.
  const [shareConsensus, setShareConsensus] = useState(null);
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

  // Quick share: copies (or invokes navigator.share for) a link to the
  // user's public bracket page (`/u/:id/bracket`). Used by the
  // PicksViewer modal "Share" button on own-bracket views — the public
  // page works without login and already CTAs new visitors to predict.
  const sharePublicBracketLink = useCallback(async () => {
    const id = userData?.id;
    if (!id) return;
    const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://goaloracle.io';
    const url = `${origin}/u/${encodeURIComponent(id)}/bracket?ref=${encodeURIComponent(id)}`;
    const text = `Check out my World Cup 2026 bracket on GoalOracle: ${url}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'My GoalOracle bracket', text, url });
      } else {
        await navigator.clipboard.writeText(url);
        notify?.('Bracket link copied — share it with friends');
      }
    } catch { /* user cancelled native share */ }
  }, [userData?.id, notify]);

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
      // Fire-and-forget: pull crowd consensus for the league so the
      // share modal can report bracket rarity in the caption.
      getSimpleConsensus(league.id)
        .then((c) => setShareConsensus(c))
        .catch(() => { /* non-fatal — caption still ships without rarity */ });
    } catch (e) {
      if (notify) notify(e?.message || 'Failed to load bracket', 'error');
    }
  }, [userData?.id, league?.id, notify]);

  // Eagerly fetch consensus when the leaderboard is active so each
  // row can show its uniqueness chip without waiting for a hover.
  // Cached per-league inside getSimpleConsensus, so revisits are cheap.
  useEffect(() => {
    if (sTab !== 'leaderboard' || lbMode !== 'simple' || !league?.id) return;
    if (shareConsensus) return; // already loaded
    let cancelled = false;
    getSimpleConsensus(league.id)
      .then((c) => { if (!cancelled) setShareConsensus(c); })
      .catch(() => { /* non-fatal — uniqueness chips just don't appear */ });
    return () => { cancelled = true; };
  }, [sTab, lbMode, league?.id, shareConsensus]);

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
          {/* Named back button — destination matches what onBack does
              ("Leagues" when authenticated, "Home" otherwise) so the
              user always knows where the tap takes them. The page
              title + member count + mode pill used to live here too,
              but they duplicated the LeagueLeaderboardLayout header
              right below — kept just the back button + leave action. */}
          <button className="btn-back-sm btn-back-sm-named" onClick={onBack}>
            &larr; <span>{authenticated ? 'Back to My Leagues' : 'Home'}</span>
          </button>
        </div>
        {/* Leave button is page-level so it's reachable from any
            sTab (Predictions, Leaderboard, etc.) — the user asked
            for the option to leave from the prediction flow as well
            as the leaderboard. Hidden on global leagues since you
            can't leave Global Quick Picks. */}
        {!isGlobalView && onLeaveLeague && (
          <button
            type="button"
            className="phc-leave"
            onClick={onLeaveLeague}
            title="Leave this league"
          >
            <LogOut size={13} aria-hidden="true" /> Leave League
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
          {/* Breadcrumb-style label — the page-header back already
              returns up the stack; a second "Back to leaderboard"
              affordance here was duplicate nav. */}
          <span className="predict-inline-crumb"><Target size={13} /> Predictions</span>
        </div>
      )}

      {sTab === 'leaderboard' && (() => {
        const isGlobal = league?.id === 'global-simple' || league?.id === 'global' || league?.isGlobal === true;
        const isPrivate = league?.visibility === 'private';
        // Build a single invite URL the recipient can click. For non-global
        // leagues we tack on `?join=LEAGUE_ID` so the auto-join effect picks
        // it up after sign-up (or immediately if already signed in). Private
        // leagues bake the passcode into the URL — that's already the
        // passcode's purpose: gate joining for whoever has it.
        const handleInvite = async () => {
          const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://goaloracle.io';
          const params = new URLSearchParams();
          if (userData?.id) params.set('ref', userData.id);
          if (!isGlobal && league?.id) {
            params.set('join', league.id);
            if (isPrivate && league?.passcode) params.set('p', league.passcode);
          }
          const url = `${origin}/?${params.toString()}`;
          try {
            await navigator.clipboard.writeText(url);
            if (notify) {
              if (isGlobal) notify('Invite link copied');
              else if (isPrivate && league?.passcode) notify('Invite link copied — joins automatically when opened');
              else notify('Invite link copied — joins automatically when opened');
            }
          } catch {
            if (notify) notify('Could not copy invite', 'error');
          }
        };
        const rows = visibleSimLb.map(e => {
          // Uniqueness = P(champion) * P(runner-up). Lower means
          // fewer players picked the same pair — i.e. rarer.
          let uniqueness;
          if (shareConsensus && e.winner && e.runnerUp) {
            const cw = shareConsensus.champion?.[e.winner];
            const cr = shareConsensus.runnerUp?.[e.runnerUp];
            if (typeof cw === 'number' && typeof cr === 'number') uniqueness = cw * cr;
          }
          // Upset signal: FIFA rank > 16 = outside the conventional
          // top tier. Picking such a team to make the final reads as
          // bold (one upset). Both outside top 16 = very bold (two).
          // Full bracket-level upsets would need the picks doc — this
          // is the lightweight signal computable from leaderboard data.
          let upsetCount = 0;
          const wRank = e.winner ? getFifaRank(e.winner) : null;
          const rRank = e.runnerUp ? getFifaRank(e.runnerUp) : null;
          if (wRank && wRank > 16) upsetCount += 1;
          if (rRank && rRank > 16) upsetCount += 1;
          return { ...e, delta: simDeltas[e.userId], uniqueness, upsetCount };
        });
        return (
          <LeagueLeaderboardLayout
            league={league}
            rows={rows}
            currentUserId={userData?.id}
            scope={lbScope}
            onScopeChange={setLbScope}
            countryFilter={lbScopeCountry}
            onCountryFilterChange={setLbScopeCountry}
            countriesList={countriesList}
            friendIds={friendIds}
            onRowClick={(row) => {
              const isMine = row.userId === userData?.id;
              if (isMine) {
                // Default to the read-only viewer (with progress card)
                // for own row when picks are complete. Only drop into
                // the prediction wizard if there's still work to do.
                const finished = row.isComplete === true || row.picksLeft === 0;
                if (!finished) { setSTab('predictions'); return; }
              }
              setViewingPicks({ userId: row.userId, displayName: row.displayName, winner: row.winner, runnerUp: row.runnerUp, leagueId: league?.id || 'global-simple' });
            }}
            onEdit={() => setSTab('predictions')}
            onInvite={handleInvite}
            onShareBracket={openShareBracket}
            onJoin={!authenticated ? onSignIn : undefined}
            loading={simLbl}
          />
        );
      })()}

      {viewingPicks && (
        <PicksViewer
          target={viewingPicks}
          isOwn={viewingPicks.userId === userData?.id}
          onEdit={viewingPicks.userId === userData?.id ? () => { setViewingPicks(null); setSTab('predictions'); } : undefined}
          onShare={viewingPicks.userId === userData?.id ? sharePublicBracketLink : undefined}
          onClose={() => setViewingPicks(null)}
        />
      )}

      {sTab === 'predictions' && (
        authenticated ? (
          <SimplePrediction
            key={`simple-${league?.id}`}
            userId={userData?.id}
            league={league}
            displayName={userData?.displayName}
            onExit={onBack}
            onComplete={handleComplete}
            onShareBracket={openShareBracket}
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
        rarityPct={(() => {
          if (!shareConsensus || !shareBracket?.winner?.name || !shareBracket?.runnerUp?.name) return undefined;
          const c = shareConsensus.champion?.[shareBracket.winner.name];
          const r = shareConsensus.runnerUp?.[shareBracket.runnerUp.name];
          const t = shareBracket.thirdPlace?.name
            ? shareConsensus.thirdPlace?.[shareBracket.thirdPlace.name]
            : null;
          const known = [c, r, t].filter((v) => typeof v === 'number');
          if (known.length === 0) return undefined;
          const avg = known.reduce((a, b) => a + b, 0) / known.length;
          return Math.min(99, Math.round((1 - avg) * 100));
        })()}
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


let heroAnimated = false;
const CITY_CODES = {
  'Atlanta': 'ATL', 'Boston': 'BOS', 'Dallas': 'DAL', 'Guadalajara': 'GDL',
  'Houston': 'HOU', 'Kansas City': 'KC', 'Los Angeles': 'LA', 'Mexico City': 'MEX',
  'Miami': 'MIA', 'Monterrey': 'MTY', 'New York/NJ': 'NJ', 'Philadelphia': 'PHI',
  'San Francisco': 'SF', 'Seattle': 'SEA', 'Toronto': 'TOR', 'Vancouver': 'VAN',
};
const GoalOracle = () => {
  // Firebase Auth replaces Privy. `ready` flips to true after the first
  // onAuthStateChanged callback so gating logic doesn't render before we
  // know the user's signed-in state. `authenticated` mirrors fbAuth.currentUser.
  const [ready, setReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [showLogin, setShowLogin] = useState(false);
  const login = useCallback(() => setShowLogin(true), []);
  const logout = useCallback(async () => {
    try { await authSignOut(); } catch (e) { console.warn('[auth] sign-out failed:', e.message); }
  }, []);
  const initialRouteRef = useRef(parseRoute());
  const [view, setView] = useState(initialRouteRef.current.view);
  const [pendingDeepLink, setPendingDeepLink] = useState(
    initialRouteRef.current.leagueId
      ? { leagueId: initialRouteRef.current.leagueId, targetView: initialRouteRef.current.deepLinkView }
      : null
  );
  // Public-share-page target — populated when the URL is /u/{userId}/bracket.
  const [publicBracketUserId, setPublicBracketUserId] = useState(initialRouteRef.current.publicUserId || null);
  // Admin-toggleable feature flags. Loaded once on mount + live-subscribed
  // so an admin flipping a toggle propagates to every client. Defaults
  // preserve legacy behavior so a missing settings doc doesn't hide
  // anything by accident.
  const [featureFlags, setFeatureFlags] = useState(DEFAULT_FEATURE_FLAGS);
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
  // Last non-null uData snapshot. The username-prompt modal renders off this
  // ref so a transient uData=null fire from onAuthStateChanged (which can
  // happen during token refresh / Firebase auth-state churn) doesn't unmount
  // the modal mid-onboarding. Without it the modal flashed a couple of
  // times before settling.
  const uDataStableRef = useRef(null);
  if (uData) uDataStableRef.current = uData;
  const [preds, setPreds] = useState({});
  const [results, setResults] = useState({});
  const [leagues, setLeagues] = useState([]);
  const [allLeagues, setAllLeagues] = useState([]);
  const [saving, setSaving] = useState(false);
  const [notif, setNotif] = useState(null);
  // Lifted out of LeaguesList — that component is defined inline in
  // the parent so it gets a new function identity on every render,
  // which causes React to remount it and wipe local state. Holding
  // the modal state at the parent keeps "View bracket" working.
  const [viewingOwnBracket, setViewingOwnBracket] = useState(null);
  const [stats, setStats] = useState({ totalPlayers: 0, totalPrizePools: 0, activeLeagues: 0 });
  const [showUsernamePrompt, setShowUsernamePrompt] = useState(false);
  const [shareCard, setShareCard] = useState(null); // { matchId, home, away, homeFlag, awayFlag, homeScore, awayScore, result }
  // Lifted from Detail — survives Firestore re-renders
  const [detailTab, setDetailTab] = useState('leaderboard');
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

  // Global consensus (champion / runner-up / 3rd-place distributions).
  // Used by HomeHeroCard insights to compute "crowd alignment" — how
  // many other players agree with the user's champion pick. Cached
  // per-league inside getSimpleConsensus, so this is essentially free.
  const [globalConsensus, setGlobalConsensus] = useState(null);
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;
    getSimpleConsensus('global-simple')
      .then((c) => { if (!cancelled) setGlobalConsensus(c); })
      .catch(() => { /* non-fatal — insights chip just hides */ });
    return () => { cancelled = true; };
  }, [authenticated]);

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
        // Pull champion + runner-up off the user's Final pick if they
        // got that far — landing-page MyPicksCard renders these as the
        // "your bracket" headline. Same source the share modal uses;
        // we just preserve them on the quickPicks state so the
        // landing card doesn't need a second fetch.
        const finalSlot = (ko.final || []).find((p) => p?.matchId === 'final');
        setQuickPicks({
          groupsRemaining,
          thirdsRemaining,
          bracketRemaining,
          totalRemaining,
          isComplete: totalRemaining === 0,
          winner: finalSlot?.winnerId || null,
          runnerUp: finalSlot?.loserId || null,
          // Raw knockout picks kept so HomeHeroCard insights can
          // derive "biggest upset" (lowest-ranked team picked to
          // advance furthest) without needing a second fetch.
          knockoutPredictions: ko,
        });
      } catch {
        if (!cancelled) setQuickPicks(null);
      }
    })();
    return () => { cancelled = true; };
  }, [uData?.id]);

  // Fetch per-league rank + picks-progress for every personal league.
  // Lives at App level (not inside Dashboard) so the leagues page can show
  // status pills even when the user navigates straight to /leagues without
  // first visiting the dashboard. Otherwise leagueRanks stays empty there
  // and predStatus() returns null for every row → no pills render.
  useEffect(() => {
    if (!uData?.id || leagues.length === 0) return;
    let cancelled = false;
    const DEFAULT_PS = { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 };
    (async () => {
      for (const league of leagues.slice(0, 20)) {
        if (leagueRanks[league.id] || cancelled) continue;
        try {
          if (league.predictionMode === 'simple') {
            const data = await getSimpleLeaderboard(league.id);
            const lb = data.leaderboard || [];
            const myIdx = lb.findIndex(e => e.userId === uData.id);
            const myEntry = myIdx >= 0 ? lb[myIdx] : null;
            if (!cancelled) setLeagueRanks(prev => ({
              ...prev,
              [league.id]: {
                rank: myIdx >= 0 ? myIdx + 1 : lb.length + 1,
                total: lb.length,
                myPicksLeft: typeof myEntry?.picksLeft === 'number' ? myEntry.picksLeft : null,
                myIsComplete: !!myEntry?.isComplete,
                myHasSubmitted: !!myEntry?.hasSubmitted,
              },
            }));
          } else {
            const { leaderboard: bu } = await getLeagueLeaderboard(league.id);
            const entries = Object.entries(bu).map(([uid, pr]) => ({ userId: uid, ...calculateTotalPoints(pr, results, league.pointsSystem || DEFAULT_PS) }));
            const sorted = sortLeaderboard(entries);
            const myIdx = sorted.findIndex(e => e.userId === uData.id);
            const myPreds = bu[uData.id] || {};
            const myPredCount = Object.values(myPreds).filter(p => p?.result).length;
            if (!cancelled) setLeagueRanks(prev => ({ ...prev, [league.id]: { rank: myIdx + 1, total: sorted.length, leaderPts: sorted[0]?.totalPoints || 0, myPts: sorted[myIdx]?.totalPoints || 0, myPredCount } }));
          }
        } catch {}
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uData?.id, leagues.length, results]);

  const notify = useCallback((msg, type = 'success') => { setNotif({ msg, type }); setTimeout(() => setNotif(null), 3000); }, []);
  const loadAllLeagues = useCallback(() => { fetchAllLeagues().then(setAllLeagues).catch(() => {}); }, []);
  const nav = useCallback((v, l, opts = {}) => {
    // Default tab when entering a league detail is the leaderboard —
    // most clicks "into a league" want to see standings first. Call
    // sites that specifically want the prediction wizard pass
    // { tab: 'predictions' } explicitly (continue / needs-prediction
    // CTAs do this).
    if (l) { setSelLeague(l); setDetailTab(opts.tab || 'leaderboard'); setDetailWeek('week1'); setDetailStage('all'); }
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

  // Warm the IP-country cache as soon as the app boots so the username
  // prompt's country picker has a value ready on first paint instead of
  // flashing empty while the lookup resolves. Result is memoised + cached
  // in localStorage by detectCountryByIP.
  useEffect(() => {
    import('./utils/countries').then(({ detectCountryByIP }) => detectCountryByIP()).catch(() => {});
  }, []);

  // Mobile Google sign-in uses signInWithRedirect (popups are unreliable on
  // mobile + in-app browsers). When the user comes back from the Google
  // consent screen this finishes the UID swap and signs them in with the
  // canonical custom token. No-op on every other mount.
  useEffect(() => {
    completeGoogleRedirectIfNeeded().catch(e => {
      console.error('[auth] Google redirect completion failed:', e?.message || e);
      notify(e?.message || 'Google sign-in failed', 'error');
    });
    // notify is stable via useCallback; safe to omit from deps and run once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-join via invite link. captureReferralFromUrl() stashes the league
  // ID + optional passcode in sessionStorage; this effect consumes them
  // once the user is authenticated and their leagues subscription has
  // resolved (so we don't try to join a league they're already in).
  // Runs once per session — consumePendingJoin clears the stored values.
  const autoJoinAttempted = useRef(false);
  useEffect(() => {
    if (autoJoinAttempted.current) return;
    if (!authenticated || !uData?.id || !ready) return;
    if (typeof window === 'undefined') return;
    // Need to wait for leagues to load so we can short-circuit if already a member.
    const pending = (typeof sessionStorage !== 'undefined') && sessionStorage.getItem('goaloracle_pending_join');
    if (!pending) { autoJoinAttempted.current = true; return; }
    if (leagues.some(l => l.id === pending)) {
      // Already a member — just clear pending and navigate.
      consumePendingJoin();
      autoJoinAttempted.current = true;
      const target = leagues.find(l => l.id === pending);
      if (target) nav('detail', target);
      return;
    }
    autoJoinAttempted.current = true;
    const { leagueId, passcode } = consumePendingJoin() || {};
    if (!leagueId) return;
    (async () => {
      try {
        await joinLeague(leagueId, uData.id, passcode);
        notify('Joined the league');
        // Wait one tick for the leagues subscription to refresh, then
        // navigate. The subscribe handler will re-render with the new doc.
        setTimeout(() => {
          // Re-read from current state via a synthetic league object — the
          // subscription will have populated it by the time the user lands.
          nav('detail', { id: leagueId });
        }, 600);
      } catch (e) {
        const msg = e?.message || 'Could not join — invite may have expired or passcode invalid';
        notify(msg, 'error');
      }
    })();
  }, [authenticated, uData?.id, ready, leagues, nav, notify]);
  // Feature flags are admin-toggleable. Initial fetch is fast (cached
  // edge response) and the live subscription keeps every client in sync
  // when an admin flips a toggle.
  useEffect(() => {
    fetchFeatureFlags().then(setFeatureFlags).catch(() => {});
    return subscribeToFeatureFlags(setFeatureFlags);
  }, []);
  const authInitRef = useRef(false);

  // Subscribe to Firebase Auth. The first callback marks `ready` so render
  // gates can wait. On sign-in we cache the ID token (used by /api/* calls)
  // and load/create the matching user doc. On sign-out we clear local state.
  useEffect(() => {
    const unsub = onAuthStateChanged(fbAuth, async (fbUser) => {
      // Google sign-in (popup or redirect) transits through a Firebase-
      // managed UID before we swap to the canonical `auth_*` / `did:privy:*`
      // UID via custom token. Skip every state change while that swap is in
      // flight so we don't create a spurious /users/{transient-uid} doc.
      //
      // Belt-and-suspenders: even if isAuthSwapInFlight() is false (Safari
      // ITP cleared our sessionStorage flag across the redirect hop), we
      // can detect the transient state from providerData — a Firebase user
      // with a google.com provider AND a UID that doesn't match our app's
      // patterns is mid-swap. completeGoogleRedirectIfNeeded() will resolve
      // it on the same tick.
      if (isAuthSwapInFlight()) return;
      if (fbUser
        && fbUser.providerData?.some(p => p.providerId === 'google.com')
        && !fbUser.uid.startsWith('auth_')
        && !fbUser.uid.startsWith('did:privy:')) {
        console.log('[auth] skipping transient Google UID', fbUser.uid, '— awaiting swap');
        return;
      }
      setReady(true);
      if (!fbUser) {
        setAuthenticated(false);
        setUData(null); setRole('user'); setAuthToken(null); resetFirebaseAuth();
        authInitRef.current = false;
        return;
      }
      setAuthenticated(true);
      if (authInitRef.current) return;
      authInitRef.current = true;

      try {
        const token = await fbUser.getIdToken();
        setAuthToken(token);
        const u = await createOrUpdateUser({ id: fbUser.uid, email: fbUser.email });
        if (!u) return;
        console.log('[auth] SUCCESS:', u.displayName, u.role);
        setUData(u);
        setRole(u.role || 'user');
        setShowLogin(false);
        if (u.usernameSet === false) setShowUsernamePrompt(true);

        // Backfill country for existing users who signed up before we required
        // it. Product directive: known overrides go first, then IP geolocation,
        // then default to US so the leaderboard flag is never blank.
        if (u.usernameSet && !u.country) {
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
        }
      } catch (e) {
        console.error('[auth] sign-in flow failed:', e.message);
      }
    });

    // Refresh the cached ID token periodically so server calls don't hit
    // expired tokens after the first hour.
    const refresh = setInterval(async () => {
      const u = fbAuth.currentUser;
      if (!u) return;
      try { setAuthToken(await u.getIdToken(false)); } catch {}
    }, 30 * 60 * 1000);

    return () => { unsub(); clearInterval(refresh); };
  }, []);
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

  // If the active view is a Classic league but Classic has been turned off
  // by an admin (deep-linked from an old URL), bounce back to the dashboard
  // so the user doesn't land on an empty page.
  useEffect(() => {
    if (view !== 'detail') return;
    if (featureFlags.classicEnabled === false && selLeague && selLeague.predictionMode !== 'simple') {
      nav('dashboard');
    }
  }, [view, selLeague, featureFlags.classicEnabled, nav]);

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

    // Hero CTAs are state-aware so a logged-in user sees their next
    // useful action (finish bracket / leaderboard / invite friends)
    // instead of the generic "Start Predicting" pitch. Mirrors the
    // dashboard's continueCard logic. While quickPicks is still loading
    // (authenticated && quickPicks === null), fall back to a neutral
    // "Continue predicting" so the primary doesn't flash a number that
    // might be wrong.
    const goLeaderboardLanding = () => {
      const gs = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || {
        id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true,
      };
      nav('detail', gs, { tab: 'leaderboard' });
    };

    // "Start Predicting" buttons: route straight to Global Quick Picks flow
    const startSimplePredicting = () => {
      track('bracket_start', { league_id: 'global-simple', authenticated });
      if (!authenticated) { login(); return; }
      const globalSimple = leagues.find(l => l.id === 'global-simple') || {
        id: 'global-simple', name: 'Global League', type: 'free',
        predictionMode: 'simple', isGlobal: true,
      };
      nav('detail', globalSimple, { tab: 'predictions' });
    };

    // Invite-friends modal — three options (referral share / create
    // private league / invite to existing private league). Replaces
    // the previous one-click navigator.share that lacked the league-
    // invite path the user asked for.
    const [inviteOpen, setInviteOpen] = useState(false);

    // Anonymous-only big-button CTAs. Logged-in users use the unified
    // chip row instead — keeps the home page CTA UX consistent
    // instead of pairing a random-gradient pill with neutral chips.
    const anonCtas = useMemo(() => {
      if (authenticated) return null;
      return {
        primary: { label: <>Start Predicting &mdash; It&rsquo;s Free</>, onClick: startSimplePredicting },
        secondary: { label: 'Create a League', onClick: () => login() },
      };
    }, [authenticated]);

    // The single "do this now" chip for logged-in users. Sits at the
    // start of the chip row with an accent style so it pops without
    // breaking the chip-row visual rhythm.
    const accentChip = useMemo(() => {
      if (!authenticated) return null;
      if (quickPicks === null) {
        return { label: 'Continue predicting', onClick: startSimplePredicting };
      }
      if (!quickPicks.isComplete) {
        const n = quickPicks.totalRemaining;
        return { label: `Finish bracket · ${n} left`, onClick: startSimplePredicting, urgent: true };
      }
      return { label: 'Edit your bracket', onClick: startSimplePredicting };
    }, [authenticated, quickPicks]);

    // Mock leaderboard data
    const mockLb = [
      { rank: 1, name: 'LeoM', pts: 78, level: 12 },
      { rank: 2, name: 'SamNYC', pts: 74, level: 9 },
      { rank: 3, name: 'MariaFutbol', pts: 71, level: 10 },
      { rank: 4, name: 'You', pts: 68, level: 7, isYou: true },
    ];

    // Community predictions mock
    const communityMatch = WORLD_CUP_MATCHES.find(m => m.id === 'gs17');

    // ─── Logged-in personal dashboard ─────────────────────────────
    // Single centered container, frosted-glass cards over a strongly-
    // overlaid stadium photo. Replaces the previous side-by-side
    // hero (Welcome / MyPicksCard / HeroLeaderboardPreview / chip
    // row / stats band) which had three competing focal points and
    // mixed card styles. Calm hierarchy, one primary CTA, uniform
    // type scale.
    if (authenticated) {
      const onLeaderboardFull = () => {
        const gs = leagues.find((l) => l.id === 'global-simple') || allLeagues.find((l) => l.id === 'global-simple') || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
        setDetailTab('leaderboard');
        nav('detail', gs);
      };
      return (
        <div className="landing-page">
          <div className="grad-mesh"></div>
          {/* Stadium photo stays — but the authed overlay is
              strong + uniform so cards float above it consistently
              instead of fighting the bright crowd image. */}
          <section className="hero hero-split hero-no-anim">
            <div className="hero-stadium-bg"></div>
            <div className="hero-stadium-overlay hero-stadium-overlay-authed"></div>
            <div className="home-shell">
              <HomeHeroCard
                displayName={uData?.displayName}
                quickPicks={quickPicks}
                rank={leagueRanks?.['global-simple']}
                leagueCount={leagues?.length || 0}
                consensus={globalConsensus}
                onView={() => setViewingOwnBracket({ id: 'global-simple', name: 'Global League', predictionMode: 'simple' })}
                onEdit={startSimplePredicting}
                onShare={handleShareOwnBracket}
              />
              <QuickActionsTiles
                onDashboard={() => nav('dashboard')}
                onMyLeagues={() => nav('leagues')}
                onLeaderboard={goLeaderboardLanding}
                onJoin={() => nav('browse')}
                onInvite={() => setInviteOpen(true)}
              />
              <div className="home-card home-leaderboard">
                <HeroLeaderboardPreview onViewFull={onLeaderboardFull} />
              </div>
            </div>
          </section>
          <div className="home-footer-strip">
            <span><AnimatedCounter value={stats.totalPlayers ? stats.totalPlayers * 12 : 13402} /> predictions today</span>
            <span className="home-footer-strip-divider">·</span>
            <span>82 countries</span>
            <span className="home-footer-strip-divider">·</span>
            <span>Free to play</span>
            <span className="home-footer-strip-divider">·</span>
            <span>FIFA-compliant</span>
          </div>
          <InviteFriendsModal
            open={inviteOpen}
            onClose={() => setInviteOpen(false)}
            userId={uData?.id}
            leagues={leagues}
            notify={notify}
            onCreateLeague={() => nav('create')}
          />
        </div>
      );
    }

    // ─── Anonymous marketing landing (unchanged) ──────────────────
    return (
      <div className="landing-page">
        <div className="grad-mesh"></div>

        {/* ─── 1. HERO + NEXT MATCH ─── */}
        <section className={`hero hero-split hero-split-anon ${heroAnimated ? 'hero-no-anim' : ''}`}>
          <div className="hero-stadium-bg"></div>
          <div className="hero-stadium-overlay"></div>
          <WorldCupCountdown />
          <div className="hero-split-inner" ref={el => { if (el && !heroAnimated) heroAnimated = true; }}>
            <div className="hero-left">
              <h1 className="hero-title">Predict the<br/><span className="highlight">World Cup.</span></h1>
              <p className="hero-subtitle">Compete with friends. Climb the leaderboard. Win rewards. Become the Oracle.</p>
              {anonCtas && (
                <div className="hero-cta">
                  <button className="btn btn-primary btn-lg" onClick={anonCtas.primary.onClick}>{anonCtas.primary.label}</button>
                  <button className="btn btn-secondary btn-lg" onClick={anonCtas.secondary.onClick}>{anonCtas.secondary.label}</button>
                </div>
              )}
            </div>
            <div className="hero-right">
              <HeroLeaderboardPreview
                onViewFull={() => login()}
              />
            </div>
          </div>
          <div className="hero-stats-band">
            <div className="hero-stats-band-inner">
              <div className="hero-social-proof">
                <div className="hero-avatars">
                  {['🇧🇷','🇩🇪','🇦🇷','🇫🇷'].map((f,i) => <span key={i} className="hero-avatar">{f}</span>)}
                </div>
                <span className="hero-proof-text"><AnimatedCounter value={stats.totalPlayers ? stats.totalPlayers * 12 : 13402} /> predictions made today &middot; 82 countries &middot; Free to play</span>
              </div>
              <p className="hero-compliance"><Shield size={12} /> Compliant with the official FIFA World Cup 26&trade; rulebook</p>
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
            <h2 className="editorial-title">Two hundred nine points.<br/><span className="editorial-em">One tournament.</span></h2>
            <div className="editorial-num">How scoring works</div>
          </div>
          <div className="ledger-grid">
            <article className="ledger-card reveal-float stagger-1">
              <header><span className="ledger-idx">I.</span><span className="ledger-stage">Group stage</span></header>
              <div className="ledger-points"><span className="ledger-num">84</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">Twelve groups, four teams each. <strong>3 pts</strong> for the group winner, <strong>2</strong> for 2nd, <strong>1 pt</strong> each for 3rd and 4th.</p>
              <div className="ledger-math"><span>12 groups</span><i>×</i><span>7 pts</span></div>
            </article>
            <article className="ledger-card ledger-accent reveal-float stagger-2">
              <header><span className="ledger-idx">II.</span><span className="ledger-stage">Best thirds</span></header>
              <div className="ledger-points"><span className="ledger-num">16</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">Eight third-place finishers advance to the Round of 32. <strong>2 pts</strong> for each correct pick.</p>
              <div className="ledger-math"><span>8 slots</span><i>×</i><span>2 pts</span></div>
            </article>
            <article className="ledger-card reveal-float stagger-3">
              <header><span className="ledger-idx">III.</span><span className="ledger-stage">Knockout rounds</span></header>
              <div className="ledger-points"><span className="ledger-num">109</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">Picks scale up: <strong>2</strong> in R32, <strong>3</strong> in R16, <strong>5</strong> in QF, <strong>8</strong> in SF, <strong>12</strong> in the Final.</p>
              <div className="ledger-math"><span>R32: 32</span><i>·</i><span>R16: 24</span><i>·</i><span>QF: 20</span><i>·</i><span>SF+: 33</span></div>
            </article>
            <article className="ledger-card ledger-total reveal-float stagger-4">
              <header><span className="ledger-idx">&Sigma;</span><span className="ledger-stage">Perfect ledger</span></header>
              <div className="ledger-points"><span className="ledger-num">209</span><span className="ledger-unit">pts</span></div>
              <p className="ledger-desc">The upper bound. Tiebreaker: earliest submission wins.</p>
              <div className="ledger-math ledger-math-all"><span>84</span><i>+</i><span>16</span><i>+</i><span>109</span><i>=</i><span className="ledger-sum">209</span></div>
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
                  const gs = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
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
                      const gs = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
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
        {/* InviteFriendsModal mount lives in the authed early-return
            above; this branch only renders for anonymous users who
            can't trigger the modal anyway. */}
      </div>
    );
  };



  // ─── Your Leagues — Apple HIG redesign ────────────────────────────────
  // Page paired with LeagueLeaderboardLayout: same row anatomy, hairline
  // dividers, chevron-only nav, one-state-pill cascade. Tap = navigate.
  const handleShareOwnBracket = useCallback(async () => {
    const userId = uData?.id;
    if (!userId) return;
    const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://goaloracle.io';
    const url = `${origin}/u/${encodeURIComponent(userId)}/bracket?ref=${encodeURIComponent(userId)}`;
    const text = `Check out my World Cup 2026 bracket on GoalOracle: ${url}`;
    try {
      if (typeof navigator !== 'undefined' && navigator.share) {
        await navigator.share({ title: 'My GoalOracle bracket', text, url });
      } else {
        await navigator.clipboard.writeText(url);
        notify?.('Bracket link copied — share it with friends');
      }
    } catch { /* user cancelled native share */ }
  }, [uData?.id, notify]);

  const LeaguesList = () => {
    const seedAll = leagues.length > 0 ? leagues : [
      { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true, memberCount: stats.totalPlayers },
    ];
    // Feature-flag filter — same logic as before.
    const allMine = seedAll.filter(l => {
      if (l.predictionMode === 'classic' && featureFlags.classicEnabled === false) return false;
      if (l.predictionMode === 'simple' && featureFlags.quickPicksEnabled === false) return false;
      return true;
    });
    const isGlobalLeague = (l) => l.id === 'global' || l.id === 'global-simple' || l.isGlobal === true;
    const globalLeagues = allMine.filter(isGlobalLeague);
    const personalLeagues = allMine.filter(l => !isGlobalLeague(l));

    // Status object derived per-league from leagueRanks (not the global
    // quickPicks state, which only tracks global-simple). Returns
    // { done, remaining, etaMin, pct, ended } | null. Each Quick Picks
    // league has its own /simplePredictions/{userId}__{leagueId} doc,
    // so picks-complete in one league doesn't imply complete in
    // another — relying on the global quickPicks state was the source
    // of every league showing "All picks in" once global-simple was
    // finished.
    const QP_TOTAL_REQUIRED = 12 + 8 + 32; // 12 group rankings + 8 best-thirds + 32 bracket picks
    const predStatus = (league) => {
      if (league.predictionMode === 'simple') {
        const rk = leagueRanks[league.id];
        if (!rk || typeof rk.myPicksLeft !== 'number') return null;
        const remaining = rk.myPicksLeft;
        const picked = Math.max(0, QP_TOTAL_REQUIRED - remaining);
        const pct = Math.round((picked / QP_TOTAL_REQUIRED) * 100);
        // Only mark "done" when the user has actually submitted picks AND
        // the bracket is complete. Without the hasSubmitted gate, a
        // brand-new user with no doc was being shown "All picks in"
        // because the leaderboard endpoint returns picksLeft=52 +
        // isComplete=false for them but a stale isComplete=true could
        // sneak in via copy operations or stale state.
        if (rk.myHasSubmitted && (rk.myIsComplete || remaining === 0)) {
          return { done: true, remaining: 0, pct: 100 };
        }
        const etaMin = Math.max(1, Math.round(remaining * 8 / 60));
        return { done: false, remaining, etaMin, pct };
      }
      const rk = leagueRanks[league.id];
      if (!rk || typeof rk.myPredCount !== 'number') return null;
      const total = WORLD_CUP_MATCHES.length;
      const remaining = Math.max(0, total - rk.myPredCount);
      const pct = Math.round((rk.myPredCount / total) * 100);
      // Same defensive gate for classic: zero predictions ≠ "done".
      if (remaining === 0 && rk.myPredCount > 0) return { done: true, remaining: 0, pct: 100 };
      const etaMin = Math.max(1, Math.round(remaining * 20 / 60));
      return { done: false, remaining, etaMin, pct };
    };

    // Urgency rule from the brief: <30 min to next deadline + picks remaining.
    // Pre-tournament we don't have per-league deadlines, so urgent = any
    // league with picks remaining within an hour of the next match lock.
    // For now, treat urgent as `remaining > 0 AND etaMin <= 30` (the user
    // could finish in under 30 min). Will tighten once match-by-match locks
    // are wired into per-league status.
    const isUrgent = (status) => !!status && !status.done && !status.ended && (status.etaMin || 9999) <= 30;

    // Sort: recently-active proxy. Active picks first (urgent then warning),
    // then completed, then ended. Within tier, alphabetical.
    const sortByActivity = (arr) => {
      const tier = (l) => {
        const s = predStatus(l);
        if (!s) return 5;
        if (s.ended) return 4;
        if (s.done) return 3;
        if (isUrgent(s)) return 1;
        return 2;
      };
      return [...arr].sort((a, b) => {
        const ta = tier(a), tb = tier(b);
        if (ta !== tb) return ta - tb;
        return (a.name || '').localeCompare(b.name || '');
      });
    };

    const filtered = useMemo(() => {
      const base = personalLeagues;
      if (dashLeagueFilter === 'all') return sortByActivity(base);
      return sortByActivity(base.filter(l => {
        const s = predStatus(l);
        if (dashLeagueFilter === 'ended') return !!s?.ended;
        if (dashLeagueFilter === 'active') return !s?.ended;
        return true;
      }));
      // sortByActivity / predStatus close over leagueRanks + quickPicks; the
      // memo deps below ensure we re-sort when those change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personalLeagues, dashLeagueFilter, leagueRanks, quickPicks]);

    const personalCount = personalLeagues.length;
    const isHeroState = personalCount === 0 && globalLeagues.length > 0;

    const renderRow = (league) => {
      const status = predStatus(league);
      const urgent = isUrgent(status);
      const rk = leagueRanks[league.id];
      const total = league.memberCount || rk?.total || 0;
      return (
        <LeagueListRow
          key={league.id}
          league={league}
          status={status}
          rank={rk?.rank}
          total={total || null}
          urgent={urgent}
          onClick={() => nav('detail', league)}
          onLeaderboard={() => nav('detail', league, { tab: 'leaderboard' })}
          onEditPicks={() => nav('detail', league, { tab: 'predictions' })}
          onViewBracket={() => {
            // Quick Picks: open the inline bracket modal. Classic:
            // there's no single bracket to render — route to the
            // detail page so the user can step through their picks.
            if (league.predictionMode === 'simple') setViewingOwnBracket(league);
            else nav('detail', league, { tab: 'predictions' });
          }}
          onLeave={!isGlobalLeague(league) ? async () => {
            if (!uData?.id) return;
            const confirmed = window.confirm(
              `Leave "${league.name}"?\n\n` +
              `You'll lose access to its leaderboard and standings. Your picks for this league are kept on the server in case you rejoin later.`
            );
            if (!confirmed) return;
            try {
              await leaveLeague(league.id, uData.id);
              notify(`Left "${league.name}"`);
            } catch (e) {
              notify(e?.message || 'Could not leave league', 'error');
            }
          } : undefined}
        />
      );
    };

    return (
      <div className="leagues-page">
        {/* Header — title + ONE primary CTA. Browse moves to the toolbar. */}
        <div className="leagues-header">
          <h1 className="leagues-title">Your leagues</h1>
          <button type="button" className="leagues-create" onClick={() => nav('create')}>
            <Plus size={14} aria-hidden="true" /> Create league
          </button>
        </div>

        {/* Toolbar — segmented filter + secondary Browse */}
        <div className="leagues-toolbar">
          <div className="leagues-filter" role="tablist" aria-label="Filter leagues">
            {['all', 'active', 'ended'].map(f => (
              <button
                key={f}
                role="tab"
                aria-selected={dashLeagueFilter === f}
                className={`leagues-filter-tab ${dashLeagueFilter === f ? 'is-active' : ''}`}
                onClick={() => setDashLeagueFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className="leagues-browse" onClick={() => nav('browse')}>
            <Search size={13} aria-hidden="true" /> Join another league
          </button>
        </div>

        {/* Hero new-user state: only the global league exists, swap the
            standard global row for an invitational hero. Once the user
            has any personal league, we revert to the section-header
            pattern. Solves the "Global feels under-emphasized for new
            users" risk surgically rather than permanently inflating its
            visual weight. */}
        {isHeroState && (
          <div className="leagues-hero">
            <div className="leagues-hero-meta">
              <span className="leagues-hero-eyebrow">YOU'RE IN</span>
              <h2 className="leagues-hero-title">{globalLeagues[0]?.name || 'Global League'}</h2>
              <p className="leagues-hero-sub">Compete against everyone playing GoalOracle. Create or join a private league to play with friends.</p>
            </div>
            <div className="leagues-hero-actions">
              <button type="button" className="leagues-hero-cta" onClick={() => nav('detail', globalLeagues[0])}>
                Open Global <ChevronRight size={14} aria-hidden="true" />
              </button>
              <button type="button" className="leagues-hero-secondary" onClick={() => nav('browse')}>
                Join another league
              </button>
            </div>
          </div>
        )}

        {/* Steady-state: section header + standard rows */}
        {!isHeroState && globalLeagues.length > 0 && (
          <>
            <div className="leagues-section-label">GLOBAL</div>
            <div className="leagues-list">{globalLeagues.map(renderRow)}</div>
          </>
        )}

        {personalCount > 0 && (
          <>
            <div className="leagues-section-label">YOUR LEAGUES · {personalCount}</div>
            {filtered.length === 0 ? (
              <div className="leagues-empty-filter">
                <p>No leagues match this filter.</p>
                <button type="button" className="leagues-browse" onClick={() => setDashLeagueFilter('all')}>Show all</button>
              </div>
            ) : (
              <div className="leagues-list">{filtered.map(renderRow)}</div>
            )}
          </>
        )}

        {/* Empty state for users who somehow have neither global nor personal
            (shouldn't happen given backfill, but render gracefully). */}
        {personalCount === 0 && globalLeagues.length === 0 && (
          <div className="leagues-empty">
            <p>No leagues yet.</p>
            <button type="button" className="leagues-create" onClick={() => nav('create')}>
              <Plus size={14} aria-hidden="true" /> Create your first league
            </button>
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
    const publicLeagues = allLeagues.filter(l => {
      if (l.visibility === 'private') return false;
      if (l.predictionMode === 'classic' && featureFlags.classicEnabled === false) return false;
      if (l.predictionMode === 'simple' && featureFlags.quickPicksEnabled === false) return false;
      return true;
    });
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
        <div className="page-header"><h1>Browse Leagues</h1><p style={{color:'var(--text-sec)', fontSize:'0.88rem', marginTop:'0.25rem'}}>Public leagues are shown below. Got a passcode? Enter it to join a private league.</p></div>

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
                          {isQuickPicks ? 'Bracket' : 'Classic'}
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
            <button className="btn-back-sm btn-back-sm-named" onClick={() => nav('leagues')}>&larr; <span>Leagues</span></button>
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
  // ACCOUNT DROPDOWN
  // ================================

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

  const [hidePredicted, setHidePredicted] = useState(false);
  const [frozenUnpredictedIds, setFrozenUnpredictedIds] = useState(null);
  const [walletBalances, setWalletBalances] = useState({ USDC: '0.00', POL: '0.00' });
  const [balLoading, setBalLoading] = useState(false);
  const balancesRef = useRef(walletBalances);

  // Sweepstakes payout wallet — admin-assigned external EVM address. Stored
  // on the user doc; balance is read-only via public Polygon RPC.
  const walletAddress = uData?.walletAddress || '';

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


  const AccountDropdown = () => {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);
    const [editingName, setEditingName] = useState(false);
    const [newName, setNewName] = useState('');
    const [editingCountry, setEditingCountry] = useState(false);
    const [newCountry, setNewCountry] = useState(uData?.country || '');
    const [savingCountry, setSavingCountry] = useState(false);
    const [countriesList, setCountriesList] = useState([]);
    // Wallet section is collapsed by default — most users never need it.
    // Will surface meaningfully when sweepstakes / paid leagues ship.
    const [walletOpen, setWalletOpen] = useState(false);
    const [editingWallet, setEditingWallet] = useState(false);
    const [walletInput, setWalletInput] = useState('');
    const [walletConfirmed, setWalletConfirmed] = useState(false);
    const [walletSaving, setWalletSaving] = useState(false);
    const walletAddr = walletAddress;
    const isValidEvm = /^0x[a-fA-F0-9]{40}$/.test(walletInput.trim());

    const startEditWallet = () => {
      setWalletInput(walletAddr || '');
      setWalletConfirmed(false);
      setEditingWallet(true);
    };
    const cancelEditWallet = () => {
      setEditingWallet(false);
      setWalletInput('');
      setWalletConfirmed(false);
    };
    const saveWallet = async () => {
      if (!isValidEvm || !walletConfirmed || walletSaving) return;
      setWalletSaving(true);
      try {
        const updated = await updateUserProfile(uData.id, { walletAddress: walletInput.trim() });
        if (updated) setUData(updated);
        setEditingWallet(false);
        setWalletInput('');
        setWalletConfirmed(false);
        notify('Payout wallet saved');
      } catch (e) {
        notify('Could not save wallet. Try again.', 'error');
      } finally {
        setWalletSaving(false);
      }
    };
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
            {/* Payout wallet — user-editable EVM address. Sweepstakes
                payouts go here on Polygon. Always shown so users can add
                or edit; collapsed by default to keep the dropdown short. */}
            <div className="dropdown-divider"></div>
            <button
              type="button"
              className={`dropdown-wallet-toggle ${walletOpen ? 'is-open' : ''}`}
              onClick={(e) => { e.stopPropagation(); setWalletOpen(v => !v); }}
              aria-expanded={walletOpen}
            >
              <Wallet size={14} />
              <span className="dropdown-wallet-toggle-label">Payout wallet</span>
              {walletAddr ? (
                <code className="dropdown-wallet-toggle-addr">{walletAddr.slice(0, 6)}…{walletAddr.slice(-4)}</code>
              ) : (
                <span className="dropdown-wallet-toggle-empty">Add</span>
              )}
              <ChevronDown size={14} className={`dropdown-wallet-toggle-chev ${walletOpen ? 'flip' : ''}`} />
            </button>
            {walletOpen && (
              <div className="dropdown-wallet-section">
                {editingWallet ? (
                  <div className="dropdown-wallet-editor">
                    <label className="dropdown-wallet-label" htmlFor="payout-wallet-input">EVM-compatible address</label>
                    <input
                      id="payout-wallet-input"
                      type="text"
                      className={`dropdown-wallet-input ${walletInput && !isValidEvm ? 'is-invalid' : ''}`}
                      placeholder="0x…"
                      value={walletInput}
                      onChange={e => setWalletInput(e.target.value.trim())}
                      autoFocus
                      spellCheck={false}
                      autoComplete="off"
                    />
                    {walletInput && !isValidEvm && (
                      <div className="dropdown-wallet-err">
                        Address must be 0x followed by 40 hex characters (Ethereum, Polygon, Base, etc.).
                      </div>
                    )}
                    <label className="dropdown-wallet-confirm">
                      <input
                        type="checkbox"
                        checked={walletConfirmed}
                        onChange={e => setWalletConfirmed(e.target.checked)}
                      />
                      <span>I confirm this is an EVM-compatible address. Sending payouts to a non-EVM address (e.g. Bitcoin, Solana) will result in lost funds.</span>
                    </label>
                    <div className="dropdown-wallet-actions">
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={saveWallet}
                        disabled={!isValidEvm || !walletConfirmed || walletSaving}
                      >
                        {walletSaving ? 'Saving…' : (walletAddr ? 'Update' : 'Save')}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={cancelEditWallet}
                        disabled={walletSaving}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : walletAddr ? (
                  <>
                    <div className="dropdown-wallet">
                      <code className="wallet-addr">{walletAddr.slice(0, 10)}…{walletAddr.slice(-8)}</code>
                      <button className="copy-btn" onClick={copyAddress} title="Copy address">
                        {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                      </button>
                      <button
                        type="button"
                        className="copy-btn"
                        onClick={(e) => { e.stopPropagation(); startEditWallet(); }}
                        title="Edit payout address"
                      >
                        <Target size={14} />
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
                    <div className="dropdown-wallet-note">
                      Sweepstakes payouts are sent to this address on Polygon.
                    </div>
                  </>
                ) : (
                  <div className="dropdown-wallet-empty">
                    <p>Add an EVM address (Ethereum, Polygon, Base, etc.) to receive sweepstakes payouts.</p>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm"
                      onClick={(e) => { e.stopPropagation(); startEditWallet(); }}
                    >
                      <Plus size={14} /> Add payout address
                    </button>
                  </div>
                )}
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
    const userEmail = uData?.email || '';
    const hasEmail = authenticated && !!userEmail;
    const [fbEmail, setFbEmail] = useState(userEmail);
    const [fbName, setFbName] = useState(uData?.displayName || '');
    const [fbType, setFbType] = useState('general');
    const [fbMsg, setFbMsg] = useState('');
    const [fbSending, setFbSending] = useState(false);
    const [fbSent, setFbSent] = useState(false);
    const [fbError, setFbError] = useState('');

    // If logged in with email, use it; otherwise require manual entry
    const finalEmail = hasEmail ? userEmail : fbEmail.trim();

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
          <button className="btn-back-sm btn-back-sm-named" onClick={() => nav('landing')}>&larr; <span>Home</span></button>
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
              <CheckCircle size={16} /> Submitting as <strong>{userEmail}</strong>
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
            a: 'When a match finishes, GoalOracle automatically pulls the final score from football-data.org — a widely-trusted football data API used by thousands of developers worldwide. Results are checked every 30 minutes and posted to your leaderboard within an hour of full-time.'
          },
          {
            q: 'Which API provides the match scores?',
            a: (<>
              <strong>Football-Data.org</strong> — a community-trusted API that provides live scores, fixtures, and standings for major football competitions including the FIFA World Cup. Their data comes directly from official league feeds.
              <br/><br/>
              <a href="https://www.football-data.org" target="_blank" rel="noopener noreferrer" className="faq-link"><ExternalLink size={12} /> football-data.org</a>
            </>)
          },
          {
            q: 'What if I think a match result is wrong?',
            a: (<>
              You can contest a result by emailing <a href="mailto:support@goaloracle.io" className="faq-link">support@goaloracle.io</a> with the match and the source you believe is correct (e.g. the official FIFA scorecard). We review every report and update the record if it\'s been miscaptured.
            </>)
          },
          {
            q: 'Can I verify the results myself?',
            a: 'Yes. All verified match results are visible on the platform and you can cross-check them against the official FIFA World Cup website (fifa.com) or football-data.org directly. Full transparency is a core principle.'
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
            a: 'GoalOracle does not create wallets for users. If a future sweepstakes or prize league pays out in crypto, a payout wallet address can be linked to your account by an administrator on request. No funds are collected, held, or managed by GoalOracle.'
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
            a: 'You can sign up with your email (we send a 6-digit code) or with Google. Both methods create the same account, and you can switch between them anytime by signing in with the same email.'
          },
          {
            q: 'Who can I contact for support?',
            a: (<>
              For bugs, questions, feedback, or to contest a match result, email us at <a href="mailto:support@goaloracle.io" className="faq-link">support@goaloracle.io</a>.
            </>)
          },
        ]
      },
    ];

    return (
      <div className="faq-page">
        <div className="page-header">
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
  // Replaced by WelcomeFlow (src/components/onboarding/WelcomeFlow.jsx) —
  // dead code below kept only briefly for reference and removed in this
  // commit. Search for `<WelcomeFlow` for the live render.
  // eslint-disable-next-line no-unused-vars
  const _UnusedUsernamePrompt = () => {
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
        notify(`Welcome, ${trimmed}!`);
        // New users go straight to the Quick Picks wizard. They've just
        // spent time picking a username and country — don't make them
        // click through a dashboard before placing their first pick.
        const globalSimple = leagues.find(l => l.id === 'global-simple')
          || allLeagues.find(l => l.id === 'global-simple')
          || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
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
          const simpleLeague = leagues.find(l => l.id === 'global-simple') || allLeagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
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
                <button type="button" className="theme-opt theme-cycle active" data-tooltip={`Theme: ${cur.label} — click for ${nxt.label}`} aria-label={`Theme: ${cur.label}. Click to switch to ${nxt.label}`} onClick={cycleTheme}>
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
      <NewsTicker />
      <ViewMeta view={view} />

      {view === 'landing' && <Landing />}
      {view === 'dashboard' && (
        <Dashboard
          leagues={leagues}
          preds={preds}
          results={results}
          uData={uData}
          stats={stats}
          quickPicks={quickPicks}
          featureFlags={featureFlags}
          leagueRanks={leagueRanks}
          setLeagueRanks={setLeagueRanks}
          nav={nav}
          consensus={globalConsensus}
          onShare={handleShareOwnBracket}
        />
      )}
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
          featureFlags={featureFlags}
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
          onLeaveLeague={async () => {
            // Confirm + leave + dashboard. Wired from SimpleDetail's
            // leaderboard header so non-global league members have a
            // visible exit. The Classic detail page already has the
            // same handler at line ~2578; this mirrors it for QP.
            if (!selLeague?.id || !uData?.id) return;
            const confirmed = window.confirm(
              `Leave "${selLeague.name}"?\n\n` +
              `You'll lose access to its leaderboard and standings. Your picks for this league are kept on the server in case you rejoin later.`
            );
            if (!confirmed) return;
            try {
              await leaveLeague(selLeague.id, uData.id);
              notify(`Left "${selLeague.name}"`);
              nav('leagues');
            } catch (e) {
              notify(e?.message || 'Could not leave league', 'error');
            }
          }}
          onOpenClassic={() => {
            const classic = leagues.find((l) => l.id === 'global') || allLeagues.find((l) => l.id === 'global') || { id: 'global', name: 'Global League', type: 'free', predictionMode: 'classic', isGlobal: true, pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 } };
            nav('detail', classic, { tab: 'predictions' });
          }}
          initialTab={detailTab === 'predictions' ? 'predictions' : 'leaderboard'}
          myLeagues={leagues}
          lbScope={lbScope}
          lbScopeCountry={lbScopeCountry}
          setLbScope={setLbScope}
          setLbScopeCountry={setLbScopeCountry}
        />
      )}
      {view === 'detail' && selLeague?.predictionMode !== 'simple' && featureFlags.classicEnabled !== false && <Detail key={selLeague?.id || 'detail'} />}
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
          authenticated={authenticated}
          onSignUp={() => {
            if (authenticated) { nav('dashboard'); }
            else { login(); }
          }}
        />
      )}
      {view === 'feedback' && <Feedback key="feedback" />}
      {view === 'admin' && (role === 'superadmin' || role === 'admin') && <AdminDashboard userData={uData} platformStats={stats} matchResults={results} allLeagues={allLeagues} notify={notify} featureFlags={featureFlags} />}
      {showLogin && !authenticated && (
        <LoginScreen
          onClose={() => setShowLogin(false)}
          onSignedIn={() => setShowLogin(false)}
        />
      )}
      {/* Brand-new user (usernameSet=false): single onboarding card combines
          username + country + optional passcode, replacing what used to be
          two consecutive modals. After submit, lands on dashboard so they
          discover the leaderboard / streak surface before being routed to
          the wizard via FirstTimeBanner. */}
      {showUsernamePrompt && (uData || uDataStableRef.current) && (
        <WelcomeFlow
          emailPrefix={(uData || uDataStableRef.current)?.email?.split('@')[0] || ''}
          allLeagues={allLeagues}
          onSubmit={async ({ username, country, passcodeMatchedLeague, passcode }) => {
            const OVERRIDES = { 'lebida2352': 'PK', 'Sumit': 'BD' };
            const finalCountry = OVERRIDES[username] || country;
            const targetUser = uData || uDataStableRef.current;
            const updated = await updateUserProfile(targetUser.id, {
              displayName: username,
              usernameSet: true,
              country: finalCountry,
              onboardingComplete: true,
            });
            if (updated) setUData(updated);
            setShowUsernamePrompt(false);
            notify(`Welcome, ${username}!`);

            if (passcodeMatchedLeague) {
              try {
                await joinLeague(passcodeMatchedLeague.id, uData.id, passcode);
                setDetailTab('leaderboard');
                nav('detail', passcodeMatchedLeague);
                return;
              } catch (e) {
                notify(`Couldn't join "${passcodeMatchedLeague.name}" — ${e.message || 'try again from Browse'}`, 'error');
              }
            }

            // #11 — Land on the dashboard so the new user sees the
            // FirstTimeBanner CTA and the leaderboard / streak surface.
            // They click "Start predicting" themselves to enter the wizard.
            nav('dashboard');
          }}
        />
      )}
      {/* Legacy passcode prompt — only fires for users who finished the old
          two-step onboarding before WelcomeFlow shipped (usernameSet=true
          but onboardingComplete=false). Once everyone has migrated this
          branch will never render. */}
      {authenticated && uData?.usernameSet === true && uData?.onboardingComplete === false && !showUsernamePrompt && (
        <PasscodePromptModal
          open
          allLeagues={allLeagues}
          notify={notify}
          onSkip={async () => {
            try { await updateUserProfile(uData.id, { onboardingComplete: true }); } catch {}
            setUData((u) => (u ? { ...u, onboardingComplete: true } : u));
          }}
          onJoin={async (joinedLeague, passcode) => {
            await joinLeague(joinedLeague.id, uData.id, passcode);
            try { await updateUserProfile(uData.id, { onboardingComplete: true }); } catch {}
            setUData((u) => (u ? { ...u, onboardingComplete: true } : u));
            setDetailTab('leaderboard');
            nav('detail', joinedLeague);
          }}
        />
      )}
      <ShareCardModal />
      {/* Live Standings drawer — rendered at App root so it survives Detail's
          re-mount cycle (every preds update re-creates the Detail function,
          which would otherwise destroy the drawer's DOM and reset its scroll
          position). Toggle is visible only on Classic leagues' predictions
          tab; drawer can always render (hidden off-canvas when closed). */}
      {view === 'detail' && selLeague?.predictionMode !== 'simple' && featureFlags.classicEnabled !== false && detailTab === 'predictions' && (
        <LiveStandingsToggle
          open={standingsOpen}
          onToggle={() => setStandingsOpen(v => !v)}
          count={Object.values(preds).filter(p => p?.result).length}
        />
      )}
      <LiveStandingsDrawer
        open={standingsOpen && view === 'detail' && selLeague?.predictionMode !== 'simple' && featureFlags.classicEnabled !== false}
        onClose={() => setStandingsOpen(false)}
        predictions={preds}
      />
      {/* "View bracket" modal — opened from the leagues list. Lifted
          to parent scope so it survives LeaguesList remounts (the
          previous local-state version was wiped on every render).
          Only Quick Picks leagues open the modal here; Classic
          leagues route to the detail page from the row handler
          instead, since a Classic "bracket" is per-match, not a
          single tree. */}
      {viewingOwnBracket && uData?.id && viewingOwnBracket.predictionMode === 'simple' && (
        <PicksViewer
          target={{
            userId: uData.id,
            displayName: uData.displayName || 'You',
            leagueId: viewingOwnBracket.id,
            leagueName: viewingOwnBracket.name,
          }}
          isOwn
          onEdit={() => {
            const league = viewingOwnBracket;
            setViewingOwnBracket(null);
            nav('simplePredict', league);
          }}
          onShare={handleShareOwnBracket}
          onClose={() => setViewingOwnBracket(null)}
        />
      )}
    </div>
  );
};

export default GoalOracle;
