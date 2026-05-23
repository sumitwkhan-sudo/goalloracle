/**
 * InterPreview — finalist typography showcase.
 *
 * Rendered at /__inter-preview-7q4m9. Narrowed to three candidates
 * (Manrope, Plus Jakarta Sans, Onest) per operator request. Each
 * panel renders real-feel surfaces lifted from across the actual
 * site so it's possible to imagine the font in context:
 *
 *   - Homepage hero (real copy)
 *   - Stat strip
 *   - Match prediction card (Brazil vs Morocco, real fixture)
 *   - Quick Picks group ranking
 *   - Leaderboard with 10 rows + tabs
 *   - FAQ excerpt with real questions
 *   - Settings rows
 *   - Privacy/legal body paragraph
 *
 * Same scoping discipline as before: per-font wrapper class
 * (.ftp-font-manrope, etc.) overrides font-family and the
 * --font / --font-display variables locally. Global theme stays
 * on Space Grotesk + Chakra Petch.
 *
 * "Computed font" chip still reads getComputedStyle so the
 * operator can verify what the browser actually painted.
 */

import React, { useEffect, useRef, useState } from 'react';
import '@fontsource-variable/manrope';
import '@fontsource-variable/plus-jakarta-sans';
import '@fontsource-variable/onest';
import {
  Trophy, Users, Target, TrendingUp, Shield, Check, ChevronRight,
  Globe, Flag, Lock, Pencil, LogOut,
} from 'lucide-react';

const FONTS = [
  {
    id: 'manrope',
    name: 'Manrope',
    panelClass: 'ftp-font-manrope',
    note: 'Friendly rounded geometric. Warmer than Inter — softer terminals, slightly bouncy. Reads as "approachable" rather than "fintech". Good fit if you want the brand to feel like a friend-group product more than a betting product.',
    strengths: 'Casual warmth · Soft headers · Readable body',
    cautions: 'Numerals are pleasant but not as authoritative as Plus Jakarta',
  },
  {
    id: 'jakarta',
    name: 'Plus Jakarta Sans',
    panelClass: 'ftp-font-jakarta',
    note: 'Indonesian foundry. Geometric with confident personality — sharper terminals than Inter, slightly tighter spacing. Headers feel decisive and athletic. Numerals have weight and presence.',
    strengths: 'Strong headers · Athletic feel · Authoritative numerals',
    cautions: 'Body text is slightly tighter — may want bumped line-height in dense copy',
  },
  {
    id: 'onest',
    name: 'Onest',
    panelClass: 'ftp-font-onest',
    note: 'Released late 2023. Screen-optimized with a higher x-height than Inter. Crisp at small sizes — leaderboard scores and stat chips stay legible when shrunk. Modern without trying too hard.',
    strengths: 'Excellent small-size legibility · Clean numerals · Underused',
    cautions: 'Less expressive at hero sizes — feels neutral rather than distinctive',
  },
];

const ICONIC_GLYPHS = 'a g I l 1 0 & R Q ?';

export default function InterPreview() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const prev = document.title;
    document.title = 'Typography Finalists · GoalOracle';
    return () => { document.head.removeChild(meta); document.title = prev; };
  }, []);

  return (
    <div className="ftp-wrapper">
      <div className="ftp-banner">
        <strong>Finalists: Manrope · Plus Jakarta Sans · Onest</strong>
        <span>Each panel below renders the same site surfaces in a different font. Live site is on Space Grotesk — open <a href="/">/ </a> in a second tab for the baseline.</span>
      </div>

      <nav className="ftp-jump">
        {FONTS.map((f) => (
          <a key={f.id} href={`#ftp-${f.id}`} className="ftp-jump-link">{f.name}</a>
        ))}
      </nav>

      {FONTS.map((f) => <FontPanel key={f.id} font={f} />)}

      <div className="ftp-footer">
        <p>
          <strong>Decision time.</strong> Pick the font that feels right for the surface
          you care most about &mdash; the homepage hero, the leaderboard, or the legal
          pages all have different demands. If you&apos;re torn between two, the
          tie-breaker is usually the numerals (leaderboard rows) and the small body
          copy (FAQ paragraphs).
        </p>
        <p>
          Each panel&apos;s <code>Computed font</code> chip shows exactly what the browser
          painted &mdash; useful if you want to confirm a font loaded vs. fell back to a
          system stack.
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
    setComputed(window.getComputedStyle(ref.current).fontFamily);
  }, []);

  return (
    <section id={`ftp-${font.id}`} className={`ftp-panel ${font.panelClass}`} ref={ref}>
      {/* Header */}
      <header className="ftp-panel-head">
        <div>
          <h2 className="ftp-panel-title">{font.name}</h2>
          <p className="ftp-panel-note">{font.note}</p>
          <p className="ftp-panel-tags">
            <span className="ftp-tag ftp-tag-good">{font.strengths}</span>
            <span className="ftp-tag ftp-tag-warn">Watch: {font.cautions}</span>
          </p>
        </div>
        <div className="ftp-panel-diag">
          <span className="ftp-diag-label">Computed font</span>
          <code className="ftp-diag-value">{computed}</code>
        </div>
      </header>

      {/* Glyphs */}
      <div className="ftp-glyphs-row">
        <span className="ftp-glyphs-label">Iconic glyphs</span>
        <span className="ftp-glyphs-sample">{ICONIC_GLYPHS}</span>
      </div>

      {/* ─── HERO ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">Homepage hero</p>
        <div className="ftp-hero">
          <p className="ftp-eyebrow">FREE TO ENTER · WORLD CUP 2026</p>
          <h1 className="ftp-hero-title">
            Predict the World Cup.
            <span className="ftp-hero-hl">Win up to $150 in free prizes.</span>
          </h1>
          <p className="ftp-hero-sub">Free skill-based prediction contest. Top 3 finishers win cash prizes paid in stablecoin.</p>
          <div className="ftp-cta-row">
            <button type="button" className="ftp-btn ftp-btn-primary"><Trophy size={15} /> Play Free</button>
            <button type="button" className="ftp-btn ftp-btn-secondary"><Users size={15} /> Create a League</button>
          </div>
        </div>
      </div>

      {/* ─── STAT STRIP ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">Stat strip</p>
        <div className="ftp-stats">
          <div className="ftp-stat">
            <div className="ftp-stat-num">12,478</div>
            <div className="ftp-stat-label">Players</div>
          </div>
          <div className="ftp-stat">
            <div className="ftp-stat-num">847</div>
            <div className="ftp-stat-label">Active Leagues</div>
          </div>
          <div className="ftp-stat">
            <div className="ftp-stat-num">$300</div>
            <div className="ftp-stat-label">Prize Pool</div>
          </div>
          <div className="ftp-stat">
            <div className="ftp-stat-num">26</div>
            <div className="ftp-stat-label">Days to Kickoff</div>
          </div>
        </div>
      </div>

      {/* ─── MATCH PREDICTION CARD ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">Match prediction card</p>
        <div className="ftp-match-card">
          <div className="ftp-match-meta">
            <span className="ftp-match-stage">GROUP C · MATCH 7</span>
            <span className="ftp-match-time">Sat Jun 13 · 18:00 ET · MetLife Stadium</span>
          </div>
          <div className="ftp-match-teams">
            <div className="ftp-team">
              <span className="ftp-team-flag" aria-hidden>🇧🇷</span>
              <span className="ftp-team-name">Brazil</span>
              <input className="ftp-score-input" defaultValue="2" inputMode="numeric" />
            </div>
            <div className="ftp-match-dash">vs</div>
            <div className="ftp-team ftp-team-right">
              <input className="ftp-score-input" defaultValue="1" inputMode="numeric" />
              <span className="ftp-team-name">Morocco</span>
              <span className="ftp-team-flag" aria-hidden>🇲🇦</span>
            </div>
          </div>
          <div className="ftp-match-footer">
            <span className="ftp-pts-pill">+5 pts on exact score</span>
            <span className="ftp-pts-pill ftp-pts-pill-muted">+3 pts on correct result</span>
          </div>
        </div>
      </div>

      {/* ─── QUICK PICKS GROUP RANKING ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">Quick Picks · Group ranking</p>
        <div className="ftp-group-card">
          <div className="ftp-group-head">
            <h3 className="ftp-group-title">Group A</h3>
            <span className="ftp-group-sub">Rank teams in your predicted finishing order</span>
          </div>
          <ol className="ftp-group-list">
            <li><span className="ftp-grp-rank">1</span><span className="ftp-grp-flag">🇲🇽</span><span className="ftp-grp-team">Mexico</span></li>
            <li><span className="ftp-grp-rank">2</span><span className="ftp-grp-flag">🇰🇷</span><span className="ftp-grp-team">South Korea</span></li>
            <li><span className="ftp-grp-rank">3</span><span className="ftp-grp-flag">🇨🇿</span><span className="ftp-grp-team">Czechia</span></li>
            <li><span className="ftp-grp-rank">4</span><span className="ftp-grp-flag">🇿🇦</span><span className="ftp-grp-team">South Africa</span></li>
          </ol>
          <div className="ftp-group-actions">
            <button type="button" className="ftp-btn ftp-btn-primary ftp-btn-sm"><Check size={14} /> Confirm Ranking</button>
            <button type="button" className="ftp-btn ftp-btn-secondary ftp-btn-sm">Reset</button>
          </div>
        </div>
      </div>

      {/* ─── LEADERBOARD ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">Leaderboard</p>
        <div className="ftp-lb">
          <div className="ftp-lb-tabs">
            <button type="button" className="ftp-lb-tab ftp-lb-tab-active">Global</button>
            <button type="button" className="ftp-lb-tab">Friends</button>
            <button type="button" className="ftp-lb-tab">My Country</button>
          </div>
          <table className="ftp-lb-table">
            <thead>
              <tr><th>Rank</th><th>Player</th><th>Country</th><th className="ftp-lb-right">Score</th><th className="ftp-lb-right">Δ</th></tr>
            </thead>
            <tbody>
              <tr><td>1</td><td>alexkim</td><td>🇺🇸</td><td className="ftp-lb-right ftp-tnum">1,247</td><td className="ftp-lb-right ftp-tnum ftp-pos">+12</td></tr>
              <tr><td>2</td><td>maradiv</td><td>🇦🇷</td><td className="ftp-lb-right ftp-tnum">1,219</td><td className="ftp-lb-right ftp-tnum ftp-pos">+8</td></tr>
              <tr className="ftp-lb-you"><td>3</td><td><strong>YOU</strong></td><td>🇨🇦</td><td className="ftp-lb-right ftp-tnum">1,187</td><td className="ftp-lb-right ftp-tnum ftp-pos">+15</td></tr>
              <tr><td>4</td><td>jordanmm</td><td>🇲🇽</td><td className="ftp-lb-right ftp-tnum">1,109</td><td className="ftp-lb-right ftp-tnum ftp-neg">-4</td></tr>
              <tr><td>5</td><td>tina_99</td><td>🇧🇷</td><td className="ftp-lb-right ftp-tnum">1,087</td><td className="ftp-lb-right ftp-tnum ftp-pos">+2</td></tr>
              <tr><td>6</td><td>nikoo</td><td>🇩🇪</td><td className="ftp-lb-right ftp-tnum">974</td><td className="ftp-lb-right ftp-tnum ftp-neg">-9</td></tr>
              <tr><td>7</td><td>sam_t</td><td>🇪🇸</td><td className="ftp-lb-right ftp-tnum">962</td><td className="ftp-lb-right ftp-tnum">—</td></tr>
              <tr><td>8</td><td>casey.r</td><td>🇫🇷</td><td className="ftp-lb-right ftp-tnum">948</td><td className="ftp-lb-right ftp-tnum ftp-pos">+1</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* ─── FAQ ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">FAQ</p>
        <div className="ftp-faq">
          <div className="ftp-faq-item">
            <h3 className="ftp-faq-q">Is GoalOracle free to play?</h3>
            <p className="ftp-faq-a">Yes. Free to enter. No purchase necessary to participate or win prizes. GoalOracle is a free skill-based prediction contest.</p>
          </div>
          <div className="ftp-faq-item">
            <h3 className="ftp-faq-q">What is a Quick Pick?</h3>
            <p className="ftp-faq-a">Quick Picks is GoalOracle&apos;s simple prediction mode. Instead of predicting every match, you rank the four teams within each group, choose the eight best third-placed teams, and then pick winners through the knockout bracket. The app fills in the rest. Takes about ten minutes.</p>
          </div>
          <div className="ftp-faq-item">
            <h3 className="ftp-faq-q">How does scoring work?</h3>
            <p className="ftp-faq-a">Classic Predictions awards 3 points for a correct result, 5 points for an exact score, plus 1 point for a correct extra time call and 2 for correct penalty shootout prediction. Quick Picks totals 76 points: 36 from group rankings, 8 from best-thirds selections, and 32 across the knockout rounds.</p>
          </div>
        </div>
      </div>

      {/* ─── SETTINGS ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">League settings</p>
        <div className="ftp-settings">
          <h3 className="ftp-settings-title">The Office Bracket</h3>
          <div className="ftp-set-row"><span className="ftp-set-label">Visibility</span><span className="ftp-set-val"><Lock size={14} /> Private</span></div>
          <div className="ftp-set-row"><span className="ftp-set-label">Passcode</span><code className="ftp-set-code">BUFO</code></div>
          <div className="ftp-set-row"><span className="ftp-set-label">Created by</span><span className="ftp-set-val">You · May 12, 2026</span></div>
          <div className="ftp-set-row"><span className="ftp-set-label">Members</span><span className="ftp-set-val">12 active</span></div>
          <div className="ftp-set-row"><span className="ftp-set-label">Mode</span><span className="ftp-set-val">Quick Picks</span></div>
          <div className="ftp-set-actions">
            <button type="button" className="ftp-btn ftp-btn-secondary ftp-btn-sm"><Pencil size={14} /> Edit House Rules</button>
            <button type="button" className="ftp-btn ftp-btn-danger ftp-btn-sm"><LogOut size={14} /> Leave League</button>
          </div>
        </div>
      </div>

      {/* ─── LEGAL PARAGRAPH ─── */}
      <div className="ftp-section">
        <p className="ftp-section-label">Privacy policy paragraph</p>
        <div className="ftp-legal">
          <h3 className="ftp-legal-h3">5. Cookies, pixels, and similar technologies</h3>
          <p className="ftp-legal-p">
            We and our service providers use cookies, pixels, local storage, and similar
            technologies to operate the Service. The categories in use are: <strong>strictly necessary</strong>{' '}
            (session and authentication cookies set by Privy and Firebase &mdash; these
            cannot be turned off without breaking the sign-in flow); <strong>analytics</strong>{' '}
            (Google Analytics 4, PostHog, and Microsoft Clarity help us understand which
            features are used and where users get stuck); and <strong>advertising</strong>{' '}
            (AdRoll, Meta, and Reddit pixels measure ad campaigns and show GoalOracle
            ads to people who&apos;ve visited the site). You can opt out via industry tools
            at <a href="#" className="ftp-link">optout.aboutads.info</a>,{' '}
            <a href="#" className="ftp-link">networkadvertising.org/choices</a>, or by
            enabling Global Privacy Control in your browser.
          </p>
          <a href="#" className="ftp-legal-cta"><ChevronRight size={14} /> Read full Privacy Policy</a>
        </div>
      </div>
    </section>
  );
}
