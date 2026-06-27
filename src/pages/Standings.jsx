/**
 * Standings.jsx — World Cup 2026 live group standings + match results, with
 * an optional "compare to my bracket" overlay (item: nav Standings page).
 *
 * Two views (segmented control): Group Standings and Match Results, both fed
 * by the live `results` map (matchResults) the app already subscribes to.
 *
 * Compare mode overlays the signed-in user's Quick Picks group ranking onto
 * the current tables — per group it shows their live points (scoreGroup) and
 * marks each team correct/!correct vs where they predicted it. The user picks
 * WHICH league's bracket to compare via a selector (defaults to Global).
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { BarChart3, ListChecks, GitCompareArrows, Trophy, Check, ChevronDown, RefreshCw } from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import TEAM_COLORS from '../data/teamColors';
import { computeLiveStandings, GROUP_LETTERS, countGroupMatchesPlayed, mergeLiveScores } from '../utils/liveStandings';
import { scoreGroup, GROUP_STAGE_MAX_PER_GROUP } from '../utils/scoringSimple';
import { getSimplePrediction, fetchLiveScores } from '../utils/db';

const flagOf = (name) => TEAM_COLORS[name]?.flag || '🏳️';
const GROUP_MATCHES = WORLD_CUP_MATCHES.filter((m) => !m.isKnockout);

// ─── A single group's standings card ───────────────────────────────
function GroupCard({ letter, rows, compare, pred, live = false }) {
  const complete = !live && rows.every((t) => t.played === 3);
  const started = rows.some((t) => t.played > 0);
  const actualNames = rows.map((t) => t.name);
  const livePts = compare && pred ? scoreGroup(pred, actualNames) : null;

  return (
    <div className="wcs-group">
      <div className="wcs-group-head">
        <span className="wcs-group-badge">{letter}</span>
        <span className="wcs-group-title">Group {letter}</span>
        {live ? (
          <span className="wcs-group-state is-playing"><span className="wcs-live-pip" aria-hidden="true" />LIVE</span>
        ) : started ? (
          <span className={`wcs-group-state ${complete ? 'is-final' : 'is-live'}`}>
            {complete ? 'Final' : 'In progress'}
          </span>
        ) : null}
        {compare && pred && (
          <span className="wcs-group-pts" title="Your live points for this group">
            {livePts}<span className="wcs-group-pts-max">/{GROUP_STAGE_MAX_PER_GROUP}</span>
          </span>
        )}
      </div>

      <div className={`wcs-table ${compare && pred ? 'wcs-table-compare' : ''}`}>
        <div className="wcs-trow wcs-thead">
          <span className="wcs-c-pos">#</span>
          <span className="wcs-c-team">Team</span>
          {compare && pred && <span className="wcs-c-pick" title="Where you ranked them">You</span>}
          <span className="wcs-c-num">P</span>
          <span className="wcs-c-num wcs-hide-xs">W</span>
          <span className="wcs-c-num wcs-hide-xs">D</span>
          <span className="wcs-c-num wcs-hide-xs">L</span>
          <span className="wcs-c-num">GD</span>
          <span className="wcs-c-num wcs-c-pts">Pts</span>
        </div>

        {rows.map((t, i) => {
          const pos = i + 1;
          const qual = pos <= 2 ? 'q-top' : pos === 3 ? 'q-third' : 'q-out';
          const predictedPos = compare && pred ? (pred.indexOf(t.name) + 1 || null) : null;
          const correct = compare && pred && pred[i] === t.name;
          return (
            <div key={t.name} className={`wcs-trow wcs-${qual} ${correct ? 'wcs-correct' : (compare && pred ? 'wcs-miss' : '')}`}>
              <span className="wcs-c-pos"><span className="wcs-pos-bar" />{pos}</span>
              <span className="wcs-c-team">
                <span className="wcs-flag" aria-hidden="true">{flagOf(t.name)}</span>
                <span className="wcs-team-name">{t.name}</span>
              </span>
              {compare && pred && (
                <span className="wcs-c-pick">
                  {predictedPos ? (
                    <span className={`wcs-pick-chip ${correct ? 'is-hit' : 'is-off'}`}>
                      {correct ? <Check size={11} /> : `#${predictedPos}`}
                    </span>
                  ) : <span className="wcs-pick-na">—</span>}
                </span>
              )}
              <span className="wcs-c-num">{t.played}</span>
              <span className="wcs-c-num wcs-hide-xs">{t.w}</span>
              <span className="wcs-c-num wcs-hide-xs">{t.d}</span>
              <span className="wcs-c-num wcs-hide-xs">{t.l}</span>
              <span className="wcs-c-num">{t.gd > 0 ? `+${t.gd}` : t.gd}</span>
              <span className="wcs-c-num wcs-c-pts">{t.pts}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Best 3rd-placed teams ladder (top 8 of 12 advance) ─────────────
// Ranks every group's 3rd-placed team against each other (points → GD → GF),
// mirroring the cross-group order the bracket resolver uses for Annexe C. The
// top 8 advance to the Round of 32; positions are provisional until all groups
// finish. Optionally marks the groups the user picked as best-thirds (compare).
function ThirdsLadder({ standings, allComplete, compare, bestThirdPicks }) {
  const thirds = GROUP_LETTERS
    .map((g) => { const row = standings[g]?.[2]; return row ? { ...row, group: g } : null; })
    .filter((t) => t && t.played > 0);
  if (thirds.length === 0) return null;
  thirds.sort((a, b) => (b.pts - a.pts) || (b.gd - a.gd) || (b.gf - a.gf) || a.group.localeCompare(b.group));
  const picks = compare && Array.isArray(bestThirdPicks) ? new Set(bestThirdPicks) : null;

  return (
    <div className="wcs-thirds">
      <div className="wcs-thirds-head">
        <Trophy size={14} aria-hidden="true" />
        <span className="wcs-thirds-title">Best third-placed teams</span>
        <span className="wcs-thirds-note">
          Top 8 of 12 reach the Round of 32{allComplete ? '' : ' · provisional until groups finish'}
        </span>
      </div>
      <div className="wcs-table wcs-thirds-table">
        <div className="wcs-trow wcs-thead">
          <span className="wcs-c-pos">#</span>
          <span className="wcs-c-grp">Grp</span>
          <span className="wcs-c-team">Team</span>
          <span className="wcs-c-num">P</span>
          <span className="wcs-c-num">GD</span>
          <span className="wcs-c-num wcs-c-pts">Pts</span>
          <span className="wcs-c-adv" aria-hidden="true" />
        </div>
        {thirds.map((t, i) => {
          const adv = i < 8;
          const youPicked = picks?.has(t.group);
          return (
            <div key={t.group} className={`wcs-trow ${adv ? 'wcs-q-top' : 'wcs-q-out'}`}>
              <span className="wcs-c-pos"><span className="wcs-pos-bar" />{i + 1}</span>
              <span className="wcs-c-grp">{t.group}</span>
              <span className="wcs-c-team">
                <span className="wcs-flag" aria-hidden="true">{flagOf(t.name)}</span>
                <span className="wcs-team-name">{t.name}</span>
              </span>
              <span className="wcs-c-num">{t.played}</span>
              <span className="wcs-c-num">{t.gd > 0 ? `+${t.gd}` : t.gd}</span>
              <span className="wcs-c-num wcs-c-pts">{t.pts}</span>
              <span className="wcs-c-adv">
                {adv && <span className="wcs-adv-pill">ADV</span>}
                {youPicked && <span className="wcs-adv-you" title="You picked this group's 3rd to advance">You</span>}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Match results view (grouped by date) ──────────────────────────
export default function Standings({ results = {}, userId, authenticated = false, leagues = [], onSignIn }) {
  const [tab, setTab] = useState('standings'); // 'standings' | 'results'
  const [compare, setCompare] = useState(false);
  const [compareLeagueId, setCompareLeagueId] = useState('global-simple');
  const [brackets, setBrackets] = useState({}); // leagueId -> doc | 'loading' | null
  const [liveScores, setLiveScores] = useState({}); // matchId -> { homeScore, awayScore, status, minute }

  // In-progress scores: poll the public /api/live-scores endpoint every 30s
  // (the cron updates the feed each minute). Polling an endpoint — rather than
  // a client Firestore subscription — means live scores work with no extra
  // Firestore rule. Immediate fetch on mount, then on an interval.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const l = await fetchLiveScores();
      if (!cancelled) setLiveScores(l || {});
    };
    load();
    const t = setInterval(load, 30000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // Merge official (FINISHED) results with the live in-progress feed; live
  // games' current scores count toward the standings, finals always win.
  const merged = useMemo(() => mergeLiveScores(results, liveScores), [results, liveScores]);
  const standings = useMemo(() => computeLiveStandings(merged), [merged]);
  const played = useMemo(() => countGroupMatchesPlayed(merged), [merged]);
  const anyLive = useMemo(() => Object.values(liveScores).some((l) => l && (l.status === 'IN_PLAY' || l.status === 'PAUSED')), [liveScores]);
  // Which group letters have a game in progress right now (for the LIVE badge).
  const liveGroups = useMemo(() => {
    const set = new Set();
    for (const m of GROUP_MATCHES) {
      const ls = liveScores[m.id];
      if (ls && (ls.status === 'IN_PLAY' || ls.status === 'PAUSED')) set.add((m.stage || '').replace('Group ', ''));
    }
    return set;
  }, [liveScores]);

  // The leagues whose bracket the user can compare against. Always offer the
  // Global League; add any other Quick Picks leagues they're in.
  const compareLeagues = useMemo(() => {
    const out = [{ id: 'global-simple', name: 'Global League' }];
    for (const l of leagues) {
      if (l.predictionMode === 'simple' && l.id !== 'global-simple') out.push({ id: l.id, name: l.name || 'League' });
    }
    return out;
  }, [leagues]);

  // Lazy-load the selected bracket when compare turns on / selection changes.
  useEffect(() => {
    if (!compare || !userId) return;
    if (brackets[compareLeagueId] !== undefined) return; // cached (incl. null)
    let cancelled = false;
    setBrackets((b) => ({ ...b, [compareLeagueId]: 'loading' }));
    getSimplePrediction(userId, compareLeagueId)
      .then((doc) => { if (!cancelled) setBrackets((b) => ({ ...b, [compareLeagueId]: doc || null })); })
      .catch(() => { if (!cancelled) setBrackets((b) => ({ ...b, [compareLeagueId]: null })); });
    return () => { cancelled = true; };
  }, [compare, userId, compareLeagueId, brackets]);

  const activeBracket = brackets[compareLeagueId];
  const bracketLoading = activeBracket === 'loading';
  const groupPreds = (activeBracket && activeBracket !== 'loading') ? (activeBracket.groupPredictions || {}) : {};
  const hasBracket = Object.values(groupPreds).some((g) => Array.isArray(g?.ranking) && g.ranking.filter(Boolean).length === 4);

  const totalLivePts = useMemo(() => {
    if (!compare || !hasBracket) return null;
    return GROUP_LETTERS.reduce((sum, g) => {
      const pred = groupPreds[g]?.ranking;
      return sum + (pred ? scoreGroup(pred, standings[g].map((t) => t.name)) : 0);
    }, 0);
  }, [compare, hasBracket, groupPreds, standings]);

  const toggleCompare = useCallback(() => {
    if (!authenticated && !userId) { onSignIn?.('compare-standings'); return; }
    setCompare((c) => !c);
  }, [authenticated, userId, onSignIn]);

  return (
    <div className="wcs-page">
      <header className="wcs-hero">
        <div className="wcs-hero-inner">
          <div className="wcs-hero-eyebrow"><Trophy size={13} /> FIFA World Cup 2026</div>
          <h1 className="wcs-hero-title">Standings &amp; Results</h1>
          <p className="wcs-hero-sub">
            Live group tables and every result — and see how the current standings stack up against your bracket.
          </p>
        </div>
      </header>

      <div className="wcs-toolbar">
        <div className="wcs-segmented" role="tablist" aria-label="View">
          <button type="button" role="tab" aria-selected={tab === 'standings'} className={`wcs-seg ${tab === 'standings' ? 'active' : ''}`} onClick={() => setTab('standings')}>
            <BarChart3 size={15} /> Standings
          </button>
          <button type="button" role="tab" aria-selected={tab === 'results'} className={`wcs-seg ${tab === 'results' ? 'active' : ''}`} onClick={() => setTab('results')}>
            <ListChecks size={15} /> Results
          </button>
        </div>

        {tab === 'standings' && (
          <div className="wcs-compare-controls">
            <button type="button" className={`wcs-compare-btn ${compare ? 'active' : ''}`} onClick={toggleCompare} aria-pressed={compare}>
              <GitCompareArrows size={15} /> {compare ? 'Comparing your bracket' : 'Compare to my bracket'}
            </button>
            {compare && (
              <div className="wcs-bracket-select">
                <label className="wcs-select-wrap">
                  <select value={compareLeagueId} onChange={(e) => setCompareLeagueId(e.target.value)} aria-label="Bracket to compare">
                    {compareLeagues.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="wcs-select-chev" aria-hidden="true" />
                </label>
                {totalLivePts != null && (
                  <span className="wcs-total-pts" title="Your total live group-stage points">
                    {totalLivePts} <span className="wcs-total-pts-label">live pts</span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {tab === 'standings' && compare && bracketLoading && (
        <div className="wcs-note"><RefreshCw size={14} className="spin" /> Loading your bracket…</div>
      )}
      {tab === 'standings' && compare && !bracketLoading && !hasBracket && (
        <div className="wcs-note wcs-note-empty">
          No completed bracket found for <strong>{compareLeagues.find((l) => l.id === compareLeagueId)?.name}</strong>. Rank your groups first, then come back to compare.
        </div>
      )}

      {tab === 'standings' ? (
        <>
          {played === 0 && (
            <div className="wcs-note">The group stage hasn’t kicked off yet — tables fill in live as results come in.</div>
          )}
          <div className="wcs-grid">
            {GROUP_LETTERS.map((g) => (
              <GroupCard
                key={g}
                letter={g}
                rows={standings[g]}
                compare={compare && hasBracket}
                pred={groupPreds[g]?.ranking}
                live={liveGroups.has(g)}
              />
            ))}
          </div>
          <ThirdsLadder
            standings={standings}
            allComplete={GROUP_LETTERS.every((g) => standings[g]?.length === 4 && standings[g].every((t) => t.played === 3))}
            compare={compare && hasBracket}
            bestThirdPicks={activeBracket && activeBracket !== 'loading' ? activeBracket.bestThirdPicks : null}
          />
        </>
      ) : (
        <ResultsViewLive results={merged} />
      )}
    </div>
  );
}

// Results grouped by date, reading live scores from the results map.
function ResultsViewLive({ results }) {
  const byDate = useMemo(() => {
    const map = new Map();
    const sorted = [...GROUP_MATCHES].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
    for (const m of sorted) {
      if (!map.has(m.date)) map.set(m.date, []);
      map.get(m.date).push(m);
    }
    return [...map.entries()];
  }, []);

  return (
    <div className="wcs-results">
      {byDate.map(([date, matches]) => (
        <div key={date} className="wcs-day">
          <div className="wcs-day-head">
            {new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
          </div>
          <div className="wcs-day-matches">
            {matches.map((m) => {
              const r = results[m.id];
              const hasScore = r && typeof r.homeScore === 'number' && typeof r.awayScore === 'number';
              const live = !!r?.live;
              const done = hasScore && !live;
              const hWin = done && r.homeScore > r.awayScore;
              const aWin = done && r.awayScore > r.homeScore;
              return (
                <div key={m.id} className={`wcs-match ${live ? 'wcs-match-islive' : ''}`}>
                  <span className="wcs-match-group">{(m.stage || '').replace('Group ', '')}</span>
                  <span className={`wcs-match-team wcs-match-home ${hWin ? 'is-win' : ''}`}>
                    <span className="wcs-team-name">{m.home}</span>
                    <span className="wcs-flag" aria-hidden="true">{m.homeFlag || flagOf(m.home)}</span>
                  </span>
                  <span className="wcs-match-score">
                    {hasScore
                      ? <span className={`wcs-score ${live ? 'wcs-score-live' : ''}`}>{r.homeScore}<span className="wcs-score-dash">–</span>{r.awayScore}</span>
                      : <span className="wcs-match-time">{m.time}</span>}
                    <span className={`wcs-match-state ${live ? 'wcs-state-live' : ''}`}>
                      {live ? (r.minute ? `${r.minute}'` : 'LIVE') : (done ? 'FT' : 'ET')}
                    </span>
                  </span>
                  <span className={`wcs-match-team wcs-match-away ${aWin ? 'is-win' : ''}`}>
                    <span className="wcs-flag" aria-hidden="true">{m.awayFlag || flagOf(m.away)}</span>
                    <span className="wcs-team-name">{m.away}</span>
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
