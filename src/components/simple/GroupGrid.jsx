/**
 * GroupGrid
 *
 * 2-column grid of 12 GroupCards on desktop, 1-column on mobile, plus a
 * progress indicator ("Groups ranked: X / 12").
 */

import React from 'react';
import GroupCard from './GroupCard';
import { GROUPS } from '../../utils/bracketUtils';

export default function GroupGrid({ predictions, touched, flags, touchedCount, onReorder }) {
  return (
    <div className="group-grid-wrap">
      <div className="group-grid-progress">
        <span>Groups ranked</span>
        <strong>{touchedCount} / {GROUPS.length}</strong>
        <div className="group-grid-bar" aria-hidden="true">
          <div className="group-grid-bar-fill" style={{ width: `${(touchedCount / GROUPS.length) * 100}%` }} />
        </div>
      </div>
      <div className="group-grid">
        {GROUPS.map((g) => (
          <GroupCard
            key={g}
            group={g}
            ranking={predictions[g]?.ranking || []}
            flags={flags}
            touched={!!touched[g]}
            onReorder={(newRanking) => onReorder(g, newRanking)}
          />
        ))}
      </div>
    </div>
  );
}
