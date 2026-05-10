/**
 * WizardCoachmarks.jsx — 3-step intro overlay for first-time wizard visitors.
 *
 * Shows on the user's first arrival at the Quick Picks wizard. Walks through
 * the three sections (rank groups → pick best 3rds → fill bracket) with
 * concrete copy explaining what they'll do and how scoring works at each
 * step. Skip is a first-class action; never blocks gameplay.
 *
 * One-shot per browser via localStorage flag to mirror the existing
 * BRACKET_HINT_KEY pattern. Re-shown if user clears site data.
 */

import React, { useState } from 'react';
import { ChevronRight, ChevronLeft, X } from 'lucide-react';

const COACH_KEY = 'goaloracle_wizard_tutorial_seen';

export function hasSeenWizardTutorial() {
  try { return localStorage.getItem(COACH_KEY) === '1'; } catch { return false; }
}

export function markWizardTutorialSeen() {
  try { localStorage.setItem(COACH_KEY, '1'); } catch {}
}

const STEPS = [
  {
    title: 'Step 1 — Rank each group',
    body: 'Drag teams into 1st / 2nd / 3rd / 4th for each of the 12 groups. Don\'t want to drag? Hit "Confirm ranking" to lock in the default order. Each group ranking is worth up to 7 points.',
    emoji: '🥇',
  },
  {
    title: 'Step 2 — Pick the best 3rd-placed teams',
    body: 'Only 8 of 12 third-placed teams advance to the Round of 32. Pick which 8 you think will. 2 points per correctly chosen group.',
    emoji: '🎯',
  },
  {
    title: 'Step 3 — Fill out the bracket',
    body: 'Pick winners round by round through to the Final. Each round counts more than the last — picking the right champion is worth 12 points.',
    emoji: '🏆',
  },
];

export default function WizardCoachmarks({ onDismiss }) {
  const [idx, setIdx] = useState(0);
  const step = STEPS[idx];
  const isLast = idx === STEPS.length - 1;

  const dismiss = () => {
    markWizardTutorialSeen();
    onDismiss?.();
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="coach-title" onClick={dismiss}>
      <div className="wizard-coachmarks" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={dismiss} aria-label="Skip tutorial">
          <X size={18} />
        </button>

        <div className="coach-emoji" aria-hidden="true">{step.emoji}</div>
        <h2 id="coach-title" className="coach-title">{step.title}</h2>
        <p className="coach-body">{step.body}</p>

        <div className="coach-dots" aria-hidden="true">
          {STEPS.map((_, i) => (
            <span key={i} className={`coach-dot ${i === idx ? 'coach-dot-active' : ''}`} />
          ))}
        </div>

        <div className="coach-actions">
          {idx > 0 && (
            <button type="button" className="btn btn-ghost coach-prev" onClick={() => setIdx(idx - 1)}>
              <ChevronLeft size={14} /> Back
            </button>
          )}
          <button type="button" className="btn btn-ghost coach-skip" onClick={dismiss}>
            Skip
          </button>
          {!isLast ? (
            <button type="button" className="btn btn-primary coach-next" onClick={() => setIdx(idx + 1)}>
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button type="button" className="btn btn-primary coach-next" onClick={dismiss}>
              Got it
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
