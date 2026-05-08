// Module-level pub/sub for the in-page news article viewer. The
// NewsTicker and NewsFeed both call openNewsArticle({ url, title,
// source }) to slide an iframe panel over the page. NewsArticleViewer
// (mounted once in the app shell) subscribes via useNewsArticle and
// renders the panel.
//
// Kept deliberately tiny — no context provider needed because the
// viewer is a singleton and the producers (ticker, feed) don't need
// to know about each other.

import { useEffect, useState } from 'react';

let current = null;
let listeners = [];

function emit() {
  for (const fn of listeners) fn(current);
}

export function openNewsArticle(article) {
  if (!article || !article.url) return;
  current = article;
  emit();
}

export function closeNewsArticle() {
  current = null;
  emit();
}

export function useNewsArticle() {
  const [a, setA] = useState(current);
  useEffect(() => {
    listeners.push(setA);
    return () => {
      listeners = listeners.filter(fn => fn !== setA);
    };
  }, []);
  return a;
}
