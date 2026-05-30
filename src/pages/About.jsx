/**
 * About — brief, credible overview of GoalOracle and the team behind it.
 * Rendered at /about. Good for E-E-A-T signals (Google's "Experience,
 * Expertise, Authoritativeness, Trustworthiness" criteria) and AEO:
 * AI engines often pull "about" content when summarizing a product.
 *
 * No prize-amount marketing copy here — keep this factual and neutral.
 */

import React from 'react';
import { SPONSOR_DBA, SPONSOR_NAME, SPONSOR_ADDRESS, LAUNCH_DATE, FINAL_DATE } from '../config/legal';

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'About GoalOracle', item: 'https://goaloracle.io/about' },
      ],
    },
  ],
});

export default function About() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">About GoalOracle</h1>
          <p className="legal-subtitle">
            What GoalOracle is, who built it, how the contest works, and how to reach us.
          </p>
        </header>

        <section className="legal-section">
          <h2 className="legal-section-title">What GoalOracle is</h2>
          <p>
            GoalOracle is a free, skill-based prediction game for the FIFA World Cup 2026.
            Players build a bracket — predicting match results from the group stage through
            the Final — and earn points based on how accurate their predictions are.
          </p>
          <p>
            The game runs from <strong>{LAUNCH_DATE}</strong> (the tournament opener in
            Mexico City) through <strong>{FINAL_DATE}</strong> (the World Cup Final at
            MetLife Stadium in East Rutherford, New Jersey). It covers all 104 matches
            across 16 venues in the United States, Canada, and Mexico.
          </p>
          <p>
            GoalOracle is <strong>not gambling</strong>. There is no entry fee, no wager,
            and no purchase required. The prize contest is a skill-based sweepstakes where
            outcomes are determined by prediction accuracy.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">How to play</h2>
          <p>
            GoalOracle is a guided three-step bracket:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Rank each group</strong> — put the four teams in each of the 12 groups
              in your predicted finishing order. You score 3 / 2 / 1 / 1 by position, up to 84
              points across every group.
            </li>
            <li>
              <strong>Pick the 8 best thirds</strong> — choose which 8 of the 12 third-placed
              teams advance to the Round of 32. Each correct pick is worth 2 points (16 max).
            </li>
            <li>
              <strong>Fill the knockout bracket</strong> — pick the winner of every tie through
              the Final. Later rounds are worth more, up to 109 points. The whole bracket takes
              about 10 minutes and totals 209 points.
            </li>
          </ul>
          <p>
            Players compete on a global leaderboard and can create or join private leagues
            to run group pools with friends, family, or coworkers.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">The prize contest</h2>
          <p>
            GoalOracle runs a free skill-based prize contest tied to the Global Quick Picks
            Leaderboard. Top finishers at the end of the World Cup Final receive cash prizes
            paid in USDC stablecoin. Free entry, no purchase necessary. Full details —
            including eligibility requirements, excluded jurisdictions, and the payout
            process — are in the{' '}
            <a href="/official-rules">Official Rules</a>.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Who we are</h2>
          <p>
            GoalOracle is operated by <strong>{SPONSOR_NAME}</strong>, a Delaware limited
            liability company doing business as GoalOracle. The registered office is{' '}
            {SPONSOR_ADDRESS}.
          </p>
          <p>
            The prediction engine is built to comply with the official FIFA World Cup 2026
            rulebook, including{' '}
            <a href="/guides/annexe-c-third-place-routing">Annexe C third-place routing</a>{' '}
            — all 495 combinations of advancing third-placed teams, each routed to the
            correct bracket slot.
          </p>
          <p>
            GoalOracle is independent and is not affiliated with, endorsed by, or sponsored
            by FIFA. &ldquo;FIFA World Cup&rdquo; and related marks are trademarks of FIFA.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Contact and support</h2>
          <p>
            For questions about the game, your account, leagues, or the prize contest,
            reach the GoalOracle team at{' '}
            <a href="mailto:support@goaloracle.io">support@goaloracle.io</a>.
          </p>
          <p>
            Useful links:
          </p>
          <ul className="legal-list">
            <li><a href="/faq">Frequently Asked Questions</a></li>
            <li><a href="/how-it-works">How GoalOracle Works</a> — full scoring and format breakdown</li>
            <li><a href="/official-rules">Official Rules</a> — prize contest eligibility and terms</li>
            <li><a href="/terms">Terms &amp; Conditions</a></li>
            <li><a href="/privacy">Privacy Policy</a></li>
          </ul>
        </section>

        <footer className="legal-footer">
          <p>
            <a href="/">GoalOracle home</a> ·{' '}
            <a href="/how-it-works">How It Works</a> ·{' '}
            <a href="/faq">FAQ</a> ·{' '}
            <a href="/contact">Contact</a>
          </p>
          <p style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-sec)' }}>
            Sponsored by {SPONSOR_DBA}. Free to enter. No purchase necessary. Not gambling.
          </p>
        </footer>
      </div>
    </div>
  );
}
