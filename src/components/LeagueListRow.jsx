/**
 * LeagueListRow — reusable row for any league-list surface (Your Leagues,
 * Browse, search results). Apple HIG primitives shared with the leaderboard
 * rebuild: hairline dividers, chevron-only navigation affordance, single
 * state pill per row, neutral metadata, accent reserved for urgency.
 *
 * Tap = navigate. Always. The whole row is the tap target.
 */

import React from 'react';
import { ChevronRight, Target, CheckCircle, Flag } from 'lucide-react';

// ── State pill — exactly one renders per row ─────────────────────────────
// Priority cascade: urgent → warning → success → ended → none. Encodes the
// brief's "one pill per row" rule.
function StatusPill({ status, urgent }) {
  if (!status) return null;
  if (status.ended) {
    return (
      <span className="lr-pill lr-pill-ended" title="League ended">
        <Flag size={11} aria-hidden="true" /> Final
        {typeof status.finalRank === 'number' && typeof status.totalPlayers === 'number' && (
          <> · {status.finalRank} of {status.totalPlayers}</>
        )}
      </span>
    );
  }
  if (status.done) {
    return (
      <span className="lr-pill lr-pill-success">
        <CheckCircle size={11} aria-hidden="true" /> All picks in
      </span>
    );
  }
  if (status.remaining > 0) {
    const cls = urgent ? 'lr-pill-danger' : 'lr-pill-warn';
    return (
      <span className={`lr-pill ${cls}`}>
        <Target size={11} aria-hidden="true" />
        {status.remaining} left{typeof status.etaMin === 'number' && status.etaMin > 0 ? ` · ${status.etaMin}m` : ''}
      </span>
    );
  }
  return null;
}

export default function LeagueListRow({ league, status, rank, total, urgent = false, onClick }) {
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };
  return (
    <div
      className={`lr-row ${urgent ? 'lr-row-urgent' : ''} ${status?.ended ? 'lr-row-ended' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKey}
      aria-label={`${league?.name || 'League'} — open leaderboard`}
    >
      <div className="lr-cell lr-cell-name">
        <span className="lr-name" title={league?.memberCount ? `${league.memberCount.toLocaleString()} members` : undefined}>
          {league?.name || 'League'}
        </span>
      </div>
      <div className="lr-cell lr-cell-status">
        <StatusPill status={status} urgent={urgent} />
      </div>
      <div className="lr-cell lr-cell-rank">
        {rank != null ? (
          <>
            <span className="lr-rank">#{rank}</span>
            {total != null && total > 0 && <span className="lr-total">/ {total.toLocaleString()}</span>}
          </>
        ) : (
          <span className="lr-rank lr-rank-skel" aria-hidden="true">—</span>
        )}
      </div>
      <div className="lr-cell lr-cell-chev" aria-hidden="true">
        <ChevronRight size={14} />
      </div>
    </div>
  );
}
