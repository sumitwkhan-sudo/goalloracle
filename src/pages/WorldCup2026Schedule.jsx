/**
 * WorldCup2026Schedule — SEO landing page targeting "world cup 2026 schedule",
 * "world cup 2026 dates", and "world cup 2026 fixtures" keyword clusters.
 *
 * Renders the full group-stage fixture list from src/data/matches.js plus
 * knockout-round milestones. Includes SportsEvent JSON-LD for the opener,
 * a selection of opening-day matches, and the Final.
 *
 * Static, no auth required.
 */

import React from 'react';
import { LAUNCH_DATE, FINAL_DATE, SPONSOR_DBA } from '../config/legal';
import WORLD_CUP_MATCHES from '../data/matches';

// Group all group-stage matches by date for a readable fixture list.
function buildGroupStageByDate(matches) {
  const byDate = {};
  matches.forEach((m) => {
    if (m.isKnockout) return;
    if (!byDate[m.date]) byDate[m.date] = [];
    byDate[m.date].push(m);
  });
  return Object.keys(byDate)
    .sort()
    .map((date) => ({ date, fixtures: byDate[date].sort((a, b) => a.time.localeCompare(b.time)) }));
}

// Format "2026-06-11" → "June 11, 2026"
function fmtDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `${months[m - 1]} ${d}, ${y}`;
}

// Format "15:00" ET to a readable string
function fmtTime(t) {
  const [h, min] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${min.toString().padStart(2, '0')} ${suffix} ET`;
}

const GROUP_STAGE_BY_DATE = buildGroupStageByDate(WORLD_CUP_MATCHES);

// SportsEvent JSON-LD — opener + Day 1 matches + Final.
// Capped at key matches to avoid bloat.
const FEATURED_MATCHES = [
  WORLD_CUP_MATCHES.find((m) => m.id === 'gs01'), // opener: Mexico vs South Africa
  WORLD_CUP_MATCHES.find((m) => m.id === 'gs02'),
  WORLD_CUP_MATCHES.find((m) => m.id === 'gs07'), // Brazil vs Morocco Day 2
  WORLD_CUP_MATCHES.find((m) => m.id === 'final'),
].filter(Boolean);

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'GoalOracle', item: 'https://goaloracle.io/' },
        { '@type': 'ListItem', position: 2, name: 'World Cup 2026 Schedule', item: 'https://goaloracle.io/world-cup-2026-schedule' },
      ],
    },
    ...FEATURED_MATCHES.map((m) => ({
      '@type': 'SportsEvent',
      name: `FIFA World Cup 2026 — ${m.stage}: ${m.home} vs ${m.away}`,
      startDate: `${m.date}T${m.time}:00-04:00`,
      location: {
        '@type': 'Place',
        name: m.venue,
        address: { '@type': 'PostalAddress', addressLocality: m.city },
      },
      sport: 'Soccer',
      organizer: { '@type': 'Organization', name: 'FIFA', url: 'https://www.fifa.com' },
    })),
  ],
});

export default function WorldCup2026Schedule() {
  return (
    <div className="legal-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">World Cup 2026 Schedule</h1>
          <p className="legal-subtitle">
            Full group-stage fixture list for the FIFA World Cup 2026, plus knockout
            round milestones — dates, times, venues, and cities.
          </p>
        </header>

        <div className="legal-callout">
          The 2026 FIFA World Cup runs from <strong>{LAUNCH_DATE}</strong> (Mexico City
          opener) to the <strong>Final on {FINAL_DATE}</strong> at MetLife Stadium in
          East Rutherford, New Jersey. 104 matches across 16 venues in the United
          States, Canada, and Mexico.
        </div>

        <section className="legal-section">
          <h2 className="legal-section-title">Tournament milestones</h2>
          <table className="legal-table" aria-label="World Cup 2026 key dates">
            <thead>
              <tr>
                <th>Phase</th>
                <th>Dates</th>
                <th>Matches</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Group Stage</td>
                <td>June 11 – June 27</td>
                <td>48</td>
              </tr>
              <tr>
                <td>Round of 32</td>
                <td>June 28 – July 3</td>
                <td>16</td>
              </tr>
              <tr>
                <td>Round of 16</td>
                <td>July 4 – July 7</td>
                <td>8</td>
              </tr>
              <tr>
                <td>Quarterfinals</td>
                <td>July 9 – July 11</td>
                <td>4</td>
              </tr>
              <tr>
                <td>Semifinals</td>
                <td>July 14 – July 15</td>
                <td>2</td>
              </tr>
              <tr>
                <td>Third-Place Match</td>
                <td>July 18</td>
                <td>1</td>
              </tr>
              <tr>
                <td>Final</td>
                <td>July 19 (MetLife Stadium, NJ)</td>
                <td>1</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Group stage fixtures</h2>
          <p>
            All 48 group-stage matches, sorted by date and kick-off time (Eastern Time).
          </p>
          {GROUP_STAGE_BY_DATE.map(({ date, fixtures }) => (
            <div key={date} style={{ marginBottom: '1.5rem' }}>
              <h3 className="legal-subhead" style={{ marginBottom: '0.5rem' }}>
                {fmtDate(date)}
              </h3>
              <table
                className="legal-table"
                aria-label={`Fixtures on ${fmtDate(date)}`}
                style={{ marginTop: 0 }}
              >
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Kick-off (ET)</th>
                    <th>Match</th>
                    <th>Venue</th>
                    <th>City</th>
                  </tr>
                </thead>
                <tbody>
                  {fixtures.map((f) => (
                    <tr key={f.id}>
                      <td style={{ whiteSpace: 'nowrap' }}>{f.stage}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{fmtTime(f.time)}</td>
                      <td>
                        <span>{f.homeFlag} {f.home}</span>
                        <span style={{ margin: '0 0.4rem', color: 'var(--text-sec)' }}>vs</span>
                        <span>{f.awayFlag} {f.away}</span>
                      </td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-sec)' }}>{f.venue}</td>
                      <td style={{ fontSize: '0.85rem', color: 'var(--text-sec)', whiteSpace: 'nowrap' }}>{f.city}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </section>

        <section className="legal-section">
          <h2 className="legal-section-title">Predict the full schedule on GoalOracle</h2>
          <p>
            GoalOracle lets you predict every one of the 104 matches — from the Group A
            opener on {LAUNCH_DATE} to the Final on {FINAL_DATE}. Choose between two
            modes:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Quick Picks:</strong> Rank each group and fill the knockout bracket.
              About 10 minutes. Up to 76 points.
            </li>
            <li>
              <strong>Classic Predictions:</strong> Predict the exact score and result of
              every match. Higher maximum points for more precise predictions.
            </li>
          </ul>
          <p>
            Predictions lock 5 minutes before each match kicks off — so you can update
            your picks based on late team news up until the last moment.
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
            <a href="/world-cup-2026-groups">2026 Groups</a> ·{' '}
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
