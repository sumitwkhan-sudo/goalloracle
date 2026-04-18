/**
 * StepProgress
 *
 * Wizard stepper shown at the top of SimplePrediction. Three steps, current
 * one highlighted, completed steps show a checkmark, clicking a completed
 * step navigates back (optionally gated by a confirmation from the parent).
 */

import React from 'react';
import { Check } from 'lucide-react';

const STEPS = [
  { key: 1, label: 'Groups' },
  { key: 2, label: 'Best Third' },
  { key: 3, label: 'Bracket' },
];

export default function StepProgress({ current, completed, onStepClick }) {
  return (
    <div className="simple-steps">
      {STEPS.map((s, i) => {
        const isDone = completed.includes(s.key);
        const isCurrent = s.key === current;
        const clickable = isDone && s.key !== current;
        return (
          <React.Fragment key={s.key}>
            <button
              type="button"
              className={`simple-step ${isCurrent ? 'current' : ''} ${isDone ? 'done' : ''}`}
              onClick={() => clickable && onStepClick && onStepClick(s.key)}
              disabled={!clickable}
              aria-current={isCurrent ? 'step' : undefined}
              aria-label={`Step ${s.key}: ${s.label}${isDone ? ' (completed)' : ''}`}
            >
              <span className="simple-step-num">
                {isDone ? <Check size={14} /> : s.key}
              </span>
              <span className="simple-step-label">{s.label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="simple-step-sep" aria-hidden="true" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}
