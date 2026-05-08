import React, { useEffect, useState } from 'react';
import { X, ExternalLink, Loader } from 'lucide-react';
import { useNewsArticle, closeNewsArticle } from '../utils/newsViewer';

// Slide-in iframe panel. Triggered by clicking a ticker item or a
// dashboard news row. Keeps the user on goaloracle.com — they read
// the article in the panel and dismiss it.
//
// Some publishers send X-Frame-Options or frame-ancestors CSP that
// blocks framing. We can't reliably detect that from the parent (the
// browser blocks silently) so the header always carries an "open in
// new tab" affordance as the recovery path.

const CLOSE_ANIM_MS = 280;

export default function NewsArticleViewer() {
  const article = useNewsArticle();
  const [closing, setClosing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Reset transient state whenever a new article is opened.
  useEffect(() => {
    if (article) {
      setClosing(false);
      setLoaded(false);
    }
  }, [article]);

  // ESC to close + body-scroll lock while open.
  useEffect(() => {
    if (!article) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') beginClose(); };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [article]);

  if (!article) return null;

  const beginClose = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(closeNewsArticle, CLOSE_ANIM_MS);
  };

  return (
    <div
      className={`news-viewer-overlay${closing ? ' news-viewer-closing' : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={`Article: ${article.title}`}
    >
      <div className="news-viewer-backdrop" onClick={beginClose} />
      <aside className="news-viewer-panel">
        <header className="news-viewer-head">
          <button
            type="button"
            className="news-viewer-close"
            onClick={beginClose}
            aria-label="Close article"
          >
            <X size={18} strokeWidth={2.2} />
          </button>
          <div className="news-viewer-title">
            <span className="news-viewer-source">{article.source || 'World Cup 26'}</span>
            <span className="news-viewer-headline" title={article.title}>{article.title}</span>
          </div>
          <a
            className="news-viewer-ext"
            href={article.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open in new tab"
            title="Open in new tab"
          >
            <ExternalLink size={14} strokeWidth={2.2} />
          </a>
        </header>
        <div className="news-viewer-frame-wrap">
          {!loaded && (
            <div className="news-viewer-loading" aria-hidden="true">
              <Loader size={18} className="news-viewer-spinner" />
              <span>Loading article…</span>
            </div>
          )}
          <iframe
            key={article.url}
            className="news-viewer-frame"
            src={article.url}
            title={article.title}
            referrerPolicy="no-referrer"
            sandbox="allow-scripts allow-same-origin allow-popups allow-forms"
            onLoad={() => setLoaded(true)}
          />
        </div>
        <footer className="news-viewer-foot">
          <span>Some publishers block embedding. If this stays blank, use the link icon to open in a new tab.</span>
        </footer>
      </aside>
    </div>
  );
}
