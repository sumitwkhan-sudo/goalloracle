/**
 * BoldestCallCard
 *
 * Dashboard widget that surfaces the user's most contrarian pick
 * relative to global Quick Picks consensus. Loops the user's
 * knockout picks (champion, runner-up, 3rd, and every R32→Final
 * advance), looks each up in the consensus payload, and returns
 * the single line with the lowest agreement.
 *
 * Hidden when the user hasn't submitted, or when consensus isn't
 * available yet — never renders a misleading number.
 */

import React, { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { getSimplePrediction, getSimpleConsensus } from '../../utils/db';

const ROUND_KEYS = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
const ROUND_ACTION = {
  roundOf32: 'to advance from R32',
  roundOf16: 'to advance from R16',
  quarterFinals: 'to win their quarterfinal',
  semiFinals: 'to reach the Final',
  thirdPlace: 'to take 3rd place',
  final: 'to win it all',
};

// MIN_USER_THRESHOLD: don't surface a "bold pick" until at least
// this many users have submitted. Lowered from 10 → 3 so the card
// renders for early-stage leagues — the % may be noisier with a
// small denominator but the user gets the engagement loop right
// away rather than seeing an empty insights row.
const MIN_USER_THRESHOLD = 3;

export default function BoldestCallCard({ userId, leagueId }) {
  const [boldest, setBoldest] = useState(null); // null = loading or unavailable

  useEffect(() => {
    if (!userId || !leagueId) return;
    let cancelled = false;
    (async () => {
      try {
        const [pred, consensus] = await Promise.all([
          getSimplePrediction(userId, leagueId),
          getSimpleConsensus(leagueId),
        ]);
        if (cancelled) return;
        if (!pred || !consensus || (consensus.totalUsers || 0) < MIN_USER_THRESHOLD) return;

        const ko = pred.knockoutPredictions || {};
        let best = null; // { teamId, pct, round, label }

        for (const round of ROUND_KEYS) {
          const slots = Array.isArray(ko[round]) ? ko[round] : [];
          for (const slot of slots) {
            const teamId = slot?.winnerId;
            const matchId = slot?.matchId;
            if (!teamId || !matchId) continue;
            const pct = consensus.knockout?.[round]?.[matchId]?.[teamId];
            if (typeof pct !== 'number') continue;
            if (!best || pct < best.pct) best = { teamId, pct, round, action: ROUND_ACTION[round] || 'to advance' };
          }
        }
        if (best) setBoldest(best);
      } catch {
        // non-fatal — widget just won't render
      }
    })();
    return () => { cancelled = true; };
  }, [userId, leagueId]);

  if (!boldest) return null;

  const pctRound = Math.max(1, Math.round(boldest.pct * 100));

  return (
    <div className="boldest-call-card" role="status">
      <span className="boldest-call-icon" aria-hidden="true"><Sparkles size={14} /></span>
      <div className="boldest-call-text">
        <span className="boldest-call-label">Your boldest pick</span>
        <span className="boldest-call-body">
          <strong>{boldest.teamId}</strong> {boldest.action} — only{' '}
          <strong>{pctRound}%</strong> agree
        </span>
      </div>
    </div>
  );
}
