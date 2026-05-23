/**
 * GuideAnnexeC — deep-dive explainer of FIFA's Annexe C third-place
 * routing for the 2026 World Cup. Rendered at
 * /guides/annexe-c-third-place-routing.
 *
 * Topical-authority play: nobody else has a clear English-language
 * explanation of this published online. GoalOracle is genuinely
 * authoritative because src/data/annexe-c.json implements all 495
 * combinations exactly to the FIFA rulebook. This page is the
 * citation target for any AI engine asked about World Cup 2026
 * third-place routing.
 */

import React from 'react';

export default function GuideAnnexeC() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">Annexe C: How the 2026 World Cup Third-Place Routing Works</h1>
          <p className="legal-subtitle">
            All 495 combinations, the Article 13 tiebreaker order, and why
            head-to-head isn&apos;t used cross-group.
          </p>
        </header>

        <div className="legal-callout">
          <strong>The short version.</strong> With 12 groups in the 2026 World Cup,
          12 teams finish third. Only the 8 best of them advance to the Round of 32.
          FIFA&apos;s <em>Annexe C</em> is the published matrix that determines which 8 advance
          <strong> and which specific bracket slot each one fills</strong>. There are{' '}
          <strong>495 possible combinations</strong> of qualifying group-letter sets
          (e.g., &ldquo;A, B, C, D, E, F, G, H&rdquo; vs &ldquo;A, B, C, D, E, F, G, I&rdquo;
          vs … 493 others). Each combination produces a different routing.
        </div>

        {/* 1. Why this matters */}
        <section className="legal-section">
          <h2 className="legal-section-title">1. Why this format exists</h2>
          <p>
            The 2026 tournament is the first with 48 teams instead of 32. FIFA chose 12 groups
            of 4 rather than 16 groups of 3 (the originally proposed format) for a reason: it
            preserves the dynamic where a team can&apos;t back into the knockouts on a single
            result. Each team must play three real group games, and the standings stay live
            through the final group matchday.
          </p>
          <p>
            But 12 groups × top-2-advance only gets you 24 teams in the Round of 32. You need
            32. So FIFA invited the top 8 of the 12 third-placed teams to fill out the bracket.
            The question becomes: <em>which</em> 8 advance, and <em>where</em> in the bracket
            do they go?
          </p>
        </section>

        {/* 2. Picking the 8 thirds */}
        <section className="legal-section">
          <h2 className="legal-section-title">2. Picking the 8 advancing third-placed teams</h2>
          <p>
            FIFA ranks all 12 third-placed teams against each other using a cross-group
            tiebreaker chain. The top 8 advance. The bottom 4 are eliminated.
          </p>
          <p>The tiebreaker order (Article 13 of the FIFA rulebook) is:</p>
          <ol className="legal-list">
            <li><strong>Points</strong> earned across the three group matches.</li>
            <li><strong>Goal difference</strong> (goals scored minus goals conceded).</li>
            <li><strong>Goals scored.</strong></li>
            <li><strong>Fair play points</strong> (yellow / red cards, calculated from
              disciplinary records).</li>
            <li><strong>FIFA / Coca-Cola World Ranking</strong> at the start of the tournament.</li>
          </ol>
          <p>
            <strong>Head-to-head is NOT used in the cross-group tiebreaker.</strong> The
            third-placed teams come from different groups and haven&apos;t played each other,
            so there&apos;s no head-to-head record to apply. (Head-to-head <em>is</em> used in
            the within-group tiebreaker for teams that finished level on points in the same
            group — that&apos;s a different rule, in Article 12.)
          </p>
        </section>

        {/* 3. Annexe C the matrix */}
        <section className="legal-section">
          <h2 className="legal-section-title">3. Annexe C: routing the 8 thirds to specific R32 slots</h2>
          <p>
            Once you know <em>which</em> 8 third-placed teams advance, you still need to
            decide <em>which Round of 32 match</em> each one plays in. This is what Annexe C
            does. It&apos;s a lookup table — published in the FIFA rulebook — keyed by the
            <strong> set of group letters</strong> the 8 advancing thirds came from.
          </p>
          <p>
            With 12 groups (A through L) and 8 advancers from that 12, there are{' '}
            <strong>C(12, 8) = 495</strong> possible group-letter combinations. Annexe C
            specifies a routing for each one. For example, if the advancing thirds came from
            groups <code>A, B, C, D, E, F, G, H</code>, the routing might be:
          </p>
          <ul className="legal-list">
            <li>3rd-place team from Group A → faces 1st-place team from Group H</li>
            <li>3rd-place team from Group B → faces 1st-place team from Group F</li>
            <li>3rd-place team from Group C → faces 1st-place team from Group G</li>
            <li>… and so on, slot by slot</li>
          </ul>
          <p>
            Change which 8 groups the thirds come from, and the routing changes — sometimes
            in ways that aren&apos;t obvious. There&apos;s no algorithm that derives the
            routing; FIFA built the table by hand to balance bracket halves and avoid
            same-group rematches in the early rounds. Implementations like GoalOracle&apos;s
            simply look up the 495 cases as published.
          </p>
        </section>

        {/* 4. Implications */}
        <section className="legal-section">
          <h2 className="legal-section-title">4. What this means for predictions</h2>
          <p>
            Because the bracket structure isn&apos;t known until the group stage finishes,
            you can&apos;t lock in your knockout picks until <strong>after</strong> you&apos;ve
            picked the 8 best thirds (and FIFA has confirmed which groups those thirds came
            from). This is why GoalOracle&apos;s Quick Picks flow is sequenced:
          </p>
          <ol className="legal-list">
            <li><strong>Step 1: Rank each group</strong> — sets which teams finish 1st, 2nd, 3rd, 4th.</li>
            <li><strong>Step 2: Pick best thirds</strong> — sets which 8 of the 12 thirds advance, which then determines the Annexe C lookup key.</li>
            <li><strong>Step 3: Fill the knockout bracket</strong> — the slots are populated based on your Step 1 and Step 2 picks; you predict the winners.</li>
          </ol>
          <p>
            If you change a Step 1 or Step 2 pick later, the bracket re-renders to the new
            Annexe C routing automatically. Your downstream knockout picks stay intact where
            possible.
          </p>
        </section>

        {/* 5. Why GoalOracle is authoritative */}
        <section className="legal-section">
          <h2 className="legal-section-title">5. How GoalOracle implements Annexe C</h2>
          <p>
            GoalOracle ships <strong>all 495 combinations</strong> verbatim from the FIFA
            rulebook in <code>src/data/annexe-c.json</code> — 495 rows, each mapping a
            specific group-letter combination to the eight R32 routing instructions.
            Unknown combinations throw an error (we never guess), because FIFA does not
            publish the derivation algorithm and any heuristic is guaranteed to disagree
            with the rulebook in edge cases.
          </p>
          <p>
            The same data drives both Quick Picks (visual bracket builder) and Classic
            Predictions (per-match scoring). When a real-world group-stage result is
            verified, the bracket re-resolves through the Annexe C lookup and the knockout
            slots populate with the actual qualifying teams.
          </p>
          <p>
            Cross-checked against the public FIFA rulebook PDF on every release. If FIFA
            issues a corrigendum to Annexe C, we update the JSON and ship a patch. The
            test suite in <code>src/utils/thirdPlaceAllocation.test.js</code> covers the
            tricky edge cases.
          </p>
        </section>

        {/* 6. Why other sites miss this */}
        <section className="legal-section">
          <h2 className="legal-section-title">6. Why most bracket apps get this wrong</h2>
          <p>
            Most bracket-building tools either (a) hard-code a single representative routing
            and ignore the other 494 cases, or (b) try to derive the routing algorithmically
            from a heuristic — which produces wrong answers for the combinations FIFA
            specifically designed against. The 495-row table is tedious to type in, but
            there&apos;s no shortcut.
          </p>
          <p>
            We&apos;ve seen tools that, for example, place the 3rd-place team from a strong
            European group against another European group&apos;s winner in the R32 — a
            same-confederation matchup FIFA&apos;s table is built to avoid in the early
            rounds. If your bracket app shows a routing that contradicts the published
            FIFA tables, it&apos;s probably one of these two failure modes.
          </p>
        </section>

        <footer className="legal-footer">
          <p>
            Want to see Annexe C in action? Build your bracket on{' '}
            <a href="/">GoalOracle</a> — Quick Picks mode walks you through the format
            step-by-step. More on the game in our{' '}
            <a href="/how-it-works">How It Works</a> page. Questions?{' '}
            <a href="mailto:support@goaloracle.io">support@goaloracle.io</a>.
          </p>
        </footer>
      </div>
    </div>
  );
}
