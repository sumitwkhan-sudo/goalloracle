/**
 * WorldCupBracket — SEO landing page targeting "world cup 2026 bracket"
 * and "fifa world cup 2026 bracket" keyword clusters.
 *
 * Static, no auth required.
 */

import React from 'react';
import { LAUNCH_DATE, FINAL_DATE, SPONSOR_DBA } from '../config/legal';

const FAQ_ITEMS = [
  {
    q: 'How does the 2026 World Cup bracket work?',
    a: '48 teams are split into 12 groups of 4. The top 2 from each group (24 teams) plus the 8 best third-placed teams advance to a 32-team single-elimination bracket. From the Round of 32 onward, one loss means elimination. The bracket ends with the Third-Place match and the Final.',
  },
  {
    q: 'Where can I make a free World Cup 2026 bracket?',
    a: 'GoalOracle.io is a free bracket-builder for the 2026 FIFA World Cup. Sign up for free, pick your group finishers, select the advancing third-placed teams, and fill the knockout bracket — all in about 10 minutes.',
  },
  {
    q: 'What is the World Cup bracket challenge on GoalOracle?',
    a: "GoalOracle's bracket challenge lets you predict the outcome of every World Cup match and compete on a global leaderboard. You earn points for correct picks and can create private pools with friends.",
  },
  {
    q: 'How many teams are in the 2026 World Cup bracket?',
    a: '32 teams enter the knockout bracket (the Round of 32): 24 group-stage qualifiers (2 per group × 12 groups) plus the 8 best third-placed teams chosen by FIFA\'s Annexe C routing matrix.',
  },
  {
    q: 'When is the 2026 World Cup Final?',
    a: `The 2026 FIFA World Cup Final is on ${FINAL_DATE} at MetLife Stadium in East Rutherford, New Jersey.`,
  },
  {
    q: 'Can I create a World Cup bracket pool for my friends?',
    a: "Yes. GoalOracle lets you create a private league with a passcode. Share it with your group and everyone's scores are tracked on a shared leaderboard. Free to create, free to join.",
  },
];

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'World Cup 2026 Bracket', item: 'https://goaloracle.io/world-cup-bracket' },
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

export default function WorldCupBracket() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">World Cup 2026 Bracket</h1>
          <p className="legal-subtitle">
            Build your free FIFA World Cup 2026 bracket challenge. Predict every knockout
            match, join a pool with friends, and win prizes.
          </p>
        </header>

        <div className="legal-callout">
          <strong>GoalOracle is a free World Cup 2026 bracket challenge</strong> — fill
          out your predictions for all 104 matches, compete on a global leaderboard, and
          create private pools for your group. Free entry. Prizes for top finishers.
          No purchase necessary.
        </div>

        <section className="legal-section">
          <h2 className="legal-section-title">The 2026 World Cup bracket format</h2>
          <p>
            The 2026 FIFA World Cup introduces the first 48-team format in history. The
            bracket unfolds in two phases:
          </p>
          <h3 className="legal-subhead">Group stage ({LAUNCH_DATE} – late June)</h3>
          <p>
            Forty-eight teams are divided into 12 groups of 4 (Groups A through L). Each
            team plays every other team in its group once — 3 matches per team, 48 total
            group matches. The top 2 teams from each group advance automatically to the
            Round of 32 (24 qualifiers total).
          </p>
          <h3 className="legal-subhead">Best-third selection</h3>
          <p>
            Of the 12 third-placed teams, the best 8 also advance. FIFA ranks all 12
            third-placed teams by points, then goal difference, goals scored, fair play,
            and FIFA ranking. The bracket slot each advancing third-place team fills is
            determined by <a href="/guides/annexe-c-third-place-routing">FIFA&apos;s Annexe C matrix</a>{' '}
            — a 495-combination lookup table published in the official rulebook.
          </p>
          <h3 className="legal-subhead">Knockout rounds (late June – {FINAL_DATE})</h3>
          <p>
            32 teams enter the single-elimination bracket: Round of 32, Round of 16,
            Quarterfinals, Semifinals, Third-Place match, and the Final at MetLife Stadium
            on {FINAL_DATE}.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">How to fill your GoalOracle bracket</h2>
          <p>
            GoalOracle guides you through the bracket in three steps:
          </p>
          <ol className="legal-list">
            <li>
              <strong>Rank each group:</strong> For each of the 12 groups, drag the four
              teams into your predicted finishing order. You score 3 / 2 / 1 / 1 by finishing
              position — up to 84 points across every group.
            </li>
            <li>
              <strong>Pick the 8 best thirds:</strong> Select which 8 of the 12
              third-placed teams you think will advance. Each correct pick is worth 2
              points — 16 points available.
            </li>
            <li>
              <strong>Fill the knockout bracket:</strong> Pick the winner of every match
              from Round of 32 through the Final. Later rounds are worth more, up to 109
              points. Your bracket auto-populates based on your group and thirds picks.
            </li>
          </ol>
          <p>
            That&apos;s 209 points in total, and it takes about ten minutes. The leaderboard
            ranks by accuracy, so even a partial bracket counts.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Create a bracket pool for your group</h2>
          <p>
            Want to run a World Cup bracket challenge with friends, family, or coworkers?
            Create a <a href="/create">private league</a> on GoalOracle in seconds:
          </p>
          <ul className="legal-list">
            <li>Set a league name and generate a shareable passcode.</li>
            <li>Members join by entering the passcode — no link sharing required.</li>
            <li>A shared leaderboard updates in real time as results come in.</li>
            <li>Optionally add house rules to clarify how your group plays.</li>
          </ul>
          <p>
            Private leagues are free to create and free to join. Public leagues are also
            available on the <a href="/browse">Browse Leagues</a> page.
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
          <h2 className="legal-section-title">Start your free World Cup bracket</h2>
          <p>
            Sign up in under a minute and fill out your bracket before the tournament
            starts on {LAUNCH_DATE}. Every prediction locks 5 minutes before kickoff —
            you have until the opener to set your group picks.
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
            <a href="/world-cup-2026-predictor">World Cup 2026 Predictor</a> ·{' '}
            <a href="/free-world-cup-pool">Free World Cup Pool</a> ·{' '}
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
