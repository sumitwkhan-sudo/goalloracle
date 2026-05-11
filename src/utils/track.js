// Thin wrapper around GA4's global gtag(). Safe no-op when gtag isn't loaded
// (e.g., local dev without the GA script) and swallows any runtime error so
// analytics never breaks the UI.
//
// Usage: track('bracket_start', { league_id: 'global-simple' })
//
// TODO(posthog): when PostHog is added, also call posthog.capture(event,
// params) here. Both vendors should receive every track() call. PostHog SDK
// install + init in main.jsx is the only other change needed.
export function track(event, params = {}) {
  try {
    if (typeof window === 'undefined') return;
    if (typeof window.gtag !== 'function') {
      // Push into dataLayer anyway so GA picks it up if gtag loads later.
      (window.dataLayer = window.dataLayer || []).push({ event, ...params });
      return;
    }
    window.gtag('event', event, params);
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
