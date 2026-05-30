/**
 * WorldCupPredictionGame — SEO landing page targeting "world cup prediction game",
 * "world cup pick em", and "best world cup prediction site" keyword clusters.
 *
 * Static, no auth required.
 */

import React from 'react';
import { LAUNCH_DATE, FINAL_DATE, SPONSOR_DBA } from '../config/legal';

const FAQ_ITEMS = [
  {
    q: 'What is a World Cup prediction game?',
    a: 'A World Cup prediction game lets you forecast match results and track your accuracy against real results as the tournament progresses. Players earn points for correct picks and compete on leaderboards.',
  },
  {
    q: 'What is the best free World Cup prediction game?',
    a: 'GoalOracle is a free FIFA World Cup 2026 prediction game that covers all 104 matches, supports private group pools, and correctly implements FIFA\'s Annexe C third-place routing — the 495-combination system most other tools get wrong.',
  },
  {
    q: 'How does the GoalOracle World Cup prediction game work?',
    a: 'GoalOracle is a guided 3-step bracket — rank each group, pick the 8 best third-placed teams, and fill the knockout bracket — about 10 minutes, 209 points max. Points award automatically as results come in, and you compete on a global leaderboard and optional private group leagues.',
  },
  {
    q: 'Is the World Cup prediction game free?',
    a: 'Yes. GoalOracle is completely free. No entry fee, no subscription, no credit card. Sign up with email, Google, or Twitter/X and start predicting immediately.',
  },
  {
    q: 'Can I win real prizes in a World Cup prediction game?',
    a: 'GoalOracle runs a free skill-based contest. Top 3 finishers on the Global Quick Picks Leaderboard at the end of the World Cup Final receive cash prizes paid in USDC stablecoin. Free entry, no purchase necessary, not gambling.',
  },
  {
    q: 'How many matches are in the 2026 World Cup?',
    a: '104 matches total: 48 group-stage matches across 12 groups, then 16 Round of 32 matches, 8 Round of 16, 4 Quarterfinals, 2 Semifinals, a Third-Place match, and the Final.',
  },
];

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'World Cup Prediction Game', item: 'https://goaloracle.io/world-cup-prediction-game' },
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

export default function WorldCupPredictionGame() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">World Cup Prediction Game</h1>
          <p className="legal-subtitle">
            GoalOracle is a free FIFA World Cup 2026 prediction game. Predict every match,
            join group pools, and compete on a global leaderboard.
          </p>
        </header>

        <div className="legal-callout">
          <strong>The free World Cup 2026 prediction game</strong> that covers all 104
          matches — from the opening Group A kick on {LAUNCH_DATE} to the Final on{' '}
          {FINAL_DATE}. Two prediction modes, private pools for groups, and prizes for
          top finishers. Free entry. No purchase necessary.
        </div>

        <section className="legal-section">
          <h2 className="legal-section-title">How to play</h2>
          <p>
            GoalOracle is a guided bracket — quick to fill out, but with enough depth that
            knowing the tournament pays off.
          </p>
          <h3 className="legal-subhead">A guided bracket — ~10 minutes</h3>
          <p>
            The bracket walks you through three steps: rank each of the 12 groups (scoring
            3 / 2 / 1 / 1 by position, 84 points), pick the 8 best third-placed teams who
            advance (2 points each, 16), then fill the knockout bracket, where later rounds
            are worth more (up to 109). That&apos;s <strong>209 points</strong> in total, and
            most players finish in under ten minutes. Predictions lock 5 minutes before each
            match kicks off, and the leaderboard ranks by accuracy.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Compete globally and with friends</h2>
          <p>
            Every GoalOracle account is automatically entered into the Global Quick Picks
            Leaderboard — a worldwide ranking updated in real time as results come in.
          </p>
          <p>
            Want to run a private prediction game with your group? Create a{' '}
            <a href="/create">private league</a>:
          </p>
          <ul className="legal-list">
            <li>Set a league name and share a passcode.</li>
            <li>Group members join with the code — no email invitations required.</li>
            <li>Scores update automatically after every match.</li>
            <li>Add optional house rules so everyone knows the format.</li>
          </ul>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Why GoalOracle gets the 2026 format right</h2>
          <p>
            The 2026 World Cup is the first 48-team tournament in FIFA history, which
            introduces a tricky third-place selection step that most prediction tools
            handle incorrectly. GoalOracle implements{' '}
            <a href="/guides/annexe-c-third-place-routing">FIFA&apos;s Annexe C routing matrix</a>
            {' '}exactly — all 495 possible combinations of qualifying third-placed teams,
            each routed to the correct Round of 32 slot.
          </p>
          <p>
            Your bracket automatically reflects the correct Annexe C routing based on
            your group predictions, so your knockout draw is always accurate.
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
          <h2 className="legal-section-title">Start predicting free</h2>
          <p>
            Sign up in under a minute and make your first prediction before the tournament
            opens on {LAUNCH_DATE}. Your account, your picks, your leaderboard spot — all
            free.
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
            <a href="/world-cup-2026-predictor">World Cup 2026 Predictor</a> ·{' '}
            <a href="/free-world-cup-pool">Free World Cup Pool</a> ·{' '}
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
