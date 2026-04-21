// Thin wrapper around GA4's global gtag(). Safe no-op when gtag isn't loaded
// (e.g., local dev without the GA script) and swallows any runtime error so
// analytics never breaks the UI.
//
// Usage: track('bracket_start', { league_id: 'global-simple' })
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
