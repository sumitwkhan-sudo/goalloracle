/**
 * WorldCup2026Predictor — SEO landing page targeting "world cup 2026 predictor"
 * and "how to predict the 2026 world cup winner" keyword clusters.
 *
 * Static, no auth required. Renders full HTML for JS-capable crawlers
 * (Google, Bing, AI engines). Internal links guide visitors toward the
 * app and related content.
 */

import React from 'react';
import { LAUNCH_DATE, FINAL_DATE, SPONSOR_DBA } from '../config/legal';

const FAQ_ITEMS = [
  {
    q: 'What is a World Cup 2026 predictor?',
    a: 'A World Cup 2026 predictor is a tool that lets you forecast match results and build a bracket for the FIFA World Cup 2026, then tracks your score against other fans as the real tournament plays out.',
  },
  {
    q: 'How do I predict the 2026 World Cup winner?',
    a: 'On GoalOracle, you fill out your bracket by ranking the 12 groups, selecting which 8 of the 12 third-placed teams advance, then picking the winner of every knockout match through the Final. The team you place in the Final and mark as champion is your predicted winner.',
  },
  {
    q: 'Is GoalOracle free to use?',
    a: 'Yes. GoalOracle is completely free to enter. No entry fee, no purchase necessary. You sign in with email, Google, or Twitter/X and your bracket is created automatically.',
  },
  {
    q: 'When does the 2026 World Cup start?',
    a: `The 2026 FIFA World Cup kicks off on ${LAUNCH_DATE} in Mexico City. The tournament runs through ${FINAL_DATE}, when the Final is played at MetLife Stadium in New York/New Jersey.`,
  },
  {
    q: 'How many matches are in the 2026 World Cup?',
    a: '104 matches total: 48 group-stage matches, 16 in the Round of 32, 8 in the Round of 16, 4 Quarterfinals, 2 Semifinals, 1 Third-Place match, and the Final.',
  },
  {
    q: 'Can I win prizes for predicting correctly?',
    a: 'Yes. GoalOracle runs a free skill-based prize contest. Top 3 finishers on the Global Quick Picks Leaderboard at the end of the World Cup Final receive cash prizes paid in USDC stablecoin. Free entry, no purchase necessary, not gambling.',
  },
];

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'World Cup 2026 Predictor', item: 'https://goaloracle.io/world-cup-2026-predictor' },
      ],
    },
    {
      '@type': 'FAQPage',
      mainEntity: FAQ_ITEMS.map(({ q, a }) => ({
        '@type': 'Question',
        name: q,
        acceptedAnswer: { '@type': 'Answer', text: a },
      })),
    },
  ],
});

export default function WorldCup2026Predictor() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">World Cup 2026 Predictor</h1>
          <p className="legal-subtitle">
            Build your free FIFA World Cup 2026 bracket, predict every match, and compete
            on a global leaderboard — no purchase required.
          </p>
        </header>

        <div className="legal-callout">
          <strong>GoalOracle is the free World Cup 2026 predictor</strong> that tracks your
          bracket against the real tournament results as they come in. Pick match winners from
          the group stage through the Final, join private pools with friends, and earn points
          for every correct call. Free entry. Prizes for top finishers.
        </div>

        <section className="legal-section">
          <h2 className="legal-section-title">How the 2026 World Cup predictor works</h2>
          <p>
            The 2026 FIFA World Cup runs from {LAUNCH_DATE} to {FINAL_DATE} across the United
            States, Canada, and Mexico. It is the first tournament with 48 teams — 12 groups of
            4 teams each, producing 104 total matches.
          </p>
          <p>
            GoalOracle&apos;s predictor walks you through the bracket in two modes:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Quick Picks (~10 minutes):</strong> Rank the four teams in each of
              the 12 groups, pick the 8 best third-placed teams who advance, then fill in
              the knockout bracket. Up to 76 points.
            </li>
            <li>
              <strong>Classic Predictions:</strong> Predict the exact score and result for
              all 104 matches. Earn 3 points for a correct result, 5 for an exact score,
              and bonus points for calling extra time or penalties.
            </li>
          </ul>
          <p>
            Both modes are free. Your bracket locks match by match — 5 minutes before each
            kickoff — so late-breaking team news can influence your final pick right up to
            the last moment.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Compete in leagues and pools</h2>
          <p>
            Every GoalOracle account is automatically entered into the Global Quick Picks
            League, where the prize contest runs. You can also:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Create a private league</strong> — share a passcode with friends,
              family, or coworkers and run your own World Cup pool. Optional house rules
              for your group.
            </li>
            <li>
              <strong>Join public leagues</strong> — browse open leagues and join any that
              interest you.
            </li>
            <li>
              <strong>Customize scoring</strong> — Classic Predictions leagues let the
              creator set their own point values.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Why GoalOracle gets the bracket right</h2>
          <p>
            The 2026 format introduces a wrinkle most bracket apps miss: the{' '}
            <strong>Annexe C third-place routing</strong>. With 12 groups and only 8
            third-placed teams advancing, FIFA published a 495-row lookup table that
            determines which teams advance and which Round of 32 slot each one fills.
          </p>
          <p>
            GoalOracle implements all 495 combinations exactly to the FIFA rulebook — the
            only publicly documented English-language tool to do so. Your bracket
            automatically reflects the correct Annexe C routing based on your group
            predictions.{' '}
            <a href="/guides/annexe-c-third-place-routing">Read the full Annexe C guide</a>.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Frequently asked questions</h2>
          <dl>
            {FAQ_ITEMS.map(({ q, a }) => (
              <React.Fragment key={q}>
                <dt style={{ fontWeight: 600, marginBottom: '0.25rem', marginTop: '1rem' }}>{q}</dt>
                <dd style={{ margin: '0 0 0.5rem 0', color: 'var(--text-sec)' }}>{a}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Start your free bracket</h2>
          <p>
            Sign up in under a minute with email, Google, or Twitter/X. Your bracket is
            created automatically and you&apos;re entered into the Global Quick Picks League
            immediately. The tournament starts {LAUNCH_DATE} — build your bracket before the
            first kick.
          </p>
          <p>
            <a href="/" className="btn btn-primary" style={{ display: 'inline-block' }}>
              Start your free bracket →
            </a>
          </p>
        </section>

        <footer className="legal-footer">
          <p>
            Related:{' '}
            <a href="/world-cup-bracket">World Cup Bracket</a> ·{' '}
            <a href="/free-world-cup-pool">Free World Cup Pool</a> ·{' '}
            <a href="/world-cup-prediction-game">Prediction Game</a> ·{' '}
            <a href="/world-cup-2026-schedule">2026 Schedule</a> ·{' '}
            <a href="/world-cup-2026-groups">2026 Groups</a> ·{' '}
            <a href="/how-it-works">How It Works</a> ·{' '}
            <a href="/faq">FAQ</a>
          </p>
          <p style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-sec)' }}>
            Sponsored by {SPONSOR_DBA}. Free to enter. No purchase necessary. Not gambling.
          </p>
        </footer>
      </div>
    </div>
  );
}
