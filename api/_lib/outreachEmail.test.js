/**
 * Branding regression tests (B2a). Every engagement email must:
 *  - embed the GoalOracle logo in the header, and
 *  - end with the EXACT founder sign-off line.
 * These are hard B2 acceptance criteria, so assert them on every template.
 */

import { describe, test, expect } from 'vitest';
import { TEMPLATES, buildEmail, buildCustomEmail } from './outreachEmail.js';

const SIGN_OFF = '- Sumit, Founder of GoalOracle.io and Football Lover';
const USER = { id: 'u1', displayName: 'Sam', email: 'sam@example.com' };

describe('outreach email branding (B2a)', () => {
  for (const id of Object.keys(TEMPLATES)) {
    test(`${id}: exact sign-off in html + text, logo in header, no double-inject`, () => {
      const { html, text } = buildEmail(id, { user: USER, ctx: {} });

      // Sign-off present, exactly once, in both parts.
      expect(html).toContain(SIGN_OFF);
      expect((html.match(/Football Lover/g) || []).length).toBe(1);
      expect(text.trimEnd().endsWith(SIGN_OFF)).toBe(true);

      // Sign-off sits in the body, ABOVE the legal footer.
      const soIdx = html.indexOf(SIGN_OFF);
      const footerIdx = html.indexOf('Free skill-based prediction contest');
      expect(soIdx).toBeGreaterThan(-1);
      expect(footerIdx).toBeGreaterThan(-1);
      expect(soIdx).toBeLessThan(footerIdx);

      // Header logo image (absolute URL so email clients can load it).
      expect(html).toContain('https://goaloracle.io/logo-lockup-trophy.png');
    });
  }
});

describe('custom one-off email (B2b)', () => {
  test('wraps operator content in branded shell + sign-off', () => {
    const { html, text } = buildCustomEmail({
      user: USER, subject: 'Quick question', body: 'Para one.\n\nPara two.',
    });
    expect(html).toContain('https://goaloracle.io/logo-lockup-trophy.png'); // logo
    expect(html).toContain('Hey Sam,'); // greeting
    expect(html).toContain(SIGN_OFF); // sign-off
    expect(text.trimEnd().endsWith(SIGN_OFF)).toBe(true);
    expect(text).toContain('Para one.');
    expect(text).toContain('Para two.');
  });

  test('escapes operator HTML — no injection from subject or body', () => {
    const { html } = buildCustomEmail({
      user: USER,
      subject: 'Hi <b>x</b>',
      body: 'before\n\n<script>alert(1)</script>\n\nafter',
    });
    // Raw script/markup must NOT survive into the HTML.
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<b>x</b>');
    // It should be escaped instead.
    expect(html).toContain('&lt;script&gt;');
  });

  test('preserves paragraph breaks from blank lines', () => {
    const { html } = buildCustomEmail({ user: USER, subject: 's', body: 'a\n\nb\n\nc' });
    // 3 body paragraphs rendered as separate <p> blocks.
    expect((html.match(/<p style="margin:0 0 16px/g) || []).length).toBe(3);
  });
});
