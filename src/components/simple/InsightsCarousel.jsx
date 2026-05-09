/**
 * InsightsCarousel
 *
 * Wraps the dashboard insights row in a per-league carousel. The
 * user can swipe (touch) or click prev/next arrows to cycle through
 * each Quick Picks league they're a member of, and the cards re-key
 * on the league change so they refetch with the right consensus.
 *
 * Single-league users see no arrows — there's nothing to cycle to.
 * Global Quick Picks always sorts first when present so the
 * landing view matches the previous static behavior.
 */

import React, { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import BoldestCallCard from './BoldestCallCard';
import BracketSurvivalCard from './BracketSurvivalCard';
import BracketAlignmentCard from './BracketAlignmentCard';
import GroupBoldnessCard from './GroupBoldnessCard';
import MarketOddsCard from './MarketOddsCard';

const SWIPE_THRESHOLD_PX = 45;

export default function InsightsCarousel({ userId, leagues = [] }) {
  // Quick Picks leagues only — Classic isn't on the dashboard, and
  // the consensus / boldness cards key off the Quick Picks doc shape.
  // Global QP sorts first so the default view stays consistent.
  const qpLeagues = useMemo(() => {
    const qp = leagues.filter(l => (l.predictionMode || 'simple') === 'simple');
    return qp.sort((a, b) => {
      if (a.id === 'global-simple') return -1;
      if (b.id === 'global-simple') return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }, [leagues]);

  const [idx, setIdx] = useState(0);
  const safeIdx = qpLeagues.length > 0 ? Math.min(idx, qpLeagues.length - 1) : 0;
  const current = qpLeagues[safeIdx] || { id: 'global-simple', name: 'Global League' };
  const total = qpLeagues.length;
  const showNav = total > 1;

  const goPrev = () => setIdx(i => Math.max(0, i - 1));
  const goNext = () => setIdx(i => Math.min(total - 1, i + 1));

  // Touch swipe — left swipe → next, right swipe → prev. Anything
  // shorter than SWIPE_THRESHOLD_PX is ignored so a vertical scroll
  // doesn't accidentally page the carousel.
  const touchStartX = useRef(null);
  const onTouchStart = (e) => {
    touchStartX.current = e.touches?.[0]?.clientX ?? null;
  };
  const onTouchEnd = (e) => {
    if (touchStartX.current == null) return;
    const endX = e.changedTouches?.[0]?.clientX ?? null;
    if (endX == null) return;
    const dx = endX - touchStartX.current;
    if (Math.abs(dx) < SWIPE_THRESHOLD_PX) return;
    if (dx < 0) goNext(); else goPrev();
    touchStartX.current = null;
  };

  return (
    <section className="td-insights-row" aria-label="Bracket insights">
      <div className="td-insights-header">
        <span className="td-section-label td-insights-label">
          Insights{current?.name ? <> · <span className="td-insights-league">{current.name}</span></> : null}
        </span>
        {showNav && (
          <div className="td-insights-nav" role="group" aria-label="Switch league">
            <span className="td-insights-counter">{safeIdx + 1} / {total}</span>
            <button
              type="button"
              className="td-insights-nav-btn"
              onClick={goPrev}
              disabled={safeIdx === 0}
              aria-label="Previous league"
            >
              <ChevronLeft size={12} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="td-insights-nav-btn"
              onClick={goNext}
              disabled={safeIdx >= total - 1}
              aria-label="Next league"
            >
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      {/*
        key={current.id} forces all five cards to remount when the
        user pages to a different league — same effect as the cards'
        own [leagueId] effect dependency, but also resets any
        in-flight fetch state cleanly so we don't briefly show one
        league's content under another league's header during a
        page swap.
      */}
      <div
        className="td-insights-grid"
        key={current.id}
        onTouchStart={showNav ? onTouchStart : undefined}
        onTouchEnd={showNav ? onTouchEnd : undefined}
      >
        <div className="td-insights-pack">
          {userId && <BoldestCallCard userId={userId} leagueId={current.id} />}
          {userId && <GroupBoldnessCard userId={userId} leagueId={current.id} />}
          {userId && <BracketAlignmentCard userId={userId} leagueId={current.id} />}
          {userId && <MarketOddsCard userId={userId} leagueId={current.id} />}
        </div>
        {userId && <BracketSurvivalCard userId={userId} leagueId={current.id} />}
      </div>
    </section>
  );
}
