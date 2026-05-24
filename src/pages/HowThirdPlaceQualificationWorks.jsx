/**
 * HowThirdPlaceQualificationWorks — SEO landing page targeting
 * "how does world cup third place qualification work", "best third
 * placed teams world cup 2026", and "world cup 2026 third place teams"
 * keyword clusters.
 *
 * Tuned for broader search intent than /guides/annexe-c-third-place-routing
 * (which targets technical/deep-dive queries). This page answers the
 * general fan question: "how do third-place teams qualify?" and links
 * to the Annexe C deep-dive for readers who want more detail.
 *
 * Static, no auth required.
 */

import React from 'react';
import { LAUNCH_DATE, FINAL_DATE, SPONSOR_DBA } from '../config/legal';

const FAQ_ITEMS = [
  {
    q: 'How do third-place teams qualify for the knockout stage in the 2026 World Cup?',
    a: 'In the 2026 World Cup, 12 teams finish third in their groups. All 12 are ranked together by points, goal difference, goals scored, fair play points, and FIFA ranking. The top 8 advance to the Round of 32.',
  },
  {
    q: 'How many third-place teams advance in the 2026 World Cup?',
    a: '8 of the 12 third-placed teams advance to the Round of 32. The other 4 are eliminated.',
  },
  {
    q: 'What is Annexe C in the FIFA World Cup rulebook?',
    a: "FIFA's Annexe C is the official matrix that determines (a) which 8 of the 12 third-placed teams advance, and (b) which specific Round of 32 bracket slot each advancing team fills. There are 495 possible combinations, all enumerated in the FIFA rulebook.",
  },
  {
    q: 'Is head-to-head used to rank third-placed teams across groups?',
    a: "No. Head-to-head results are only used within a group (where teams have played each other). When comparing third-placed teams across different groups, head-to-head is irrelevant — those teams haven't played each other. The cross-group tiebreaker is: points → goal difference → goals scored → fair play points → FIFA ranking.",
  },
  {
    q: 'How does GoalOracle handle Annexe C in its bracket?',
    a: "GoalOracle implements all 495 Annexe C combinations exactly as published in the FIFA rulebook. Your bracket automatically routes the advancing third-place teams to the correct Round of 32 slots based on your group-stage predictions.",
  },
  {
    q: 'Can I predict which third-place teams advance on GoalOracle?',
    a: "Yes. GoalOracle's Quick Picks mode includes a dedicated step where you select which 8 of the 12 third-placed teams you think will advance. Each correct pick is worth 1 point — 8 points available for this step.",
  },
];

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'How World Cup Third-Place Qualification Works', item: 'https://goaloracle.io/how-world-cup-third-place-qualification-works' },
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

export default function HowThirdPlaceQualificationWorks() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">How World Cup Third-Place Qualification Works</h1>
          <p className="legal-subtitle">
            In the 2026 FIFA World Cup, 12 teams finish third in their groups — but only
            8 advance. Here is how those 8 are selected and where they are placed in the
            bracket.
          </p>
        </header>

        <div className="legal-callout">
          <strong>The short answer.</strong> All 12 third-placed teams are ranked by
          points, goal difference, goals scored, fair play points, and FIFA ranking.
          The top 8 advance to the Round of 32. Their exact bracket slots are determined
          by <a href="/guides/annexe-c-third-place-routing">FIFA&apos;s Annexe C</a> —
          a 495-combination lookup table in the official rulebook.
        </div>

        <section className="legal-section">
          <h2 className="legal-section-title">Why third-place qualification is different in 2026</h2>
          <p>
            Previous 32-team World Cups had 8 groups of 4 with a simpler third-place
            selection process. The 2026 format expands to <strong>48 teams in 12 groups</strong>,
            which means 12 teams finish third — more than any prior tournament.
          </p>
          <p>
            Only <strong>8 of those 12</strong> advance to the knockout stage. The selection
            system is the same in principle — rank all third-placed teams, take the best 8 —
            but the routing of those 8 into specific bracket slots is now handled by
            FIFA&apos;s published <strong>Annexe C matrix</strong>, which covers all possible
            combinations.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">How the top 8 third-placed teams are selected</h2>
          <p>
            After the group stage concludes (around late June 2026), the 12 third-placed
            teams are compared directly against each other using this tiebreaker order:
          </p>
          <ol className="legal-list">
            <li>
              <strong>Points</strong> — 3 for a win, 1 for a draw, 0 for a loss across
              their 3 group-stage matches.
            </li>
            <li>
              <strong>Goal difference</strong> — goals scored minus goals conceded across
              the 3 group matches.
            </li>
            <li>
              <strong>Goals scored</strong> — total goals scored across 3 group matches.
            </li>
            <li>
              <strong>Fair play points</strong> — yellow cards (−1 point), red cards
              (−3 points), two yellow cards leading to red (−3 points).
            </li>
            <li>
              <strong>FIFA ranking</strong> — the team&apos;s most recent published FIFA
              world ranking.
            </li>
          </ol>
          <p>
            <strong>Head-to-head is not used.</strong> Third-placed teams come from
            different groups and have not played each other. The cross-group comparison
            is purely by these objective statistics.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">How bracket slots are assigned — Annexe C</h2>
          <p>
            Once the top 8 third-placed teams are known, FIFA&apos;s <strong>Annexe C</strong>{' '}
            matrix determines which Round of 32 slot each team fills. The matrix accounts
            for which 8 of the 12 groups contributed a qualifying third-placed team, and
            routes each one to a predetermined bracket position to balance the draw.
          </p>
          <p>
            There are <strong>495 possible combinations</strong> of 8 groups out of 12, and
            Annexe C specifies a unique routing for every single one of them. GoalOracle
            implements all 495 combinations exactly as published — the only publicly
            documented English-language prediction tool to do so.
          </p>
          <p>
            For the full technical breakdown of Annexe C — including how the M-IDs map to
            bracket slots and why certain routing patterns exist — see our{' '}
            <a href="/guides/annexe-c-third-place-routing">Annexe C deep-dive guide</a>.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">How GoalOracle handles third-place predictions</h2>
          <p>
            GoalOracle&apos;s <strong>Quick Picks</strong> mode includes a dedicated step
            for third-place predictions:
          </p>
          <ul className="legal-list">
            <li>
              After ranking all 12 groups, you select which 8 of the 12 third-placed teams
              you think will advance.
            </li>
            <li>
              Each correct pick earns <strong>1 point</strong> — 8 points available for this
              step.
            </li>
            <li>
              The app automatically applies the correct Annexe C routing based on your
              selections to populate the knockout bracket.
            </li>
          </ul>
          <p>
            No manual bracket adjustment needed. If you change a group ranking, the
            third-place projections and bracket routing update automatically.
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
          <h2 className="legal-section-title">Start predicting the 2026 World Cup</h2>
          <p>
            Build your bracket before the tournament opens on {LAUNCH_DATE}. GoalOracle
            handles all 495 Annexe C combinations automatically — you just pick the teams
            you think will make it.
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
            <a href="/guides/annexe-c-third-place-routing">Annexe C deep-dive</a> ·{' '}
            <a href="/world-cup-2026-groups">2026 Groups</a> ·{' '}
            <a href="/world-cup-bracket">World Cup Bracket</a> ·{' '}
            <a href="/world-cup-2026-predictor">World Cup 2026 Predictor</a> ·{' '}
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
