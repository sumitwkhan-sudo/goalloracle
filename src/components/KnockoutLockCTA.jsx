/**
 * KnockoutLockCTA
 *
 * One subtle, gold-bordered banner prompting users to lock in their knockout
 * bracket, with a live countdown to the Round-of-32 lock (single source of
 * truth: stageLockTimeUtc('roundOf32')). Shown on the logged-out homepage hero
 * and the logged-in dashboard. The whole banner is the click target.
 *
 * Stays dumb: each surface passes `onAction` + a `hasPicks` flag. Renders
 * nothing once R32 has locked.
 */

import React, { useEffect, useState } from 'react';
import { Trophy, Lock, ChevronRight } from 'lucide-react';
import { stageLockTimeUtc, formatLockDelta } from '../utils/stageLock';

// Live R32-lock countdown; ticks every 30s. Shared so any surface shows the
// same "locks in Xd Xh" string off one clock.
export function useKnockoutLock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  let lockMs = Infinity;
  try { lockMs = stageLockTimeUtc('roundOf32') - now; } catch { lockMs = Infinity; }
  return { lockMs, locked: Number.isFinite(lockMs) && lockMs <= 0, label: formatLockDelta(lockMs) };
}

export default function KnockoutLockCTA({ variant = 'dashboard', hasPicks = false, onAction }) {
  const { lockMs, locked, label } = useKnockoutLock();
  // Quiet once R32 has locked (or if the lock time can't be resolved).
  if (locked || !Number.isFinite(lockMs)) return null;

  const text = hasPicks
    ? 'Lock in your updated knockout bracket'
    : 'Lock in your World Cup knockout bracket';
  const Icon = hasPicks ? Trophy : Lock;

  return (
    <button
      type="button"
      className={`klc klc-${variant} ${hasPicks ? 'klc-have' : 'klc-none'}`}
      onClick={onAction}
    >
      <Icon size={16} className="klc-icon" aria-hidden="true" />
      <span className="klc-text">{text}</span>
      <span className="klc-deadline">Round&nbsp;of&nbsp;32 locks in <strong>{label}</strong></span>
      <ChevronRight size={16} className="klc-arrow" aria-hidden="true" />
    </button>
  );
}
