/**
 * LeagueListRow — reusable row for any league-list surface (Your Leagues,
 * Browse, search results). Apple HIG primitives shared with the leaderboard
 * rebuild: hairline dividers, neutral metadata, accent reserved for urgency.
 *
 * Tap on the row's name area = navigate to the league. Three small action
 * buttons inline let the user jump straight to the bracket, the edit-picks
 * wizard, or the leaderboard for that league without opening the detail
 * landing first.
 */

import React from 'react';
import { ChevronRight, Target, CheckCircle, Flag, LayoutGrid, Pencil, TrendingUp } from 'lucide-react';

// ── State pill — exactly one renders per row ─────────────────────────────
// Priority cascade: ended → done (100%) → in-progress (% complete) → none.
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
    const pctText = typeof status.pct === 'number' ? `${status.pct}% · ` : '';
    return (
      <span className={`lr-pill ${cls}`}>
        <Target size={11} aria-hidden="true" />
        {pctText}{status.remaining} left
      </span>
    );
  }
  return null;
}

// ── Action button — small icon-only with stop-propagation ──────────────
// Each action stops the row's default click so the parent's onClick (the
// generic nav-to-detail) doesn't also fire on top of the explicit route.
function ActionButton({ icon: Icon, label, onClick }) {
  if (!onClick) return null;
  return (
    <button
      type="button"
      className="lr-action-btn"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      title={label}
    >
      <Icon size={13} aria-hidden="true" />
    </button>
  );
}

export default function LeagueListRow({
  league,
  status,
  rank,
  total,
  urgent = false,
  onClick,
  onLeaderboard,
  onEditPicks,
  onViewBracket,
}) {
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick?.(); }
  };
  const hasActions = !!(onLeaderboard || onEditPicks || onViewBracket);
  return (
    <div
      className={`lr-row ${urgent ? 'lr-row-urgent' : ''} ${status?.ended ? 'lr-row-ended' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKey}
      aria-label={`${league?.name || 'League'} — open league`}
    >
      <div className="lr-cell lr-cell-name">
        <span className="lr-name" title={league?.memberCount ? `${league.memberCount.toLocaleString()} members` : undefined}>
          {league?.name || 'League'}
        </span>
      </div>
      <div className="lr-cell lr-cell-status">
        <StatusPill status={status} urgent={urgent} />
      </div>
      {hasActions && (
        <div className="lr-cell lr-cell-actions" onClick={(e) => e.stopPropagation()}>
          <ActionButton icon={LayoutGrid} label="View bracket" onClick={onViewBracket} />
          <ActionButton icon={Pencil} label="Edit picks" onClick={onEditPicks} />
          <ActionButton icon={TrendingUp} label="Leaderboard" onClick={onLeaderboard} />
        </div>
      )}
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
