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

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getLeaguePasscode } from '../utils/db';
import {
  Trophy, ArrowUp, ArrowDown, ArrowRight, Lock as LockIcon, UserPlus, LogOut,
  Award, User,
  CheckCircle, RefreshCw, Clock, Globe, MapPin, Users, Target, Share2,
  ChevronRight, Copy, Check, MessageSquare,
} from 'lucide-react';
import { teamFlags, countryFlag } from '../utils/flags';
import { isTournamentOver } from '../utils/stageLock';
import { getScoringBullets } from '../utils/scoringExplainer';

// ── scoring explainer (item E) ──────────────────────────────────────────
// Subtle, collapsed-by-default "How scoring works" disclosure. Content
// comes from the shared scoringExplainer.js source of truth, so it can
// never drift from the FAQ (item D) or the engine. Collapsed it's a single
// low-contrast row that doesn't push the rankings down.
function ScoringExplainer() {
  const [open, setOpen] = useState(false);
  const { intro, bullets } = getScoringBullets();
  return (
    <div className={`ll-scoring ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="ll-scoring-toggle"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <Target size={12} aria-hidden="true" />
        <span>How scoring works</span>
        <ChevronRight size={13} className="ll-scoring-chev" aria-hidden="true" />
      </button>
      {open && (
        <div className="ll-scoring-body">
          <p className="ll-scoring-intro">{intro}</p>
          <ul className="ll-scoring-list">
            {bullets.map((b) => (
              <li key={b.label} className="ll-scoring-item">
                <span className="ll-scoring-h">{b.label}</span>
                <span className="ll-scoring-d">{b.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

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
function uniquenessLabel(pct, upsetCount = 0) {
  // Combine raw consensus with upset count: a bracket with multiple
  // big upsets reads as Bold even if its champion+runner-up pair is
  // popular. Conversely, a vanilla pair with no upsets stays neutral.
  let tier = null;
  if (pct != null) {
    if (pct <= 0.05) tier = 'rare';
    else if (pct <= 0.20) tier = 'bold';
  }
  if (upsetCount >= 3) tier = 'rare';
  else if (upsetCount >= 1 && !tier) tier = 'bold';
  if (!tier) return null;
  return tier === 'rare'
    ? { label: 'Rare', tier: 'rare' }
    : { label: 'Bold', tier: 'bold' };
}

// Friendly status for a player who hasn't locked in a champion yet, derived
// from how far they've gotten through the Quick Picks flow (groups → best
// thirds → bracket). Lets the leaderboard say "Groups picked" / "No picks
// yet" instead of a bare "—".
function predictionStatus(row) {
  const g = row.groupsDone || 0;
  const t = row.thirdsDone || 0;
  const b = row.bracketDone || 0;
  if (g + t + b === 0) return { key: 'none', label: 'No picks yet' };
  if (g >= 12 && t >= 8 && b > 0) return { key: 'bracket', label: 'Filling bracket' };
  if (g >= 12 && t >= 8) return { key: 'thirds', label: 'Best thirds in' };
  if (g >= 12) return { key: 'groups', label: 'Groups picked' };
  return { key: 'partial', label: 'In progress' };
}

function PredictionCell({ winner, runnerUp, uniqueness, upsetCount = 0, status }) {
  if (!winner && !runnerUp) {
    return status
      ? <span className={`ll-pred-status ll-pred-status-${status.key}`}>{status.label}</span>
      : <span className="ll-pred-empty">—</span>;
  }
  const u = uniquenessLabel(uniqueness, upsetCount);
  // Tooltip explains both halves of the score: how many other players
  // picked the same pair (consensus) AND how many lower-ranked teams
  // advanced (upset count).
  const tip = u
    ? [
        typeof uniqueness === 'number'
          ? `${Math.round(uniqueness * 100)}% of players picked the same champion + runner-up`
          : null,
        upsetCount > 0
          ? `${upsetCount} upset${upsetCount === 1 ? '' : 's'} called (lower-ranked teams advancing)`
          : null,
        u.tier === 'rare'
          ? 'Rare = top-tier bold + uncommon picks'
          : 'Bold = at least one underdog or non-consensus pick',
      ].filter(Boolean).join(' · ')
    : null;
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
          data-tooltip={tip}
          aria-label={tip}
        >
          {u.label}
        </span>
      )}
    </span>
  );
}

// ── single row — used for both standard and you-row ─────────────────────
function LeaderboardRow({ row, rank, isYou, isCreator, onRowClick, onEdit, onShareBracket, onViewProfile, showLiveScore = false }) {
  const handleKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick?.(row); } };
  return (
    <div
      className={`ll-row ${isYou ? 'll-row-you' : ''}${showLiveScore ? ' ll-with-live' : ''}`}
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
          {isCreator && <span className="ll-id-creator" title="League creator">Creator</span>}
        </span>
        {onViewProfile && (
          <button
            type="button"
            className="ll-id-profile"
            title="View profile & badges"
            aria-label={`View ${row.displayName}'s profile and badges`}
            onClick={(e) => { e.stopPropagation(); onViewProfile(row.userId); }}
          >
            <User size={12} aria-hidden="true" />
            <span className="ll-id-profile-label">Profile</span>
          </button>
        )}
      </div>
      <div className="ll-cell ll-cell-status">
        <StatusIcon row={row} />
      </div>
      <div className="ll-cell ll-cell-pred">
        <PredictionCell winner={row.winner} runnerUp={row.runnerUp} uniqueness={row.uniqueness} upsetCount={row.upsetCount || 0} status={(!row.winner && !row.runnerUp) ? predictionStatus(row) : null} />
      </div>
      {showLiveScore && (
        <div className="ll-cell ll-cell-live">
          {row.liveGroupScore > 0 ? (
            <span className="ll-live-wrap">
              <span className="ll-live-dot" aria-hidden="true" />
              <span className="ll-live-num">{row.liveGroupScore}</span>
            </span>
          ) : <span className="ll-pts-empty">—</span>}
        </div>
      )}
      <div className="ll-cell ll-cell-pts">
        {/* Ranking is by points; accuracy shown as a secondary stat. */}
        {(row.totalScore > 0 || row.totalAccuracy > 0) ? (
          <span className="ll-pts-wrap">
            <span className="ll-pts-num">{Math.round(row.totalScore || 0)} pts</span>
            {row.totalAccuracy > 0 && (
              <span className="ll-pts-acc">{Math.round(row.totalAccuracy * 100)}%</span>
            )}
          </span>
        ) : <span className="ll-pts-empty">—</span>}
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
function LeaderboardHeader({ league, isPrivate, isGlobal, memberCount, passcode, onInvite, onNudge, onLeave, onBack, onJoin }) {
  const inviteLabel = isGlobal ? 'Share leaderboard' : 'Invite friends';
  const lockIcon = isPrivate ? <LockIcon size={11} aria-hidden="true" /> : null;
  const [copied, setCopied] = useState(false);
  const handleCopyPasscode = async () => {
    if (!passcode) return;
    try {
      await navigator.clipboard.writeText(passcode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Fallback: select-and-prompt for browsers without clipboard API.
      window.prompt('Passcode (copy this):', passcode);
    }
  };
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
            {isTournamentOver() && (
              <>
                <span className="ll-header-dot" aria-hidden="true">·</span>
                <span className="ll-header-ended">Final standings — contest ended</span>
              </>
            )}
          </div>
          {passcode && (
            <div className="ll-header-passcode">
              <span className="ll-header-passcode-label">Passcode</span>
              <code className="ll-header-passcode-code" onClick={handleCopyPasscode}>{passcode}</code>
              <button
                type="button"
                className="ll-header-passcode-copy"
                onClick={handleCopyPasscode}
                aria-label={copied ? 'Copied' : 'Copy passcode'}
              >
                {copied ? <><Check size={11} aria-hidden="true" /> Copied</> : <><Copy size={11} aria-hidden="true" /> Copy</>}
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="ll-header-actions">
        {/* Join CTA — primary affordance for non-signed-up viewers
            of a public leaderboard. Falls in front of the Share
            button so it's the obvious next action. */}
        {onJoin && !isTournamentOver() && (
          <button type="button" className="ll-header-join" onClick={onJoin}>
            <UserPlus size={14} aria-hidden="true" /> Join now
          </button>
        )}
        {onLeave && (
          <button type="button" className="ll-header-leave" onClick={onLeave}>
            <LogOut size={13} aria-hidden="true" /> Leave League
          </button>
        )}
        {onInvite && !isTournamentOver() && (
          <button type="button" className="ll-header-invite" onClick={onInvite}>
            <UserPlus size={14} aria-hidden="true" /> {inviteLabel}
          </button>
        )}
        {/* Creator-only — present when the parent passes onNudge
            (i.e. viewer is the creator of a private league). */}
        {onNudge && (
          <button type="button" className="ll-header-nudge" onClick={onNudge} title="Nudge members">
            <MessageSquare size={14} aria-hidden="true" /> Nudge
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
  onNudge,
  onShareBracket,
  onLeave,
  onJoin,
  onViewProfile,
  loading = false,
  onBack,
  showLiveScore = false,
}) {
  const isGlobal = league?.id === 'global-simple' || league?.id === 'global' || league?.isGlobal === true;
  const isPrivate = league?.visibility === 'private';
  const memberCount = league?.memberCount || league?.members?.length || rows.length;
  const creatorId = league?.createdBy || null;
  // Frozen /profiles docs only exist after tournament finalization, so the
  // per-row Profile shortcut would 404 before then — gate it on ended state.
  const viewProfile = isTournamentOver() ? onViewProfile : null;
  // Reveal the passcode only when the viewer is a member of the league —
  // for public leaderboards or anonymous viewers we keep it hidden.
  const isMember = !!currentUserId && (Array.isArray(league?.members) ? league.members.includes(currentUserId) : false);

  // Passcode is no longer on the public league doc (PR #121 moved it
  // into a private subcollection). Fetch it server-side once when the
  // viewer is a private-league member, then fall back to the legacy
  // public field for any league created before that refactor.
  const [fetchedPasscode, setFetchedPasscode] = useState(null);
  useEffect(() => {
    if (!isPrivate || !isMember || !league?.id) return;
    if (league?.passcode) return; // legacy league — public field still set
    let cancelled = false;
    (async () => {
      try {
        const p = await getLeaguePasscode(league.id);
        if (!cancelled) setFetchedPasscode(p);
      } catch {
        // 403 / 404 are fine — pill just stays hidden. No retry, no toast.
      }
    })();
    return () => { cancelled = true; };
  }, [isPrivate, isMember, league?.id, league?.passcode]);

  const passcode = (isPrivate && isMember) ? (league?.passcode || fetchedPasscode) : null;

  // Pull the user's own row out so we can render it sticky and put the
  // edit/share actions inline. The rest renders top-down without it.
  const youIdx = rows.findIndex(r => r.userId === currentUserId);
  const youRow = youIdx >= 0 ? rows[youIdx] : null;

  // Client-side pagination — rendering thousands of rows at once is slow on
  // phones. Ranks stay global (pageStart + i); the sticky you-row always
  // shows the viewer's true rank regardless of the visible page. Page resets
  // whenever the underlying set changes (scope/country filter/new data).
  const PAGE_SIZE = 100;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);
  const listTopRef = useRef(null);
  useEffect(() => { setPage(0); }, [scope, countryFilter, rows.length]);
  const goToPage = (p) => {
    setPage(Math.max(0, Math.min(pageCount - 1, p)));
    // Bring the top of the list back into view so "Next" doesn't leave the
    // user staring at the bottom of the new page.
    requestAnimationFrame(() => {
      listTopRef.current?.scrollIntoView({ behavior: 'auto', block: 'start' });
    });
  };

  return (
    <div className="ll-shell">
      <LeaderboardHeader
        league={league}
        isPrivate={isPrivate}
        isGlobal={isGlobal}
        memberCount={memberCount}
        passcode={passcode}
        onInvite={onInvite}
        onNudge={onNudge}
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

      {/* Subtle scoring explainer (items E + I) — on EVERY Quick Picks
          league leaderboard (global, public, private), collapsed by default
          so it never pushes the rankings down. Quick Picks scoring is
          identical across leagues, so the shared copy is correct everywhere. */}
      <ScoringExplainer />

      {/* Optional column header — small caps, low contrast. Helps scan
          when the rows have lots of fields. Hidden on mobile (the row
          hierarchy is unambiguous at this density). */}
      <div className={`ll-colheader${showLiveScore ? ' ll-with-live' : ''}`} aria-hidden="true">
        <div className="ll-cell ll-cell-rank">RANK</div>
        <div className="ll-cell ll-cell-id">PLAYER</div>
        <div className="ll-cell ll-cell-status" />
        <div className="ll-cell ll-cell-pred">PREDICTION</div>
        {showLiveScore && (
          <div className="ll-cell ll-cell-live" title="Live points from the current group tables — provisional, updates as matches are played">LIVE</div>
        )}
        <div className="ll-cell ll-cell-pts" title="Total points (ranking) · accuracy">SCORE</div>
        <div className="ll-cell ll-cell-chev" />
      </div>

      {loading ? (
        <div className="ll-loading"><RefreshCw size={16} className="spin" /> Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState scope={scope} countryFilter={countryFilter} />
      ) : (
        <>
          <div className="ll-list" ref={listTopRef} style={{ scrollMarginTop: '72px' }}>
            {pageRows.map((row, i) => {
              const rank = pageStart + i + 1;
              const isYou = row.userId === currentUserId;
              const isCreator = !!creatorId && row.userId === creatorId;
              return (
                <LeaderboardRow
                  key={row.userId}
                  row={row}
                  rank={rank}
                  isYou={isYou}
                  isCreator={isCreator}
                  showLiveScore={showLiveScore}
                  onRowClick={onRowClick}
                  onEdit={onEdit}
                  onShareBracket={isYou ? onShareBracket : null}
                  onViewProfile={viewProfile}
                />
              );
            })}
          </div>
          {rows.length > PAGE_SIZE && (
            <div className="ll-pager" role="navigation" aria-label="Leaderboard pages">
              <button
                type="button"
                className="ll-pager-btn"
                onClick={() => goToPage(safePage - 1)}
                disabled={safePage === 0}
              >
                ‹ Prev
              </button>
              <span className="ll-pager-info">
                {(pageStart + 1).toLocaleString()}–{Math.min(pageStart + PAGE_SIZE, rows.length).toLocaleString()} of {rows.length.toLocaleString()}
              </span>
              <button
                type="button"
                className="ll-pager-btn"
                onClick={() => goToPage(safePage + 1)}
                disabled={safePage >= pageCount - 1}
              >
                Next ›
              </button>
            </div>
          )}
        </>
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
            isCreator={!!creatorId && youRow.userId === creatorId}
            showLiveScore={showLiveScore}
            onRowClick={onRowClick}
            onEdit={onEdit}
            onShareBracket={onShareBracket}
            onViewProfile={viewProfile}
          />
        </div>
      )}
    </div>
  );
}
