/**
 * PasscodePromptModal
 *
 * One-screen post-signup prompt: invites brand-new users to enter a
 * passcode from a friend so their first prediction lands them in a
 * private league alongside the global one. Skipping is a first-class
 * choice — the user is already a member of the Global League
 * automatically, and the copy makes that explicit.
 *
 * Controlled by the caller via `open`. The caller is responsible for
 * persisting `onboardingComplete: true` on the user doc so the prompt
 * doesn't reappear next session.
 */

import React, { useState } from 'react';
import { Users, X, Check } from 'lucide-react';
import { lookupLeagueByPasscode } from '../utils/db';

export default function PasscodePromptModal({
  open,
  allLeagues,
  onJoin,        // async (league, passcode) => void
  onSkip,        // () => void
  notify,
}) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const handleJoin = async () => {
    setErr('');
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) { setErr('Enter a passcode to continue, or tap Skip.'); return; }
    setBusy(true);
    // Server-side lookup — new private leagues keep their passcode in a
    // subcollection that clients can't read directly, so the legacy
    // allLeagues.find() check silently failed for every league created
    // since that refactor.
    let match;
    try {
      match = await lookupLeagueByPasscode(trimmed);
    } catch (lookupErr) {
      setErr('No league found with that passcode. Double-check with your friend.');
      setBusy(false);
      return;
    }
    if (!match) {
      setErr('No league found with that passcode. Double-check with your friend.');
      setBusy(false);
      return;
    }
    try {
      await onJoin(match, trimmed);
      if (notify) notify(`Joined "${match.name}"`);
    } catch (e) {
      setErr(e?.message || 'Could not join — try again.');
      setBusy(false);
    }
    // On success the parent will close the modal, so no reset needed.
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ppm-title">
      <div className="passcode-prompt-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ppm-icon"><Users size={28} aria-hidden="true" /></div>
        <h2 id="ppm-title" className="ppm-title">Got a passcode from a friend?</h2>
        <p className="ppm-sub">
          Enter it to join their private league right away. You'll also be in
          the <strong>Global League</strong> automatically.
        </p>

        <div className="ppm-input-row">
          <input
            type="text"
            className="input-field ppm-input"
            placeholder="GOAL2026"
            value={code}
            onChange={(e) => { setCode(e.target.value.toUpperCase()); if (err) setErr(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleJoin(); }}
            maxLength={12}
            autoFocus
            autoCapitalize="characters"
            spellCheck={false}
            disabled={busy}
            aria-label="Private-league passcode"
          />
          <button
            type="button"
            className="btn btn-primary ppm-join-btn"
            onClick={handleJoin}
            disabled={busy || !code.trim()}
          >
            {busy ? 'Joining…' : <><Check size={16} /> Join</>}
          </button>
        </div>
        {err && <p className="ppm-err" role="alert">{err}</p>}

        <button type="button" className="ppm-skip" onClick={onSkip} disabled={busy}>
          <X size={14} aria-hidden="true" /> No code right now — go to Global League
        </button>
        <p className="ppm-skip-hint">
          You can join private leagues anytime from your dashboard.
        </p>
      </div>
    </div>
  );
}
