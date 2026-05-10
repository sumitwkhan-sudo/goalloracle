/**
 * InviteFriendsModal
 *
 * Three paths for inviting people once the user clicks the hero
 * "Invite friends" chip:
 *   1. Share GoalOracle (referral) — copies / native-shares
 *      `${origin}/?ref=${userId}` so signups join Global Quick Picks
 *      automatically and the inviter gets attribution credit.
 *   2. Create a private league — routes to the existing /create flow.
 *   3. Invite to one of your existing private leagues — picks a
 *      league and shares an auto-join link including the passcode.
 *
 * No backend calls — all share URLs are constructed client-side from
 * the user's own data. Leverages navigator.share on touch devices,
 * falls back to clipboard with a toast on desktop.
 */

import React, { useMemo, useState } from 'react';
import { X, Sparkles, Plus, Users, ChevronRight, ChevronDown } from 'lucide-react';
import ShareButtons from './ShareButtons';

function buildShareUrl({ origin, userId, leagueId, passcode }) {
  const params = new URLSearchParams();
  if (userId) params.set('ref', userId);
  if (leagueId) params.set('join', leagueId);
  if (passcode) params.set('p', passcode);
  return `${origin}/?${params.toString()}`;
}

// Public-bracket share URL — viewable without an account, drops the
// recipient onto the operator's bracket page. Used by the "Share my
// bracket" referral flow so a friend can preview the bracket before
// signing up. Falls back to the referral-style URL if userId is missing.
function buildPublicBracketUrl({ origin, userId }) {
  if (!userId) return `${origin}/?ref=${encodeURIComponent(userId || '')}`;
  return `${origin}/u/${encodeURIComponent(userId)}/bracket?ref=${encodeURIComponent(userId)}`;
}

export default function InviteFriendsModal({
  open,
  onClose,
  userId,
  leagues = [],
  notify,
  onCreateLeague,
}) {
  // Private leagues the user can invite to. Excludes global leagues
  // (no passcode) and any classic league rendered behind the kill
  // switch in the data layer.
  const privateLeagues = useMemo(() => {
    return (leagues || [])
      .filter(l => l && l.id !== 'global' && l.id !== 'global-simple' && !l.isGlobal)
      .filter(l => l.passcode || l.visibility === 'public') // include public user-created leagues too
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  }, [leagues]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickedLeagueId, setPickedLeagueId] = useState(null);
  const pickedLeague = useMemo(
    () => privateLeagues.find(l => l.id === pickedLeagueId) || null,
    [privateLeagues, pickedLeagueId]
  );

  if (!open) return null;

  const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://goaloracle.io';

  // ── 1. Referral share ─────────────────────────────────────────
  // Public-bracket URL: friends can preview the bracket without an
  // account, then sign up if they want to compete.
  const referralUrl = buildPublicBracketUrl({ origin, userId });
  const referralText = `Join me on GoalOracle — predict the World Cup 2026.`;

  // ── 2. Create a new private league ────────────────────────────
  const handleCreate = () => {
    onClose?.();
    onCreateLeague?.();
  };

  // ── 3. Invite to an existing private league ───────────────────
  const leagueUrl = pickedLeague
    ? buildShareUrl({
        origin, userId,
        leagueId: pickedLeague.id,
        passcode: pickedLeague.passcode || undefined,
      })
    : '';
  const leagueText = pickedLeague
    ? `Join my GoalOracle league "${pickedLeague.name}" — predict the World Cup 2026.`
    : '';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="invite-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="invite-modal-title">
        <div className="invite-modal-head">
          <h2 id="invite-modal-title">Invite friends</h2>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <p className="invite-modal-sub">
          Three ways to bring friends into your World Cup. Pick whichever fits.
        </p>

        {/* Option 1 — referral share. Each channel button posts the
            user's public-bracket URL so a friend can preview the
            picks even before signing up. */}
        <div className="invite-option invite-option-static">
          <div className="invite-option-row" style={{ cursor: 'default' }}>
            <span className="invite-option-icon"><Sparkles size={16} /></span>
            <span className="invite-option-text">
              <span className="invite-option-title">Share my bracket</span>
              <span className="invite-option-desc">
                Friends preview your bracket on a public page (no signup needed) and earn you XP if they join.
              </span>
            </span>
          </div>
          <div className="invite-share-strip-wrap">
            <ShareButtons
              text={referralText}
              url={referralUrl}
              copyLabel="Copy link"
              trackEvent="invite_completed"
              trackProps={{ kind: 'referral' }}
              notify={notify}
            />
          </div>
        </div>

        {/* Option 2 — create a new private league */}
        <button
          type="button"
          className="invite-option"
          onClick={handleCreate}
        >
          <span className="invite-option-icon"><Plus size={16} /></span>
          <span className="invite-option-text">
            <span className="invite-option-title">Create a private league</span>
            <span className="invite-option-desc">
              Start a fresh league with a passcode. Friends join only with the link.
            </span>
          </span>
          <span className="invite-option-cta">
            Create <ChevronRight size={14} />
          </span>
        </button>

        {/* Option 3 — invite to an existing private league */}
        <div className={`invite-option invite-option-static ${pickerOpen ? 'is-open' : ''}`}>
          <button
            type="button"
            className="invite-option-row"
            onClick={() => setPickerOpen(v => !v)}
            disabled={privateLeagues.length === 0}
            aria-expanded={pickerOpen}
            title={privateLeagues.length === 0 ? 'You haven\'t joined any private leagues yet' : undefined}
          >
            <span className="invite-option-icon"><Users size={16} /></span>
            <span className="invite-option-text">
              <span className="invite-option-title">
                Invite to one of your leagues
                {privateLeagues.length > 0 && <span className="invite-option-count"> · {privateLeagues.length}</span>}
              </span>
              <span className="invite-option-desc">
                {privateLeagues.length === 0
                  ? 'Once you create or join a private league, it\'ll show up here.'
                  : 'Generates a one-tap join link — recipients auto-join with the passcode included.'}
              </span>
            </span>
            <span className="invite-option-cta">
              {privateLeagues.length === 0
                ? null
                : <ChevronDown size={14} className={pickerOpen ? 'invite-chev-flip' : ''} />}
            </span>
          </button>
          {pickerOpen && privateLeagues.length > 0 && (
            <div className="invite-league-picker">
              <div className="invite-league-picker-list" role="listbox" aria-label="Choose a league">
                {privateLeagues.map(l => (
                  <button
                    key={l.id}
                    type="button"
                    role="option"
                    aria-selected={pickedLeagueId === l.id}
                    className={`invite-league-pill ${pickedLeagueId === l.id ? 'is-picked' : ''}`}
                    onClick={() => setPickedLeagueId(l.id)}
                  >
                    {l.name}
                    {l.passcode && <span className="invite-league-pill-pass">{l.passcode}</span>}
                  </button>
                ))}
              </div>
              {pickedLeague ? (
                <div className="invite-share-strip-wrap">
                  <ShareButtons
                    text={leagueText}
                    url={leagueUrl}
                    copyLabel={`Copy invite for "${pickedLeague.name}"`}
                    trackEvent="invite_completed"
                    trackProps={{ kind: 'league', league_id: pickedLeague.id }}
                    notify={notify}
                  />
                </div>
              ) : (
                <p className="invite-league-pick-hint">Pick a league above to share.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
