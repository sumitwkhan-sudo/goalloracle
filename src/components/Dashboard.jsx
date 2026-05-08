import React, { useEffect, useMemo, useState } from 'react';
import {
  Trophy, Users, ChevronRight, CheckCircle, Clock, Target, Plus,
  Search, Lock, Star, Flame,
} from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import { calculateXP, getLevelInfo } from '../utils/xp';
import { calculateStreak, getStreakBadge, calculateTotalPoints, calculatePoints, getMatchStatus, sortLeaderboard } from '../utils/points';
import { getSimpleLeaderboard, getLeagueLeaderboard } from '../utils/db';
import AnimatedCounter from './AnimatedCounter';
import BoldestCallCard from './simple/BoldestCallCard';
import MostContestedCard from './simple/MostContestedCard';
import BracketSurvivalCard from './simple/BracketSurvivalCard';

const DEFAULT_PS = { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 };

// Compute the kickoff-lock countdown string for a match. Returns 'LOCKED'
// once we're inside the 5-min buffer or past kickoff.
function computeCountdown(match) {
  const [hh, mm] = (match.time || '15:00').split(':').map(Number);
  const kick = new Date(`${match.date}T00:00:00Z`);
  kick.setUTCHours(hh + 4, mm, 0, 0);
  const lockMs = kick.getTime() - 5 * 60 * 1000;
  const diff = lockMs - Date.now();
  if (diff <= 0) return 'LOCKED';
  const d = Math.floor(diff / 86400000), h = Math.floor((diff % 86400000) / 3600000), mi = Math.floor((diff % 3600000) / 60000);
  return d > 0 ? `${d}d ${h}h` : `${h}h ${mi}m`;
}

function Countdown({ match }) {
  const [ct, setCt] = useState(() => computeCountdown(match));
  useEffect(() => {
    setCt(computeCountdown(match));
    const iv = setInterval(() => setCt(computeCountdown(match)), 60000);
    return () => clearInterval(iv);
  }, [match.date, match.time]);
  return <span className="dv2-countdown">{ct === 'LOCKED' ? <><Lock size={10} /> Locked</> : <><Clock size={10} /> Closes in {ct}</>}</span>;
}

// Pulled out of GoalOracle so it has a stable component reference across the
// parent's re-renders. With the inline definition, every parent setState
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

  const needsPrediction = useMemo(() =>
    WORLD_CUP_MATCHES.filter(m => getMatchStatus(m.date, m.time) === 'open' && !results[m.id]?.completed && !preds[m.id]?.result).slice(0, 4),
  [preds, results]);

  const simpleLeagues = useMemo(() => ml.filter(l => l.predictionMode === 'simple'), [ml]);

  // Don't flag "first time" until the Quick Picks fetch has resolved once —
  // otherwise returning users briefly see the onboard banner flash before
  // their picks arrive from Firestore, then watch it get replaced by stats.
  // `quickPicks === null` means "not loaded yet"; max totalRemaining is
  // 12 groups + 8 thirds + 32 bracket winners = 52.
  const isFirstTime = quickPicks !== null
    && quickPicks.totalRemaining === 52
    && Object.keys(preds).length === 0
    && totalCompleted === 0;

  const quickPicksIncomplete = !!quickPicks && !quickPicks.isComplete && simpleLeagues.length > 0;
  const firstMatch = useMemo(() => WORLD_CUP_MATCHES.find(m => getMatchStatus(m.date, m.time) === 'open') || WORLD_CUP_MATCHES[0], []);

  // Pick the single highest-priority "do this next" action for the hero
  // card. Priority order: finish Quick Picks → a Classic match locking
  // soon → rank teaser (if there's competition) → fallback explore card.
  const continueCard = useMemo(() => {
    if (quickPicks === null) return null;

    if (quickPicksIncomplete) {
      const etaMin = Math.max(1, Math.round(quickPicks.totalRemaining * 8 / 60));
      const qpLeague = simpleLeagues[0];
      return {
        kind: 'quickpicks',
        eyebrow: 'Quick Picks',
        title: `Finish your bracket — ${quickPicks.totalRemaining} pick${quickPicks.totalRemaining === 1 ? '' : 's'} left`,
        sub: `About ${etaMin} min · locks when the opener kicks off`,
        cta: 'Continue picking',
        onClick: () => { if (qpLeague) { nav('detail', qpLeague, { tab: 'predictions' }); } else { nav('simplePredict'); } },
      };
    }

    const now = Date.now();
    const LOCK_BUFFER_MS = 5 * 60 * 1000;
    const SOON_MS = 24 * 60 * 60 * 1000;
    const soon = featureFlags.classicEnabled === false ? null : needsPrediction.find(m => {
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
        onClick: () => { if (classicLeague) { nav('detail', classicLeague, { tab: 'predictions' }); } },
      };
    }

    const qpGlobalRk = leagueRanks['global-simple'];
    if (qpGlobalRk && qpGlobalRk.total > 1) {
      const leading = qpGlobalRk.rank === 1;
      return {
        kind: 'rank',
        eyebrow: 'Global League',
        title: leading
          ? `You're #1 of ${qpGlobalRk.total.toLocaleString()}`
          : `You're #${qpGlobalRk.rank.toLocaleString()} of ${qpGlobalRk.total.toLocaleString()}`,
        sub: leading ? `Hold the top spot until June 11.` : `See who's ahead of you and why.`,
        cta: 'Open leaderboard',
        onClick: () => {
          const qpLeague = simpleLeagues[0] || leagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
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
  }, [quickPicks, quickPicksIncomplete, simpleLeagues, needsPrediction, ml, leagueRanks, leagues, featureFlags.classicEnabled, nav]);

  const recentResults = useMemo(() =>
    WORLD_CUP_MATCHES.filter(m => results[m.id]?.completed).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5),
  [results]);

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

  // Fetch league ranks on mount / when the user's league set or live results
  // change. Uses an effect rather than a memo because we batch multiple
  // network calls in flight.
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
    // ml.length is sufficient — we don't want to refetch on every league
    // object identity change. Same with results: leaderboard rank depends
    // on results, but we pull fresh on results changes by including it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uData?.id, ml.length, results]);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="dashboard-v2">
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

      {isFirstTime ? (
        <div className="dv2-onboard">
          <div className="dv2-onboard-inner">
            <div className="dv2-onboard-text">
              <h2>Make your first pick</h2>
              <p>Takes about 3 minutes. Rank the groups, pick your best thirds, fill the bracket. Your picks auto-save as you go.</p>
            </div>
            <button className="btn btn-primary btn-lg" onClick={() => {
              const simpleL = ml.find(l => l.predictionMode === 'simple') || ml[0];
              nav('detail', simpleL, { tab: 'predictions' });
            }}>
              Start predicting <ChevronRight size={16} />
            </button>
          </div>
        </div>
      ) : (
        <>
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

      <div className="dv2-section dv2-cta-section">
        <button
          type="button"
          className="dv2-cta-primary"
          onClick={() => {
            const gs = leagues.find(l => l.id === 'global-simple') || { id: 'global-simple', name: 'Global League', type: 'free', predictionMode: 'simple', isGlobal: true };
            nav('detail', gs, { tab: 'predictions' });
          }}
        >
          <span className="dv2-cta-primary-icon"><Target size={18} /></span>
          <span className="dv2-cta-primary-label">
            {quickPicks && quickPicks.isComplete ? 'Edit your Quick Picks' : 'Continue your Quick Picks'}
          </span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
        <div className="dv2-cta-row">
          <button type="button" className="dv2-cta-secondary" onClick={() => nav('browse')}>
            <Users size={14} aria-hidden="true" /> Join a league
          </button>
          <button type="button" className="dv2-cta-secondary" onClick={() => nav('create')}>
            <Plus size={14} aria-hidden="true" /> Create a league
          </button>
        </div>
      </div>

      {uData?.id && (
        <BoldestCallCard userId={uData.id} leagueId="global-simple" />
      )}
      <MostContestedCard leagueId="global-simple" />
      {uData?.id && (
        <BracketSurvivalCard userId={uData.id} leagueId="global-simple" />
      )}

      {quickPicks === null ? (
        <div className="dv2-section"><div className="dv2-section-placeholder" aria-hidden="true" /></div>
      ) : (needsPrediction.length > 0 || quickPicksIncomplete) ? (
        <div className="dv2-section">
          <h3 className="dv2-section-title">Needs Your Prediction</h3>
          <div className="dv2-action-cards">
            {quickPicksIncomplete && simpleLeagues.map(qpLeague => {
              const remainingBits = [];
              if (quickPicks.groupsRemaining > 0) remainingBits.push(`${quickPicks.groupsRemaining} group${quickPicks.groupsRemaining > 1 ? 's' : ''}`);
              if (quickPicks.thirdsRemaining > 0) remainingBits.push(`${quickPicks.thirdsRemaining} best-third${quickPicks.thirdsRemaining > 1 ? 's' : ''}`);
              if (quickPicks.bracketRemaining > 0) remainingBits.push(`${quickPicks.bracketRemaining} bracket winner${quickPicks.bracketRemaining > 1 ? 's' : ''}`);
              const summary = remainingBits.length > 0 ? remainingBits.join(' · ') : 'Finish your picks';
              const estMin = Math.max(1, Math.round(quickPicks.totalRemaining * 8 / 60));
              return (
                <div key={qpLeague.id} className="dv2-action-card dv2-action-card-qp" onClick={() => nav('detail', qpLeague, { tab: 'predictions' })}>
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
            {featureFlags.classicEnabled !== false && needsPrediction.map(m => {
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

      <div className="dv2-xp-strip">
        <Star size={14} /> Level {lvl.level} &mdash; {lvl.title}
        <div className="dv2-xp-bar"><div className="dv2-xp-fill" style={{width:`${lvl.progress*100}%`}} /></div>
        <span className="dv2-xp-num">{lvl.totalXP.toLocaleString()} / {lvl.isMaxLevel ? 'MAX' : lvl.nextLevelXP.toLocaleString()} XP</span>
      </div>
    </div>
  );
}
