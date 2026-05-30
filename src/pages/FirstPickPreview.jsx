/**
 * FirstPickPreview
 *
 * Temporary visual mock-up for the post-signup "first prediction" moment.
 * The live version (Dashboard.jsx FirstTimeBanner + the stats strip)
 * greets a brand-new user with a generic CTA on top of a row of
 * zero-state vanity metrics — Global Rank #179 of 188, 0 points, 0%
 * accuracy, 0 streak, "52 left". Every number is a zero or a discouraging
 * signal before the user has done anything.
 *
 * This page stacks several alternative hero directions so we can pick the
 * most engaging entry point. Shared principle across all of them: drop the
 * rank/points/accuracy/streak strip entirely (none of it is useful or
 * motivating for someone with zero predictions) and lead with momentum —
 * emotion, stakes, ease, or urgency.
 *
 * Route is intentionally obscure and the page injects a noindex meta tag
 * so it stays undiscoverable on prod. Delete this file + its route entry
 * in goaloracle.jsx once a direction is chosen. Self-contained: no app
 * data or components, so it can't break the build.
 */

import React, { useEffect, useState } from 'react';

// First group-stage kickoff (matches STAGE_FIRST_KICKOFF_UTC.groupStage).
const KICKOFF_UTC = Date.UTC(2026, 5, 11, 19, 0, 0);

// Real prize structure from src/config/legal.js (free-to-enter contest).
const PRIZES = [
  { medal: '🥇', amount: 150 },
  { medal: '🥈', amount: 100 },
  { medal: '🥉', amount: 50 },
];

// A handful of favourites for the champion-first direction.
const FAVOURITES = [
  { flag: '🇧🇷', name: 'Brazil' },
  { flag: '🇦🇷', name: 'Argentina' },
  { flag: '🇫🇷', name: 'France' },
  { flag: '🇪🇸', name: 'Spain' },
  { flag: '🇩🇪', name: 'Germany' },
  { flag: '🇵🇹', name: 'Portugal' },
  { flag: '🇳🇱', name: 'Netherlands' },
  { flag: '🇺🇸', name: 'USA' },
];

function useNoIndexMeta() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => { meta.parentNode?.removeChild(meta); };
  }, []);
}

function useCountdown(target) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target - now);
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return { days, hours, minutes, seconds };
}

const Cta = ({ children, big }) => (
  <button type="button" className={`fpp-cta ${big ? 'fpp-cta-big' : ''}`} onClick={() => {}}>
    {children}
    <span className="fpp-cta-arrow" aria-hidden="true">›</span>
  </button>
);

/* ───────────────────────── Variant A — Champion-first ───────────────────────── */
function VariantChampion() {
  const [picked, setPicked] = useState(null);
  return (
    <div className="fpp-hero fpp-hero-champion">
      <div className="fpp-eyebrow">START WITH THE FUN PART</div>
      <h2 className="fpp-title">Who's lifting the trophy?</h2>
      <p className="fpp-sub">
        Tap your champion — we'll start your bracket there, then you rank the
        groups and fill in the rest. About 3 minutes, auto-saves as you go.
      </p>
      <div className="fpp-flag-grid">
        {FAVOURITES.map((t) => (
          <button
            key={t.name}
            type="button"
            className={`fpp-flag-btn ${picked === t.name ? 'is-picked' : ''}`}
            onClick={() => setPicked(t.name)}
          >
            <span className="fpp-flag">{t.flag}</span>
            <span className="fpp-flag-name">{t.name}</span>
          </button>
        ))}
      </div>
      <div className="fpp-champion-foot">
        {picked
          ? <Cta big>Build my bracket around {picked}</Cta>
          : <button type="button" className="fpp-textlink" onClick={() => {}}>Don't see your pick? Start from the group stage ›</button>}
      </div>
    </div>
  );
}

/* ───────────────────────── Variant B — 3-step journey ───────────────────────── */
function VariantSteps() {
  const steps = [
    { n: 1, icon: '📊', title: 'Rank the groups', desc: 'Order all 12 groups', time: '~1 min' },
    { n: 2, icon: '🎯', title: 'Pick the best 3rd-places', desc: '8 teams advance', time: '~30 sec' },
    { n: 3, icon: '🏆', title: 'Fill the knockout bracket', desc: 'All the way to the Final', time: '~90 sec' },
  ];
  return (
    <div className="fpp-hero">
      <div className="fpp-eyebrow">YOUR BRACKET, STEP BY STEP</div>
      <h2 className="fpp-title">Build your bracket in 3 steps</h2>
      <div className="fpp-steps">
        {steps.map((s) => (
          <div key={s.n} className="fpp-step">
            <div className="fpp-step-icon">{s.icon}</div>
            <div className="fpp-step-body">
              <div className="fpp-step-title"><span className="fpp-step-n">{s.n}</span> {s.title}</div>
              <div className="fpp-step-desc">{s.desc} · <span className="fpp-step-time">{s.time}</span></div>
            </div>
          </div>
        ))}
      </div>
      <div className="fpp-steps-foot">
        <div className="fpp-track" aria-hidden="true"><div className="fpp-track-fill" style={{ width: '4%' }} /></div>
        <Cta>Start predicting</Cta>
      </div>
      <p className="fpp-reassure">No scores to guess — just tap who advances. It saves automatically.</p>
    </div>
  );
}

/* ───────────────────────── Variant C — Stakes & urgency ───────────────────────── */
function VariantStakes() {
  const { days, hours, minutes, seconds } = useCountdown(KICKOFF_UTC);
  return (
    <div className="fpp-hero fpp-hero-stakes">
      <div className="fpp-eyebrow fpp-eyebrow-gold">FREE TO ENTER</div>
      <h2 className="fpp-title">Predict the World Cup.<br />Win up to <span className="fpp-gold">$150</span>.</h2>
      <div className="fpp-prizes">
        {PRIZES.map((p) => (
          <span key={p.amount} className="fpp-prize-chip">{p.medal} ${p.amount} <em>USDC</em></span>
        ))}
      </div>
      <div className="fpp-countdown">
        <span className="fpp-countdown-label">Group stage locks in</span>
        <span className="fpp-countdown-clock">
          <b>{days}</b>d <b>{String(hours).padStart(2, '0')}</b>h <b>{String(minutes).padStart(2, '0')}</b>m <b>{String(seconds).padStart(2, '0')}</b>s
        </span>
      </div>
      <Cta big>Start my bracket · ~3 min</Cta>
      <p className="fpp-social">188 fans have already locked their picks.</p>
    </div>
  );
}

/* ───────────────────────── Variant D — Minimal one-tap ───────────────────────── */
function VariantMinimal() {
  return (
    <div className="fpp-hero fpp-hero-minimal">
      <div className="fpp-minimal-bracket" aria-hidden="true">⌥</div>
      <h2 className="fpp-title fpp-title-xl">Your bracket is empty.</h2>
      <p className="fpp-sub fpp-sub-lg">
        Rank groups, pick best thirds, fill the bracket. About 3 minutes, and
        it auto-saves as you go — no scores to guess, just tap who advances.
      </p>
      <Cta big>Start predicting</Cta>
    </div>
  );
}

const VARIANTS = [
  {
    id: 'champion',
    name: 'A · Champion-first',
    blurb: 'Lead with the one decision every fan already has an opinion on — who wins it all. Tapping a flag is a frictionless, emotional entry point that seeds the bracket. (Recommended — most differentiated and engaging.)',
    Component: VariantChampion,
  },
  {
    id: 'steps',
    name: 'B · 3-step journey',
    blurb: 'Reframes "52 picks left" (a burden) as a short, guided 3-step path with time estimates and a progress track. Sets expectations and lowers the perceived effort.',
    Component: VariantSteps,
  },
  {
    id: 'stakes',
    name: 'C · Stakes & urgency',
    blurb: 'Leads with the real free prize ($150/$100/$50) and a live countdown to the group-stage lock, plus light social proof. Strongest extrinsic motivation + FOMO.',
    Component: VariantStakes,
  },
  {
    id: 'minimal',
    name: 'D · Minimal one-tap',
    blurb: 'Closest to today, but strips the discouraging stats strip and elevates a single bold message + one giant CTA. Fastest to ship, lowest risk.',
    Component: VariantMinimal,
  },
];

export default function FirstPickPreview() {
  useNoIndexMeta();
  return (
    <div className="fpp-page">
      <style>{FPP_CSS}</style>
      <div className="fpp-intro">
        <h1>First-prediction page — alternative directions</h1>
        <p>
          Four engaging entry points for a brand-new user, replacing the
          current generic CTA + zero-state stats strip (Global Rank #179 of
          188, 0 points, 0% accuracy, 0 streak). <strong>All four drop those
          vanity metrics</strong> — they're meaningless and discouraging before
          you've predicted anything. Scroll to compare; the buttons are inert
          mock-ups. The strongest real-world page is likely a blend (A's
          champion entry + C's prize/countdown ribbon).
        </p>
      </div>

      {VARIANTS.map(({ id, name, blurb, Component }) => (
        <section key={id} className="fpp-panel">
          <div className="fpp-panel-head">
            <h2 className="fpp-panel-name">{name}</h2>
            <p className="fpp-panel-blurb">{blurb}</p>
          </div>
          <div className="fpp-stage">
            <Component />
          </div>
        </section>
      ))}

      <div className="fpp-foot-note">Temporary preview — delete <code>src/pages/FirstPickPreview.jsx</code> and its route once a direction is chosen.</div>
    </div>
  );
}

const FPP_CSS = `
.fpp-page {
  --fpp-card: var(--bg-card, #fff);
  --fpp-elev: var(--bg-elev, #f4f6f8);
  --fpp-text: var(--text, #0c1424);
  --fpp-sec: var(--text-sec, #50607a);
  --fpp-dim: var(--text-dim, #8b97ab);
  --fpp-border: var(--border, #e4e8ee);
  --fpp-accent: var(--cyan, #14b8e6);
  --fpp-gold: var(--amber, #f5a623);
  min-height: 100vh;
  background: var(--fpp-elev);
  padding: 2.5rem 1rem 5rem;
  font-family: var(--font, system-ui, sans-serif);
  color: var(--fpp-text);
}
.fpp-intro { max-width: 760px; margin: 0 auto 2rem; }
.fpp-intro h1 { font-size: 1.6rem; font-weight: 800; margin: 0 0 0.5rem; letter-spacing: -0.02em; }
.fpp-intro p { color: var(--fpp-sec); font-size: 0.95rem; line-height: 1.55; margin: 0; }
.fpp-panel { max-width: 760px; margin: 0 auto 2.5rem; }
.fpp-panel-head { margin: 0 0 0.7rem; padding-left: 0.1rem; }
.fpp-panel-name { font-size: 0.82rem; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--fpp-accent); margin: 0 0 0.25rem; }
.fpp-panel-blurb { font-size: 0.85rem; color: var(--fpp-dim); margin: 0; line-height: 1.5; }
.fpp-stage { }

/* Shared hero shell */
.fpp-hero {
  position: relative;
  background: var(--fpp-card);
  border: 1px solid var(--fpp-border);
  border-radius: 18px;
  padding: 1.9rem 1.9rem 1.7rem;
  box-shadow: 0 1px 2px rgba(10,20,40,0.04), 0 12px 32px rgba(10,20,40,0.06);
  overflow: hidden;
}
.fpp-eyebrow { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.12em; color: var(--fpp-accent); margin-bottom: 0.55rem; }
.fpp-eyebrow-gold { color: var(--fpp-gold); }
.fpp-title { font-size: 1.7rem; line-height: 1.12; font-weight: 800; letter-spacing: -0.02em; margin: 0 0 0.55rem; }
.fpp-title-xl { font-size: 2.1rem; }
.fpp-sub { color: var(--fpp-sec); font-size: 0.95rem; line-height: 1.55; margin: 0 0 1.2rem; max-width: 46ch; }
.fpp-sub-lg { font-size: 1.02rem; }
.fpp-gold { color: var(--fpp-gold); }

/* CTA */
.fpp-cta {
  display: inline-flex; align-items: center; gap: 0.4rem;
  background: var(--fpp-accent); color: #fff; border: none;
  font-weight: 700; font-size: 0.95rem; cursor: pointer;
  padding: 0.7rem 1.25rem; border-radius: 11px;
  box-shadow: 0 6px 16px rgba(20,184,230,0.32);
  transition: transform 0.12s ease, box-shadow 0.12s ease;
}
.fpp-cta:hover { transform: translateY(-1px); box-shadow: 0 8px 22px rgba(20,184,230,0.42); }
.fpp-cta-big { font-size: 1.05rem; padding: 0.85rem 1.6rem; border-radius: 13px; }
.fpp-cta-arrow { font-size: 1.15em; line-height: 1; }
.fpp-textlink { background: none; border: none; color: var(--fpp-sec); font-size: 0.88rem; cursor: pointer; padding: 0.4rem 0; font-weight: 600; }
.fpp-textlink:hover { color: var(--fpp-text); }

/* A — champion */
.fpp-flag-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0.6rem; margin-bottom: 1.3rem; }
.fpp-flag-btn {
  display: flex; flex-direction: column; align-items: center; gap: 0.3rem;
  background: var(--fpp-elev); border: 1.5px solid var(--fpp-border); border-radius: 13px;
  padding: 0.85rem 0.4rem; cursor: pointer; transition: all 0.12s ease;
}
.fpp-flag-btn:hover { border-color: var(--fpp-accent); transform: translateY(-2px); }
.fpp-flag-btn.is-picked { border-color: var(--fpp-accent); background: color-mix(in srgb, var(--fpp-accent) 12%, transparent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--fpp-accent) 18%, transparent); }
.fpp-flag { font-size: 1.9rem; line-height: 1; }
.fpp-flag-name { font-size: 0.78rem; font-weight: 600; color: var(--fpp-sec); }
.fpp-champion-foot { min-height: 48px; display: flex; align-items: center; }

/* B — steps */
.fpp-steps { display: flex; flex-direction: column; gap: 0.6rem; margin-bottom: 1.2rem; }
.fpp-step { display: flex; align-items: center; gap: 0.9rem; background: var(--fpp-elev); border: 1px solid var(--fpp-border); border-radius: 13px; padding: 0.85rem 1rem; }
.fpp-step-icon { font-size: 1.5rem; width: 2.4rem; height: 2.4rem; display: grid; place-items: center; background: var(--fpp-card); border-radius: 10px; flex-shrink: 0; }
.fpp-step-title { font-weight: 700; font-size: 0.98rem; display: flex; align-items: center; gap: 0.5rem; }
.fpp-step-n { width: 1.3rem; height: 1.3rem; display: grid; place-items: center; background: var(--fpp-accent); color: #fff; border-radius: 50%; font-size: 0.72rem; font-weight: 800; }
.fpp-step-desc { font-size: 0.84rem; color: var(--fpp-dim); margin-top: 0.1rem; }
.fpp-step-time { color: var(--fpp-accent); font-weight: 600; }
.fpp-steps-foot { display: flex; align-items: center; gap: 1rem; }
.fpp-track { flex: 1; height: 7px; background: var(--fpp-border); border-radius: 99px; overflow: hidden; }
.fpp-track-fill { height: 100%; background: var(--fpp-accent); border-radius: 99px; }
.fpp-reassure { font-size: 0.82rem; color: var(--fpp-dim); margin: 0.9rem 0 0; }

/* C — stakes */
.fpp-hero-stakes { background: linear-gradient(160deg, var(--fpp-card), color-mix(in srgb, var(--fpp-gold) 7%, var(--fpp-card))); }
.fpp-prizes { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1.1rem; }
.fpp-prize-chip { display: inline-flex; align-items: center; gap: 0.3rem; background: var(--fpp-elev); border: 1px solid var(--fpp-border); border-radius: 99px; padding: 0.32rem 0.7rem; font-weight: 700; font-size: 0.9rem; }
.fpp-prize-chip em { font-style: normal; font-size: 0.7rem; color: var(--fpp-dim); font-weight: 600; }
.fpp-countdown { display: flex; flex-direction: column; gap: 0.15rem; margin-bottom: 1.2rem; }
.fpp-countdown-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--fpp-dim); font-weight: 600; }
.fpp-countdown-clock { font-size: 1.15rem; font-weight: 600; color: var(--fpp-text); font-variant-numeric: tabular-nums; }
.fpp-countdown-clock b { font-size: 1.4rem; font-weight: 800; }
.fpp-social { font-size: 0.84rem; color: var(--fpp-dim); margin: 0.9rem 0 0; }

/* D — minimal */
.fpp-hero-minimal { text-align: center; padding: 3rem 1.9rem; }
.fpp-hero-minimal .fpp-sub { margin-left: auto; margin-right: auto; }
.fpp-minimal-bracket { font-size: 2.4rem; color: var(--fpp-border); margin-bottom: 0.6rem; }

.fpp-foot-note { max-width: 760px; margin: 1rem auto 0; font-size: 0.78rem; color: var(--fpp-dim); text-align: center; }
.fpp-foot-note code { background: var(--fpp-card); padding: 0.1rem 0.35rem; border-radius: 5px; border: 1px solid var(--fpp-border); }

@media (max-width: 560px) {
  .fpp-flag-grid { grid-template-columns: repeat(4, 1fr); gap: 0.4rem; }
  .fpp-title { font-size: 1.4rem; }
  .fpp-title-xl { font-size: 1.7rem; }
  .fpp-steps-foot { flex-direction: column; align-items: stretch; gap: 0.7rem; }
}
`;
