/**
 * useBestThird
 *
 * Tracks the user's selection of 8-of-12 third-place groups.
 * Enforces the "exactly 8" constraint by rejecting a 9th pick.
 */

import { useEffect, useRef, useState, useCallback } from 'react';

export const BEST_THIRD_REQUIRED = 8;

export default function useBestThird(initialPicks) {
  const [picks, setPicks] = useState([]);
  const hydratedRef = useRef(false);

  useEffect(() => {
    if (hydratedRef.current) return;
    if (Array.isArray(initialPicks)) {
      setPicks([...initialPicks].slice(0, BEST_THIRD_REQUIRED));
      hydratedRef.current = true;
    }
  }, [initialPicks]);

  const toggle = useCallback((group) => {
    setPicks((prev) => {
      if (prev.includes(group)) return prev.filter((g) => g !== group);
      if (prev.length >= BEST_THIRD_REQUIRED) return prev; // cap at 8
      return [...prev, group];
    });
  }, []);

  const clear = useCallback(() => setPicks([]), []);

  const isComplete = picks.length === BEST_THIRD_REQUIRED;
  const isFull = picks.length >= BEST_THIRD_REQUIRED;

  return { picks, toggle, clear, isComplete, isFull };
}
