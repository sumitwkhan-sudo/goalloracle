/**
 * BracketHintTooltip
 *
 * First-visit prompt that points at the first R32 matchup and tells the
 * user how to advance teams. The bracket reads as a static display
 * otherwise — this is the smallest touch that turns it interactive.
 *
 * Visibility is controlled by the parent so the wizard can dismiss the
 * tooltip on the first pick anywhere in the bracket. Parent also handles
 * localStorage persistence.
 */

import React from 'react';
import { X } from 'lucide-react';

export default function BracketHintTooltip({ onDismiss }) {
  return (
    <div className="bracket-hint-tooltip" role="status" aria-live="polite">
      <span className="bracket-hint-arrow" aria-hidden="true" />
      <span className="bracket-hint-text">
        Tap a team to advance them to the next round
      </span>
      <button
        type="button"
        className="bracket-hint-close"
        onClick={onDismiss}
        aria-label="Dismiss tip"
      >
        <X size={12} />
      </button>
    </div>
  );
}
