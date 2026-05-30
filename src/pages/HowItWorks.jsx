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
import {
  SCORING_FACTS,
  GROUP_POSITION_POINTS,
  KNOCKOUT_ROUND_ROWS,
} from '../utils/scoringExplainer';

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

        {/* 2. How the bracket is scored */}
        <section className="legal-section">
          <h2 className="legal-section-title">2. Building and scoring your bracket (~10 minutes)</h2>
          <p>
            GoalOracle is a guided three-step bracket. Most players finish in under ten
            minutes. The maximum score is <strong>{SCORING_FACTS.totalMax} points</strong>,
            and you can save partial progress and come back — you don&apos;t have to fill it
            all at once.
          </p>
          <h3 className="legal-subhead">
            Step 1 — Rank each group ({SCORING_FACTS.groupStageMax} points)
          </h3>
          <p>
            For each of the {SCORING_FACTS.groupCount} groups, put the four teams in your
            predicted finishing order. You earn points for every team you place correctly:{' '}
            <strong>{GROUP_POSITION_POINTS[0]}</strong> for the group winner,{' '}
            <strong>{GROUP_POSITION_POINTS[1]}</strong> for the runner-up,{' '}
            <strong>{GROUP_POSITION_POINTS[2]}</strong> for third, and{' '}
            <strong>{GROUP_POSITION_POINTS[3]}</strong> for fourth. A perfectly ranked group
            is {SCORING_FACTS.groupMaxPerGroup} points; {SCORING_FACTS.groupCount} groups ×{' '}
            {SCORING_FACTS.groupMaxPerGroup} = {SCORING_FACTS.groupStageMax} max.
          </p>
          <h3 className="legal-subhead">
            Step 2 — Pick the 8 best third-placed teams ({SCORING_FACTS.bestThirdMax} points)
          </h3>
          <p>
            {SCORING_FACTS.groupCount} teams finish third but only {SCORING_FACTS.bestThirdCount}{' '}
            advance to the Round of 32. Pick which {SCORING_FACTS.bestThirdCount} you think will
            make it. Each correct pick scores{' '}
            <strong>{SCORING_FACTS.bestThirdPerPick} points</strong>; {SCORING_FACTS.bestThirdMax} max.
          </p>
          <h3 className="legal-subhead">
            Step 3 — Fill the knockout bracket ({SCORING_FACTS.knockoutMax} points)
          </h3>
          <p>
            Pick the winner of every knockout tie through to the Final. Later rounds are worth
            more, so the bracket stays in play to the end:
          </p>
          <ul className="legal-list">
            {KNOCKOUT_ROUND_ROWS.map((r) => (
              <li key={r.key}>
                {r.label} — {r.matches} {r.matches === 1 ? 'match' : 'matches'} ×{' '}
                {r.perPick} pt{r.perPick === 1 ? '' : 's'} = {r.max}
              </li>
            ))}
          </ul>
        </section>

        {/* 3. Scoring table */}
        <section className="legal-section">
          <h2 className="legal-section-title">3. Scoring at a glance</h2>
          <table className="legal-table" aria-label="GoalOracle scoring summary">
            <thead>
              <tr>
                <th>Step</th>
                <th>What you predict</th>
                <th>Points</th>
                <th>Total possible</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Group ranking</td>
                <td>4 teams in order, each group</td>
                <td>{GROUP_POSITION_POINTS.join(' / ')} by position</td>
                <td>{SCORING_FACTS.groupStageMax}</td>
              </tr>
              <tr>
                <td>Best thirds</td>
                <td>{SCORING_FACTS.bestThirdCount} of {SCORING_FACTS.groupCount} third-placed teams</td>
                <td>{SCORING_FACTS.bestThirdPerPick} per correct pick</td>
                <td>{SCORING_FACTS.bestThirdMax}</td>
              </tr>
              <tr>
                <td>Knockouts</td>
                <td>Winner of every knockout tie</td>
                <td>
                  {KNOCKOUT_ROUND_ROWS.map((r) => `${r.perPick}`).join(' / ')} by round
                </td>
                <td>{SCORING_FACTS.knockoutMax}</td>
              </tr>
              <tr>
                <td><strong>Total</strong></td>
                <td>Full bracket</td>
                <td>—</td>
                <td><strong>{SCORING_FACTS.totalMax}</strong></td>
              </tr>
            </tbody>
          </table>
          <p style={{ marginTop: '0.75rem', fontSize: '0.88rem', color: 'var(--text-sec)' }}>
            The leaderboard ranks by <strong>accuracy</strong> — the share of available points
            you&apos;ve earned — so partial brackets are compared fairly; ties go to whoever
            submitted first. Predictions lock 5 minutes before each match kicks off, and
            auto-save until then.
          </p>
        </section>

        {/* 4. Prize contest */}
        <section className="legal-section">
          <h2 className="legal-section-title">4. The prize contest</h2>
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

        {/* 5. Verification */}
        <section className="legal-section">
          <h2 className="legal-section-title">5. How match results are verified</h2>
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

        {/* 6. Annexe C */}
        <section className="legal-section">
          <h2 className="legal-section-title">6. Annexe C — third-place routing</h2>
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

        {/* 7. Where to play */}
        <section className="legal-section">
          <h2 className="legal-section-title">7. Get started</h2>
          <p>
            Start your bracket — it&apos;s free, takes about ten minutes, and your account is
            created automatically with any sign-in method (email, Google, Twitter/X).
            You&apos;re entered into the Global Quick Picks League (where the prize contest
            runs) the moment you finish your bracket.
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
          <p style={{ marginTop: '0.75rem' }}>
            More resources:{' '}
            <a href="/world-cup-2026-predictor">World Cup 2026 Predictor</a> ·{' '}
            <a href="/world-cup-bracket">Bracket</a> ·{' '}
            <a href="/free-world-cup-pool">Free Pool</a> ·{' '}
            <a href="/world-cup-prediction-game">Prediction Game</a> ·{' '}
            <a href="/world-cup-2026-schedule">2026 Schedule</a> ·{' '}
            <a href="/world-cup-2026-groups">2026 Groups</a> ·{' '}
            <a href="/how-world-cup-third-place-qualification-works">3rd-place routing</a>
          </p>
        </footer>
      </div>
    </div>
  );
}
