import React, { useEffect, useMemo, useState } from 'react';
import {
  Trophy, Users, ChevronRight, CheckCircle, Clock, Target, Plus,
  Lock, Zap, Star, Flame, ArrowUp, ArrowDown,
} from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import { calculateXP, getLevelInfo } from '../utils/xp';
import { calculateStreak, getStreakBadge, calculateTotalPoints, calculatePoints, getMatchStatus, sortLeaderboard } from '../utils/points';
import { getSimpleLeaderboard, getLeagueLeaderboard } from '../utils/db';
import AnimatedCounter from './AnimatedCounter';
import BoldestCallCard from './simple/BoldestCallCard';
import MostContestedCard from './simple/MostContestedCard';
import BracketSurvivalCard from './simple/BracketSurvivalCard';
import NewsFeed from './NewsFeed';

const DEFAULT_PS = { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 };

// Match-time helpers — duplicated from utils/db's logic intentionally so the
// dashboard can reason about lock windows without going through the DB layer.
function matchKickoffMs(m) {
  const [hh, mm] = (m.time || '15:00').split(':').map(Number);
  const k = new Date(`${m.date}T00:00:00Z`);
  k.setUTCHours(hh + 4, mm, 0, 0);
  return k.getTime();
}

function formatLockDelta(ms) {
  if (ms <= 0) return 'LOCKED';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const mi = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mi}m`;
  return `${mi}m`;
}

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
}) {
  useTick(60_000);

  const ml = leagues.length > 0 ? leagues : [
    { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', memberCount: stats.totalPlayers },
  ];
  const ps = ml[0]?.pointsSystem || DEFAULT_PS;

  const { streak, bestStreak } = useMemo(() => calculateStreak(preds, results), [preds, results]);
  const streakBadge = getStreakBadge(streak);
  const totalStats = useMemo(() => calculateTotalPoints(preds, results, ps), [preds, results, ps]);
  const xpTotal = useMemo(() => calculateXP(preds, results, leagues.length), [preds, results, leagues.length]);
  const lvl = useMemo(() => getLevelInfo(xpTotal), [xpTotal]);
  const totalCompleted = useMemo(() => Object.entries(preds).filter(([id]) => results[id]?.completed).length, [preds, results]);
  const accuracy = totalCompleted > 0 ? Math.round((totalStats.correctResults / totalCompleted) * 100) : 0;

  // Headline rank — global Quick Picks leaderboard. The Classic 'global'
  // league is hidden across the app, so QP is the canonical rank.
  const qpRank = leagueRanks['global-simple'];

  const simpleLeagues = useMemo(() => ml.filter(l => l.predictionMode === 'simple'), [ml]);
  const quickPicksIncomplete = !!quickPicks && !quickPicks.isComplete && simpleLeagues.length > 0;

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

  // Fetch league ranks on mount + when results change. Same effect as before
  // the rebuild — just lifted to the new layout.
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
  }, [uData?.id, ml.length, results]);

  // Onboarding banner is a separate row above the strip — doesn't replace
  // the dashboard; first-time users still see their (zeroed) state too.
  if (isFirstTime) {
    return (
      <div className="td-shell">
        <FirstTimeBanner ml={ml} nav={nav} />
        <DashboardStrip
          qpRank={qpRank}
          points={totalStats.totalPoints}
          accuracy={accuracy}
          totalCompleted={totalCompleted}
          streak={streak}
          streakBadge={streakBadge}
          lvl={lvl}
          quickPicks={quickPicks}
          quickPicksIncomplete={quickPicksIncomplete}
        />
      </div>
    );
  }

  return (
    <div className="td-shell">
      {/* Top dense strip — every cell carries one piece of canonical state. */}
      <DashboardStrip
        qpRank={qpRank}
        points={totalStats.totalPoints}
        accuracy={accuracy}
        totalCompleted={totalCompleted}
        streak={streak}
        streakBadge={streakBadge}
        lvl={lvl}
        quickPicks={quickPicks}
        quickPicksIncomplete={quickPicksIncomplete}
      />

      <div className="td-grid">
        {/* Time-sensitive pane — what needs your attention now */}
        <div className="td-pane">
          {nextLock && featureFlags.classicEnabled !== false ? (
            <NextLockRow lock={nextLock} now={now} buffer={LOCK_BUFFER_MS} simpleLeagues={simpleLeagues} ml={ml} nav={nav} />
          ) : quickPicksIncomplete ? (
            <QuickPicksLockRow quickPicks={quickPicks} simpleLeagues={simpleLeagues} nav={nav} />
          ) : (
            <CaughtUpRow nav={nav} />
          )}

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

        {/* Insights pane — meta-commentary on the user's bracket. Each card
            self-gates on having enough data to be meaningful, so the pane
            collapses gracefully when consensus is thin. */}
        <aside className="td-pane td-pane-side">
          <div className="td-section-label">Insights</div>
          {uData?.id && <BoldestCallCard userId={uData.id} leagueId="global-simple" />}
          <MostContestedCard leagueId="global-simple" />
          {uData?.id && <BracketSurvivalCard userId={uData.id} leagueId="global-simple" />}
        </aside>
      </div>

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
              <span>{quickPicks?.isComplete ? 'Edit your Quick Picks' : 'Continue Quick Picks'}</span>
              <ChevronRight size={12} aria-hidden="true" />
            </button>
            <button type="button" className="td-action" onClick={() => nav('create')}>
              <Plus size={14} aria-hidden="true" />
              <span>Create a league</span>
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

function DashboardStrip({ qpRank, points, accuracy, totalCompleted, streak, streakBadge, lvl, quickPicks, quickPicksIncomplete }) {
  return (
    <div className="td-strip">
      <div className="td-strip-cell td-strip-cell-rank">
        <span className="td-label">Global rank</span>
        <span className="td-rank">
          {qpRank ? `#${qpRank.rank}` : <span className="td-skel">#—</span>}
        </span>
        <span className="td-of">{qpRank ? `of ${qpRank.total.toLocaleString()}` : '—'}</span>
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
        <span className="td-label">Level</span>
        <span className="td-num">L{lvl.level}</span>
        <span className="td-sub">{lvl.title}</span>
      </div>
      <div className="td-strip-cell">
        <span className="td-label">Quick Picks</span>
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

function FirstTimeBanner({ ml, nav }) {
  return (
    <div className="td-onboard">
      <div>
        <div className="td-onboard-title">Make your first pick</div>
        <div className="td-onboard-sub">Rank groups, pick best thirds, fill the bracket. ~3 minutes, auto-saves.</div>
      </div>
      <button className="td-onboard-cta" onClick={() => {
        const simpleL = ml.find(l => l.predictionMode === 'simple') || ml[0];
        nav('detail', simpleL, { tab: 'predictions' });
      }}>
        Start predicting <ChevronRight size={14} />
      </button>
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
  return (
    <div className="td-row td-row-lock">
      <Target size={14} className="td-row-icon" />
      <div className="td-row-body">
        <div className="td-row-title">Finish your bracket</div>
        <div className="td-row-sub"><strong>{quickPicks.totalRemaining}</strong> picks left · ~{eta} min · locks at kickoff</div>
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

function CaughtUpRow({ nav }) {
  return (
    <div className="td-row td-row-idle">
      <CheckCircle size={14} className="td-row-icon" />
      <div className="td-row-body">
        <div className="td-row-title">All caught up</div>
        <div className="td-row-sub">No picks due right now. Come back when a match is close to kickoff.</div>
      </div>
      <button className="td-row-cta td-row-cta-ghost" onClick={() => nav('browse')}>
        Browse leagues <ChevronRight size={11} />
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
