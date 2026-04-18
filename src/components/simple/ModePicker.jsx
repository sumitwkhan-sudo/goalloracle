/**
 * ModePicker
 *
 * Two-card selector shown in the league-creation flow. Simple is the default
 * (highlighted) and marked "RECOMMENDED". Classic is the secondary option.
 */

import React from 'react';
import { Target } from 'lucide-react';

const MODES = [
  {
    key: 'simple',
    icon: '⚽',
    title: 'Simple Mode',
    recommended: true,
    description: 'Pick group rankings + bracket winners. No score predictions. Great for casual fans.',
    scoring: '% prediction accuracy',
    tiebreaker: 'earliest submission',
  },
  {
    key: 'classic',
    iconComponent: Target,
    title: 'Classic Mode',
    recommended: false,
    description: 'Predict every match score. Full points system. For the dedicated football analysts.',
    scoring: 'points per correct result',
    tiebreaker: 'total points',
  },
];

export default function ModePicker({ value, onChange }) {
  return (
    <div className="mode-picker">
      {MODES.map((m) => {
        const selected = value === m.key;
        const Icon = m.iconComponent;
        return (
          <button
            key={m.key}
            type="button"
            className={`mode-card ${selected ? 'selected' : ''}`}
            onClick={() => onChange(m.key)}
            aria-pressed={selected}
          >
            <div className="mode-card-header">
              <span className="mode-card-icon" aria-hidden="true">
                {Icon ? <Icon size={20} /> : m.icon}
              </span>
              <span className="mode-card-title">{m.title}</span>
              {m.recommended && <span className="mode-card-badge">RECOMMENDED</span>}
            </div>
            <p className="mode-card-desc">{m.description}</p>
            <dl className="mode-card-meta">
              <div><dt>Scoring</dt><dd>{m.scoring}</dd></div>
              <div><dt>Tiebreaker</dt><dd>{m.tiebreaker}</dd></div>
            </dl>
          </button>
        );
      })}
    </div>
  );
}
