/**
 * WorldCup2026Groups — SEO landing page listing all 12 groups and their
 * teams, targeting "world cup 2026 groups", "2026 world cup group stage",
 * and "world cup 2026 teams by group" keyword clusters.
 *
 * Team data pulled directly from src/data/matches.js to stay in sync
 * with the app's canonical source. Static render — no hooks.
 */

import React from 'react';
import { LAUNCH_DATE, FINAL_DATE, SPONSOR_DBA } from '../config/legal';
import WORLD_CUP_MATCHES from '../data/matches';

// Derive group membership from the match fixture list.
// Each group-stage match (isKnockout: false) lists home + away teams.
// We collect all unique teams per group from all group-stage fixtures.
function deriveGroups(matches) {
  const groupMap = {};
  matches.forEach((m) => {
    if (m.isKnockout) return;
    const g = m.stage; // e.g. "Group A"
    if (!groupMap[g]) groupMap[g] = new Set();
    groupMap[g].add(JSON.stringify({ name: m.home, flag: m.homeFlag }));
    groupMap[g].add(JSON.stringify({ name: m.away, flag: m.awayFlag }));
  });
  // Sort group keys A–L, convert sets to arrays
  return Object.keys(groupMap)
    .sort()
    .map((name) => ({
      name,
      teams: [...groupMap[name]].map((s) => JSON.parse(s)).sort((a, b) =>
        a.name.localeCompare(b.name)
      ),
    }));
}

const GROUPS = deriveGroups(WORLD_CUP_MATCHES);

const FAQ_ITEMS = [
  {
    q: 'How many groups are in the 2026 World Cup?',
    a: 'There are 12 groups (A through L) in the 2026 FIFA World Cup, each containing 4 teams. This is the first World Cup to use a 12-group format.',
  },
  {
    q: 'How many teams advance from each group?',
    a: 'The top 2 teams from each group advance automatically to the Round of 32 — 24 qualifiers total. Additionally, the 8 best third-placed teams (ranked across all 12 groups) also advance, bringing the Round of 32 total to 32 teams.',
  },
  {
    q: 'How are third-placed teams ranked across groups?',
    a: 'The 12 third-placed teams are ranked by: points, then goal difference, then goals scored, then fair play points (yellow/red cards), then FIFA ranking. Head-to-head is not used since these teams have not played each other.',
  },
  {
    q: 'When does the 2026 World Cup group stage start?',
    a: `The group stage opens on ${LAUNCH_DATE} with Mexico vs South Africa at Estadio Azteca in Mexico City — the official tournament opener.`,
  },
  {
    q: 'How many matches are in the group stage?',
    a: '48 group-stage matches in total. Each team plays the other three teams in its group once — 3 matches per team, 4 matches per group, 12 groups × 4 = 48.',
  },
  {
    q: 'How do I predict the group stage on GoalOracle?',
    a: "GoalOracle's Quick Picks mode lets you rank all four teams in each group in your predicted finishing order. Earn 0.75 points for each correctly placed team — up to 3 points per group and 36 points total for the group stage.",
  },
];

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'World Cup 2026 Groups', item: 'https://goaloracle.io/world-cup-2026-groups' },
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

export default function WorldCup2026Groups() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">World Cup 2026 Groups</h1>
          <p className="legal-subtitle">
            All 12 groups (A–L) and 48 teams for the FIFA World Cup 2026 — plus how
            group-stage qualification works and how to predict it on GoalOracle.
          </p>
        </header>

        <div className="legal-callout">
          The 2026 FIFA World Cup is the first to use a <strong>48-team, 12-group format</strong>.
          The group stage runs from {LAUNCH_DATE} through late June 2026. The top 2 from each
          group plus the 8 best third-placed teams advance to the Round of 32.
        </div>

        <section className="legal-section">
          <h2 className="legal-section-title">All 12 groups at a glance</h2>
          <p>
            Below are all 48 teams drawn into groups for the 2026 FIFA World Cup. Use
            GoalOracle&apos;s Quick Picks mode to predict how your groups finish.
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
            {GROUPS.map(({ name, teams }) => (
              <div
                key={name}
                style={{
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '0.875rem 1rem',
                  background: 'var(--surface)',
                }}
              >
                <h3
                  style={{
                    margin: '0 0 0.5rem 0',
                    fontSize: '0.9rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    color: 'var(--accent)',
                  }}
                >
                  {name}
                </h3>
                <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                  {teams.map((t) => (
                    <li
                      key={t.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.5rem',
                        padding: '0.2rem 0',
                        fontSize: '0.92rem',
                      }}
                    >
                      <span role="img" aria-label={t.name} style={{ fontSize: '1.1rem' }}>
                        {t.flag}
                      </span>
                      {t.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">How group-stage qualification works</h2>
          <p>
            Each group plays a round-robin — every team faces the other three teams once.
            Teams earn 3 points for a win, 1 for a draw, 0 for a loss.
          </p>
          <p>
            The <strong>top 2 teams from each group</strong> advance automatically — 24
            qualifiers total. Additionally, <strong>the 8 best third-placed teams</strong>{' '}
            across all 12 groups also advance to the Round of 32.
          </p>
          <h3 className="legal-subhead">Tiebreaker order (within a group)</h3>
          <ol className="legal-list">
            <li>Points</li>
            <li>Goal difference</li>
            <li>Goals scored</li>
            <li>Head-to-head results (mini-league among tied teams)</li>
            <li>Fair play points (yellow / red card record)</li>
            <li>FIFA ranking</li>
          </ol>
          <h3 className="legal-subhead">How third-placed teams are ranked (across groups)</h3>
          <p>
            The 12 third-placed teams are compared using the same criteria <em>except</em>{' '}
            head-to-head — these teams haven&apos;t played each other. The top 8 advance.
            Their exact bracket slots are determined by{' '}
            <a href="/guides/annexe-c-third-place-routing">FIFA&apos;s Annexe C matrix</a>,
            which GoalOracle implements with all 495 possible combinations.
          </p>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Predict the groups on GoalOracle</h2>
          <p>
            GoalOracle&apos;s <strong>Quick Picks</strong> mode asks you to rank all four
            teams in each group in your predicted finishing order. You earn{' '}
            <strong>0.75 points</strong> for each correctly placed team — up to 3 points
            per group, 36 points total across all 12 groups.
          </p>
          <p>
            Prefer match-by-match predictions? <strong>Classic Predictions</strong> mode
            lets you predict the exact score and result of every group-stage match for
            higher potential points.
          </p>
          <p>
            <a href="/" className="btn btn-primary" style={{ display: 'inline-block' }}>
              Start your free bracket →
            </a>
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

        <footer className="legal-footer">
          <p>
            Related:{' '}
            <a href="/world-cup-2026-schedule">2026 Schedule</a> ·{' '}
            <a href="/world-cup-bracket">World Cup Bracket</a> ·{' '}
            <a href="/world-cup-2026-predictor">World Cup 2026 Predictor</a> ·{' '}
            <a href="/how-world-cup-third-place-qualification-works">3rd-place qualification</a> ·{' '}
            <a href="/guides/annexe-c-third-place-routing">Annexe C guide</a> ·{' '}
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
