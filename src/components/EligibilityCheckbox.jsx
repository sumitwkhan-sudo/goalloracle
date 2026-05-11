/**
 * EligibilityCheckbox — single-control consent capture for the prize
 * contest. Used inline at the bottom of WelcomeFlow (new-user signup)
 * and inside ContestConsentBanner (existing-user re-prompt).
 *
 * One checkbox combining the two attestations (18+, eligible
 * jurisdiction) plus link to Official Rules. Per the spec, this is
 * deliberately subtle — a single line, not a multi-step compliance
 * gate. The full rules text lives at /official-rules; this component
 * just collects the click.
 *
 * Parent passes `checked` + `onChange`. Parent is responsible for
 * gating its submit button on the value. We don't enforce it
 * internally — keeps this purely controlled and reusable.
 */

import React from 'react';
import { MIN_AGE, RULES_VERSION } from '../config/legal';
import { track } from '../utils/track';

export default function EligibilityCheckbox({
  checked,
  onChange,
  disabled = false,
  onSeeRules,        // function — called when user clicks the "Official Rules" link
  className = '',
}) {
  const handle = (e) => {
    const next = !!e.target.checked;
    onChange?.(next);
    if (next) {
      // Fire only on transition to true so we count opt-ins, not toggles.
      track('eligibility_checkbox_checked', { checked: true, rulesVersion: RULES_VERSION });
    }
  };

  return (
    <label className={`eligibility-checkbox ${className}`}>
      <input
        type="checkbox"
        checked={!!checked}
        onChange={handle}
        disabled={disabled}
        aria-describedby="eligibility-checkbox-text"
      />
      <span id="eligibility-checkbox-text" className="eligibility-checkbox-text">
        I&rsquo;m {MIN_AGE}+ and a resident of an eligible jurisdiction. I agree to the{' '}
        <button
          type="button"
          className="eligibility-checkbox-link"
          onClick={(e) => { e.preventDefault(); onSeeRules?.(); }}
        >
          Official Rules
        </button>.
      </span>
    </label>
  );
}
