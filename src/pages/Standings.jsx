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
import { computeLiveStandings, GROUP_LETTERS, countGroupMatchesPlayed } from '../utils/liveStandings';
import { scoreGroup, GROUP_STAGE_MAX_PER_GROUP } from '../utils/scoringSimple';
import { getSimplePrediction } from '../utils/db';

const flagOf = (name) => TEAM_COLORS[name]?.flag || '🏳️';
const GROUP_MATCHES = WORLD_CUP_MATCHES.filter((m) => !m.isKnockout);

// ─── A single group's standings card ───────────────────────────────
function GroupCard({ letter, rows, compare, pred }) {
  const complete = rows.every((t) => t.played === 3);
  const started = rows.some((t) => t.played > 0);
  const actualNames = rows.map((t) => t.name);
  const livePts = compare && pred ? scoreGroup(pred, actualNames) : null;

  return (
    <div className="wcs-group">
      <div className="wcs-group-head">
        <span className="wcs-group-badge">{letter}</span>
        <span className="wcs-group-title">Group {letter}</span>
        {started && (
          <span className={`wcs-group-state ${complete ? 'is-final' : 'is-live'}`}>
            {complete ? 'Final' : 'Live'}
          </span>
        )}
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

// ─── Match results view (grouped by date) ──────────────────────────
export default function Standings({ results = {}, userId, authenticated = false, leagues = [], onSignIn }) {
  const [tab, setTab] = useState('standings'); // 'standings' | 'results'
  const [compare, setCompare] = useState(false);
  const [compareLeagueId, setCompareLeagueId] = useState('global-simple');
  const [brackets, setBrackets] = useState({}); // leagueId -> doc | 'loading' | null

  const standings = useMemo(() => computeLiveStandings(results), [results]);
  const played = useMemo(() => countGroupMatchesPlayed(results), [results]);

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
              />
            ))}
          </div>
        </>
      ) : (
        <ResultsViewLive results={results} />
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
              const done = r && r.completed === true && typeof r.homeScore === 'number';
              const hWin = done && r.homeScore > r.awayScore;
              const aWin = done && r.awayScore > r.homeScore;
              return (
                <div key={m.id} className="wcs-match">
                  <span className="wcs-match-group">{(m.stage || '').replace('Group ', '')}</span>
                  <span className={`wcs-match-team wcs-match-home ${hWin ? 'is-win' : ''}`}>
                    <span className="wcs-team-name">{m.home}</span>
                    <span className="wcs-flag" aria-hidden="true">{m.homeFlag || flagOf(m.home)}</span>
                  </span>
                  <span className="wcs-match-score">
                    {done
                      ? <span className="wcs-score">{r.homeScore}<span className="wcs-score-dash">–</span>{r.awayScore}</span>
                      : <span className="wcs-match-time">{m.time}</span>}
                    <span className="wcs-match-state">{done ? 'FT' : 'ET'}</span>
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
