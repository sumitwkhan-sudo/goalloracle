/**
 * ScrollDownNudge
 *
 * Subtle "scroll down to start" prompt rendered between the collapsed
 * scoring panel and the Save & Continue button on Step 1 of Quick
 * Picks. Bouncing chevron + a one-line label, dismisses itself once
 * the user scrolls past it.
 *
 * Shown on every visit. Earlier versions one-shot-dismissed it via
 * localStorage and a 6s timer, but the layout above the groups is
 * tall enough that even returning users benefit from the affordance —
 * without it the page reads like it ends at "Save & Continue".
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function ScrollDownNudge({ label = 'Scroll down to rank each group' }) {
  const [visible, setVisible] = useState(true);
  const ref = useRef(null);

  useEffect(() => {
    if (!visible) return;
    const el = ref.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const observer = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) setVisible(false);
      }
    }, { threshold: 0 });
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  if (!visible) return null;
  return (
    <div ref={ref} className="qp-scroll-nudge" aria-hidden="true">
      <span className="qp-scroll-nudge-label">{label}</span>
      <ChevronDown size={18} className="qp-scroll-nudge-chev" />
    </div>
  );
}
