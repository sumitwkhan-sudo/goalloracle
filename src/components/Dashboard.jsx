import React, { useEffect, useMemo, useState } from 'react';
import {
  Trophy, Users, ChevronRight, CheckCircle, Clock, Target, Plus,
  Lock, Zap, Star, Flame, ArrowUp, ArrowDown,
} from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
// calculateXP / getLevelInfo were removed from the dashboard surface
// per user feedback; the imports stay available in src/utils/xp for
// future use elsewhere.
import { calculateStreak, getStreakBadge, calculateTotalPoints, calculatePoints, getMatchStatus } from '../utils/points';
import { STAGES, STAGE_FIRST_KICKOFF_UTC, stageLockTimeUtc, formatLockDelta } from '../utils/stageLock';
import { PRIZES } from '../config/legal';
import { TOTAL_MAX } from '../utils/scoringSimple';
import { getSimpleLeaderboard, getLeagueLeaderboard } from '../utils/db';
import FriendsWidget from './dashboard/FriendsWidget';
import AnimatedCounter from './AnimatedCounter';
import InsightsCarousel from './simple/InsightsCarousel';
import BracketInsightsRow from './BracketInsightsRow';
import NewsFeed from './NewsFeed';
import KnockoutLockCTA from './KnockoutLockCTA';

const DEFAULT_PS = { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 };

// Match-time helpers — duplicated from utils/db's logic intentionally so the
// dashboard can reason about lock windows without going through the DB layer.
function matchKickoffMs(m) {
  const [hh, mm] = (m.time || '15:00').split(':').map(Number);
  const k = new Date(`${m.date}T00:00:00Z`);
  k.setUTCHours(hh + 4, mm, 0, 0);
  return k.getTime();
}

// formatLockDelta now lives in utils/stageLock (single source of truth, shared
// with the knockout lock-in CTA) — imported above.

// Total Quick Picks pieces a user can submit:
// 12 group rankings + 8 best-thirds + 32 bracket winners = 52.
const QP_TOTAL_PICKS = 52;

const STAGE_LABELS = {
  groupStage: 'Group stage',
  roundOf32: 'Round of 32',
  roundOf16: 'Round of 16',
  quarterFinals: 'Quarterfinals',
  semiFinals: 'Semifinals',
  thirdPlace: '3rd-place',
  final: 'Final',
};

// Live countdown — re-evaluates every minute. Shared between lock and live
// state rows so each match in the time-sensitive pane can update independently.
function useTick(intervalMs = 60_000) {
  const [, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN(n => n + 1), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
}

function RankDelta({ delta }) {
  if (delta == null) return null;
  if (delta === 0) return <span className="td-delta td-delta-flat">— flat</span>;
  if (delta > 0) return <span className="td-delta td-delta-up"><ArrowUp size={11} />+{delta}</span>;
  return <span className="td-delta td-delta-down"><ArrowDown size={11} />{delta}</span>;
}

// Pulled out of GoalOracle so the component reference is stable across the
// parent's re-renders. With an inline definition every parent setState
// recreated the function, React saw a new component type, and unmounted +
// remounted the entire dashboard subtree — including the BoldestCall /
// MostContested / BracketSurvival cards, each of which re-fetched on mount
// and visibly flickered. Now reconciliation runs in place.
export default function Dashboard({
  leagues,
  preds,
  results,
  uData,
  stats,
  quickPicks,
  featureFlags,
  leagueRanks,
  setLeagueRanks,
  nav,
  consensus,
  onShare,
}) {
  useTick(60_000);

  const ml = leagues.length > 0 ? leagues : [
    { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', memberCount: stats.totalPlayers },
  ];
  const ps = ml[0]?.pointsSystem || DEFAULT_PS;

  const { streak, bestStreak } = useMemo(() => calculateStreak(preds, results), [preds, results]);
  const streakBadge = getStreakBadge(streak);
  const totalStats = useMemo(() => calculateTotalPoints(preds, results, ps), [preds, results, ps]);
  // XP + Level removed from the dashboard — user-facing leveling wasn't
  // adding signal. Keeping the helpers imported in case we surface them
  // elsewhere later; if not, the imports can be cleaned up in a follow-up.
  const totalCompleted = useMemo(() => Object.entries(preds).filter(([id]) => results[id]?.completed).length, [preds, results]);
  const accuracy = totalCompleted > 0 ? Math.round((totalStats.correctResults / totalCompleted) * 100) : 0;

  // Headline rank — global Quick Picks leaderboard. The Classic 'global'
  // league is hidden across the app, so QP is the canonical rank.
  const qpRank = leagueRanks['global-simple'];

  const simpleLeagues = useMemo(() => ml.filter(l => l.predictionMode === 'simple'), [ml]);
  const quickPicksIncomplete = !!quickPicks && !quickPicks.isComplete && simpleLeagues.length > 0;

  // Per-league incomplete check. The dashboard used to show "All caught
  // up" the moment the global Quick Picks doc was complete, even if the
  // user had unfinished picks in private/public QP leagues — each league
  // has its own /simplePredictions/{userId}__{leagueId} doc, so global
  // completion ≠ all leagues complete. Pull from leagueRanks (populated
  // by the league-rank fetch effect below); the field was added to the
  // store in the Your-leagues progress fix.
  const incompleteOtherLeagues = useMemo(() => {
    return simpleLeagues.filter(l => {
      if (l.id === 'global-simple') return false; // global handled by quickPicksIncomplete
      const rk = leagueRanks[l.id];
      return rk && typeof rk.myPicksLeft === 'number' && rk.myPicksLeft > 0;
    });
  }, [simpleLeagues, leagueRanks]);
  const outstandingOtherLeaguesCount = incompleteOtherLeagues.length;

  const isFirstTime = quickPicks !== null
    && quickPicks.totalRemaining === 52
    && Object.keys(preds).length === 0
    && totalCompleted === 0;

  // Time-sensitive: the next match that locks, and any live matches.
  // Locking = not yet kicked off. Live = kicked off but not completed.
  // 5-min lock buffer matches the server-side rule.
  const LOCK_BUFFER_MS = 5 * 60 * 1000;
  const now = Date.now();
  const nextLock = useMemo(() => {
    const candidates = WORLD_CUP_MATCHES
      .filter(m => !results[m.id]?.completed && !preds[m.id]?.result)
      .map(m => ({ m, lockAt: matchKickoffMs(m) - LOCK_BUFFER_MS }))
      .filter(x => x.lockAt > now)
      .sort((a, b) => a.lockAt - b.lockAt);
    return candidates[0] || null;
  }, [preds, results, now]);

  const liveMatches = useMemo(() => {
    return WORLD_CUP_MATCHES
      .filter(m => {
        const k = matchKickoffMs(m);
        const inWindow = now >= k && now <= k + 2 * 60 * 60 * 1000; // 2h match window
        return inWindow && !results[m.id]?.completed;
      })
      .slice(0, 2);
  }, [results, now]);

  const recentResults = useMemo(() =>
    WORLD_CUP_MATCHES.filter(m => results[m.id]?.completed).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
  [results]);

  // Streak dots — last 10 graded matches in chronological order
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

  // League ranks (rank, total, myPicksLeft / myPredCount) are fetched at the
  // App level so they're populated regardless of which view the user lands on.
  // We just consume `leagueRanks` here.

  // First-time users get the variant-E onboarding card alone — the
  // zero-state DashboardStrip (Rank #179 of 188 / 0 pts / 0% / 0 streak /
  // 52 left) is deliberately omitted because every metric is a discouraging
  // signal before the user has predicted anything. The strip returns on
  // their next visit (once they've made any pick).
  if (isFirstTime) {
    return (
      <div className="td-shell">
        <FirstTimeBanner ml={ml} nav={nav} />
      </div>
    );
  }

  return (
    <div className="td-shell">
      <h1 className="td-page-title">Dashboard</h1>

      {/* Bracket insights — same row HomeHeroCard renders, mirrored
          here so the user sees their headline stats from either page.
          Hidden until the user has at least picked a champion. */}
      <BracketInsightsRow
        quickPicks={quickPicks}
        consensus={consensus}
        leagueCount={leagues?.length || 0}
        onShare={onShare}
        onLeaguesClick={() => nav('leagues')}
        // Both upset + consensus deep-link to the user's own bracket
        // view via the same Quick Picks detail page nav. The parent
        // (goaloracle.jsx) handles the actual modal/route — Dashboard
        // just routes the click upward via nav.
        onUpsetClick={() => nav('detail', { id: 'global-simple', name: 'Global League', predictionMode: 'simple' })}
        onConsensusClick={() => nav('detail', { id: 'global-simple', name: 'Global League', predictionMode: 'simple' })}
        variant="dashboard"
      />

      {/* Top dense strip — every cell carries one piece of canonical state. */}
      <DashboardStrip
        qpRank={qpRank}
        points={totalStats.totalPoints}
        accuracy={accuracy}
        totalCompleted={totalCompleted}
        streak={streak}
        streakBadge={streakBadge}
        quickPicks={quickPicks}
        quickPicksIncomplete={quickPicksIncomplete}
      />

      {/* Time-sensitive pane — what needs your attention now. Single
          full-width column instead of being half a 2-column grid;
          previously the right insights rail was much taller than this
          pane and left a long vertical void on desktop. Insights now
          flow below as a 3-column row, eliminating that empty space. */}
      <div className="td-pane">
        {quickPicks !== null && (
          <KnockoutLockCTA
            variant="dashboard"
            hasPicks={quickPicks.winner != null}
            onAction={() => nav('detail', simpleLeagues[0] || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true }, { tab: 'predictions' })}
          />
        )}
        {nextLock && featureFlags.classicEnabled !== false ? (
          <NextLockRow lock={nextLock} now={now} buffer={LOCK_BUFFER_MS} simpleLeagues={simpleLeagues} ml={ml} nav={nav} />
        ) : quickPicksIncomplete ? (
          <QuickPicksLockRow quickPicks={quickPicks} simpleLeagues={simpleLeagues} nav={nav} />
        ) : outstandingOtherLeaguesCount > 0 ? (
          <OutstandingPicksRow leagues={incompleteOtherLeagues} leagueRanks={leagueRanks} nav={nav} />
        ) : (
          <>
            <CaughtUpRow nav={nav} quickPicks={quickPicks} onShare={onShare} />
            {quickPicks?.isComplete && <StageLockTimeline />}
          </>
        )}

        {/* DailyCheckIn removed per user feedback — the daily streak
            loop wasn't pulling weight on the dashboard surface. Friends
            widget below is the more durable engagement surface. */}

        {/* #8 — Friends-in-leagues widget. Hidden when the user has no
            private league (otherwise we'd just show the global crowd,
            which isn't a "friends" surface). */}
        <FriendsWidget leagues={leagues} currentUserId={uData?.id} nav={nav} />

        {liveMatches.length > 0 && (
          <div className="td-live-stack">
            {liveMatches.map(m => <LiveRow key={m.id} match={m} pred={preds[m.id]} now={now} />)}
          </div>
        )}

        <div className="td-resultsblock">
          <div className="td-section-label"><Flame size={12} /> Streak {streak}{streakBadge && <span className={`streak-badge streak-badge-${streakBadge.tier}`}>{streakBadge.emoji} {streakBadge.name}</span>}</div>
          <div className="td-dots">
            {[...Array(10)].map((_, i) => {
              const dot = streakDots[i];
              return <span key={i} className={`td-dot ${dot ? (dot.correct ? 'td-dot-c' : 'td-dot-w') : 'td-dot-x'}`}>{dot ? (dot.correct ? '✓' : '✗') : ''}</span>;
            })}
            <span className="td-dotcap">last {streakDots.length || 0} · best {bestStreak}</span>
          </div>

          {recentResults.length > 0 && (
            <>
              <div className="td-section-label">Recent · last {Math.min(recentResults.length, 5)}</div>
              <div className="td-recent">
                {recentResults.map(m => {
                  const res = results[m.id];
                  const pred = preds[m.id];
                  const pts = pred ? calculatePoints(pred, res, ps) : 0;
                  const ok = pts > 0;
                  return (
                    <div key={m.id} className={`td-recent-row td-recent-${ok ? 'ok' : 'miss'}`}>
                      <span className="td-recent-when">{new Date(m.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      <span className="td-recent-match">
                        <span>{m.homeFlag} {m.home}</span>
                        <strong>{res.homeScore}-{res.awayScore}</strong>
                        <span>{m.away} {m.awayFlag}</span>
                      </span>
                      <span className="td-recent-pts">+{pts}</span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Insights — per-league carousel. Defaults to Global QP and
          lets the user swipe / arrow through every other Quick Picks
          league they're a member of. Each card refetches per league
          via key remount inside the carousel. */}
      <InsightsCarousel userId={uData?.id} leagues={ml} />

      <NewsFeed />

      {/* Bottom strip — leagues. Friends section is a placeholder until the
          friend-graph layer lands; leaving the cell so the layout doesn't
          jump when it arrives. */}
      <div className="td-bottom">
        <div className="td-bottom-cell">
          <div className="td-section-label">Your leagues</div>
          <div className="td-leagues">
            {ml.slice(0, 5).map(l => {
              const rk = leagueRanks[l.id];
              return (
                <button key={l.id} type="button" className="td-league-row" onClick={() => nav('detail', l)}>
                  <span className="td-league-name">{l.name}</span>
                  <span className="td-league-meta">
                    <Users size={11} aria-hidden="true" />
                    {(l.memberCount || l.members?.length || 0).toLocaleString()}
                  </span>
                  <span className="td-league-rank">{rk ? `#${rk.rank}` : <span className="td-skel">—</span>}</span>
                </button>
              );
            })}
            <button type="button" className="td-league-cta" onClick={() => nav('browse')}>
              <Plus size={12} /> Join a league
            </button>
          </div>
        </div>
        <div className="td-bottom-cell">
          <div className="td-section-label">Quick actions</div>
          <div className="td-actions">
            <button type="button" className="td-action" onClick={() => {
              const gs = simpleLeagues[0] || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
              nav('detail', gs, { tab: 'predictions' });
            }}>
              <Target size={14} aria-hidden="true" />
              <span>{quickPicks?.isComplete ? 'Edit my picks' : 'Continue my picks'}</span>
              <ChevronRight size={12} aria-hidden="true" />
            </button>
            <button type="button" className="td-action" onClick={() => nav('create')}>
              <Plus size={14} aria-hidden="true" />
              <span>Create a league</span>
              <ChevronRight size={12} aria-hidden="true" />
            </button>
            <button type="button" className="td-action" onClick={() => nav('browse')}>
              <Users size={14} aria-hidden="true" />
              <span>Join a league</span>
              <ChevronRight size={12} aria-hidden="true" />
            </button>
            <button type="button" className="td-action" onClick={() => nav('faq')}>
              <span style={{width:14,display:'inline-block'}} aria-hidden="true" />
              <span>FAQ &amp; help</span>
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Subcomponents — kept colocated so the data flow stays obvious. These run
// as React.createElement children of Dashboard, NOT as inline functions of
// the parent GoalOracle, so they don't re-mount on parent state changes.

function DashboardStrip({ qpRank, points, accuracy, totalCompleted, streak, streakBadge, quickPicks, quickPicksIncomplete }) {
  return (
    <div className="td-strip">
      <div className="td-strip-cell td-strip-cell-rank">
        <span className="td-label">Global rank</span>
        <span className="td-rank">
          {typeof qpRank?.rank === 'number' ? `#${qpRank.rank}` : <span className="td-skel">#—</span>}
        </span>
        <span className="td-of">{typeof qpRank?.total === 'number' ? `of ${qpRank.total.toLocaleString()}` : '—'}</span>
      </div>
      <div className="td-strip-cell">
        <span className="td-label">Points</span>
        <span className="td-num"><AnimatedCounter value={points} /></span>
      </div>
      <div className="td-strip-cell">
        <span className="td-label">Accuracy</span>
        <span className="td-num">{accuracy}%</span>
        <span className="td-sub">{totalCompleted} played</span>
      </div>
      <div className="td-strip-cell">
        <span className="td-label">Streak</span>
        <span className="td-num"><Flame size={13} /> {streak}</span>
        {streakBadge && <span className="td-sub">{streakBadge.name}</span>}
      </div>
      <div className="td-strip-cell">
        <span className="td-label">My picks</span>
        {quickPicks === null ? (
          <span className="td-num"><span className="td-skel">—</span></span>
        ) : quickPicksIncomplete ? (
          <span className="td-num td-warn">● {quickPicks.totalRemaining} left</span>
        ) : (
          <span className="td-num td-ok">● Locked</span>
        )}
      </div>
    </div>
  );
}

// Variant-E onboarding card (shipped from /__first-pick-preview-q7m2x).
// Prize is the headline (Free Prizes / $150 podium / live countdown), then
// "Steps to enter" as a tight 3-row list, then one CTA. Targets ~400px tall
// on mobile so it fits an iPhone 16 viewport without scrolling. No vanity
// metrics, no champion picker — see the preview page for the design history.
function FirstTimeBanner({ ml, nav }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  // Once the group stage has locked, a new entrant can't make group or
  // best-third picks — they go straight to the knockout bracket, pre-filled
  // with the real teams. Count down to the R32 lock and describe the
  // knockout-only flow instead of group ranking.
  const groupLocked = stageLockTimeUtc('groupStage') <= now;
  const deadlineMs = groupLocked ? stageLockTimeUtc('roundOf32') : stageLockTimeUtc('groupStage');
  const diff = Math.max(0, deadlineMs - now);
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const startWizard = () => {
    const simpleL = ml.find((l) => l.predictionMode === 'simple') || ml[0];
    if (simpleL) nav('detail', simpleL, { tab: 'predictions' });
  };
  const topPrize = PRIZES[0];
  return (
    <div className="td-fp-card">
      <div className="td-fp-prize">
        <div className="td-fp-eyebrow">🎁 FREE PRIZES</div>
        <h2 className="td-fp-title">Win up to <span className="td-fp-amount">${topPrize.amount}</span> in {topPrize.currency}</h2>
        <div className="td-fp-podium" aria-label="Prize tiers">
          <div className="td-fp-tier td-fp-tier-2"><span className="td-fp-medal">{PRIZES[1].medal}</span><span className="td-fp-money">${PRIZES[1].amount}</span></div>
          <div className="td-fp-tier td-fp-tier-1"><span className="td-fp-medal">{PRIZES[0].medal}</span><span className="td-fp-money">${PRIZES[0].amount}</span></div>
          <div className="td-fp-tier td-fp-tier-3"><span className="td-fp-medal">{PRIZES[2].medal}</span><span className="td-fp-money">${PRIZES[2].amount}</span></div>
        </div>
        <div className="td-fp-countdown" aria-live="polite">
          <span aria-hidden="true">⏱</span>
          <span>{groupLocked ? 'Bracket locks' : 'Locks'} in <b>{days}d {String(hours).padStart(2, '0')}h {String(minutes).padStart(2, '0')}m</b></span>
        </div>
      </div>
      <div className="td-fp-steps">
        <div className="td-fp-steps-title">{groupLocked ? 'How it works' : 'Steps to enter'}</div>
        {groupLocked ? (
          <ol className="td-fp-list">
            <li><span className="td-fp-num">1</span><span className="td-fp-step-title">The real Round of 32 is pre-filled for you</span><span className="td-fp-step-time" /></li>
            <li><span className="td-fp-num">2</span><span className="td-fp-step-title">Pick the winner of every knockout match</span><span className="td-fp-step-time">~2 min</span></li>
            <li><span className="td-fp-num">3</span><span className="td-fp-step-title">Reach the Final and lock it in</span><span className="td-fp-step-time" /></li>
          </ol>
        ) : (
          <ol className="td-fp-list">
            <li><span className="td-fp-num">1</span><span className="td-fp-step-title">Rank the 12 groups</span><span className="td-fp-step-time">~1 min</span></li>
            <li><span className="td-fp-num">2</span><span className="td-fp-step-title">Pick the 8 best 3rd-places</span><span className="td-fp-step-time">~30 sec</span></li>
            <li><span className="td-fp-num">3</span><span className="td-fp-step-title">Fill the bracket to the Final</span><span className="td-fp-step-time">~90 sec</span></li>
          </ol>
        )}
      </div>
      <div className="td-fp-action">
        <button type="button" className="td-fp-cta" onClick={startWizard}>
          {groupLocked ? 'Pick my knockout bracket' : 'Start predicting · ~3 min'} <ChevronRight size={14} />
        </button>
        <div className="td-fp-foot">Auto-saves as you go</div>
      </div>
    </div>
  );
}

function NextLockRow({ lock, now, buffer, simpleLeagues, ml, nav }) {
  const remaining = lock.lockAt - now;
  const urgent = remaining < 60 * 60 * 1000;
  const classicLeague = ml.find(l => l.predictionMode === 'classic') || ml[0];
  return (
    <div className={`td-row td-row-lock ${urgent ? 'td-row-urgent' : ''}`}>
      <Lock size={14} className="td-row-icon" />
      <div className="td-row-body">
        <div className="td-row-title">{lock.m.homeFlag} {lock.m.home} <span className="td-vs">vs</span> {lock.m.awayFlag} {lock.m.away}</div>
        <div className="td-row-sub">Locks in <strong>{formatLockDelta(remaining)}</strong></div>
      </div>
      <button className="td-row-cta" onClick={() => classicLeague && nav('detail', classicLeague, { tab: 'predictions' })}>
        Predict <ChevronRight size={11} />
      </button>
    </div>
  );
}

function QuickPicksLockRow({ quickPicks, simpleLeagues, nav }) {
  const eta = Math.max(1, Math.round(quickPicks.totalRemaining * 8 / 60));
  const made = Math.max(0, QP_TOTAL_PICKS - (quickPicks.totalRemaining || 0));
  const pct = Math.min(100, Math.round((made / QP_TOTAL_PICKS) * 100));
  // Specific countdown to the group-stage lock (gs01 - 5min). Far more
  // motivating than the vague "locks at kickoff".
  const lockMs = stageLockTimeUtc('groupStage') - Date.now();
  const lockText = lockMs > 0 ? `locks in ${formatLockDelta(lockMs)}` : 'locks have started';
  return (
    <div className="td-row td-row-lock">
      <Target size={14} className="td-row-icon" />
      <div className="td-row-body">
        <div className="td-row-title">Finish your bracket</div>
        <div className="td-row-sub"><strong>{made}/{QP_TOTAL_PICKS}</strong> picks · ~{eta} min left · {lockText}</div>
        <div className="td-progress" aria-label={`${pct}% complete`}>
          <div className="td-progress-fill" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <button className="td-row-cta" onClick={() => {
        const qp = simpleLeagues[0] || { id: 'global-simple', predictionMode: 'simple' };
        nav('detail', qp, { tab: 'predictions' });
      }}>
        Continue <ChevronRight size={11} />
      </button>
    </div>
  );
}

function CaughtUpRow({ nav, quickPicks, onShare }) {
  // Find the next stage lock that hasn't fired yet so the user has a
  // tangible "your next deadline" target instead of "come back later".
  const now = Date.now();
  const nextStage = STAGES.map((s) => ({ stage: s, lockAt: stageLockTimeUtc(s) }))
    .find((x) => x.lockAt > now);
  const remaining = nextStage ? nextStage.lockAt - now : 0;
  const stageLabel = nextStage ? STAGE_LABELS[nextStage.stage] : null;
  const canShare = !!quickPicks?.isComplete && typeof onShare === 'function';

  return (
    <div className="td-row td-row-idle">
      <CheckCircle size={14} className="td-row-icon" />
      <div className="td-row-body">
        <div className="td-row-title">
          {nextStage
            ? <>Bracket locked in. <span className="td-row-em">{stageLabel}</span> picks freeze in <strong>{formatLockDelta(remaining)}</strong>.</>
            : 'Tournament wrapping up — sit back and watch.'}
        </div>
        <div className="td-row-sub">
          {nextStage
            ? 'You can still tweak later rounds until each stage starts. Or share your bracket and brag.'
            : 'Final results are in.'}
        </div>
      </div>
      {canShare ? (
        <button className="td-row-cta" onClick={onShare}>
          Share bracket <ChevronRight size={11} />
        </button>
      ) : (
        <button className="td-row-cta td-row-cta-ghost" onClick={() => nav('browse')}>
          Join another league <ChevronRight size={11} />
        </button>
      )}
    </div>
  );
}

// #10: Compact horizontal stage-lock timeline shown on the completed
// dashboard so the user can see at a glance which rounds are still
// editable and when each freezes.
function StageLockTimeline() {
  const now = Date.now();
  return (
    <div className="td-stage-timeline" aria-label="Stage locks timeline">
      {STAGES.map((stage) => {
        const lockAt = stageLockTimeUtc(stage);
        const locked = now >= lockAt;
        const delta = lockAt - now;
        return (
          <div key={stage} className={`td-stage-pill ${locked ? 'td-stage-locked' : ''}`}>
            <span className="td-stage-name">{STAGE_LABELS[stage]}</span>
            <span className="td-stage-when">
              {locked ? <><Lock size={9} /> locked</> : `in ${formatLockDelta(delta)}`}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Reuses .td-row-lock styling from QuickPicksLockRow so the warning
// reads as urgent. Surfaces total outstanding picks across the user's
// non-global QP leagues and routes to the first incomplete one — the
// user can finish there and the row updates as data refreshes.
function OutstandingPicksRow({ leagues, leagueRanks, nav }) {
  const totalLeft = leagues.reduce((sum, l) => sum + (leagueRanks[l.id]?.myPicksLeft || 0), 0);
  const first = leagues[0];
  const eta = Math.max(1, Math.round(totalLeft * 8 / 60));
  return (
    <div className="td-row td-row-lock">
      <Target size={14} className="td-row-icon" />
      <div className="td-row-body">
        <div className="td-row-title">
          {leagues.length === 1
            ? `Picks pending in ${first.name}`
            : `Picks pending across ${leagues.length} leagues`}
        </div>
        <div className="td-row-sub">
          <strong>{totalLeft}</strong> pick{totalLeft === 1 ? '' : 's'} left · ~{eta} min · each league has its own bracket
        </div>
      </div>
      <button className="td-row-cta" onClick={() => nav('detail', first, { tab: 'predictions' })}>
        Finish {first.name} <ChevronRight size={11} />
      </button>
    </div>
  );
}

function LiveRow({ match, pred, now }) {
  const k = matchKickoffMs(match);
  const minute = Math.max(1, Math.floor((now - k) / 60_000));
  const myPick = pred?.result === 'home' ? match.home : pred?.result === 'away' ? match.away : pred?.result === 'draw' ? 'Draw' : null;
  return (
    <div className="td-row td-row-live">
      <Zap size={14} className="td-row-icon" />
      <div className="td-row-body">
        <div className="td-row-title">{match.homeFlag} {match.home} <span className="td-vs">vs</span> {match.awayFlag} {match.away} <span className="td-min">{minute}'</span></div>
        {myPick && <div className="td-row-sub">Your pick: <strong>{myPick}</strong></div>}
      </div>
    </div>
  );
}
