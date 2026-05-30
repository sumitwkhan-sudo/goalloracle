/**
 * FreeWorldCupPool — SEO landing page targeting "free world cup pool",
 * "world cup bracket pool with friends", and "world cup pool no entry fee"
 * keyword clusters.
 *
 * Static, no auth required.
 */

import React from 'react';
import { LAUNCH_DATE, FINAL_DATE, SPONSOR_DBA } from '../config/legal';

const FAQ_ITEMS = [
  {
    q: 'What is a World Cup pool?',
    a: 'A World Cup pool is a group competition where friends, family, or coworkers each fill out a bracket predicting the World Cup results. Participants earn points for correct picks and compete on a shared leaderboard.',
  },
  {
    q: 'Is GoalOracle free to join?',
    a: 'Yes. GoalOracle is completely free. There is no entry fee, no subscription, and no purchase of any kind required. Free to enter, free to create leagues, free to invite friends.',
  },
  {
    q: 'How do I create a World Cup pool with friends?',
    a: "Create a private league on GoalOracle in seconds. Give it a name, generate a passcode, and share the code with your group. Every member's score updates on your shared leaderboard as results come in.",
  },
  {
    q: 'Can I set custom rules for my World Cup pool?',
    a: "Private leagues on GoalOracle support optional House Rules — a note from the creator describing how your group plays, from tiebreakers to informal prizes.",
  },
  {
    q: 'How many people can join my World Cup pool?',
    a: 'There is no hard cap on private league membership. Invite as many friends, family members, or coworkers as you like.',
  },
  {
    q: 'What prediction modes are available in a GoalOracle pool?',
    a: 'GoalOracle is a guided 3-step bracket — rank each group, pick the 8 best third-placed teams, and fill the knockout bracket — in about 10 minutes, 209 points max. Everyone in your pool plays the same way and is ranked on a shared leaderboard.',
  },
];

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'Free World Cup Pool', item: 'https://goaloracle.io/free-world-cup-pool' },
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

export default function FreeWorldCupPool() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">Free World Cup Pool</h1>
          <p className="legal-subtitle">
            Create a free FIFA World Cup 2026 pool for friends, family, or coworkers.
            Private leagues, shared leaderboards, and no entry fee.
          </p>
        </header>

        <div className="legal-callout">
          <strong>GoalOracle is a free World Cup 2026 pool platform.</strong> Create a
          private league, share a passcode with your group, and everyone competes on a
          shared leaderboard. Free entry. Prizes for top finishers on the global
          leaderboard. No purchase necessary.
        </div>

        <section className="legal-section">
          <h2 className="legal-section-title">How to run a World Cup pool on GoalOracle</h2>
          <p>
            Running a World Cup pool used to mean spreadsheets and manual point tallying.
            GoalOracle handles all of that automatically — scores update in real time as
            results come in from {LAUNCH_DATE} through {FINAL_DATE}.
          </p>
          <ol className="legal-list">
            <li>
              <strong>Create a free account</strong> — sign up with email, Google, or
              Twitter/X in under a minute.
            </li>
            <li>
              <strong>Create a private league</strong> — give it a name, set optional
              house rules, and get your shareable passcode.
            </li>
            <li>
              <strong>Share the passcode</strong> — send it to your group via text,
              email, or a group chat.
            </li>
            <li>
              <strong>Everyone fills out their bracket</strong> — the guided three-step
              bracket takes about 10 minutes.
            </li>
            <li>
              <strong>Watch the leaderboard</strong> — points award automatically after
              each match. No admin required.
            </li>
          </ol>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Pool features</h2>
          <p>
            GoalOracle private leagues come with everything your group needs out of the box:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Shared leaderboard:</strong> Ranked by total points, updated
              automatically after each match.
            </li>
            <li>
              <strong>Same bracket for everyone:</strong> All members fill the guided
              three-step bracket, so the leaderboard is a fair head-to-head.
            </li>
            <li>
              <strong>House rules:</strong> Add a note describing any informal rules for
              your group — tiebreakers, prizes, rules of engagement.
            </li>
            <li>
              <strong>No limits:</strong> No cap on league members and no limit on the
              number of leagues you join.
            </li>
          </ul>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">The 2026 World Cup format your pool covers</h2>
          <p>
            The 2026 FIFA World Cup is the first 48-team tournament in history. Your pool
            spans the full tournament:
          </p>
          <ul className="legal-list">
            <li><strong>48 teams</strong> across 12 groups of 4 (Groups A–L).</li>
            <li><strong>104 matches total</strong> — group stage through the Final on {FINAL_DATE}.</li>
            <li>
              <strong>Best-thirds selection:</strong> Of the 12 third-placed teams, the
              8 best advance based on{' '}
              <a href="/guides/annexe-c-third-place-routing">FIFA&apos;s Annexe C matrix</a>.
              GoalOracle handles all 495 possible routing combinations automatically.
            </li>
          </ul>
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
          <h2 className="legal-section-title">Start your free World Cup pool</h2>
          <p>
            Create your account, build your bracket, and set up your private league before
            the tournament opens on {LAUNCH_DATE}. Your whole group can be signed up and
            picking in under 15 minutes.
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
            <a href="/world-cup-prediction-game">Prediction Game</a> ·{' '}
            <a href="/world-cup-2026-schedule">2026 Schedule</a> ·{' '}
            <a href="/world-cup-2026-groups">2026 Groups</a> ·{' '}
            <a href="/how-it-works">How It Works</a>
          </p>
          <p style={{ marginTop: '0.75rem', fontSize: '0.82rem', color: 'var(--text-sec)' }}>
            Sponsored by {SPONSOR_DBA}. Free to enter. No purchase necessary. Not gambling.
          </p>
        </footer>
      </div>
    </div>
  );
}
