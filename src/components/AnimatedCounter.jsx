import React, { useState, useEffect, useRef } from 'react';

// Animate from the currently displayed value to the new target — never reset
// to 0 on subsequent updates. preds / results stream in from Firestore in
// multiple bursts; without ramp-from-current the dashboard counters would
// blink back to 0 and re-run the animation on every update.
export default function AnimatedCounter({ value, prefix = '', suffix = '', decimals = 0 }) {
  const [d, setD] = useState(0);
  const dRef = useRef(0);
  useEffect(() => { dRef.current = d; }, [d]);
  useEffect(() => {
    if (value == null || Number.isNaN(value)) { setD(0); dRef.current = 0; return; }
    const start = dRef.current;
    if (start === value) return;
    const span = value - start;
    const totalSteps = 30;
    let step = 0;
    const t = setInterval(() => {
      step++;
      if (step >= totalSteps) { setD(value); dRef.current = value; clearInterval(t); return; }
      const cur = start + (span * step) / totalSteps;
      setD(cur);
    }, 25);
    return () => clearInterval(t);
  }, [value]);
  return <span>{prefix}{decimals > 0 ? d.toFixed(decimals) : Math.floor(d).toLocaleString()}{suffix}</span>;
}
