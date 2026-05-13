/**
 * FontPreview
 *
 * Temporary visual mock-up. Renders the logged-in home shell six times
 * in a vertical stack, each panel with a different font family stack
 * applied via CSS-variable overrides on a wrapping div. Lets the
 * operator scroll and pick a typography direction before committing
 * to a site-wide swap.
 *
 * Route is intentionally obscure (`/__typography-preview-xk29r`) and
 * the page injects a `noindex,nofollow` meta tag so it stays
 * un-discoverable on prod. Delete this file + its route entry in
 * goaloracle.jsx once a winner is chosen.
 */

import React, { useEffect } from 'react';
import HomeHeroCard from '../components/HomeHeroCard';
import QuickActionsTiles from '../components/QuickActionsTiles';
import HeroLeaderboardPreview from '../components/HeroLeaderboardPreview';

const MOCK_QUICK_PICKS = {
  isComplete: true,
  totalRemaining: 0,
  winner: 'Colombia',
  runnerUp: 'Spain',
  knockoutPredictions: {
    // One mid-ranked team in R32 produces a visible "biggest upset"
    // chip so all three insight stats render.
    roundOf32: [{ winnerId: 'Czechia' }],
  },
};

const MOCK_RANK = { rank: 1247, total: 12500 };

const MOCK_CONSENSUS = {
  champion: {
    Brazil: 0.32,
    Argentina: 0.21,
    France: 0.18,
    Spain: 0.08,
    Germany: 0.06,
    Colombia: 0.05,
  },
  runnerUp: { Brazil: 0.18, Argentina: 0.14, France: 0.12, Spain: 0.11 },
};

const VARIANTS = [
  {
    id: 'current',
    name: '1. Current — Space Grotesk + Chakra Petch',
    blurb: 'Control. The baseline you already ship.',
    style: {
      '--font': "'Space Grotesk', 'Inter Tight', -apple-system, sans-serif",
      '--font-display': "'Chakra Petch', 'Space Grotesk', system-ui, sans-serif",
      '--mono': "'JetBrains Mono', monospace",
    },
  },
  {
    id: 'geist',
    name: '2. Geist — Vercel modern tech',
    blurb: 'Clean, technical, fintech-trustworthy. Distinct from Inter.',
    style: {
      '--font': "'Geist', system-ui, sans-serif",
      '--font-display': "'Geist', system-ui, sans-serif",
      '--mono': "'Geist Mono', ui-monospace, monospace",
    },
  },
  {
    id: 'schibsted',
    name: '3. Schibsted Grotesk — Editorial sans',
    blurb: 'Norwegian-newspaper credibility. Reads as serious publication.',
    style: {
      '--font': "'Schibsted Grotesk', system-ui, sans-serif",
      '--font-display': "'Schibsted Grotesk', system-ui, sans-serif",
      '--mono': "'JetBrains Mono', monospace",
    },
  },
  {
    id: 'fraunces-manrope',
    name: '4. Fraunces + Manrope — Sports-magazine editorial',
    blurb: 'Variable serif headlines + clean modern body. Athletic / ESPN.',
    style: {
      '--font': "'Manrope', system-ui, sans-serif",
      '--font-display': "'Fraunces', 'Manrope', serif",
      '--mono': "'JetBrains Mono', monospace",
    },
  },
  {
    id: 'bricolage',
    name: '5. Bricolage Grotesque — Distinctive variable',
    blurb: 'Character without being playful. Modern publication feel.',
    style: {
      '--font': "'Bricolage Grotesque', system-ui, sans-serif",
      '--font-display': "'Bricolage Grotesque', system-ui, sans-serif",
      '--mono': "'JetBrains Mono', monospace",
    },
  },
  {
    id: 'big-shoulders',
    name: '6. Big Shoulders + Schibsted — Sports authority',
    blurb: 'Condensed athletic display + editorial body. SI / Sky Sports.',
    style: {
      '--font': "'Schibsted Grotesk', system-ui, sans-serif",
      '--font-display': "'Big Shoulders Display', 'Schibsted Grotesk', sans-serif",
      '--mono': "'JetBrains Mono', monospace",
    },
  },
];

// Single stylesheet that pulls every family we need for the six
// variants. Heavy on bytes, but only loaded when this page is open —
// the production bundle is unaffected.
const FONTS_HREF =
  'https://fonts.googleapis.com/css2' +
  '?family=Geist:wght@400;500;600;700' +
  '&family=Geist+Mono:wght@400;500' +
  '&family=Schibsted+Grotesk:wght@400;500;600;700' +
  '&family=Fraunces:wght@400;600;700' +
  '&family=Manrope:wght@400;500;600;700' +
  '&family=Bricolage+Grotesque:wght@400;500;600;700' +
  '&family=Big+Shoulders+Display:wght@500;700;800' +
  '&display=swap';

function useExternalFonts() {
  useEffect(() => {
    const links = [];
    const preconnect1 = document.createElement('link');
    preconnect1.rel = 'preconnect';
    preconnect1.href = 'https://fonts.googleapis.com';
    document.head.appendChild(preconnect1);
    links.push(preconnect1);

    const preconnect2 = document.createElement('link');
    preconnect2.rel = 'preconnect';
    preconnect2.href = 'https://fonts.gstatic.com';
    preconnect2.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect2);
    links.push(preconnect2);

    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = FONTS_HREF;
    document.head.appendChild(stylesheet);
    links.push(stylesheet);

    return () => { links.forEach((l) => l.parentNode?.removeChild(l)); };
  }, []);
}

function useNoIndexMeta() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => { meta.parentNode?.removeChild(meta); };
  }, []);
}

const NOOP = () => {};

function VariantPanel({ variant }) {
  return (
    <section
      className="font-preview-panel"
      style={{ ...variant.style, fontFamily: 'var(--font)' }}
    >
      <div className="font-preview-panel-header">
        <h2 className="font-preview-panel-name">{variant.name}</h2>
        <p className="font-preview-panel-blurb">{variant.blurb}</p>
      </div>
      <div className="home-shell">
        <HomeHeroCard
          displayName="Sumit"
          quickPicks={MOCK_QUICK_PICKS}
          rank={MOCK_RANK}
          leagueCount={6}
          consensus={MOCK_CONSENSUS}
          onView={NOOP}
          onEdit={NOOP}
          onShare={NOOP}
          onLeaguesClick={NOOP}
          onUpsetClick={NOOP}
          onConsensusClick={NOOP}
        />
        <QuickActionsTiles
          onDashboard={NOOP}
          onMyLeagues={NOOP}
          onLeaderboard={NOOP}
          onJoin={NOOP}
          onCreate={NOOP}
          onInvite={NOOP}
        />
        <div className="home-card home-leaderboard">
          <HeroLeaderboardPreview onViewFull={NOOP} />
        </div>
      </div>
    </section>
  );
}

export default function FontPreview() {
  useExternalFonts();
  useNoIndexMeta();

  return (
    <div className="font-preview-page">
      <div className="font-preview-intro">
        <h1>Typography preview — six directions</h1>
        <p>
          Each panel renders the logged-in home shell (hero card, Quick
          Actions tiles, leaderboard preview) with a different font
          stack applied. Scroll to compare. Once you pick a winner, the
          site-wide swap is a 3-line edit in <code>src/styles.css</code>.
        </p>
      </div>
      {VARIANTS.map((v) => (
        <VariantPanel key={v.id} variant={v} />
      ))}
    </div>
  );
}
