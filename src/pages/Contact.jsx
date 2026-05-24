/**
 * Contact — simple contact/support page at /contact.
 * Provides support email, response time expectations, and links to
 * self-serve resources. Good for E-E-A-T (shows a real operator).
 *
 * Static, no auth required.
 */

import React from 'react';
import { SPONSOR_DBA } from '../config/legal';

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'Contact', item: 'https://goaloracle.io/contact' },
      ],
    },
  ],
});

export default function Contact() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">Contact GoalOracle</h1>
          <p className="legal-subtitle">
            Questions about the game, your account, leagues, or the prize contest?
            We&apos;re here to help.
          </p>
        </header>

        <section className="legal-section">
          <h2 className="legal-section-title">Email support</h2>
          <p>
            The best way to reach us is by email:
          </p>
          <p style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0.75rem 0' }}>
            <a href="mailto:support@goaloracle.io">support@goaloracle.io</a>
          </p>
          <p>
            We aim to respond within <strong>2 business days</strong>. During the World
            Cup tournament (June – July 2026), response times may be slightly longer due
            to volume — we&apos;ll still get back to you.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Self-serve resources</h2>
          <p>
            Many common questions are answered in our documentation. Check these first
            — they may save you the wait:
          </p>
          <ul className="legal-list">
            <li>
              <a href="/faq">FAQ</a> — how the game works, scoring, leagues, result
              verification, and account help.
            </li>
            <li>
              <a href="/how-it-works">How GoalOracle Works</a> — full breakdown of both
              prediction modes, the scoring table, and the prize contest mechanics.
            </li>
            <li>
              <a href="/official-rules">Official Rules</a> — prize contest eligibility,
              excluded jurisdictions, and the payout process.
            </li>
            <li>
              <a href="/guides/annexe-c-third-place-routing">Annexe C guide</a> — deep
              explanation of how third-place teams qualify and get routed in the 2026
              World Cup bracket.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Feedback</h2>
          <p>
            Found a bug or have a suggestion? Use our{' '}
            <a href="/feedback">feedback form</a> or include it in your email to
            support@goaloracle.io. We read everything.
          </p>
        </section>

        <footer className="legal-footer">
          <p>
            <a href="/">GoalOracle home</a> ·{' '}
            <a href="/faq">FAQ</a> ·{' '}
            <a href="/about">About</a>
          </p>
          <p style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-sec)' }}>
            Operated by {SPONSOR_DBA}. Free to enter. No purchase necessary. Not gambling.
          </p>
        </footer>
      </div>
    </div>
  );
}
