/**
 * InterPreview — typography preview page for the proposed Inter
 * (Polymarket-style) typography swap.
 *
 * Rendered at the obscure URL /__inter-preview-7q4m9 (noindex,
 * nofollow). Lets the operator see what the existing site copy
 * looks like rendered with Inter at the four target weights, side
 * by side with a comparable current-typography panel for a real
 * before/after.
 *
 * IMPORTANT: Inter is scoped to this page only via CSS-variable
 * overrides inside .inter-preview-page. The rest of the site
 * continues to use Space Grotesk + Chakra Petch + JetBrains Mono.
 * Deleting this file + its route in goaloracle.jsx fully reverses
 * the experiment.
 *
 * The font is imported once at the top of this module; Vite
 * code-splits it so the rest of the app pays no bundle cost.
 */

import React, { useEffect } from 'react';
import '@fontsource-variable/inter';
import { Trophy, Users, Target, TrendingUp, Shield, Check } from 'lucide-react';

const SAMPLE_HERO_TITLE = 'Predict the World Cup.';
const SAMPLE_HERO_HIGHLIGHT = 'Win up to $150 in free prizes.';
const SAMPLE_SUB = 'Free skill-based prediction contest. Top 3 finishers win cash prizes paid in stablecoin.';
const SAMPLE_BODY = 'GoalOracle is a free, skill-based prediction game tied to the 2026 FIFA World Cup. Build a bracket — rank each group, pick best third-placed teams, then fill the knockout rounds — and score points based on how accurately your predictions match real results. The top 3 finishers on the global leaderboard at the end of the tournament receive prizes paid in USDC stablecoin.';

export default function InterPreview() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const prevTitle = document.title;
    document.title = 'Inter Typography Preview · GoalOracle';
    return () => {
      document.head.removeChild(meta);
      document.title = prevTitle;
    };
  }, []);

  return (
    <div className="inter-preview-wrapper">
      <div className="inter-preview-banner">
        <strong>Inter typography preview</strong>
        <span>Scoped to this page only — the rest of the site is unchanged. Compare side-by-side: <a href="/">/ (current)</a></span>
      </div>

      <div className="inter-preview-grid">
        <PreviewColumn label="Current" className="inter-preview-current" />
        <PreviewColumn label="Inter (proposed)" className="inter-preview-page" />
      </div>

      <div className="inter-preview-detail inter-preview-page">
        <h2 className="ipd-title">Weight hierarchy</h2>
        <p className="ipd-sub">All four weights from a single variable font. Same color tokens, same spacing.</p>
        <div className="ipd-weights">
          <div className="ipd-weight-row">
            <span className="ipd-weight-label">Regular · 400</span>
            <span className="ipd-weight-sample" style={{ fontWeight: 400 }}>Body text, paragraphs, secondary copy.</span>
          </div>
          <div className="ipd-weight-row">
            <span className="ipd-weight-label">Medium · 500</span>
            <span className="ipd-weight-sample" style={{ fontWeight: 500 }}>UI labels, table headers, secondary headings.</span>
          </div>
          <div className="ipd-weight-row">
            <span className="ipd-weight-label">Semibold · 600</span>
            <span className="ipd-weight-sample" style={{ fontWeight: 600 }}>Buttons, emphasis, card titles, navigation.</span>
          </div>
          <div className="ipd-weight-row">
            <span className="ipd-weight-label">Bold · 700</span>
            <span className="ipd-weight-sample" style={{ fontWeight: 700 }}>Page headings, hero text, key prize callouts.</span>
          </div>
        </div>

        <h2 className="ipd-title" style={{ marginTop: '2rem' }}>Numerals (tabular)</h2>
        <p className="ipd-sub">Inter&apos;s tabular figures keep leaderboard scores aligned column-to-column.</p>
        <div className="ipd-numbers">
          <div className="ipd-num-row"><span className="ipd-num-rank">1</span><span className="ipd-num-name">Alex K.</span><span className="ipd-num-score" style={{ fontVariantNumeric: 'tabular-nums' }}>1,247</span></div>
          <div className="ipd-num-row"><span className="ipd-num-rank">2</span><span className="ipd-num-name">YOU</span><span className="ipd-num-score" style={{ fontVariantNumeric: 'tabular-nums' }}>1,119</span></div>
          <div className="ipd-num-row"><span className="ipd-num-rank">3</span><span className="ipd-num-name">Jordan M.</span><span className="ipd-num-score" style={{ fontVariantNumeric: 'tabular-nums' }}>987</span></div>
          <div className="ipd-num-row"><span className="ipd-num-rank">4</span><span className="ipd-num-name">Sam T.</span><span className="ipd-num-score" style={{ fontVariantNumeric: 'tabular-nums' }}>74</span></div>
        </div>
      </div>
    </div>
  );
}

function PreviewColumn({ label, className }) {
  return (
    <div className={`inter-preview-col ${className}`}>
      <div className="inter-preview-col-label">{label}</div>

      <div className="ipc-hero">
        <p className="ipc-eyebrow">FREE TO ENTER · WORLD CUP 2026</p>
        <h1 className="ipc-title">
          {SAMPLE_HERO_TITLE}
          <span className="ipc-title-highlight">{SAMPLE_HERO_HIGHLIGHT}</span>
        </h1>
        <p className="ipc-subtitle">{SAMPLE_SUB}</p>
        <div className="ipc-cta-row">
          <button type="button" className="ipc-btn ipc-btn-primary">
            <Trophy size={16} /> Play Free
          </button>
          <button type="button" className="ipc-btn ipc-btn-secondary">
            <Users size={16} /> Create a League
          </button>
        </div>
      </div>

      <div className="ipc-section">
        <h2 className="ipc-h2">How it works</h2>
        <p className="ipc-body">{SAMPLE_BODY}</p>
      </div>

      <div className="ipc-tabs">
        <button type="button" className="ipc-tab ipc-tab-active"><Target size={14} /> Predictions</button>
        <button type="button" className="ipc-tab"><TrendingUp size={14} /> Leaderboard</button>
        <button type="button" className="ipc-tab"><Shield size={14} /> Rules</button>
      </div>

      <div className="ipc-card">
        <div className="ipc-card-head">
          <h3 className="ipc-card-title">The Office Bracket</h3>
          <span className="ipc-card-sub">12 members · World Cup 2026</span>
        </div>
        <ul className="ipc-list">
          <li><span className="ipc-list-num">1</span> Alex K. <span className="ipc-list-score">127 pts</span></li>
          <li className="ipc-list-you"><span className="ipc-list-num">2</span> YOU <span className="ipc-list-score">119 pts</span></li>
          <li><span className="ipc-list-num">3</span> Jordan M. <span className="ipc-list-score">98 pts</span></li>
        </ul>
      </div>

      <div className="ipc-features">
        <div className="ipc-feature"><Check size={14} /> 100% free to play</div>
        <div className="ipc-feature"><Check size={14} /> Skill-based scoring</div>
        <div className="ipc-feature"><Check size={14} /> Private leagues</div>
      </div>
    </div>
  );
}
