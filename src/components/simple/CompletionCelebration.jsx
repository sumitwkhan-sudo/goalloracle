/**
 * CompletionCelebration.jsx
 *
 * Shown once when a user transitions from incomplete → complete in the
 * Quick Picks wizard (i.e. they just picked the Final winner). Closes the
 * emotional loop after ~3 minutes of bracket-filling and surfaces the
 * existing BracketShareModal as the primary next action — share is the
 * single most-leveraged path back into the funnel.
 *
 * Single-fire: the parent passes `open` as true only on the first
 * transition. Once dismissed, `onDismiss` flips it false and we don't
 * re-show on subsequent edits.
 */

import React from 'react';
import { Trophy, X, Share2, ChevronRight } from 'lucide-react';

export default function CompletionCelebration({
  open,
  championName,
  championFlag,
  onShare,
  onDismiss,
  onViewBracket,
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="ccel-title" onClick={onDismiss}>
      <div className="completion-celebration" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onDismiss} aria-label="Close">
          <X size={18} />
        </button>

        <div className="ccel-trophy" aria-hidden="true">
          <Trophy size={48} />
        </div>

        <h2 id="ccel-title" className="ccel-title">Bracket locked in!</h2>

        {championName ? (
          <p className="ccel-sub">
            You picked {championFlag ? <span className="ccel-flag">{championFlag}</span> : null}{' '}
            <strong>{championName}</strong> to win the World Cup. Bold call. We'll see.
          </p>
        ) : (
          <p className="ccel-sub">Your bracket is in. The hard part is over.</p>
        )}

        <div className="ccel-actions">
          {typeof onShare === 'function' && (
            <button type="button" className="btn btn-primary ccel-share" onClick={() => { onShare(); onDismiss(); }}>
              <Share2 size={14} /> Share my bracket
            </button>
          )}
          {typeof onViewBracket === 'function' && (
            <button type="button" className="btn btn-ghost ccel-view" onClick={() => { onViewBracket(); onDismiss(); }}>
              Review bracket <ChevronRight size={14} />
            </button>
          )}
        </div>

        <p className="ccel-hint">
          You can still tweak later rounds until each stage starts. Tournament kicks off June 11.
        </p>
      </div>
    </div>
  );
}
