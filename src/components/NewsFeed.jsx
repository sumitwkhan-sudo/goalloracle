import React, { useMemo } from 'react';
import { Newspaper, ExternalLink } from 'lucide-react';
import { getDailyArticles } from '../data/teamNews';

// Dashboard news feed — three articles per calendar day, links open in
// a new tab so users keep their session here. Date selection is
// deterministic so every visitor sees the same three on a given day.
export default function NewsFeed() {
  const articles = useMemo(() => getDailyArticles(new Date(), 3), []);
  if (articles.length === 0) return null;

  const today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

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
        {articles.map(a => (
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
