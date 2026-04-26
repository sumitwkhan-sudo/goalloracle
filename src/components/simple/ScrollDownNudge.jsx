/**
 * ScrollDownNudge
 *
 * Subtle "scroll down to start" prompt rendered between the collapsed
 * scoring panel and the group grid on Step 1 of Quick Picks. Bouncing
 * chevron + a one-line label, fades itself out the moment the user
 * scrolls past it (or after a 6-second timer, so it never lingers).
 *
 * Stays out of the way for returning users by also dismissing on the
 * second visit via localStorage.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

const STORAGE_KEY = 'goaloracle_qp_scroll_nudge_seen';

export default function ScrollDownNudge({ label = 'Scroll down to rank each group' }) {
  const [visible, setVisible] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) !== '1'; } catch { return true; }
  });
  const ref = useRef(null);

  useEffect(() => {
    if (!visible) return;
    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      setVisible(false);
      try { localStorage.setItem(STORAGE_KEY, '1'); } catch {}
    };

    // Auto-dismiss as soon as the nudge scrolls out of view — by then
    // the user has clearly figured it out without our help.
    const el = ref.current;
    let observer = null;
    if (el && 'IntersectionObserver' in window) {
      observer = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) dismiss();
        }
      }, { threshold: 0 });
      observer.observe(el);
    }

    // Belt-and-braces: fade after 6s even if the user hasn't moved.
    const t = setTimeout(dismiss, 6000);

    return () => {
      clearTimeout(t);
      if (observer) observer.disconnect();
    };
  }, [visible]);

  if (!visible) return null;
  return (
    <div ref={ref} className="qp-scroll-nudge" aria-hidden="true">
      <span className="qp-scroll-nudge-label">{label}</span>
      <ChevronDown size={18} className="qp-scroll-nudge-chev" />
    </div>
  );
}
