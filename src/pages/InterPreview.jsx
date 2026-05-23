/**
 * InterPreview — multi-font typography preview.
 *
 * Rendered at /__inter-preview-7q4m9 (kept this URL stable since
 * yesterday's merge already cached it). Compares the current
 * Space Grotesk + Chakra Petch stack against seven candidate
 * variable-font swaps:
 *
 *   1. Inter (Polymarket-style)
 *   2. Geist (Vercel-style)
 *   3. Manrope
 *   4. Plus Jakarta Sans
 *   5. Bricolage Grotesque
 *   6. Onest
 *   7. Outfit
 *
 * Each panel scopes the font via a per-font wrapper class — global
 * CSS variables and the rest of the site stay on Space Grotesk.
 *
 * Each panel also surfaces a "computed font-family" diagnostic so
 * the operator can verify what's actually being painted by the
 * browser (helpful when the visual difference is subtle).
 */

import React, { useEffect, useRef, useState } from 'react';
import '@fontsource-variable/inter';
import '@fontsource-variable/geist';
import '@fontsource-variable/manrope';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/onest';
import '@fontsource-variable/outfit';
import { Trophy, Users, Target, TrendingUp, Check } from 'lucide-react';

const FONTS = [
  {
    id: 'current',
    name: 'Current (Space Grotesk)',
    panelClass: 'ftp-font-current',
    note: 'What the site ships today. Space Grotesk for body / UI, Chakra Petch for display headings. Reference baseline.',
  },
  {
    id: 'inter',
    name: 'Inter',
    panelClass: 'ftp-font-inter',
    note: 'Polymarket and the broader fintech world. Very common, but for a reason — extremely legible at every size. Single-story "a" via cv11 feature.',
  },
  {
    id: 'geist',
    name: 'Geist',
    panelClass: 'ftp-font-geist',
    note: "Vercel's typeface. Developer-coded vibe. Crisper feel than Inter at headline sizes, more personality in numerals.",
  },
  {
    id: 'manrope',
    name: 'Manrope',
    panelClass: 'ftp-font-manrope',
    note: 'Friendly rounded geometric. Warmer than Inter. Good fit for a casual / social product like a friend-group bracket pool.',
  },
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    panelClass: 'ftp-font-jakarta',
    note: 'Indonesian foundry. Geometric with subtle personality — sharper terminals, slightly tighter spacing than Inter. Strong, confident headers.',
  },
  {
    id: 'bricolage',
    name: 'Bricolage Grotesque',
    panelClass: 'ftp-font-bricolage',
    note: 'Variable across optical sizes and width. Distinctive, slightly hand-drawn feel. High-personality option — your hero would look unlike anyone else.',
  },
  {
    id: 'onest',
    name: 'Onest',
    panelClass: 'ftp-font-onest',
    note: 'Released late 2023. Screen-optimized, slightly higher x-height than Inter. Crisp at small sizes — good for stat-heavy leaderboards.',
  },
  {
    id: 'outfit',
    name: 'Outfit',
    panelClass: 'ftp-font-outfit',
    note: 'Rounded geometric. Contemporary, optimistic. Less common than Inter but lands on the same axis of "modern sans".',
  },
];

// Distinctive characters that vary most between typefaces.
const ICONIC_GLYPHS = 'a g I l 1 0 & R Q ?';

export default function InterPreview() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const prev = document.title;
    document.title = 'Typography Preview · GoalOracle';
    return () => { document.head.removeChild(meta); document.title = prev; };
  }, []);

  return (
    <div className="ftp-wrapper">
      <div className="ftp-banner">
        <strong>Typography preview — 7 font options</strong>
        <span>Each panel below is the same mock content rendered in a different variable font. The rest of the site is unchanged — visit <a href="/">/ </a> in another tab for the live baseline.</span>
      </div>

      {FONTS.map((f) => <FontPanel key={f.id} font={f} />)}

      <div className="ftp-footer">
        <p>
          <strong>How to read this page.</strong> The most reliable test of a font is
          the &ldquo;Iconic glyphs&rdquo; row in each panel — characters like <code>a g I l 1 0</code> vary
          most between typefaces. The &ldquo;Computed font&rdquo; line below each panel name shows
          exactly which font-family the browser actually painted, so you can confirm
          the font loaded correctly even when the visual difference is subtle.
        </p>
      </div>
    </div>
  );
}

function FontPanel({ font }) {
  const ref = useRef(null);
  const [computed, setComputed] = useState('checking…');

  useEffect(() => {
    if (!ref.current) return;
    // Read the actually-painted font-family. If the variable font failed
    // to load, the browser falls back to the next item in the stack and
    // this string will show that instead — instant diagnostic.
    const cs = window.getComputedStyle(ref.current);
    setComputed(cs.fontFamily);
  }, []);

  return (
    <section className={`ftp-panel ${font.panelClass}`} ref={ref}>
      <header className="ftp-panel-head">
        <div>
          <h2 className="ftp-panel-title">{font.name}</h2>
          <p className="ftp-panel-note">{font.note}</p>
        </div>
        <div className="ftp-panel-diag" aria-label="computed font-family">
          <span className="ftp-diag-label">Computed font</span>
          <code className="ftp-diag-value">{computed}</code>
        </div>
      </header>

      <div className="ftp-glyphs-row">
        <span className="ftp-glyphs-label">Iconic glyphs</span>
        <span className="ftp-glyphs-sample">{ICONIC_GLYPHS}</span>
      </div>

      <div className="ftp-mock">
        <div className="ftp-mock-hero">
          <p className="ftp-eyebrow">FREE TO ENTER · WORLD CUP 2026</p>
          <h1 className="ftp-title">
            Predict the World Cup.
            <span className="ftp-title-hl">Win up to $150 in free prizes.</span>
          </h1>
          <p className="ftp-sub">Free skill-based prediction contest. Top 3 finishers win cash prizes paid in stablecoin.</p>
          <div className="ftp-cta-row">
            <button type="button" className="ftp-btn ftp-btn-primary">
              <Trophy size={15} /> Play Free
            </button>
            <button type="button" className="ftp-btn ftp-btn-secondary">
              <Users size={15} /> Create a League
            </button>
          </div>
        </div>

        <div className="ftp-mock-card">
          <h3 className="ftp-card-title">The Office Bracket</h3>
          <p className="ftp-card-sub">12 members · World Cup 2026</p>
          <ul className="ftp-leaderboard">
            <li><span className="ftp-rank">1</span><span className="ftp-player">Alex K.</span><span className="ftp-score">1,247</span></li>
            <li className="ftp-row-you"><span className="ftp-rank">2</span><span className="ftp-player">YOU</span><span className="ftp-score">1,119</span></li>
            <li><span className="ftp-rank">3</span><span className="ftp-player">Jordan M.</span><span className="ftp-score">987</span></li>
            <li><span className="ftp-rank">4</span><span className="ftp-player">Sam T.</span><span className="ftp-score">874</span></li>
          </ul>
        </div>

        <div className="ftp-weights">
          <div className="ftp-weight-row"><span className="ftp-weight-label">400 · Regular</span><span style={{ fontWeight: 400 }}>The quick brown fox jumps over the lazy dog. 1234567890</span></div>
          <div className="ftp-weight-row"><span className="ftp-weight-label">500 · Medium</span><span style={{ fontWeight: 500 }}>The quick brown fox jumps over the lazy dog. 1234567890</span></div>
          <div className="ftp-weight-row"><span className="ftp-weight-label">600 · Semibold</span><span style={{ fontWeight: 600 }}>The quick brown fox jumps over the lazy dog. 1234567890</span></div>
          <div className="ftp-weight-row"><span className="ftp-weight-label">700 · Bold</span><span style={{ fontWeight: 700 }}>The quick brown fox jumps over the lazy dog. 1234567890</span></div>
        </div>

        <div className="ftp-features">
          <div className="ftp-feature"><Check size={14} /> 100% free</div>
          <div className="ftp-feature"><Check size={14} /> Skill-based</div>
          <div className="ftp-feature"><Check size={14} /> No purchase</div>
          <div className="ftp-feature"><Target size={14} /> 104 matches</div>
          <div className="ftp-feature"><TrendingUp size={14} /> Global ranking</div>
        </div>
      </div>
    </section>
  );
}
