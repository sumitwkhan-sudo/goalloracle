/**
 * HouseRulesInput
 *
 * Optional free-text textarea used in the create-league form and the
 * (future) edit-league flow. Plain-text only — no markdown, no link
 * rendering — to keep this dead simple and reduce phishing surface in
 * v1. Server enforces the same 500-char limit + private-only rule.
 *
 * Controlled component: parent owns the value + onChange. We just
 * render the input, a live char counter, and the helper text.
 */

import React from 'react';

const MAX_LEN = 500;

export default function HouseRulesInput({
  value = '',
  onChange,
  disabled = false,
  label = 'House Rules (optional)',
  helper = 'Add any notes for your members — pick deadlines, tiebreakers, group chat links, etc.',
  placeholder = 'e.g., Submit picks by Friday 8pm. Tiebreaker is total goals scored. Group chat: [link]',
}) {
  const v = typeof value === 'string' ? value : '';
  const remaining = MAX_LEN - v.length;
  const over = remaining < 0;
  const handle = (e) => {
    let next = e.target.value;
    // Truncate paste / IME input that exceeds the limit so the user
    // can't sneak past the cap via copy-paste. Server also enforces.
    if (next.length > MAX_LEN) next = next.slice(0, MAX_LEN);
    onChange?.(next);
  };
  return (
    <div className="house-rules-input">
      <label className="house-rules-label">{label}</label>
      <textarea
        className="input-field house-rules-textarea"
        value={v}
        onChange={handle}
        placeholder={placeholder}
        rows={4}
        maxLength={MAX_LEN}
        disabled={disabled}
        aria-describedby="house-rules-helper house-rules-counter"
      />
      <div className="house-rules-meta">
        <span id="house-rules-helper" className="house-rules-helper">{helper}</span>
        <span id="house-rules-counter" className={`house-rules-counter ${remaining <= 50 ? 'house-rules-counter-warn' : ''} ${over ? 'house-rules-counter-over' : ''}`}>
          {v.length} / {MAX_LEN}
        </span>
      </div>
    </div>
  );
}
