/**
 * FifaTooltip
 *
 * Click-to-toggle info popover next to the 3rd-place badge on each group card.
 * Hover-to-open on desktop, click-to-open on mobile. Dismissible via outside
 * click, Escape key, or X button.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Info, X } from 'lucide-react';
import { FIFA_THIRD_PLACE_EXPLANATION } from '../../utils/fifaThirdPlaceRules';

export default function FifaTooltip() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <span className="fifa-tooltip" ref={ref}>
      <button
        type="button"
        className="fifa-tooltip-trigger"
        aria-label="About best third-place rule"
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
        onMouseEnter={() => setOpen(true)}
      >
        <Info size={12} />
      </button>
      {open && (
        <div className="fifa-tooltip-popover" role="tooltip">
          <button
            type="button"
            className="fifa-tooltip-close"
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            aria-label="Close tooltip"
          >
            <X size={12} />
          </button>
          <strong>Best third-place teams</strong>
          <p>{FIFA_THIRD_PLACE_EXPLANATION} You&rsquo;ll pick which 8 in the next step.</p>
        </div>
      )}
    </span>
  );
}
