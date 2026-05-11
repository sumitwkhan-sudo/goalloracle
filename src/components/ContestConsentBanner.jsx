/**
 * ContestConsentBanner — one-time inline consent for users who joined
 * Global League BEFORE the prize contest existed (or before
 * RULES_VERSION bumped).
 *
 * Behaviour:
 *   - Hidden if user has on-file consent for the current rules version.
 *   - Hidden if user has explicitly opted out (prizeIneligible=true).
 *   - Hidden if dismissed in this session via localStorage flag (so it
 *     doesn't keep popping back as the user navigates).
 *   - Otherwise shows a single horizontal banner at the top of the
 *     viewport area: short copy + Confirm + Dismiss.
 *
 * Subtle by design — one line of copy, no overlay, no blocking modal.
 * If a user truly never opens the prize surface they may never see this;
 * that's fine, they're flagged ineligible silently and can opt-in later
 * when they engage.
 */

import React, { useState } from 'react';
import { Award, X, RefreshCw } from 'lucide-react';
import EligibilityCheckbox from './EligibilityCheckbox';
import { RULES_VERSION, hasCurrentConsent, isPrizeIneligible } from '../config/legal';

const DISMISSED_KEY = 'goaloracle_contest_consent_dismissed_v' + RULES_VERSION;

function readDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}
function writeDismissed() {
  try { localStorage.setItem(DISMISSED_KEY, '1'); } catch {}
}

export default function ContestConsentBanner({
  userDoc,
  onConfirm,         // async ({ rulesVersion, ageAttested, jurisdictionAttested }) => void
  onDecline,         // async () => void  (sets prizeIneligible: true server-side)
  onSeeRules,
}) {
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dismissedLocal, setDismissedLocal] = useState(readDismissed());

  // Visibility guards — fastest exit first. If any return null, no DOM.
  if (!userDoc) return null;
  if (hasCurrentConsent(userDoc)) return null;
  if (isPrizeIneligible(userDoc)) return null;
  if (dismissedLocal) return null;

  const submit = async () => {
    if (!checked || busy) return;
    setBusy(true);
    try {
      await onConfirm?.({
        rulesVersion: RULES_VERSION,
        ageAttested: true,
        jurisdictionAttested: true,
      });
      writeDismissed();
      setDismissedLocal(true);
    } catch {
      setBusy(false); // leave the banner visible so the user can retry
    }
  };

  const dismiss = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Mark prize-ineligible server-side so we have a durable record of
      // the opt-out (rather than relying on the dismiss-flag in
      // localStorage, which can be wiped). The user keeps their
      // leaderboard spot — they just won't be a winner candidate.
      await onDecline?.();
      writeDismissed();
      setDismissedLocal(true);
    } catch {
      setBusy(false);
    }
  };

  return (
    <div className="contest-consent-banner" role="region" aria-label="Confirm prize contest eligibility">
      <div className="contest-consent-inner">
        <Award size={16} className="contest-consent-icon" aria-hidden="true" />
        <div className="contest-consent-body">
          <div className="contest-consent-title">Confirm prize contest eligibility</div>
          <EligibilityCheckbox
            checked={checked}
            onChange={setChecked}
            disabled={busy}
            onSeeRules={onSeeRules}
            className="contest-consent-eligibility"
          />
        </div>
        <div className="contest-consent-actions">
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={submit}
            disabled={!checked || busy}
          >
            {busy ? <><RefreshCw size={13} className="spin" /> Saving…</> : 'Confirm'}
          </button>
          <button
            type="button"
            className="contest-consent-dismiss"
            onClick={dismiss}
            disabled={busy}
            aria-label="Dismiss — opt out of prize eligibility"
            title="Skip — opt out of prize eligibility"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
