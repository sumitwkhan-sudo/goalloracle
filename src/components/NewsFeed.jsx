import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Newspaper, ExternalLink } from 'lucide-react';
import { ARTICLES_FALLBACK } from '../data/teamNews';

// Three live World Cup 26 articles, sourced from /api/news (Google News
// RSS). Refreshes every 30 minutes. Falls back to a generic hub-link
// set if the API is unreachable. Each row opens the article in a new
// tab — publishers block iframe embedding so a new tab is the
// reliable path.

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min

export default function NewsFeed() {
  const [articles, setArticles] = useState(ARTICLES_FALLBACK);
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
        if (Array.isArray(data.articles) && data.articles.length > 0) {
          setArticles(data.articles.slice(0, 3));
        }
      } catch {
        // Keep whatever's currently rendered.
      }
    };
    load();
    const id = setInterval(load, REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  const today = useMemo(
    () => new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    []
  );

  if (articles.length === 0) return null;

  return (
    <section className="news-feed" aria-label="World Cup 2026 news today">
      <header className="news-feed-head">
        <span className="td-section-label">
          <Newspaper size={12} aria-hidden="true" />
          World Cup 26 News
        </span>
        <span className="news-feed-date">{today} · {articles.length} of 3</span>
      </header>
      <ul className="news-feed-list">
        {articles.slice(0, 3).map(a => (
          <li key={a.id} className="news-feed-item-wrap">
            <a
              className="news-feed-item"
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              <span className="news-feed-source">
                <span className="news-feed-source-dot" aria-hidden="true" />
                {a.source}
              </span>
              <span className="news-feed-title">{a.title}</span>
              <span className="news-feed-meta">
                <span className="news-feed-team" aria-hidden="true">{a.flag} {a.team}</span>
                <ExternalLink size={11} aria-hidden="true" />
              </span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
