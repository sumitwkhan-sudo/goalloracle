/**
 * HouseRulesJoinView
 *
 * Expanded read-only display of a league's House Rules shown above the
 * "Join League" CTA on the join modal / preview screen. Always
 * expanded (no toggle) since this is the user's first encounter with
 * the rules — they should see all content before clicking Join.
 *
 * Joining the league is the acknowledgment per spec — no separate
 * checkbox.
 */

import React from 'react';
import { Info } from 'lucide-react';

export default function HouseRulesJoinView({ houseRules }) {
  if (!houseRules || !houseRules.content) return null;
  return (
    <section className="house-rules-join" aria-label="House Rules from the league creator">
      <header className="house-rules-join-head">
        <Info size={14} aria-hidden="true" />
        <h3 className="house-rules-join-title">House Rules from the league creator</h3>
      </header>
      <p className="house-rules-join-content">{houseRules.content}</p>
      <p className="house-rules-join-foot">
        These rules are set by the league creator. GoalOracle does not enforce or administer them.
      </p>
    </section>
  );
}
