/**
 * KnockoutLockCTA
 *
 * A prominent, on-brand "lock in your knockout bracket" prompt shown on the
 * logged-out homepage hero and the logged-in dashboard. A live countdown to the
 * Round-of-32 lock (single source of truth: stageLockTimeUtc('roundOf32')).
 *
 * It stays dumb: each surface passes `onAction` (the nav/sign-up wiring) and a
 * `hasPicks` flag. Copy reassures users who already have picks that their
 * existing bracket is saved + still scoring — they can re-pick now that the real
 * teams are set, or keep what they have. Renders nothing once R32 has locked.
 */

import React, { useEffect, useState } from 'react';
import { Trophy, Lock, ChevronRight } from 'lucide-react';
import { stageLockTimeUtc, formatLockDelta } from '../utils/stageLock';

// Live R32-lock countdown; ticks every 30s. Shared so any surface can show the
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

const COPY = {
  hero: {
    none: {
      eyebrow: 'The knockouts are set',
      title: 'Lock in your World Cup knockout bracket',
      sub: 'The 32 knockout teams are confirmed. Pick the winners all the way to the Final — free to play, with prizes for the top finishers.',
      cta: 'Start my bracket — Free',
    },
    have: {
      eyebrow: 'Your bracket is ready',
      title: 'Lock in your knockout bracket',
      sub: 'Sign up free to lock in your picks and stay eligible for prizes. Your picks are already saved — this just secures them.',
      cta: 'Sign up to lock in',
    },
  },
  dashboard: {
    none: {
      eyebrow: 'Round of 32 is set',
      title: 'Fill in your knockout bracket',
      sub: 'The real Round of 32 matchups are confirmed. Pick your winners through to the Final before the bracket locks.',
      cta: 'Build my bracket',
    },
    have: {
      eyebrow: 'Real teams are set',
      title: 'Review your knockout bracket',
      sub: 'Your picks are saved and still scoring. Now the actual Round of 32 is set — re-pick before lock so you don’t miss out, or keep exactly what you have.',
      cta: 'Review my bracket',
    },
  },
};

export default function KnockoutLockCTA({ variant = 'dashboard', hasPicks = false, onAction }) {
  const { lockMs, locked, label } = useKnockoutLock();
  // Quiet once R32 has locked (or if the lock time can't be resolved).
  if (locked || !Number.isFinite(lockMs)) return null;

  const copy = (COPY[variant] || COPY.dashboard)[hasPicks ? 'have' : 'none'];
  const Icon = hasPicks ? Trophy : Lock;

  return (
    <div className={`klc klc-${variant} ${hasPicks ? 'klc-have' : 'klc-none'}`}>
      <span className="klc-glow" aria-hidden="true" />
      <div className="klc-icon" aria-hidden="true"><Icon size={22} /></div>
      <div className="klc-body">
        <div className="klc-eyebrow">{copy.eyebrow}</div>
        <div className="klc-title">{copy.title}</div>
        <div className="klc-sub">{copy.sub}</div>
        <div className="klc-deadline">
          <span className="klc-dot" aria-hidden="true" />
          Round of 32 locks in <strong>{label}</strong>
        </div>
      </div>
      <button type="button" className="btn btn-primary btn-lg klc-cta" onClick={onAction}>
        {copy.cta} <ChevronRight size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
