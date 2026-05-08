import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Radio } from 'lucide-react';
import { TEAM_NEWS_FALLBACK } from '../data/teamNews';
import { openNewsArticle } from '../utils/newsViewer';

// Pulls live World Cup 26 team news from /api/news (Google News RSS),
// rendered as a slow-scrolling marquee under the navbar so users can
// read items as they pass. Items are buttons — clicking one opens the
// in-page slide-in iframe viewer (NewsArticleViewer) so the user can
// read the article without leaving goaloracle.com.
//
// Refreshes every 30 minutes; falls back to the seed file if the API
// is down. Pause-on-hover for full readability; honours
// prefers-reduced-motion.

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min

export default function NewsTicker() {
  const [items, setItems] = useState(TEAM_NEWS_FALLBACK);
  const fetchTokenRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const token = ++fetchTokenRef.current;
      try {
        const r = await fetch('/api/news', { cache: 'no-store' });
        if (!r.ok) return;
        const data = await r.json();
        if (cancelled || token !== fetchTokenRef.current) return;
        if (Array.isArray(data.ticker) && data.ticker.length > 0) {
          setItems(data.ticker);
        }
      } catch {
        // Network or parse error — keep whatever's currently rendered.
      }
    };
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Doubled track makes the loop seamless — the second half exits the
  // viewport just as the first half completes its translateX(-50%).
  const doubled = useMemo(() => [...items, ...items], [items]);

  const handleClick = (item) => {
    if (!item.url) return;
    openNewsArticle({
      url: item.url,
      title: item.text,
      source: item.source || (item.team ? `${item.team} · World Cup 26` : 'World Cup 26'),
    });
  };

  return (
    <div className="news-ticker" role="status" aria-label="FIFA World Cup 2026 team news">
      <div className="news-ticker-label" aria-hidden="true">
        <span className="news-ticker-pulse" />
        <Radio size={11} strokeWidth={2.5} />
        <span className="news-ticker-label-text">Team News</span>
      </div>
      <div className="news-ticker-viewport">
        <div className="news-ticker-track">
          {doubled.map((item, i) => (
            <button
              type="button"
              className="news-ticker-item"
              key={i}
              onClick={() => handleClick(item)}
              disabled={!item.url}
              aria-label={item.team ? `${item.team}: ${item.text}` : item.text}
            >
              {item.flag && <span className="news-ticker-flag" aria-hidden="true">{item.flag}</span>}
              {item.team && <span className="news-ticker-team">{item.team}</span>}
              <span className="news-ticker-text">{item.text}</span>
              <span className="news-ticker-sep" aria-hidden="true">◆</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
