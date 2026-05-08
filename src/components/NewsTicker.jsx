import React, { useMemo } from 'react';
import { Radio } from 'lucide-react';
import { TEAM_NEWS_TICKER } from '../data/teamNews';

// Marquee-style scrolling team news bar that lives directly under the
// navbar on every view. Items are rendered as plain spans — no anchors,
// no onClick — so users physically can't navigate away from the site.
//
// Loop is implemented by duplicating the items inside the track and
// translating the track by exactly -50%, which makes the seam invisible.
// Speed is "medium fast" — see --news-ticker-duration in styles.css.
//
// Pause-on-hover is intentional for readability; prefers-reduced-motion
// pauses the animation entirely.
export default function NewsTicker() {
  const items = useMemo(() => [...TEAM_NEWS_TICKER, ...TEAM_NEWS_TICKER], []);

  return (
    <div className="news-ticker" role="status" aria-label="FIFA World Cup 2026 team news">
      <div className="news-ticker-label" aria-hidden="true">
        <span className="news-ticker-pulse" />
        <Radio size={11} strokeWidth={2.5} />
        <span className="news-ticker-label-text">Team News</span>
      </div>
      <div className="news-ticker-viewport">
        <div className="news-ticker-track">
          {items.map((item, i) => (
            <span className="news-ticker-item" key={`${item.team}-${i}`}>
              <span className="news-ticker-flag" aria-hidden="true">{item.flag}</span>
              <span className="news-ticker-team">{item.team}</span>
              <span className="news-ticker-text">{item.text}</span>
              <span className="news-ticker-sep" aria-hidden="true">◆</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
