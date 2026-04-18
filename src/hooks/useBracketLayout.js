/**
 * useBracketLayout
 *
 * Returns 'desktop' at window widths ≥ 1024px, 'mobile' below.
 * SSR-safe default: 'mobile'.
 */

import { useEffect, useState } from 'react';

const DESKTOP_BREAKPOINT = 1024;

export default function useBracketLayout() {
  const [layout, setLayout] = useState(() => {
    if (typeof window === 'undefined') return 'mobile';
    return window.innerWidth >= DESKTOP_BREAKPOINT ? 'desktop' : 'mobile';
  });

  useEffect(() => {
    const onResize = () => {
      setLayout(window.innerWidth >= DESKTOP_BREAKPOINT ? 'desktop' : 'mobile');
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return layout;
}
