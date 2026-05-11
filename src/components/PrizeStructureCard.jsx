/**
 * PrizeStructureCard — the 3-place prize visualization.
 *
 * Used on the homepage (below the hero) and on the Global League page.
 * Repetition is intentional per the spec — a returning user landing on
 * the league page should see the same prize summary as a cold visitor
 * on the homepage.
 *
 * Mobile: stacks to a single column. Desktop: 3 equal columns.
 *
 * Reads from src/config/legal.js so prize amounts + currency stay in
 * one place. Don't hardcode amounts here.
 */

import React, { useEffect, useRef } from 'react';
import { Award } from 'lucide-react';
import { PRIZES, PRIZE_DEFAULT_CURRENCY, PRIZE_ALT_CURRENCY, WINNER_NOTIFICATION_WINDOW_DAYS } from '../config/legal';
import { track } from '../utils/track';

export default function PrizeStructureCard({ source = 'unknown', onSeeRules }) {
  const ref = useRef(null);
  // IntersectionObserver-based view tracking. Fires once per mount when
  // the card scrolls into the viewport. The `source` prop disambiguates
  // homepage vs global-league-page in analytics.
  useEffect(() => {
    if (!ref.current || typeof IntersectionObserver === 'undefined') return;
    let fired = false;
    const obs = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && !fired) {
          fired = true;
          track('prize_section_viewed', { source });
          obs.disconnect();
        }
      });
    }, { threshold: 0.4 });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [source]);

  return (
    <section ref={ref} className="prize-structure" aria-labelledby="prize-structure-heading">
      <div className="prize-structure-inner">
        <div className="prize-structure-head">
          <Award size={18} aria-hidden="true" />
          <h2 id="prize-structure-heading" className="prize-structure-title">
            Top 3 win cash prizes
          </h2>
        </div>
        <ol className="prize-structure-list">
          {PRIZES.map((p) => (
            <li key={p.place} className="prize-structure-item" data-place={p.place}>
              <span className="prize-structure-medal" aria-hidden="true">{p.medal}</span>
              <span className="prize-structure-place">{p.label}</span>
              <span className="prize-structure-amount">${p.amount}</span>
            </li>
          ))}
        </ol>
        <p className="prize-structure-foot">
          Paid in {PRIZE_DEFAULT_CURRENCY} stablecoin ({PRIZE_ALT_CURRENCY} on request) to winners&rsquo; EVM wallets.
          Top 3 finishers contacted within {WINNER_NOTIFICATION_WINDOW_DAYS} days of the World Cup Final.
          {onSeeRules && (
            <> · <button type="button" className="prize-structure-link" onClick={onSeeRules}>See Official Rules</button></>
          )}
        </p>
      </div>
    </section>
  );
}
