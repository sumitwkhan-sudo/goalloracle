import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import posthog from 'posthog-js';
// Plus Jakarta Sans — site-wide typeface. Variable font loaded
// once at boot; --font and --font-display in styles.css point at
// "Plus Jakarta Sans Variable" so every surface picks it up.
import '@fontsource-variable/plus-jakarta-sans';
import GoalOracle from './goaloracle';

// PostHog — initialise once at app boot. Every track() call in
// src/utils/track.js also fires posthog.capture() so the prize-contest
// funnel surfaces in PostHog Live Events alongside GA4.
//
// Hosted on US Cloud. Project key lives in the VITE_POSTHOG_KEY env
// var (must be set on Vercel; Vite bakes it into the bundle at build
// time). When the key isn't present (local dev without env, CI builds
// without secrets) we skip init silently so the app keeps working —
// analytics is never load-bearing.
const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY;
if (POSTHOG_KEY && typeof window !== 'undefined') {
  posthog.init(POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    capture_pageview: true,
    autocapture: true,
    person_profiles: 'identified_only',
    // Expose the instance globally so track.js can call
    // window.posthog.capture without circular imports. Set both inside
    // `loaded` (canonical) and immediately (in case track() fires
    // before `loaded` resolves — usually safe but defensive).
    loaded: (ph) => { window.posthog = ph; },
  });
  window.posthog = posthog;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <GoalOracle />
      <Analytics />
      <SpeedInsights />
    </HelmetProvider>
  </React.StrictMode>
);
