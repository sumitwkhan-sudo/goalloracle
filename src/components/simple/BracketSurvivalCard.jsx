/**
 * BracketSurvivalCard
 *
 * Dashboard widget tracking how many of the user's predicted advances
 * are still possible given current match results. Pre-tournament every
 * pick is "alive" by definition — the card shows full counts plus a
 * "Tournament starts in N days" banner. Post-kickoff, the same shape
 * decrements as teams the user picked are eliminated.
 *
 * Pure render — pulls data via subscribeToMatchResults and a one-shot
 * getSimplePrediction; computeSurvival in src/utils/bracketSurvival.js
 * is the unit-tested logic this component renders.
 *
 * NOTE: full mid-tournament accuracy depends on matchLookup having the
 * actual home/away team names for each knockout fixture, which only
 * resolves after the group stage. Pre-group-stage WORLD_CUP_MATCHES
 * has placeholders ("Winner R32-01"), so eliminations won't decrement
 * past the group stage until those slots are populated by real
 * teams. Acceptable for the May launch since the tournament starts
 * June 11.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Shield } from 'lucide-react';
import { getSimplePrediction, subscribeToMatchResults } from '../../utils/db';
import { computeSurvival, isPreTournament } from '../../utils/bracketSurvival';
import WORLD_CUP_MATCHES from '../../data/matches';

const ROUND_LABEL = {
  roundOf32: 'R32',
  roundOf16: 'R16',
  quarterFinals: 'QF',
  semiFinals: 'SF',
  thirdPlace: '3rd',
  final: 'Final',
};

// Tournament kickoff — Date.UTC for 11 Jun 2026 19:00 UTC (15:00 ET).
const KICKOFF_MS = Date.UTC(2026, 5, 11, 19, 0, 0);

function daysUntilKickoff() {
  const diff = KICKOFF_MS - Date.now();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export default function BracketSurvivalCard({ userId, leagueId = 'global-simple' }) {
  const [prediction, setPrediction] = useState(null);
  const [matchResults, setMatchResults] = useState({});

  useEffect(() => {
    if (!userId || !leagueId) return;
    let cancelled = false;
    getSimplePrediction(userId, leagueId)
      .then((p) => { if (!cancelled) setPrediction(p); })
      .catch(() => { /* hidden if missing */ });
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  useEffect(() => {
    return subscribeToMatchResults(setMatchResults);
  }, []);

  const matchLookup = useMemo(() => {
    const out = {};
    for (const m of WORLD_CUP_MATCHES) {
      if (m.isKnockout) out[m.id] = { home: m.home, away: m.away };
    }
    return out;
  }, []);

  const survival = useMemo(
    () => prediction ? computeSurvival(prediction.knockoutPredictions, matchResults, matchLookup) : null,
    [prediction, matchResults, matchLookup]
  );

  // Hidden when we have nothing to show — user hasn't submitted any
  // bracket picks at all, or the data hasn't loaded yet.
  if (!survival) return null;
  const totalPicks = Object.values(survival).reduce((s, r) => s + r.total, 0);
  if (totalPicks === 0) return null;

  const pre = isPreTournament(matchResults);
  const days = pre ? daysUntilKickoff() : 0;

  return (
    <div className="bracket-survival-card" role="status">
      <div className="bs-card-head">
        <span className="bs-card-icon" aria-hidden="true"><Shield size={14} /></span>
        <span className="bs-card-title">Bracket survival</span>
        {pre && days > 0 && (
          <span className="bs-card-pre">Tournament starts in {days} day{days === 1 ? '' : 's'}</span>
        )}
      </div>
      <ul className="bs-card-rows">
        {Object.keys(ROUND_LABEL).map((round) => {
          const r = survival[round] || { alive: 0, total: 0 };
          if (r.total === 0) return null;
          const pctAlive = r.total > 0 ? r.alive / r.total : 0;
          return (
            <li key={round} className="bs-card-row">
              <span className="bs-card-round">{ROUND_LABEL[round]}</span>
              <div className="bs-card-bar" aria-hidden="true">
                <div className="bs-card-bar-fill" style={{ width: `${pctAlive * 100}%` }} />
              </div>
              <span className={`bs-card-count ${r.alive < r.total ? 'is-cracked' : ''}`}>
                {r.alive} / {r.total}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
