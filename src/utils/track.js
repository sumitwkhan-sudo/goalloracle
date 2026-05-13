// Thin wrapper around GA4's global gtag() AND PostHog's window-level
// capture(). Safe no-op when neither is loaded (e.g., local dev without
// the GA script or VITE_POSTHOG_KEY env var) and swallows any runtime
// error so analytics never breaks the UI.
//
// Both vendors receive every track() call. PostHog is initialised in
// src/main.jsx and exposed as window.posthog. GA4 is loaded by the
// gtag script tag in index.html.
//
// Usage: track('bracket_start', { league_id: 'global-simple' })
export function track(event, params = {}) {
  if (typeof window === 'undefined') return;

  // GA4 / dataLayer
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', event, params);
    } else {
      // Push into dataLayer anyway so GA picks it up if gtag loads later.
      (window.dataLayer = window.dataLayer || []).push({ event, ...params });
    }
  } catch {
    // analytics failures must never surface to users
  }

  // PostHog — best effort. window.posthog is set in main.jsx after
  // posthog.init(). The optional-chain + typeof guard handles both
  // "key not configured" (window.posthog undefined) and "loaded but
  // capture method not available yet" cases without throwing.
  try {
    if (typeof window.posthog?.capture === 'function') {
      window.posthog.capture(event, params);
    }
  } catch {
    // analytics failures must never surface to users
  }
}

// Fire an event ONCE per browser per user — useful for funnel events like
// "first prediction" where the second occurrence isn't interesting. Uses
// localStorage so it survives reloads but resets if the user clears storage
// or switches devices (acceptable trade-off vs adding a server-side flag).
export function trackOnce(event, params = {}) {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      track(event, params);
      return;
    }
    const key = 'goaloracle_track_once_' + event;
    if (localStorage.getItem(key) === '1') return;
    localStorage.setItem(key, '1');
    track(event, params);
  } catch {
    track(event, params);
  }
}
