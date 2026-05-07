/**
 * RarityCard
 *
 * Post-Final-pick reveal: tells the user how unique their bracket is
 * compared to the global Quick Picks crowd. Headline number is the
 * inverse of the average consensus across their three end-state
 * picks (champion, runner-up, 3rd place — third is optional). Three
 * rows below break it down per pick.
 *
 * Pure presentational — caller is responsible for fetching consensus
 * and passing the user's picks. If consensus is null (still loading
 * or fetch failed) the card collapses gracefully to a neutral state.
 */

import React from 'react';
import { Sparkles, Trophy, Award, Users } from 'lucide-react';

function pct(consensus, group, teamId) {
  const v = consensus?.[group]?.[teamId];
  return typeof v === 'number' ? v : null;
}

export default function RarityCard({ consensus, champion, runnerUp, thirdPlace, onShare }) {
  if (!champion || !runnerUp) return null; // can't report rarity without an end-state

  const cPct = pct(consensus, 'champion', champion);
  const rPct = pct(consensus, 'runnerUp', runnerUp);
  const tPct = thirdPlace ? pct(consensus, 'thirdPlace', thirdPlace) : null;

  const known = [cPct, rPct, tPct].filter((v) => v != null);
  const avgConsensus = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : null;
  // Headline metric: inverse of average consensus, bounded so we never
  // report 100% (always a few users somewhere). Round to whole percent
  // for a clean shareable number.
  const rarity = avgConsensus != null ? Math.min(99, Math.round((1 - avgConsensus) * 100)) : null;

  const totalUsers = consensus?.totalUsers || 0;

  return (
    <div className="rarity-card">
      <div className="rarity-card-head">
        <span className="rarity-card-icon" aria-hidden="true"><Sparkles size={18} /></span>
        <div className="rarity-card-headline">
          {rarity != null ? (
            <>
              <strong>{rarity}%</strong>
              <span> more unique than the average bracket</span>
            </>
          ) : totalUsers === 0 ? (
            <>
              <strong>You're first.</strong>
              <span> No one else has submitted a bracket yet — set the benchmark.</span>
            </>
          ) : (
            <>
              <strong>Bracket rarity</strong>
              <span> still loading…</span>
            </>
          )}
        </div>
      </div>

      <ul className="rarity-card-rows" aria-label="Per-pick rarity">
        <li className="rarity-card-row">
          <span className="rarity-card-role"><Trophy size={12} /> Champion</span>
          <span className="rarity-card-team">{champion}</span>
          <span className="rarity-card-pct">
            <Users size={11} /> {cPct != null ? `${Math.round(cPct * 100)}% agree` : '—'}
          </span>
        </li>
        <li className="rarity-card-row">
          <span className="rarity-card-role"><Award size={12} /> Runner-up</span>
          <span className="rarity-card-team">{runnerUp}</span>
          <span className="rarity-card-pct">
            <Users size={11} /> {rPct != null ? `${Math.round(rPct * 100)}% agree` : '—'}
          </span>
        </li>
        {thirdPlace && (
          <li className="rarity-card-row">
            <span className="rarity-card-role"><Award size={12} /> 3rd</span>
            <span className="rarity-card-team">{thirdPlace}</span>
            <span className="rarity-card-pct">
              <Users size={11} /> {tPct != null ? `${Math.round(tPct * 100)}% agree` : '—'}
            </span>
          </li>
        )}
      </ul>

      {onShare && (
        <button type="button" className="btn btn-primary btn-sm rarity-card-share" onClick={onShare}>
          Share my bracket
        </button>
      )}
    </div>
  );
}
