import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Newspaper, ExternalLink, ChevronLeft, ChevronRight } from 'lucide-react';
import { ARTICLES_FALLBACK } from '../data/teamNews';

// Live World Cup 26 articles, sourced from /api/news (Google News RSS).
// API returns up to 12 items; we paginate 3 at a time with the arrow
// controls. Refreshes every 30 minutes. Falls back to a generic
// hub-link set if the API is unreachable. Each row opens the article
// in a new tab — publishers block iframe embedding so a new tab is
// the reliable path.

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 min
const PAGE_SIZE = 3;

export default function NewsFeed() {
  const [articles, setArticles] = useState(ARTICLES_FALLBACK);
  const [page, setPage] = useState(0);
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
          setArticles(data.articles);
          // Reset to first page on new fetch so the user isn't
          // mid-pagination through stale headlines after a refresh.
          setPage(0);
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

  const totalPages = Math.max(1, Math.ceil(articles.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const start = safePage * PAGE_SIZE;
  const visible = articles.slice(start, start + PAGE_SIZE);
  const showNav = articles.length > PAGE_SIZE;

  return (
    <section className="news-feed" aria-label="World Cup 2026 news today">
      <header className="news-feed-head">
        <span className="td-section-label">
          <Newspaper size={12} aria-hidden="true" />
          World Cup 26 News
        </span>
        <div className="news-feed-head-right">
          <span className="news-feed-date">
            {today} · {start + 1}–{Math.min(start + PAGE_SIZE, articles.length)} of {articles.length}
          </span>
          {showNav && (
            <div className="news-feed-nav" role="group" aria-label="More news">
              <button
                type="button"
                className="news-feed-nav-btn"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={safePage === 0}
                aria-label="Previous news"
              >
                <ChevronLeft size={12} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="news-feed-nav-btn"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={safePage >= totalPages - 1}
                aria-label="More news"
              >
                <ChevronRight size={12} aria-hidden="true" />
              </button>
            </div>
          )}
        </div>
      </header>
      <ul className="news-feed-list" key={safePage}>
        {visible.map(a => (
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
