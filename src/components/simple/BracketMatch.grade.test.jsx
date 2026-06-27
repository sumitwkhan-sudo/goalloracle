/* Read-only grading: when actual knockout results are in, the viewer marks the
 * user's advanced pick right (+points) or wrong, and flags the real winner. */
import { describe, it, expect } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import BracketMatch from './BracketMatch';

const base = {
  matchId: 'r32-01', homeTeam: 'Brazil', awayTeam: 'Spain',
  homeFlag: '', awayFlag: '', onPick: () => {}, isLocked: false, readOnly: true,
};

describe('BracketMatch read-only grading', () => {
  it('marks a CORRECT pick with +points', () => {
    const html = renderToStaticMarkup(
      <BracketMatch {...base} winnerId="Brazil" actualWinnerId="Brazil" pointsIfRight={2} />,
    );
    expect(html).toContain('+2');
    expect(html).toContain('✓');
  });

  it('marks a WRONG pick and flags the real winner (WON)', () => {
    const html = renderToStaticMarkup(
      <BracketMatch {...base} winnerId="Brazil" actualWinnerId="Spain" pointsIfRight={2} />,
    );
    expect(html).toContain('✗');
    expect(html).toContain('WON'); // Spain is the loser row but actually won
    expect(html).not.toContain('+2');
  });

  it('falls back to ADV/OUT when there is no result yet', () => {
    const html = renderToStaticMarkup(
      <BracketMatch {...base} winnerId="Brazil" actualWinnerId={null} />,
    );
    expect(html).toContain('ADV');
    expect(html).toContain('OUT');
  });

  it('a CORRECT pick the user never predicted to advance shows 0 pts, not +points', () => {
    const html = renderToStaticMarkup(
      <BracketMatch
        {...base}
        winnerId="Brazil"
        actualWinnerId="Brazil"
        pointsIfRight={2}
        pickScoreEligible={false}
      />,
    );
    expect(html).toContain('0 pts');
    expect(html).not.toContain('+2');
  });
});
