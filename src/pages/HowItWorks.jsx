/**
 * HowItWorks — comprehensive overview of the GoalOracle game.
 *
 * Rendered at /how-it-works. Static (no auth required) so search
 * engines + AI answer engines land on a complete description. This
 * is the highest-leverage SEO page because it answers the primary
 * keyword queries ("how does world cup 2026 bracket work", "world
 * cup prediction game", "world cup 2026 scoring system") in one URL.
 *
 * Pulls dates / prize amounts / sponsor / age threshold from
 * src/config/legal.js so the page never drifts from the canonical
 * source.
 */

import React from 'react';
import {
  PRIZES,
  PRIZE_TOTAL_USD,
  PRIZE_DEFAULT_CURRENCY,
  PRIZE_NETWORK,
  LAUNCH_DATE,
  FINAL_DATE,
  MIN_AGE,
  SPONSOR_DBA,
} from '../config/legal';

export default function HowItWorks() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">How GoalOracle Works</h1>
          <p className="legal-subtitle">
            FIFA World Cup 2026 bracket predictions, scoring, and how the
            prize contest is decided.
          </p>
          <p className="legal-meta">Updated {LAUNCH_DATE}</p>
        </header>

        <div className="legal-callout">
          <strong>The short version.</strong> GoalOracle is a free, skill-based prediction
          game for the 2026 FIFA World Cup. You build a bracket — predicting which teams
          advance from each group and who wins every knockout match — and earn points
          based on how accurate your predictions are. Top 3 finishers on the Global Quick
          Picks Leaderboard at the end of the World Cup Final win cash prizes paid in
          USDC stablecoin. Free to enter, no purchase necessary, not gambling.
        </div>

        {/* 1. World Cup format */}
        <section className="legal-section">
          <h2 className="legal-section-title">1. The 2026 FIFA World Cup format</h2>
          <p>
            The 2026 World Cup is the first 48-team tournament in FIFA history. Hosted across
            the United States, Canada, and Mexico, it runs from {LAUNCH_DATE} through {FINAL_DATE}.
          </p>
          <ul className="legal-list">
            <li><strong>48 teams</strong> drawn into 12 groups of 4 (Groups A through L).</li>
            <li><strong>104 total matches:</strong> 48 group-stage + 16 Round of 32 + 8 Round of 16 + 4 Quarterfinals + 2 Semifinals + 1 Third-Place Match + 1 Final.</li>
            <li><strong>Qualification to the Round of 32:</strong> the top two teams from each group (24 teams) + the 8 best third-placed teams across all 12 groups, per FIFA&apos;s Annexe C routing matrix (see Section 7).</li>
            <li><strong>Group-stage tiebreaker order:</strong> points → goal difference → goals scored → head-to-head (mini-league among tied teams) → fair play points → FIFA ranking.</li>
            <li><strong>Single-elimination from R32 onward.</strong> The Final is on {FINAL_DATE}.</li>
          </ul>
        </section>

        {/* 2. Quick Picks */}
        <section className="legal-section">
          <h2 className="legal-section-title">2. Quick Picks mode (~10 minutes)</h2>
          <p>
            Quick Picks is the guided three-step bracket. Most users finish it in under
            ten minutes. Total scoring potential: <strong>76 points</strong>.
          </p>
          <h3 className="legal-subhead">Step 1 — Rank each group (36 points)</h3>
          <p>
            For each of the 12 groups, drag the four teams into your predicted finishing order.
            Each correctly placed team scores <strong>0.75 points</strong>. A perfectly ranked
            group scores 3 points; 12 groups × 3 = 36 max.
          </p>
          <h3 className="legal-subhead">Step 2 — Pick the 8 best third-placed teams (8 points)</h3>
          <p>
            Of the 12 third-placed teams, only 8 advance to the Round of 32. Pick which 8 you
            think will make it. Each correct pick scores 1 point; 8 max.
          </p>
          <h3 className="legal-subhead">Step 3 — Fill the knockout bracket (32 points)</h3>
          <p>
            Pick the winner of every knockout match through to the Final and the Third-Place
            match. Each correct pick scores 1 point:
          </p>
          <ul className="legal-list">
            <li>Round of 32 — 16 matches × 1 pt = 16</li>
            <li>Round of 16 — 8 matches × 1 pt = 8</li>
            <li>Quarterfinals — 4 matches × 1 pt = 4</li>
            <li>Semifinals — 2 matches × 1 pt = 2</li>
            <li>Third-Place Match — 1 pt</li>
            <li>Final — 1 pt</li>
          </ul>
        </section>

        {/* 3. Classic */}
        <section className="legal-section">
          <h2 className="legal-section-title">3. Classic Predictions mode</h2>
          <p>
            Classic Predictions is the per-match mode. You predict both the <strong>result</strong>
            (home win / draw / away win) and the <strong>exact score</strong> of every one of the
            104 matches. Default scoring (league creators can customize for private leagues):
          </p>
          <ul className="legal-list">
            <li>Correct result (e.g. predicted &ldquo;home wins,&rdquo; home wins): <strong>3 points</strong></li>
            <li>Exact score (e.g. predicted 2-1, actual 2-1): <strong>5 points</strong> — replaces the 3-point result bonus, not additive</li>
            <li>Correct extra-time call (knockouts only): <strong>+1 point</strong></li>
            <li>Correct penalty-shootout call (knockouts only): <strong>+2 points</strong></li>
          </ul>
          <p>
            A user who predicted every score exactly plus called every shootout would earn
            roughly 510-540 points across the tournament.
          </p>
        </section>

        {/* 4. Scoring table */}
        <section className="legal-section">
          <h2 className="legal-section-title">4. Scoring at a glance</h2>
          <table className="legal-table" aria-label="GoalOracle scoring summary">
            <thead>
              <tr>
                <th>Mode</th>
                <th>What you predict</th>
                <th>Points per correct pick</th>
                <th>Total possible</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Quick Picks — Group ranking</td>
                <td>4 teams in order</td>
                <td>0.75 per position</td>
                <td>36</td>
              </tr>
              <tr>
                <td>Quick Picks — Best thirds</td>
                <td>8 of 12 third-placed teams</td>
                <td>1 per correct pick</td>
                <td>8</td>
              </tr>
              <tr>
                <td>Quick Picks — Knockouts</td>
                <td>Winner of every knockout match</td>
                <td>1 per correct winner</td>
                <td>32</td>
              </tr>
              <tr>
                <td>Classic — Match result</td>
                <td>Home win / Draw / Away win</td>
                <td>3</td>
                <td>312 (104 × 3)</td>
              </tr>
              <tr>
                <td>Classic — Exact score</td>
                <td>Exact final score</td>
                <td>5 (replaces the 3)</td>
                <td>520 (104 × 5)</td>
              </tr>
              <tr>
                <td>Classic — Extra time / penalty bonuses</td>
                <td>Correct ET / shootout call</td>
                <td>+1 ET, +2 PK</td>
                <td>Variable</td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: '0.75rem', fontSize: '0.88rem', color: 'var(--text-sec)' }}>
            Predictions lock 5 minutes before each match kicks off. Up to that moment you can
            update your picks as many times as you want — they auto-save.
          </p>
        </section>

        {/* 5. Prize contest */}
        <section className="legal-section">
          <h2 className="legal-section-title">5. The prize contest</h2>
          <p>
            GoalOracle runs a free skill-based contest tied to the Global Quick Picks
            Leaderboard. At the end of the World Cup Final ({FINAL_DATE}), the top 3
            finishers receive cash prizes paid in {PRIZE_DEFAULT_CURRENCY} stablecoin on{' '}
            {PRIZE_NETWORK}.
          </p>
          <ul className="legal-prize-list">
            {PRIZES.map((p) => (
              <li key={p.place}>
                <strong>{p.place === 1 ? '1st place' : p.place === 2 ? '2nd place' : '3rd place'}</strong>
                {' — '}
                <strong>${p.amount} {PRIZE_DEFAULT_CURRENCY}</strong>
              </li>
            ))}
            <li><strong>Total prize pool: ${PRIZE_TOTAL_USD} {PRIZE_DEFAULT_CURRENCY}</strong></li>
          </ul>
          <p>
            <strong>Eligibility:</strong> {MIN_AGE} years or older, resident of an eligible
            jurisdiction, must provide a self-custody EVM-compatible wallet address to receive
            the prize. <strong>No purchase necessary.</strong> See <a href="/official-rules">Official Rules</a> for
            the full eligibility list, excluded jurisdictions, and dispute process.
          </p>
          <p>
            Sponsored by {SPONSOR_DBA}. This is a skill-based contest, not gambling. There
            is no entry fee and no wagering. Outcomes are determined by accuracy of prediction.
          </p>
        </section>

        {/* 6. Verification */}
        <section className="legal-section">
          <h2 className="legal-section-title">6. How match results are verified</h2>
          <p>
            GoalOracle uses a <strong>dual-source oracle</strong>. When a match concludes:
          </p>
          <ol className="legal-list">
            <li>The result is fetched from <strong>football-data.org</strong>.</li>
            <li>The result is also fetched from <strong>api-football.com</strong>.</li>
            <li><strong>Both sources must agree</strong> on the final score (and extra-time / penalty outcome where applicable) before points are awarded.</li>
            <li>If the sources disagree (rare), the match is marked &ldquo;disputed&rdquo; and reviewed manually by a GoalOracle admin within 24 hours.</li>
          </ol>
          <p>
            The dual-source approach prevents a single data provider&apos;s error from
            affecting points. Once a result is verified, it&apos;s locked — points are
            awarded to every prediction in the same scoring pass.
          </p>
        </section>

        {/* 7. Annexe C */}
        <section className="legal-section">
          <h2 className="legal-section-title">7. Annexe C — third-place routing</h2>
          <p>
            With 12 groups in the 2026 World Cup, 12 teams finish third. Only the top 8 of them
            advance to the Round of 32. FIFA&apos;s <strong>Annexe C</strong> is the official
            published matrix that decides which 8 advance <em>and</em> which specific bracket
            slot each one fills. There are <strong>495 possible combinations</strong>, all
            enumerated in the FIFA rulebook.
          </p>
          <p>
            The cross-group third-place tiebreaker order (Article 13) is: <strong>points → goal
            difference → goals scored → fair play points → FIFA ranking</strong>. Head-to-head is
            <em> not</em> used in the cross-group tiebreaker (these teams haven&apos;t played each
            other); it&apos;s only used in the within-group standings.
          </p>
          <p>
            GoalOracle&apos;s prediction engine implements all 495 combinations exactly to the
            rulebook. For the full deep-dive, see our{' '}
            <a href="/guides/annexe-c-third-place-routing">Annexe C guide</a>.
          </p>
        </section>

        {/* 8. Where to play */}
        <section className="legal-section">
          <h2 className="legal-section-title">8. Get started</h2>
          <p>
            Pick a mode and start your bracket — it&apos;s free, takes about ten minutes for
            Quick Picks, and your account is created automatically with any sign-in method
            (email, Google, Twitter/X). You&apos;re entered into the Global Quick Picks League
            (where the prize contest runs) the moment you finish your bracket.
          </p>
          <p>
            Want to play with friends? Create a <a href="/create">private league</a> and share
            the passcode. Members can run their own scoring rules. Public leagues are also
            browsable from your dashboard.
          </p>
        </section>

        <footer className="legal-footer">
          <p>
            Questions? See the <a href="/faq">FAQ</a> or contact{' '}
            <a href="mailto:support@goaloracle.io">support@goaloracle.io</a>. Full contest
            rules are at <a href="/official-rules">Official Rules</a>.
          </p>
        </footer>
      </div>
    </div>
  );
}
