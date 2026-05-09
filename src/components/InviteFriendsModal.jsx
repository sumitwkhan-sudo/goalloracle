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
import { X, Sparkles, Plus, Users, Copy, Check, ChevronRight, ChevronDown } from 'lucide-react';

function buildShareUrl({ origin, userId, leagueId, passcode }) {
  const params = new URLSearchParams();
  if (userId) params.set('ref', userId);
  if (leagueId) params.set('join', leagueId);
  if (passcode) params.set('p', passcode);
  return `${origin}/?${params.toString()}`;
}

async function shareOrCopy({ title, text, url, notify, copyMessage }) {
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title, text, url });
      return true;
    }
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(url);
      if (notify) notify(copyMessage);
      return true;
    }
  } catch {
    // user cancelled native share, or clipboard blocked — silent
  }
  return false;
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
  const [copied, setCopied] = useState(null); // 'referral' | 'league' | null

  if (!open) return null;

  const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://goaloracle.io';

  // ── 1. Referral share ─────────────────────────────────────────
  const handleReferralShare = async () => {
    const url = buildShareUrl({ origin, userId });
    const text = `Join me on GoalOracle — predict the World Cup 2026: ${url}`;
    const ok = await shareOrCopy({
      title: 'GoalOracle',
      text, url, notify,
      copyMessage: 'Referral link copied — earn XP for each signup',
    });
    if (ok) {
      setCopied('referral');
      setTimeout(() => setCopied(null), 1800);
    }
  };

  // ── 2. Create a new private league ────────────────────────────
  const handleCreate = () => {
    onClose?.();
    onCreateLeague?.();
  };

  // ── 3. Invite to an existing private league ───────────────────
  const handleLeagueShare = async () => {
    if (!pickedLeague) return;
    const url = buildShareUrl({
      origin, userId,
      leagueId: pickedLeague.id,
      passcode: pickedLeague.passcode || undefined,
    });
    const text = `Join my GoalOracle league "${pickedLeague.name}" — predict the World Cup 2026: ${url}`;
    const ok = await shareOrCopy({
      title: `Join ${pickedLeague.name}`,
      text, url, notify,
      copyMessage: `Invite to "${pickedLeague.name}" copied`,
    });
    if (ok) {
      setCopied('league');
      setTimeout(() => setCopied(null), 1800);
    }
  };

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

        {/* Option 1 — referral share */}
        <button
          type="button"
          className="invite-option"
          onClick={handleReferralShare}
        >
          <span className="invite-option-icon"><Sparkles size={16} /></span>
          <span className="invite-option-text">
            <span className="invite-option-title">Share GoalOracle</span>
            <span className="invite-option-desc">
              Copies a referral link so signups join the Global League. Earn XP for every friend who joins.
            </span>
          </span>
          <span className="invite-option-cta">
            {copied === 'referral' ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Share</>}
          </span>
        </button>

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
              <button
                type="button"
                className="invite-league-share-btn"
                onClick={handleLeagueShare}
                disabled={!pickedLeague}
              >
                {copied === 'league'
                  ? <><Check size={14} /> Copied — paste to your friends</>
                  : <><Copy size={14} /> {pickedLeague ? `Copy invite for "${pickedLeague.name}"` : 'Pick a league above'}</>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
