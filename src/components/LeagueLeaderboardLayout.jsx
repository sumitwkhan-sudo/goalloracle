/**
 * LeagueLeaderboardLayout — single component, three flavors (global / public
 * / private). Layout, row anatomy, type, and rhythm are identical across
 * all three; differences are expressed through props that derive from
 * `league.id` and `league.visibility`.
 *
 * Apple HIG principles applied:
 *  - Clarity: text legible at every size, no decorative color, no yellow
 *    pill backgrounds, predictions clearly labeled.
 *  - Deference: chrome (recruitment CTAs) recedes; rows are the content.
 *  - Depth: hairline dividers between rows, single 3px primary edge on the
 *    user's own row instead of heavy borders.
 *  - Consistency: one row anatomy across all league types and viewports.
 *  - Color discipline: accent reserved for ONE primary action (Invite) +
 *    the user's own row highlight. Status is icon-only, no pills.
 *  - Touch targets: 56px row height on mobile (44pt + breathing room).
 */

import React, { useMemo } from 'react';
import {
  Trophy, ArrowUp, ArrowDown, ArrowRight, Lock as LockIcon, UserPlus,
  Award,
  CheckCircle, RefreshCw, Clock, Globe, MapPin, Users, Target, Share2,
  ChevronRight,
} from 'lucide-react';
import { teamFlags, countryFlag } from '../utils/flags';

// ── small atoms ─────────────────────────────────────────────────────────
function RankCell({ rank }) {
  if (rank === 1) return <Trophy size={18} className="ll-rank-trophy ll-rank-gold" aria-label="1st place" />;
  if (rank === 2) return <Trophy size={18} className="ll-rank-trophy ll-rank-silver" aria-label="2nd place" />;
  if (rank === 3) return <Trophy size={18} className="ll-rank-trophy ll-rank-bronze" aria-label="3rd place" />;
  return <span className="ll-rank-num">#{rank}</span>;
}

function RankDelta({ delta }) {
  if (delta === undefined || delta === null) return null;
  if (delta > 0) return <span className="ll-delta ll-delta-up" title={`Up ${delta}`}><ArrowUp size={10} />{delta}</span>;
  if (delta < 0) return <span className="ll-delta ll-delta-down" title={`Down ${-delta}`}><ArrowDown size={10} />{-delta}</span>;
  return null;
}

// Status indicator — single icon, no pill, no text on desktop. Mobile shows
// a tooltip via the title attribute. This is meta info; demoted by design.
function StatusIcon({ row }) {
  if (row.isComplete) return <CheckCircle size={12} className="ll-status ll-status-ok" aria-label="Picks complete" />;
  if (row.hasSubmitted) return <RefreshCw size={12} className="ll-status ll-status-progress" aria-label={typeof row.picksLeft === 'number' ? `${row.picksLeft} picks left` : 'In progress'} />;
  return <Clock size={12} className="ll-status ll-status-none" aria-label="Not started" />;
}

// Prediction column — Trophy (gold) next to the champion pick, Award
// (silver) next to the runner-up. Replaces the previous arrow which
// required a header gloss to explain what the order meant. Optional
// `uniqueness` chip surfaces how rare the bracket pair is vs the
// global crowd — `Rare` (≤5%), `Bold` (≤20%), default no chip.
function uniquenessLabel(pct) {
  if (pct == null) return null;
  if (pct <= 0.05) return { label: 'Rare', tier: 'rare' };
  if (pct <= 0.20) return { label: 'Bold', tier: 'bold' };
  return null;
}

function PredictionCell({ winner, runnerUp, uniqueness }) {
  if (!winner && !runnerUp) return <span className="ll-pred-empty">—</span>;
  const u = uniquenessLabel(uniqueness);
  return (
    <span className="ll-pred">
      <span className="ll-pred-team ll-pred-team-winner">
        <Trophy size={12} className="ll-pred-medal ll-pred-medal-gold" aria-label="Champion" />
        <span className="ll-pred-flag" aria-hidden="true">{teamFlags[winner] || ''}</span>
        <span className="ll-pred-name">{winner || '—'}</span>
      </span>
      <span className="ll-pred-team ll-pred-team-second">
        <Award size={12} className="ll-pred-medal ll-pred-medal-silver" aria-label="Runner-up" />
        <span className="ll-pred-flag" aria-hidden="true">{teamFlags[runnerUp] || ''}</span>
        <span className="ll-pred-name">{runnerUp || '—'}</span>
      </span>
      {u && (
        <span
          className={`ll-pred-rare ll-pred-rare-${u.tier}`}
          title={`Only ${Math.round(uniqueness * 100)}% of players picked the same champion + runner-up`}
        >
          {u.label}
        </span>
      )}
    </span>
  );
}

// ── single row — used for both standard and you-row ─────────────────────
function LeaderboardRow({ row, rank, isYou, onRowClick, onEdit, onShareBracket }) {
  const handleKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(row); } };
  return (
    <div
      className={`ll-row ${isYou ? 'll-row-you' : ''}`}
      onClick={() => onRowClick?.(row)}
      role="button"
      tabIndex={0}
      onKeyDown={handleKey}
      aria-label={isYou ? `Your row, rank ${rank}` : `${row.displayName}, rank ${rank}, click to view picks`}
    >
      <div className="ll-cell ll-cell-rank">
        <RankCell rank={rank} />
        <RankDelta delta={row.delta} />
      </div>
      <div className="ll-cell ll-cell-id">
        <span className="ll-id-name">
          {row.country && <span className="ll-id-flag" aria-hidden="true">{countryFlag(row.country)}</span>}
          {row.displayName}
          {isYou && <span className="ll-id-you">You</span>}
        </span>
      </div>
      <div className="ll-cell ll-cell-status">
        <StatusIcon row={row} />
      </div>
      <div className="ll-cell ll-cell-pred">
        <PredictionCell winner={row.winner} runnerUp={row.runnerUp} uniqueness={row.uniqueness} />
      </div>
      <div className="ll-cell ll-cell-pts">
        {row.totalAccuracy > 0 ? <span className="ll-pts-num">{Math.round(row.totalAccuracy * 100)}%</span> : <span className="ll-pts-empty">—</span>}
      </div>
      {!isYou && (
        <div className="ll-cell ll-cell-chev" aria-hidden="true">
          <ChevronRight size={14} />
        </div>
      )}
      {isYou && (
        <div className="ll-cell ll-cell-actions">
          <button
            type="button"
            className="ll-row-action ll-row-action-primary"
            onClick={(e) => { e.stopPropagation(); onEdit?.(); }}
          >
            <Target size={11} aria-hidden="true" /> Edit
          </button>
          {onShareBracket && (
            <button
              type="button"
              className="ll-row-action"
              onClick={(e) => { e.stopPropagation(); onShareBracket(); }}
              aria-label="Share my bracket"
            >
              <Share2 size={11} aria-hidden="true" /> Share
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── header (league name + member count + invite primary CTA) ────────────
function LeaderboardHeader({ league, isPrivate, isGlobal, memberCount, onInvite, onLeave, onBack, onJoin }) {
  const inviteLabel = isGlobal ? 'Share leaderboard' : 'Invite friends';
  const lockIcon = isPrivate ? <LockIcon size={11} aria-hidden="true" /> : null;
  return (
    <div className="ll-header">
      <div className="ll-header-meta">
        {onBack && (
          <button type="button" className="ll-header-back" onClick={onBack} aria-label="Back">
            ‹ Back
          </button>
        )}
        <div className="ll-header-title-block">
          <h1 className="ll-header-title">
            {lockIcon}
            {league?.name || 'Leaderboard'}
          </h1>
          <div className="ll-header-sub">
            {memberCount.toLocaleString()} {memberCount === 1 ? 'member' : 'members'}
            {isPrivate && (
              <>
                <span className="ll-header-dot" aria-hidden="true">·</span>
                <span>Private</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="ll-header-actions">
        {/* Join CTA — primary affordance for non-signed-up viewers
            of a public leaderboard. Falls in front of the Share
            button so it's the obvious next action. */}
        {onJoin && (
          <button type="button" className="ll-header-join" onClick={onJoin}>
            <UserPlus size={14} aria-hidden="true" /> Join now
          </button>
        )}
        {onLeave && (
          <button type="button" className="ll-header-leave" onClick={onLeave}>
            Leave
          </button>
        )}
        {onInvite && (
          <button type="button" className="ll-header-invite" onClick={onInvite}>
            <UserPlus size={14} aria-hidden="true" /> {inviteLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// ── scope tabs (global only) ────────────────────────────────────────────
function ScopeBar({ scope, onScopeChange, countryFilter, onCountryFilterChange, countriesList, friendsCount }) {
  return (
    <div className="ll-scope">
      <div className="ll-scope-tabs" role="tablist" aria-label="Leaderboard scope">
        <button type="button" role="tab" aria-selected={scope === 'all'} className={`ll-scope-tab ${scope === 'all' ? 'is-active' : ''}`} onClick={() => onScopeChange('all')}>
          <Globe size={11} aria-hidden="true" /> Global
        </button>
        <button type="button" role="tab" aria-selected={scope === 'country'} className={`ll-scope-tab ${scope === 'country' ? 'is-active' : ''}`} onClick={() => onScopeChange('country')}>
          <MapPin size={11} aria-hidden="true" /> Country
        </button>
        <button type="button" role="tab" aria-selected={scope === 'friends'} className={`ll-scope-tab ${scope === 'friends' ? 'is-active' : ''}`} onClick={() => onScopeChange('friends')}>
          <Users size={11} aria-hidden="true" /> Friends
        </button>
      </div>
      {scope === 'country' && (
        <select
          className="ll-scope-country"
          value={countryFilter}
          onChange={(e) => onCountryFilterChange(e.target.value)}
          aria-label="Filter leaderboard by country"
        >
          <option value="">All countries</option>
          {countriesList.map(c => (
            <option key={c.code} value={c.code}>{c.flag} {c.name}</option>
          ))}
        </select>
      )}
      {scope === 'friends' && friendsCount === 0 && (
        <span className="ll-scope-hint">Join a private league to see friends here.</span>
      )}
    </div>
  );
}

// ── empty / loading states ──────────────────────────────────────────────
function EmptyState({ scope, countryFilter }) {
  if (scope === 'friends') {
    return (
      <div className="ll-empty">
        <Users size={20} aria-hidden="true" />
        <p>No friends here yet — invite a few and watch the rankings come alive.</p>
      </div>
    );
  }
  if (scope === 'country' && countryFilter) {
    return (
      <div className="ll-empty">
        <p>No players in {countryFlag(countryFilter)} {countryFilter} yet. Be the first.</p>
      </div>
    );
  }
  return (
    <div className="ll-empty"><p>No members yet.</p></div>
  );
}

// ── main ────────────────────────────────────────────────────────────────
export default function LeagueLeaderboardLayout({
  league,
  rows = [],
  currentUserId,
  scope = 'all',
  onScopeChange,
  countryFilter = '',
  onCountryFilterChange,
  countriesList = [],
  friendIds = new Set(),
  onRowClick,
  onEdit,
  onInvite,
  onShareBracket,
  onLeave,
  onJoin,
  loading = false,
  onBack,
}) {
  const isGlobal = league?.id === 'global-simple' || league?.id === 'global' || league?.isGlobal === true;
  const isPrivate = league?.visibility === 'private';
  const memberCount = league?.memberCount || league?.members?.length || rows.length;

  // Pull the user's own row out so we can render it sticky and put the
  // edit/share actions inline. The rest renders top-down without it.
  const youIdx = rows.findIndex(r => r.userId === currentUserId);
  const youRow = youIdx >= 0 ? rows[youIdx] : null;

  return (
    <div className="ll-shell">
      <LeaderboardHeader
        league={league}
        isPrivate={isPrivate}
        isGlobal={isGlobal}
        memberCount={memberCount}
        onInvite={onInvite}
        onLeave={onLeave}
        onBack={onBack}
        onJoin={onJoin}
      />

      {isGlobal && (
        <ScopeBar
          scope={scope}
          onScopeChange={onScopeChange}
          countryFilter={countryFilter}
          onCountryFilterChange={onCountryFilterChange}
          countriesList={countriesList}
          friendsCount={friendIds.size}
        />
      )}

      {/* Optional column header — small caps, low contrast. Helps scan
          when the rows have lots of fields. Hidden on mobile (the row
          hierarchy is unambiguous at this density). */}
      <div className="ll-colheader" aria-hidden="true">
        <div className="ll-cell ll-cell-rank">RANK</div>
        <div className="ll-cell ll-cell-id">PLAYER</div>
        <div className="ll-cell ll-cell-status" />
        <div className="ll-cell ll-cell-pred">PREDICTION</div>
        <div className="ll-cell ll-cell-pts" title="Score — % of available points scored so far">SCORE</div>
        <div className="ll-cell ll-cell-chev" />
      </div>

      {loading ? (
        <div className="ll-loading"><RefreshCw size={16} className="spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState scope={scope} countryFilter={countryFilter} />
      ) : (
        <div className="ll-list">
          {rows.map((row, i) => {
            const rank = i + 1;
            const isYou = row.userId === currentUserId;
            return (
              <LeaderboardRow
                key={row.userId}
                row={row}
                rank={rank}
                isYou={isYou}
                onRowClick={onRowClick}
                onEdit={onEdit}
                onShareBracket={isYou ? onShareBracket : null}
              />
            );
          })}
        </div>
      )}

      {/* Sticky duplicate of the user's own row — pinned to the bottom of
          the leaderboard list so they always see their position and can
          tap Edit. The "real" row above it scrolls naturally. */}
      {youRow && (
        <div className="ll-stickyrow" aria-hidden="false">
          <LeaderboardRow
            row={youRow}
            rank={youIdx + 1}
            isYou={true}
            onRowClick={onRowClick}
            onEdit={onEdit}
            onShareBracket={onShareBracket}
          />
        </div>
      )}
    </div>
  );
}
