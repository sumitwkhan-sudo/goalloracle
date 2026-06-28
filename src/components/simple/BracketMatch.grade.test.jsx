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

describe('BracketMatch TBD descriptor + match number', () => {
  it('shows the qualifier descriptor + FIFA match number for an undecided side', () => {
    // r32-03: home "1st Group E", away "3rd ABCDF", match number M75.
    const html = renderToStaticMarkup(
      <BracketMatch matchId="r32-03" homeTeam="Spain" awayTeam={null} homeFlag="" awayFlag=""
        onPick={() => {}} isLocked={false} city="Boston" date="2026-06-29" />,
    );
    expect(html).toContain('Spain');                  // decided side → real team
    expect(html).toContain('3rd place (A/B/C/D/F)');   // undecided side → descriptor
    expect(html).toContain('M75');                     // FIFA match number on the card
    expect(html).not.toContain('>TBD<');               // no bare TBD when a descriptor exists
  });

  it('labels an undecided R16 side with its feeder match number', () => {
    const html = renderToStaticMarkup(
      <BracketMatch matchId="r16-01" homeTeam={null} awayTeam={null} onPick={() => {}} isLocked={false} />,
    );
    // r16-01 is fed by the winners of r32-03 (M75) and r32-06.
    expect(html).toContain('Winner of M75');
  });
});
