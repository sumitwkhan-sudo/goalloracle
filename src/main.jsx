import React from 'react';
import ReactDOM from 'react-dom/client';
import { HelmetProvider } from 'react-helmet-async';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import GoalOracle from './goaloracle';
import DashboardMockups from './pages/DashboardMockups';

// Throwaway preview route. ?mock=1 mounts the design-direction comparison
// page standalone — does not touch auth, routing, or live data. Remove
// this branch once a direction is chosen.
const isMock = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('mock') === '1';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      {isMock ? (
        <DashboardMockups />
      ) : (
        <>
          <GoalOracle />
          <Analytics />
          <SpeedInsights />
        </>
      )}
    </HelmetProvider>
  </React.StrictMode>
);
