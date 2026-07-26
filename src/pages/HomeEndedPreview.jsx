/**
 * HomeEndedPreview
 *
 * Temporary visual mock-up for the POST-TOURNAMENT home page redesign.
 * The live home still sells entry into a contest that ended: the anonymous
 * landing leads with "Predict the World Cup / Enter Free" + a kickoff
 * countdown, and the logged-in home is built around editing picks and
 * joining leagues — all dead ends now.
 *
 * This page shows 3 design directions × 2 auth states (toggle at the top):
 *   A · The Record Book   — pure closeout: winners + records, no future talk
 *   B · Celebrate + Next  — closeout + a quiet "next seasons" teaser (RECOMMENDED)
 *   C · Season Two        — pivot-forward: waitlist hero, WC as proof band
 *
 * Same conventions as FirstPickPreview: obscure route, noindex meta,
 * self-contained (prefixed hep-* CSS, site tokens only, no app components),
 * buttons inert. Real winners names are pulled from the public edge-cached
 * winners doc when published; everything personal is static mock data.
 * Delete this file + its route entries once a direction is chosen.
 */

import React, { useEffect, useState } from 'react';
import { fetchWinnersPage } from '../utils/db';

function useNoIndexMeta() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex,nofollow';
    document.head.appendChild(meta);
    return () => { meta.parentNode?.removeChild(meta); };
  }, []);
}

// ── shared mock/real data ────────────────────────────────────────────────
const STATS = { players: 5580, countries: 82, leagues: 312, paid: '$300' };

// Static stand-in for the signed-in viewer (preview has no auth context).
const ME = {
  name: 'Alex',
  rank: 212,
  total: 5580,
  pct: 4,
  points: 118,
  badges: ['🎯 Oracle Eye', '🏁 Bracket Finisher', '⚡ Early Bird'],
  leagues: [
    { name: 'Global League', rank: 212, total: 5580 },
    { name: 'Office Legends', rank: 3, total: 14 },
    { name: 'Sunday Crew', rank: 1, total: 9 },
  ],
};

const FALLBACK_WINNERS = [
  { place: 1, displayName: 'ThirdPlaceProphet', country: 'MX', amount: 150 },
  { place: 2, displayName: 'BracketBender', country: 'US', amount: 100 },
  { place: 3, displayName: 'La Oracle', country: 'AR', amount: 50 },
];

const NEXT_SEASONS = [
  { name: 'Premier League 26/27', when: 'Kicks off August', emoji: '⚽' },
  { name: 'Champions League 26/27', when: 'Draw in late August', emoji: '🏆' },
  { name: 'More competitions', when: 'You tell us', emoji: '🗳️' },
];

function flagOf(code) {
  if (!code || code.length !== 2) return '🏳️';
  const A = 0x1f1e6;
  const c = code.toUpperCase();
  return String.fromCodePoint(A + c.charCodeAt(0) - 65, A + c.charCodeAt(1) - 65);
}

// ── shared pieces ────────────────────────────────────────────────────────
function Podium({ winners, compact }) {
  const by = (p) => winners.find((w) => w.place === p);
  const order = [2, 1, 3];
  return (
    <div className={`hep-podium ${compact ? 'hep-podium-compact' : ''}`}>
      {order.map((p) => {
        const w = by(p);
        if (!w) return null;
        return (
          <div key={p} className={`hep-podium-col hep-podium-${p}`}>
            <span className="hep-podium-medal" aria-hidden="true">{p === 1 ? '🥇' : p === 2 ? '🥈' : '🥉'}</span>
            <span className="hep-podium-name">{flagOf(w.country)} {w.displayName}</span>
            <span className="hep-podium-amt">${w.amount} USDC</span>
            <div className="hep-podium-block" aria-hidden="true" />
          </div>
        );
      })}
    </div>
  );
}

function StatsBand() {
  return (
    <div className="hep-stats" role="list">
      <span role="listitem"><strong>{STATS.players.toLocaleString()}</strong> players</span>
      <span role="listitem"><strong>{STATS.countries}</strong> countries</span>
      <span role="listitem"><strong>{STATS.leagues}</strong> leagues &amp; pools</span>
      <span role="listitem"><strong>{STATS.paid}</strong> paid to winners</span>
    </div>
  );
}

function WrappedCard({ compact }) {
  return (
    <div className={`hep-wrapped ${compact ? 'hep-wrapped-compact' : ''}`}>
      <div className="hep-eyebrow">Your tournament record</div>
      <div className="hep-wrapped-rank">
        <span className="hep-wrapped-num">#{ME.rank.toLocaleString()}</span>
        <span className="hep-wrapped-meta">
          of {ME.total.toLocaleString()} worldwide · <strong>top {ME.pct}%</strong>
          <br />{ME.points} points
        </span>
      </div>
      <div className="hep-badge-row">
        {ME.badges.map((b) => <span key={b} className="hep-badge">{b}</span>)}
      </div>
      {!compact && (
        <div className="hep-mini-leagues">
          {ME.leagues.map((l) => (
            <div key={l.name} className="hep-mini-league">
              <span>{l.rank === 1 ? '👑 ' : ''}{l.name}</span>
              <span className="hep-mini-rank">#{l.rank.toLocaleString()} of {l.total.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
      <div className="hep-cta-row">
        <button type="button" className="hep-btn hep-btn-gold">My profile &amp; badges</button>
        <button type="button" className="hep-btn hep-btn-ghost">Share my result</button>
      </div>
    </div>
  );
}

function NextSeasonsStrip({ heading = 'Next seasons' }) {
  return (
    <div className="hep-next">
      <div className="hep-next-head">
        <span className="hep-eyebrow">{heading}</span>
        <p>The Oracle returns for club season. One tap and you&rsquo;ll hear when picks open.</p>
      </div>
      <div className="hep-next-grid">
        {NEXT_SEASONS.map((s) => (
          <div key={s.name} className="hep-next-card">
            <span className="hep-next-emoji" aria-hidden="true">{s.emoji}</span>
            <span className="hep-next-name">{s.name}</span>
            <span className="hep-next-when">{s.when}</span>
          </div>
        ))}
      </div>
      <div className="hep-notify">
        <input className="hep-input" placeholder="you@email.com" aria-label="Email for season updates" readOnly />
        <button type="button" className="hep-btn hep-btn-gold">Get notified</button>
      </div>
    </div>
  );
}

function TipSurveyRow() {
  return (
    <div className="hep-two-up">
      <div className="hep-side-card">
        <div className="hep-eyebrow">Enjoyed the ride?</div>
        <p className="hep-side-copy">GoalOracle is one founder + a lot of late nights. Tips keep the lights on for season two.</p>
        <button type="button" className="hep-btn hep-btn-ghost">☕ Leave a tip</button>
      </div>
      <div className="hep-side-card">
        <div className="hep-eyebrow">What should we play next?</div>
        <div className="hep-vote-row">
          {['EPL', 'UCL', 'IPL', 'March Madness'].map((v) => (
            <button key={v} type="button" className="hep-vote">{v}</button>
          ))}
        </div>
        <button type="button" className="hep-textlink">See what others voted →</button>
      </div>
    </div>
  );
}

// ── Variant A — The Record Book ──────────────────────────────────────────
function VariantA({ authed, winners }) {
  if (!authed) {
    return (
      <div className="hep-home">
        <div className="hep-eyebrow">World Cup 2026 · Final results</div>
        <h1 className="hep-h1">The world predicted.<br /><span className="hep-grad">These three saw it clearest.</span></h1>
        <Podium winners={winners} />
        <StatsBand />
        <div className="hep-cta-row hep-center">
          <button type="button" className="hep-btn hep-btn-gold">See the winners</button>
          <button type="button" className="hep-btn hep-btn-ghost">Browse final standings</button>
        </div>
        <p className="hep-signin-line">Played this summer? <button type="button" className="hep-textlink">Sign in</button> to see your permanent record.</p>
      </div>
    );
  }
  return (
    <div className="hep-home">
      <WrappedCard />
      <div className="hep-winners-mini">
        <span className="hep-eyebrow">The podium</span>
        <div className="hep-winners-mini-row">
          {winners.map((w) => (
            <span key={w.place} className="hep-winner-chip">
              {w.place === 1 ? '🥇' : w.place === 2 ? '🥈' : '🥉'} {flagOf(w.country)} {w.displayName}
            </span>
          ))}
          <button type="button" className="hep-textlink">Full winners page →</button>
        </div>
      </div>
      <div className="hep-tile-row">
        <button type="button" className="hep-tile">🏆 Final leaderboard</button>
        <button type="button" className="hep-tile">👥 My leagues</button>
      </div>
    </div>
  );
}

// ── Variant B — Celebrate + What's Next ──────────────────────────────────
function VariantB({ authed, winners }) {
  if (!authed) {
    return (
      <div className="hep-home">
        <div className="hep-eyebrow">World Cup 2026 · Contest complete</div>
        <h1 className="hep-h1">5,580 played. Three got paid.<br /><span className="hep-grad">The Oracle rests — briefly.</span></h1>
        <Podium winners={winners} compact />
        <StatsBand />
        <div className="hep-cta-row hep-center">
          <button type="button" className="hep-btn hep-btn-gold">See the winners</button>
          <button type="button" className="hep-btn hep-btn-ghost">Final standings</button>
        </div>
        <NextSeasonsStrip />
      </div>
    );
  }
  return (
    <div className="hep-home">
      <WrappedCard compact />
      <NextSeasonsStrip heading="Play the next one" />
      <TipSurveyRow />
    </div>
  );
}

// ── Variant C — Season Two ───────────────────────────────────────────────
function VariantC({ authed, winners }) {
  if (!authed) {
    return (
      <div className="hep-home">
        <div className="hep-eyebrow">Season two</div>
        <h1 className="hep-h1"><span className="hep-grad">The bracket brain returns.</span></h1>
        <p className="hep-sub">Premier League 26/27 opens in August. Same game, whole new season — rank the table, out-call your friends, climb the world.</p>
        <div className="hep-notify hep-notify-hero">
          <input className="hep-input" placeholder="you@email.com" aria-label="Email for the season-two waitlist" readOnly />
          <button type="button" className="hep-btn hep-btn-gold">Join the waitlist</button>
        </div>
        <div className="hep-proof-band">
          <span className="hep-eyebrow">Season one: World Cup 2026</span>
          <StatsBand />
          <div className="hep-winners-mini-row">
            {winners.map((w) => (
              <span key={w.place} className="hep-winner-chip">
                {w.place === 1 ? '🥇' : w.place === 2 ? '🥈' : '🥉'} {flagOf(w.country)} {w.displayName} · ${w.amount}
              </span>
            ))}
            <button type="button" className="hep-textlink">Winners &amp; proof →</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="hep-home">
      <div className="hep-eyebrow">Season two</div>
      <h1 className="hep-h1">Carry your record<br /><span className="hep-grad">into season two.</span></h1>
      <p className="hep-sub">Top {ME.pct}% of {ME.total.toLocaleString()} at the World Cup. Your record carries — first pick of the Premier League table is yours in August.</p>
      <div className="hep-cta-row">
        <button type="button" className="hep-btn hep-btn-gold">Join the waitlist</button>
        <button type="button" className="hep-btn hep-btn-ghost">My WC 2026 record</button>
      </div>
      <WrappedCard compact />
    </div>
  );
}

// ── page shell ───────────────────────────────────────────────────────────
const VARIANTS = [
  {
    id: 'A',
    name: 'A · The Record Book',
    blurb: 'Pure closeout. The site becomes the permanent archive of WC 2026 — winners as the logged-out hero, your wrapped record as the logged-in hero. No future promises.',
    Component: VariantA,
  },
  {
    id: 'B',
    name: 'B · Celebrate + What’s Next (recommended)',
    blurb: 'Same closeout content, tighter, plus a quiet "next seasons" strip with email capture — keeps the 5,580-player base warm for a club-season pivot without committing to it. Logged-in adds tip jar + "what next" vote.',
    Component: VariantB,
  },
  {
    id: 'C',
    name: 'C · Season Two',
    blurb: 'Pivot-forward. Logged-out hero sells the next-season waitlist; WC 2026 demoted to a proof band. Logged-in personalizes the pitch with your finish. Strongest if the club-season pivot is a done decision.',
    Component: VariantC,
  },
];

export default function HomeEndedPreview() {
  useNoIndexMeta();
  const [variant, setVariant] = useState('B');
  const [authed, setAuthed] = useState(false);
  const [winners, setWinners] = useState(FALLBACK_WINNERS);

  useEffect(() => {
    let cancelled = false;
    fetchWinnersPage().then((d) => {
      if (cancelled || !d?.published || !Array.isArray(d.winners) || d.winners.length === 0) return;
      setWinners(d.winners.map((w) => ({
        place: w.place, displayName: w.displayName, country: w.country || '', amount: w.amount,
      })));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const active = VARIANTS.find((v) => v.id === variant);
  const V = active.Component;

  return (
    <div className="hep-page">
      <style>{HEP_CSS}</style>
      <div className="hep-controls" role="navigation" aria-label="Preview controls">
        <span className="hep-controls-tag">Home redesign — post-tournament</span>
        <div className="hep-tabs" role="tablist" aria-label="Design variant">
          {VARIANTS.map((v) => (
            <button
              key={v.id}
              type="button"
              role="tab"
              aria-selected={variant === v.id}
              className={`hep-tab ${variant === v.id ? 'on' : ''}`}
              onClick={() => setVariant(v.id)}
            >
              {v.id}
            </button>
          ))}
        </div>
        <div className="hep-tabs" role="tablist" aria-label="Auth state">
          <button type="button" role="tab" aria-selected={!authed} className={`hep-tab ${!authed ? 'on' : ''}`} onClick={() => setAuthed(false)}>Logged out</button>
          <button type="button" role="tab" aria-selected={authed} className={`hep-tab ${authed ? 'on' : ''}`} onClick={() => setAuthed(true)}>Logged in</button>
        </div>
      </div>
      <div className="hep-blurb">
        <strong>{active.name}.</strong> {active.blurb} <em>Buttons are inert; personal numbers are mock data.</em>
      </div>
      <div className="hep-stage">
        <V authed={authed} winners={winners} />
      </div>
      <div className="hep-foot">Temporary preview — delete <code>src/pages/HomeEndedPreview.jsx</code> and its route once a direction is chosen.</div>
    </div>
  );
}

const HEP_CSS = `
.hep-page {
  --hep-card: var(--bg-card, #0C0C12);
  --hep-elev: var(--bg-elev, #121219);
  --hep-border: var(--border, rgba(255,255,255,0.06));
  --hep-text: var(--text, #E8E8EF);
  --hep-sec: var(--text-sec, #7A7A8E);
  --hep-dim: var(--text-dim, #3E3E4F);
  --hep-gold: var(--gold, #C9A86A);
  --hep-rose: var(--rose, #E8C6B8);
  --hep-plat: var(--platinum, #D9D4CA);
  --hep-grad: linear-gradient(120deg, var(--hep-plat), var(--hep-rose) 45%, var(--hep-gold));
  min-height: 100vh;
  background: var(--bg, #050508);
  color: var(--hep-text);
  font-family: var(--font, system-ui, sans-serif);
  padding: 0 1rem 4rem;
}
.hep-controls {
  position: sticky; top: 0; z-index: 40;
  display: flex; align-items: center; gap: 0.7rem; flex-wrap: wrap;
  margin: 0 -1rem 1.2rem; padding: 0.7rem 1rem;
  background: var(--bg-glass, rgba(5,5,8,0.9)); backdrop-filter: blur(10px);
  border-bottom: 1px dashed rgba(201,168,106,0.4);
}
.hep-controls-tag {
  font-family: var(--mono, monospace); font-size: 0.68rem; letter-spacing: 0.12em;
  text-transform: uppercase; color: var(--hep-gold);
}
.hep-tabs { display: inline-flex; gap: 4px; border: 1px solid var(--hep-border); border-radius: 999px; padding: 3px; }
.hep-tab {
  border: none; background: transparent; color: var(--hep-sec); cursor: pointer;
  font-family: var(--mono, monospace); font-size: 0.72rem; font-weight: 600;
  padding: 0.3rem 0.85rem; border-radius: 999px;
}
.hep-tab.on { background: var(--hep-grad); color: #14100A; font-weight: 700; }
.hep-blurb {
  max-width: 720px; margin: 0 auto 1.6rem;
  font-size: 0.85rem; line-height: 1.55; color: var(--hep-sec);
}
.hep-blurb em { color: var(--hep-dim); font-style: normal; }
.hep-stage { max-width: 720px; margin: 0 auto; }
.hep-foot {
  max-width: 720px; margin: 3rem auto 0;
  font-family: var(--mono, monospace); font-size: 0.7rem; color: var(--hep-dim);
}
.hep-foot code { color: var(--hep-sec); }

/* home canvas */
.hep-home {
  background: var(--hep-card); border: 1px solid var(--hep-border);
  border-radius: 18px; padding: 2.2rem 1.9rem 2rem;
  display: flex; flex-direction: column; gap: 1.35rem;
}
.hep-eyebrow {
  font-family: var(--mono, monospace); font-size: 0.66rem; font-weight: 500;
  letter-spacing: 0.16em; text-transform: uppercase; color: var(--hep-gold);
}
.hep-h1 {
  font-size: clamp(1.7rem, 4.5vw, 2.5rem); font-weight: 800;
  letter-spacing: -0.03em; line-height: 1.1; margin: 0; text-wrap: balance;
}
.hep-grad {
  background: var(--hep-grad);
  -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hep-sub { color: var(--hep-sec); font-size: 0.98rem; line-height: 1.55; margin: 0; max-width: 52ch; }

.hep-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  border: none; border-radius: 999px; cursor: pointer;
  font-weight: 700; font-size: 0.9rem; padding: 0.7rem 1.4rem;
}
.hep-btn-gold { background: var(--hep-grad); color: #14100A; }
.hep-btn-ghost {
  background: transparent; color: var(--hep-text);
  border: 1px solid var(--hep-border);
}
.hep-btn-ghost:hover { border-color: rgba(232,198,184,0.45); }
.hep-cta-row { display: flex; gap: 0.7rem; flex-wrap: wrap; }
.hep-cta-row.hep-center { justify-content: center; }
.hep-textlink {
  background: none; border: none; cursor: pointer; padding: 0;
  color: var(--hep-rose); font-size: 0.85rem; font-weight: 600;
}
.hep-signin-line { text-align: center; color: var(--hep-dim); font-size: 0.85rem; margin: 0; }

/* podium */
.hep-podium {
  display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 0.7rem;
  align-items: end; margin-top: 0.4rem;
}
.hep-podium-col { display: flex; flex-direction: column; align-items: center; gap: 0.3rem; text-align: center; }
.hep-podium-medal { font-size: 1.5rem; }
.hep-podium-name { font-weight: 700; font-size: 0.88rem; }
.hep-podium-amt { font-family: var(--mono, monospace); font-size: 0.72rem; color: var(--hep-gold); }
.hep-podium-block { width: 100%; border-radius: 8px 8px 0 0; background: linear-gradient(180deg, rgba(201,168,106,0.35), rgba(201,168,106,0.08)); }
.hep-podium-1 .hep-podium-block { height: 74px; }
.hep-podium-2 .hep-podium-block { height: 50px; opacity: 0.8; }
.hep-podium-3 .hep-podium-block { height: 36px; opacity: 0.65; }
.hep-podium-compact .hep-podium-block { display: none; }
.hep-podium-compact { align-items: center; }

/* stats band */
.hep-stats {
  display: flex; gap: 0.5rem 1.6rem; flex-wrap: wrap; justify-content: center;
  font-family: var(--mono, monospace); font-size: 0.74rem; color: var(--hep-dim);
  padding-top: 0.9rem; border-top: 1px solid var(--hep-border);
}
.hep-stats strong { color: var(--hep-sec); font-weight: 600; }

/* wrapped card */
.hep-wrapped {
  border: 1px solid rgba(232,198,184,0.22); border-radius: 14px;
  background: linear-gradient(120deg, rgba(217,212,202,0.05), rgba(232,198,184,0.07) 45%, rgba(201,168,106,0.05)), var(--hep-elev);
  padding: 1.4rem 1.5rem; display: flex; flex-direction: column; gap: 0.9rem;
}
.hep-wrapped-rank { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; }
.hep-wrapped-num {
  font-size: 2.6rem; font-weight: 800; letter-spacing: -0.03em;
  background: var(--hep-grad);
  -webkit-background-clip: text; background-clip: text; color: transparent;
  font-variant-numeric: tabular-nums;
}
.hep-wrapped-meta { color: var(--hep-sec); font-size: 0.9rem; line-height: 1.5; }
.hep-wrapped-meta strong { color: var(--hep-text); }
.hep-badge-row { display: flex; gap: 0.5rem; flex-wrap: wrap; }
.hep-badge {
  font-size: 0.76rem; font-weight: 600; color: var(--hep-text);
  border: 1px solid var(--hep-border); border-radius: 999px;
  background: rgba(255,255,255,0.03); padding: 0.3rem 0.7rem;
}
.hep-mini-leagues { display: flex; flex-direction: column; gap: 0.35rem; }
.hep-mini-league {
  display: flex; justify-content: space-between; gap: 1rem;
  font-size: 0.86rem; padding: 0.45rem 0.6rem;
  background: rgba(255,255,255,0.02); border: 1px solid var(--hep-border); border-radius: 8px;
}
.hep-mini-rank { font-family: var(--mono, monospace); font-size: 0.74rem; color: var(--hep-sec); }

/* winners mini row + tiles */
.hep-winners-mini { display: flex; flex-direction: column; gap: 0.55rem; }
.hep-winners-mini-row { display: flex; gap: 0.5rem 0.8rem; flex-wrap: wrap; align-items: center; }
.hep-winner-chip {
  font-size: 0.8rem; font-weight: 600;
  border: 1px solid rgba(201,168,106,0.3); border-radius: 999px;
  padding: 0.32rem 0.75rem; background: rgba(201,168,106,0.06);
}
.hep-tile-row { display: grid; grid-template-columns: 1fr 1fr; gap: 0.7rem; }
.hep-tile {
  border: 1px solid var(--hep-border); border-radius: 12px;
  background: var(--hep-elev); color: var(--hep-text); cursor: pointer;
  font-weight: 700; font-size: 0.9rem; padding: 1rem;
}
.hep-tile:hover { border-color: rgba(232,198,184,0.4); }

/* next seasons */
.hep-next {
  border-top: 1px solid var(--hep-border); padding-top: 1.3rem;
  display: flex; flex-direction: column; gap: 0.9rem;
}
.hep-next-head p { margin: 0.35rem 0 0; color: var(--hep-sec); font-size: 0.88rem; }
.hep-next-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.7rem; }
.hep-next-card {
  display: flex; flex-direction: column; gap: 0.25rem;
  border: 1px solid var(--hep-border); border-radius: 12px;
  background: rgba(255,255,255,0.02); padding: 0.85rem 0.9rem;
}
.hep-next-emoji { font-size: 1.15rem; }
.hep-next-name { font-weight: 700; font-size: 0.85rem; }
.hep-next-when { font-family: var(--mono, monospace); font-size: 0.68rem; color: var(--hep-dim); }
.hep-notify { display: flex; gap: 0.6rem; flex-wrap: wrap; }
.hep-notify-hero { margin-top: 0.2rem; }
.hep-input {
  flex: 1; min-width: 200px;
  background: var(--hep-elev); border: 1px solid var(--hep-border); border-radius: 999px;
  padding: 0.68rem 1.1rem; color: var(--hep-text); font: inherit; font-size: 0.9rem;
}
.hep-input::placeholder { color: var(--hep-dim); }

/* proof band (variant C) */
.hep-proof-band {
  border: 1px solid var(--hep-border); border-radius: 14px;
  background: var(--hep-elev); padding: 1.1rem 1.2rem;
  display: flex; flex-direction: column; gap: 0.8rem;
}
.hep-proof-band .hep-stats { border-top: none; padding-top: 0; justify-content: flex-start; }

/* tip + survey two-up */
.hep-two-up { display: grid; grid-template-columns: 1fr 1fr; gap: 0.8rem; }
.hep-side-card {
  border: 1px solid var(--hep-border); border-radius: 12px;
  background: var(--hep-elev); padding: 1rem 1.1rem;
  display: flex; flex-direction: column; gap: 0.6rem; align-items: flex-start;
}
.hep-side-copy { margin: 0; color: var(--hep-sec); font-size: 0.84rem; line-height: 1.5; }
.hep-vote-row { display: flex; gap: 0.4rem; flex-wrap: wrap; }
.hep-vote {
  border: 1px solid var(--hep-border); border-radius: 999px;
  background: transparent; color: var(--hep-text); cursor: pointer;
  font-size: 0.8rem; font-weight: 600; padding: 0.35rem 0.8rem;
}
.hep-vote:hover { border-color: rgba(232,198,184,0.45); }

@media (max-width: 640px) {
  .hep-home { padding: 1.5rem 1.1rem; }
  .hep-next-grid { grid-template-columns: 1fr; }
  .hep-two-up { grid-template-columns: 1fr; }
  .hep-tile-row { grid-template-columns: 1fr; }
}
`;
