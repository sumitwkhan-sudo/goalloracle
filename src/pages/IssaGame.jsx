/**
 * IssaGame — goaloracle.io/issa-game
 *
 * Landing page for the "Issa Game" games section. Scaffold to start
 * building games on. Self-contained (no app data/components), so it
 * can't break the build. Currently noindex while empty — flip
 * `index: true` in goaloracle.jsx's VIEW_META once there's real content
 * worth surfacing in search.
 */

import React, { useEffect } from 'react';

function useNoIndexMeta() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => { meta.parentNode?.removeChild(meta); };
  }, []);
}

export default function IssaGame() {
  useNoIndexMeta();
  return (
    <div className="issa-page">
      <style>{ISSA_CSS}</style>
      <div className="issa-inner">
        <h1 className="issa-title">Issa Game</h1>
        <p className="issa-sub">Games are on the way. Check back soon.</p>
      </div>
    </div>
  );
}

const ISSA_CSS = `
.issa-page {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 32px 20px;
  background: #0b0f1a;
  color: #f5f7fb;
}
.issa-inner { text-align: center; max-width: 560px; }
.issa-title {
  font-size: clamp(2rem, 6vw, 3.25rem);
  font-weight: 800;
  margin: 0 0 12px;
  letter-spacing: -0.02em;
}
.issa-sub {
  font-size: 1.05rem;
  margin: 0;
  color: #aab3c5;
}
`;
