/* Render guard for the knockout lock-in CTA: it ships on the homepage hero +
 * dashboard, so a render crash here would blank those surfaces. Verifies it
 * renders across variants, carries the live countdown + the have-picks
 * reassurance, and self-hides once R32 has locked. */
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Controllable R32 lock time so the "locked → renders nothing" path is testable
// without depending on the wall clock. formatLockDelta stays real.
const state = vi.hoisted(() => ({ lockMs: 0 }));
vi.mock('../utils/stageLock', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, stageLockTimeUtc: () => state.lockMs };
});

import KnockoutLockCTA from './KnockoutLockCTA';

describe('KnockoutLockCTA', () => {
  it('renders the hero variant (no picks) with the live R32 countdown', () => {
    state.lockMs = Date.now() + 20 * 3600000; // 20h out
    const html = renderToStaticMarkup(<KnockoutLockCTA variant="hero" hasPicks={false} onAction={() => {}} />);
    expect(html).toContain('locks in');
    expect(html).toContain('Lock in your World Cup knockout bracket');
  });

  it('uses the "updated bracket" copy for have-picks users (dashboard)', () => {
    state.lockMs = Date.now() + 10 * 3600000;
    const html = renderToStaticMarkup(<KnockoutLockCTA variant="dashboard" hasPicks onAction={() => {}} />);
    expect(html).toContain('Lock in your updated knockout bracket');
  });

  it('renders nothing once the Round of 32 has locked', () => {
    state.lockMs = Date.now() - 1000; // already past
    const html = renderToStaticMarkup(<KnockoutLockCTA variant="hero" hasPicks={false} onAction={() => {}} />);
    expect(html).toBe('');
  });
});
