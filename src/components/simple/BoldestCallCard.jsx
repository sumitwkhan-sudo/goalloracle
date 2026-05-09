/**
 * BoldestCallCard
 *
 * Surfaces the user's top three most contrarian knockout picks
 * relative to the broadest meaningful crowd: the Global Quick Picks
 * consensus. The user's PICKS are pulled per-league (so Team-X's
 * bracket gets compared correctly), but the COMPARISON crowd is
 * always global-simple — comparing a per-league bracket against a
 * 3-person private-league crowd is statistical noise; comparing
 * against thousands of submitters is signal.
 *
 * Hidden when the user hasn't picked anything yet, or when global-
 * simple itself has fewer than MIN_USER_THRESHOLD submitters
 * (early-stage tournament with almost no users).
 */

import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getSimplePrediction, getSimpleConsensus } from '../../utils/db';
import { teamFlags } from '../../utils/flags';

const ROUND_KEYS = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
const ROUND_LABEL = {
  roundOf32: 'R32',
  roundOf16: 'R16',
  quarterFinals: 'QF',
  semiFinals: 'SF',
  thirdPlace: '3rd',
  final: 'Final',
};

const MIN_USER_THRESHOLD = 3;
const TOP_N = 3;

export default function BoldestCallCard({ userId, leagueId }) {
  const [picks, setPicks] = useState(null); // null = loading; [] = no picks

  useEffect(() => {
    if (!userId || !leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        // Per-league prediction (the user's picks for THIS league)
        // but always the global-simple consensus as the comparison
        // crowd. See file header for why.
        const [pred, consensus] = await Promise.all([
          getSimplePrediction(userId, leagueId),
          getSimpleConsensus('global-simple'),
        ]);
        if (cancelled) return;
        if (!pred || !consensus || (consensus.totalUsers || 0) < MIN_USER_THRESHOLD) return;

        const ko = pred.knockoutPredictions || {};
        const candidates = [];
        for (const round of ROUND_KEYS) {
          const slots = Array.isArray(ko[round]) ? ko[round] : [];
          for (const slot of slots) {
            const teamId = slot?.winnerId;
            const matchId = slot?.matchId;
            if (!teamId || !matchId) continue;
            const pct = consensus.knockout?.[round]?.[matchId]?.[teamId];
            if (typeof pct !== 'number') continue;
            candidates.push({ teamId, pct, round });
          }
        }
        candidates.sort((a, b) => a.pct - b.pct);
        // Deduplicate by team — same team appearing in multiple rounds
        // would otherwise dominate the list. Keep the lowest-pct
        // appearance per team so the user sees their boldest call for
        // each underdog rather than three rows of the same name.
        const seen = new Set();
        const top = [];
        for (const c of candidates) {
          if (seen.has(c.teamId)) continue;
          seen.add(c.teamId);
          top.push(c);
          if (top.length >= TOP_N) break;
        }
        if (top.length > 0) setPicks(top);
      } catch {
        // non-fatal — widget just won't render
      }
    })();
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  if (!picks) return null;

  return (
    <div className="boldest-call-card insight-card" role="status">
      <div className="boldest-call-head">
        <span className="boldest-call-icon" aria-hidden="true"><Sparkles size={11} /></span>
        <span className="boldest-call-label">Your boldest picks</span>
      </div>
      <ul className="boldest-call-list">
        {picks.map((p) => {
          const pctRound = Math.max(1, Math.round(p.pct * 100));
          return (
            <li key={`${p.round}-${p.teamId}`} className="boldest-call-row">
              <span className="boldest-call-flag" aria-hidden="true">{teamFlags[p.teamId] || '🏳️'}</span>
              <span className="boldest-call-team">{p.teamId}</span>
              <span className="boldest-call-round">{ROUND_LABEL[p.round]}</span>
              <span className="boldest-call-pct">{pctRound}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
