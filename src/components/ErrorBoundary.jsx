/**
 * ErrorBoundary
 *
 * App-wide safety net. A render-time throw anywhere below this boundary
 * previously unmounted the whole React root and left users staring at a
 * blank white page (there was no boundary at all). Now we catch it, show a
 * recoverable card with a Reload button, and POST the error + component
 * stack to /api/client-log (tag `react.render.error`) so the real cause is
 * visible in Vercel logs — the same breadcrumb channel auth.js uses.
 */

import React from 'react';

// Fire-and-forget breadcrumb, mirrors clientLog() in utils/auth.js.
function clientLog(tag, data) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([JSON.stringify({ tag, data })], { type: 'application/json' });
      navigator.sendBeacon('/api/client-log', blob);
      return;
    }
  } catch { /* ignore */ }
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, data }),
      keepalive: true,
    }).catch(() => {});
  } catch { /* ignore */ }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    try {
      clientLog('react.render.error', {
        message: error?.message || String(error),
        stack: (error?.stack || '').slice(0, 2000),
        componentStack: (info?.componentStack || '').slice(0, 2000),
        path: typeof window !== 'undefined' ? window.location?.pathname : '',
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : '',
      });
    } catch { /* never let logging throw */ }
    // eslint-disable-next-line no-console
    console.error('Render error caught by ErrorBoundary:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div style={{
        minHeight: '60vh', display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: '24px', textAlign: 'center',
      }}>
        <div style={{ maxWidth: 420 }}>
          <div style={{ fontSize: '2.4rem', marginBottom: 8 }}>⚽</div>
          <h2 style={{ margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ color: '#6b7280', margin: '0 0 18px', lineHeight: 1.5 }}>
            We hit a snag loading this page. Your picks are saved — reloading
            usually fixes it.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => { try { window.location.reload(); } catch { /* ignore */ } }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
