/**
 * SignupPromptModal — the no-login funnel's conversion prompt (item C).
 *
 * Shown at the three high-intent moments for an anonymous visitor:
 *   - 'prizes' : they tap "Save & submit" on the bracket (the completion gate)
 *   - 'save'   : they're about to leave with unsaved-feeling picks
 *   - 'share'  : they tap a share affordance
 *
 * Copy leads with the real prize incentive (amounts from src/config/legal.js)
 * and is honest: their picks are already saved under their anonymous session,
 * so signing up "makes them count" rather than "saves" them.
 */

import React from 'react';
import { X, Trophy } from 'lucide-react';
import { PRIZES } from '../config/legal';

const COPY = {
  prizes: {
    title: 'Lock in your bracket',
    sub: 'Sign up free to submit your picks and be eligible to win.',
  },
  save: {
    title: 'Keep your bracket',
    sub: 'Sign up free to keep your picks across devices and be eligible to win.',
  },
  share: {
    title: 'Share your bracket',
    sub: 'Sign up free to share your bracket, challenge friends, and be eligible to win.',
  },
};

export default function SignupPromptModal({ context = 'prizes', onSignUp, onClose }) {
  const c = COPY[context] || COPY.prizes;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="sup-title" onClick={onClose} style={{ zIndex: 2100 }}>
      <div className="signup-prompt" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        <div className="signup-prompt-trophy" aria-hidden="true"><Trophy size={40} /></div>
        <h2 id="sup-title" className="signup-prompt-title">{c.title}</h2>
        <p className="signup-prompt-sub">{c.sub}</p>
        <div className="signup-prompt-prizes">
          {PRIZES.map((p) => (
            <div key={p.place} className="signup-prompt-prize">
              <span className="signup-prompt-medal" aria-hidden="true">{p.medal}</span>
              <span className="signup-prompt-amount">${p.amount}</span>
              <span className="signup-prompt-cur">{p.currency}</span>
            </div>
          ))}
        </div>
        <p className="signup-prompt-fine">Top 3 at the end of the World Cup Final. Winners are contacted by email.</p>
        <button type="button" className="btn btn-primary btn-lg signup-prompt-cta" onClick={onSignUp}>
          Sign up free
        </button>
        <p className="signup-prompt-note">Your picks are already saved — signing up just makes them count.</p>
      </div>
    </div>
  );
}
