/**
 * GroupGrid
 *
 * 2-column grid of 12 GroupCards on desktop, 1-column on mobile, plus a
 * sticky progress indicator ("Groups ranked: X / 12") that stays visible
 * as the user scrolls through the 12 groups.
 */

import React from 'react';
import GroupCard from './GroupCard';
import { GROUPS } from '../../utils/bracketUtils';

export default function GroupGrid({
  predictions,
  touched,
  flags,
  touchedCount,
  onReorder,
  onConfirm,
  onUnconfirm,
}) {
  const pct = (touchedCount / GROUPS.length) * 100;
  return (
    <div className="group-grid-wrap">
      <div className="group-grid-progress" role="status" aria-live="polite">
        <div className="group-grid-progress-row">
          <span>Groups ranked</span>
          <strong>{touchedCount} / {GROUPS.length}</strong>
          <span className="group-grid-progress-remaining">
            {touchedCount === GROUPS.length
              ? 'All done — ready to continue'
              : `${GROUPS.length - touchedCount} left`}
          </span>
        </div>
        <div className="group-grid-bar" aria-hidden="true">
          <div className="group-grid-bar-fill" style={{ width: `${pct}%` }} />
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
            onConfirm={onConfirm}
            onUnconfirm={onUnconfirm}
          />
        ))}
      </div>
    </div>
  );
}
