/**
 * BracketAlignmentCard
 *
 * Single-number insight: how aligned the user's full knockout bracket
 * is with the global crowd consensus. For every (round, matchId) the
 * user picked a winner for, we look up whether that team is also the
 * crowd's top pick for the same slot. Count of matches ÷ total picks
 * = alignment %.
 *
 * Distinct from the Boldest-pick card:
 *   - Boldest = the one MOST contrarian pick (lowest consensus).
 *   - Alignment = the WHOLE bracket's mainstream-ness aggregated.
 *
 * The user's PICKS are pulled per-league (so a private league shows
 * the user's bracket for THAT league). The COMPARISON crowd is
 * always global-simple — comparing a private-league bracket against
 * a 3-person private-league crowd is statistical noise; comparing
 * against thousands of global submitters is signal. Hidden only
 * when global-simple itself has too few submitters or the user
 * hasn't picked anything.
 */

import React, { useEffect, useState } from 'react';
import { Compass } from 'lucide-react';
import { getSimplePrediction, getSimpleConsensus } from '../../utils/db';

const ROUND_KEYS = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
const MIN_USER_THRESHOLD = 3;

export default function BracketAlignmentCard({ userId, leagueId }) {
  const [stats, setStats] = useState(null); // { aligned, total, pct }

  useEffect(() => {
    if (!userId || !leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        // Per-league prediction; always-global comparison crowd. See
        // file header for why a private-league crowd of 3 is noise.
        const [pred, consensus] = await Promise.all([
          getSimplePrediction(userId, leagueId),
          getSimpleConsensus('global-simple'),
        ]);
        if (cancelled) return;
        if (!pred || !consensus || (consensus.totalUsers || 0) < MIN_USER_THRESHOLD) return;

        const ko = pred.knockoutPredictions || {};
        let aligned = 0;
        let total = 0;
        for (const round of ROUND_KEYS) {
          const slots = Array.isArray(ko[round]) ? ko[round] : [];
          for (const slot of slots) {
            if (!slot?.winnerId || !slot?.matchId) continue;
            total++;
            const matchConsensus = consensus.knockout?.[round]?.[slot.matchId];
            if (!matchConsensus) continue;
            // Find the team the crowd most agrees on for this slot.
            const topTeam = Object.entries(matchConsensus)
              .sort(([, a], [, b]) => b - a)[0]?.[0];
            if (topTeam && topTeam === slot.winnerId) aligned++;
          }
        }
        if (total > 0) {
          setStats({ aligned, total, pct: aligned / total });
        }
      } catch {
        // non-fatal — widget just won't render
      }
    })();
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  if (!stats) return null;

  const pctRound = Math.round(stats.pct * 100);
  // Tone the headline based on where on the spectrum the user lands.
  // 0–35% = strong contrarian, 36–60% = balanced, 61–100% = mainstream.
  const tone = pctRound <= 35 ? 'contrarian' : pctRound >= 61 ? 'mainstream' : 'balanced';
  const verdict = tone === 'contrarian'
    ? 'Bold contrarian'
    : tone === 'mainstream'
      ? 'Running with the herd'
      : 'Mixed strategy';

  return (
    <div className={`alignment-card insight-card alignment-${tone}`} role="status">
      <div className="alignment-head">
        <span className="alignment-icon" aria-hidden="true"><Compass size={11} /></span>
        <span className="alignment-label">Crowd alignment</span>
      </div>
      <div className="alignment-body">
        <span className="alignment-pct"><strong>{pctRound}%</strong> of your picks match the crowd</span>
        <span className="alignment-meta">{stats.aligned} of {stats.total} · {verdict}</span>
      </div>
    </div>
  );
}
