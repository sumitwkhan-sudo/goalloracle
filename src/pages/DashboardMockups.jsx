/**
 * Throwaway preview page for evaluating four dashboard design directions.
 * Mounted at ?mock=1 — does not touch auth, routing, or live data.
 *
 * Each mock uses the same hardcoded sample state so direction comparisons
 * are about layout and hierarchy, not data.
 *
 * Tabs: A (Terminal), B (Trader), C (Live Pulse), Mix.
 */

import React, { useState } from 'react';
import {
  Trophy, Flame, ArrowUp, ArrowDown, Lock, Zap, ChevronRight,
  CheckCircle, X, Star, Target, Users, TrendingUp, Sparkles,
} from 'lucide-react';

// ───────────────────────────── sample data ─────────────────────────────
const ME = {
  rank: 44,
  rankPrev: 47,
  rankTotal: 1247,
  points: 2148,
  accuracy: 78,
  level: 14,
  levelTitle: 'Tactician',
  streak: 7,
  bestStreak: 12,
};
const NEXT_LOCK = {
  home: 'Brazil',
  homeFlag: '🇧🇷',
  away: 'Argentina',
  awayFlag: '🇦🇷',
  myPick: 'Brazil 2-1',
  myPickPct: 18,
  closesIn: '3h 12m',
};
const LIVE = {
  home: 'Mexico', homeFlag: '🇲🇽', homeScore: 1,
  away: 'South Africa', awayFlag: '🇿🇦', awayScore: 0,
  minute: 62,
  myPick: 'Mexico',
  alive: true,
};
const RECENT = [
  { home: 'France', away: 'Croatia', score: '2-1', myResult: 'correct', pts: 5, when: 'Yesterday' },
  { home: 'Spain', away: 'Italy', score: '0-0', myResult: 'wrong', pts: 0, when: '2d ago' },
  { home: 'Germany', away: 'Japan', score: '3-2', myResult: 'correct', pts: 3, when: '3d ago' },
];
const INSIGHTS = [
  { kind: 'boldest', label: 'Boldest call', body: 'France to win their QF', detail: 'Only 12% of brackets agree.', tone: 'violet' },
  { kind: 'contested', label: 'Most contested', body: 'Spain vs Germany QF', detail: '51% Spain, 49% Germany.', tone: 'amber' },
  { kind: 'survival', label: 'Bracket survival', body: '28 of 32 R32 picks alive', detail: 'You started with 100%.', tone: 'cyan' },
];
const FRIENDS = [
  { name: 'Aniruddh', delta: +2, rank: 18 },
  { name: 'Maya', delta: -1, rank: 31 },
  { name: 'Carlos', delta: 0, rank: 52 },
];

// ─────────────────────────── shared atoms ──────────────────────────────
const RankDelta = ({ from, to }) => {
  const d = from - to; // positive = improved
  if (d === 0) return <span className="mk-delta mk-delta-flat">— flat</span>;
  if (d > 0) return <span className="mk-delta mk-delta-up"><ArrowUp size={11} />+{d}</span>;
  return <span className="mk-delta mk-delta-down"><ArrowDown size={11} />{d}</span>;
};

const Pill = ({ children, tone = 'default' }) => (
  <span className={`mk-pill mk-pill-${tone}`}>{children}</span>
);

// ───────────────────────────── A · TERMINAL ─────────────────────────────
function MockA() {
  return (
    <div className="mk-a">
      {/* dense top strip — no greeting, no padding fluff */}
      <div className="mk-a-strip">
        <div className="mk-a-strip-cell mk-a-strip-cell-rank">
          <span className="mk-a-label">Global rank</span>
          <span className="mk-a-rank">#{ME.rank}</span>
          <RankDelta from={ME.rankPrev} to={ME.rank} />
          <span className="mk-a-of">of {ME.rankTotal.toLocaleString()}</span>
        </div>
        <div className="mk-a-strip-cell"><span className="mk-a-label">Points</span><span className="mk-a-num">{ME.points.toLocaleString()}</span></div>
        <div className="mk-a-strip-cell"><span className="mk-a-label">Accuracy</span><span className="mk-a-num">{ME.accuracy}%</span></div>
        <div className="mk-a-strip-cell"><span className="mk-a-label">Streak</span><span className="mk-a-num"><Flame size={14} /> {ME.streak}</span></div>
        <div className="mk-a-strip-cell"><span className="mk-a-label">Level</span><span className="mk-a-num">L{ME.level} · {ME.levelTitle}</span></div>
        <div className="mk-a-strip-cell"><span className="mk-a-label">QP</span><span className="mk-a-num mk-a-ok">●  Locked</span></div>
      </div>

      <div className="mk-a-grid">
        {/* left pane: time-sensitive */}
        <div className="mk-a-pane">
          <div className="mk-a-row mk-a-lock">
            <Lock size={14} className="mk-a-row-icon" />
            <div className="mk-a-row-body">
              <div className="mk-a-row-title">{NEXT_LOCK.homeFlag} {NEXT_LOCK.home} <span className="mk-a-vs">vs</span> {NEXT_LOCK.awayFlag} {NEXT_LOCK.away}</div>
              <div className="mk-a-row-sub">Locks in <strong>{NEXT_LOCK.closesIn}</strong> · Your pick: <strong>{NEXT_LOCK.myPick}</strong> · {NEXT_LOCK.myPickPct}% chose this score</div>
            </div>
            <button className="mk-a-row-cta">Predict <ChevronRight size={12} /></button>
          </div>
          <div className="mk-a-row mk-a-live">
            <Zap size={14} className="mk-a-row-icon" />
            <div className="mk-a-row-body">
              <div className="mk-a-row-title">{LIVE.homeFlag} {LIVE.home} <strong>{LIVE.homeScore}</strong>—<strong>{LIVE.awayScore}</strong> {LIVE.away} {LIVE.awayFlag} <span className="mk-a-min">{LIVE.minute}'</span></div>
              <div className="mk-a-row-sub">Your pick: <strong>{LIVE.myPick}</strong> · <span className="mk-a-ok">●  alive</span></div>
            </div>
          </div>
          <div className="mk-a-resultsblock">
            <div className="mk-a-section-label">Recent · last 5</div>
            <div className="mk-a-dots">
              {['c','c','w','c','c'].map((r, i) => <span key={i} className={`mk-a-dot mk-a-dot-${r}`}>{r === 'c' ? '✓' : '✗'}</span>)}
              <span className="mk-a-dotcap">7-day streak · best 12</span>
            </div>
            <div className="mk-a-recent">
              {RECENT.map((r, i) => (
                <div key={i} className="mk-a-recent-row">
                  <span className="mk-a-recent-when">{r.when}</span>
                  <span className="mk-a-recent-match">{r.home} {r.score} {r.away}</span>
                  <span className={`mk-a-recent-pts mk-a-recent-${r.myResult}`}>+{r.pts}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* right pane: insights — full pane on desktop */}
        <div className="mk-a-pane mk-a-pane-side">
          <div className="mk-a-section-label">Insights · 3 active</div>
          {INSIGHTS.map((ins, i) => (
            <div key={i} className={`mk-a-ins mk-a-ins-${ins.tone}`}>
              <div className="mk-a-ins-head">
                <span className="mk-a-ins-kind">{ins.label}</span>
              </div>
              <div className="mk-a-ins-body">{ins.body}</div>
              <div className="mk-a-ins-detail">{ins.detail}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="mk-a-bottom">
        <div className="mk-a-bottom-cell">
          <span className="mk-a-section-label">Friends</span>
          <div className="mk-a-friends">
            {FRIENDS.map((f, i) => (
              <div key={i} className="mk-a-friend">
                <span className="mk-a-friend-name">{f.name}</span>
                <span className="mk-a-friend-rank">#{f.rank}</span>
                <RankDelta from={f.rank + f.delta} to={f.rank} />
              </div>
            ))}
          </div>
        </div>
        <div className="mk-a-bottom-cell">
          <span className="mk-a-section-label">Your leagues</span>
          <div className="mk-a-leagues">
            <div className="mk-a-league">Global · #{ME.rank}/{ME.rankTotal}</div>
            <div className="mk-a-league">Office · #4/12</div>
            <div className="mk-a-league">Family · #2/8</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── B · TRADER ─────────────────────────────
function MockB() {
  return (
    <div className="mk-b">
      {/* hero */}
      <div className="mk-b-hero">
        <div className="mk-b-hero-stripe mk-b-hero-stripe-up" />
        <div className="mk-b-hero-body">
          <div className="mk-b-hero-rank">
            <span className="mk-b-hero-rank-label">Global rank</span>
            <div className="mk-b-hero-rank-num">#{ME.rank}</div>
            <RankDelta from={ME.rankPrev} to={ME.rank} />
            <span className="mk-b-hero-of">of {ME.rankTotal.toLocaleString()}</span>
          </div>
          <div className="mk-b-hero-stats">
            <div><span className="mk-b-hero-stat-label">Points</span><span className="mk-b-hero-stat-val">{ME.points.toLocaleString()}</span></div>
            <div><span className="mk-b-hero-stat-label">Accuracy</span><span className="mk-b-hero-stat-val">{ME.accuracy}%</span></div>
            <div><span className="mk-b-hero-stat-label">Level</span><span className="mk-b-hero-stat-val">L{ME.level}</span></div>
            <div><span className="mk-b-hero-stat-label">Streak</span><span className="mk-b-hero-stat-val"><Flame size={14} /> {ME.streak}</span></div>
          </div>
        </div>
      </div>

      <div className="mk-b-grid">
        {/* main column */}
        <div className="mk-b-main">
          <div className="mk-b-lock">
            <div className="mk-b-lock-eyebrow"><Lock size={12} /> Locks in {NEXT_LOCK.closesIn}</div>
            <div className="mk-b-lock-title">{NEXT_LOCK.homeFlag} {NEXT_LOCK.home} <span className="mk-b-vs">vs</span> {NEXT_LOCK.awayFlag} {NEXT_LOCK.away}</div>
            <div className="mk-b-lock-sub">Your pick: <strong>{NEXT_LOCK.myPick}</strong> · <Pill tone="violet">{NEXT_LOCK.myPickPct}% picked</Pill></div>
            <div className="mk-b-lock-actions">
              <button className="mk-b-cta-pri">Predict <ChevronRight size={14} /></button>
              <button className="mk-b-cta-sec">Skip</button>
            </div>
          </div>

          <div className="mk-b-live">
            <div className="mk-b-live-eyebrow"><Zap size={12} /> Live · {LIVE.minute}'</div>
            <div className="mk-b-live-score">
              <span>{LIVE.homeFlag} {LIVE.home}</span>
              <strong>{LIVE.homeScore}–{LIVE.awayScore}</strong>
              <span>{LIVE.away} {LIVE.awayFlag}</span>
            </div>
            <div className="mk-b-live-sub">Your pick: <strong>{LIVE.myPick}</strong> · <span className="mk-b-ok">alive</span></div>
          </div>

          <div className="mk-b-section">
            <h3 className="mk-b-section-title">Recent results</h3>
            <div className="mk-b-recent">
              {RECENT.map((r, i) => (
                <div key={i} className={`mk-b-recent-row mk-b-recent-${r.myResult}`}>
                  <span className="mk-b-recent-when">{r.when}</span>
                  <span className="mk-b-recent-match">{r.home} <strong>{r.score}</strong> {r.away}</span>
                  <span className="mk-b-recent-pts">+{r.pts}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* insights rail */}
        <aside className="mk-b-rail">
          <div className="mk-b-rail-head">Insights</div>
          {INSIGHTS.map((ins, i) => (
            <div key={i} className={`mk-b-ins mk-b-ins-${ins.tone}`}>
              <div className="mk-b-ins-kind">{ins.label}</div>
              <div className="mk-b-ins-body">{ins.body}</div>
              <div className="mk-b-ins-detail">{ins.detail}</div>
            </div>
          ))}
          <div className="mk-b-rail-foot">More insights as the tournament unfolds →</div>
        </aside>
      </div>

      <div className="mk-b-belowfold">
        <div className="mk-b-strip-row">
          <span className="mk-b-strip-label">Friends</span>
          {FRIENDS.map((f, i) => (
            <span key={i} className="mk-b-friend-chip">
              {f.name} #{f.rank} <RankDelta from={f.rank + f.delta} to={f.rank} />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── C · LIVE PULSE ─────────────────────────────
function MockC() {
  return (
    <div className="mk-c">
      <div className="mk-c-statsbar">
        <span>#{ME.rank}<RankDelta from={ME.rankPrev} to={ME.rank} /></span>
        <span>{ME.points.toLocaleString()} pts</span>
        <span>{ME.accuracy}%</span>
        <span><Flame size={12} /> {ME.streak}</span>
        <span>L{ME.level}</span>
      </div>

      <div className="mk-c-stream">
        {/* Each event row: time-sensitive state with insight inline as annotation */}
        <div className="mk-c-event mk-c-event-lock">
          <div className="mk-c-event-icon"><Lock size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">{NEXT_LOCK.homeFlag} {NEXT_LOCK.home} vs {NEXT_LOCK.awayFlag} {NEXT_LOCK.away}</div>
            <div className="mk-c-event-meta">Locks in <strong>{NEXT_LOCK.closesIn}</strong> · Your pick: <strong>{NEXT_LOCK.myPick}</strong></div>
            <div className="mk-c-event-insight"><Sparkles size={11} /> Only <strong>{NEXT_LOCK.myPickPct}%</strong> of brackets picked this score</div>
          </div>
          <button className="mk-c-event-cta">Predict</button>
        </div>

        <div className="mk-c-event mk-c-event-live">
          <div className="mk-c-event-icon"><Zap size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">{LIVE.homeFlag} {LIVE.home} <strong>{LIVE.homeScore}–{LIVE.awayScore}</strong> {LIVE.away} {LIVE.awayFlag}</div>
            <div className="mk-c-event-meta">{LIVE.minute}' · Your pick: <strong>{LIVE.myPick}</strong> <span className="mk-c-ok">alive</span></div>
          </div>
        </div>

        <div className="mk-c-event mk-c-event-rank">
          <div className="mk-c-event-icon"><TrendingUp size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">You moved up <strong>3 spots</strong> in Global</div>
            <div className="mk-c-event-meta">Now #{ME.rank} of {ME.rankTotal.toLocaleString()} · since yesterday</div>
            <div className="mk-c-event-insight"><Sparkles size={11} /> France's QF win bumped <strong>140 brackets</strong> below yours</div>
          </div>
        </div>

        <div className="mk-c-event mk-c-event-result">
          <div className="mk-c-event-icon mk-c-event-icon-ok"><CheckCircle size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">France 2-1 Croatia · You called it</div>
            <div className="mk-c-event-meta">+5 pts · 1d ago</div>
            <div className="mk-c-event-insight"><Sparkles size={11} /> <strong>Boldest call</strong> — only 12% picked France to win</div>
          </div>
        </div>

        <div className="mk-c-event mk-c-event-result mk-c-event-miss">
          <div className="mk-c-event-icon mk-c-event-icon-bad"><X size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">Spain 0-0 Italy · Wrong</div>
            <div className="mk-c-event-meta">0 pts · 2d ago</div>
          </div>
        </div>

        <div className="mk-c-event mk-c-event-friend">
          <div className="mk-c-event-icon"><Users size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">Aniruddh passed you in Office</div>
            <div className="mk-c-event-meta">They're #4, you're #5 · since yesterday</div>
          </div>
        </div>
      </div>

      <div className="mk-c-foot">No "view all insights" page — insights live where the events do.</div>
    </div>
  );
}

// ───────────────────────────── MIX ─────────────────────────────
// Trader hero (B) + Live Pulse stream (C) for time-sensitive zone +
// Insights as both inline annotations on stream rows AND a slim "discover"
// strip below the fold for non-urgent ones. Picks the strongest piece of
// each direction without inheriting their weaknesses.
function MockMix() {
  return (
    <div className="mk-mix">
      {/* B's hero */}
      <div className="mk-b-hero">
        <div className="mk-b-hero-stripe mk-b-hero-stripe-up" />
        <div className="mk-b-hero-body">
          <div className="mk-b-hero-rank">
            <span className="mk-b-hero-rank-label">Global rank</span>
            <div className="mk-b-hero-rank-num">#{ME.rank}</div>
            <RankDelta from={ME.rankPrev} to={ME.rank} />
            <span className="mk-b-hero-of">of {ME.rankTotal.toLocaleString()}</span>
          </div>
          <div className="mk-b-hero-stats">
            <div><span className="mk-b-hero-stat-label">Points</span><span className="mk-b-hero-stat-val">{ME.points.toLocaleString()}</span></div>
            <div><span className="mk-b-hero-stat-label">Accuracy</span><span className="mk-b-hero-stat-val">{ME.accuracy}%</span></div>
            <div><span className="mk-b-hero-stat-label">Level</span><span className="mk-b-hero-stat-val">L{ME.level}</span></div>
            <div><span className="mk-b-hero-stat-label">Streak</span><span className="mk-b-hero-stat-val"><Flame size={14} /> {ME.streak}</span></div>
          </div>
        </div>
      </div>

      {/* C's stream — time-sensitive only, no rank/friend events here */}
      <div className="mk-c-stream mk-mix-stream">
        <div className="mk-c-event mk-c-event-lock">
          <div className="mk-c-event-icon"><Lock size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">{NEXT_LOCK.homeFlag} {NEXT_LOCK.home} vs {NEXT_LOCK.awayFlag} {NEXT_LOCK.away}</div>
            <div className="mk-c-event-meta">Locks in <strong>{NEXT_LOCK.closesIn}</strong> · You: <strong>{NEXT_LOCK.myPick}</strong></div>
            <div className="mk-c-event-insight"><Sparkles size={11} /> Only <strong>{NEXT_LOCK.myPickPct}%</strong> picked this score</div>
          </div>
          <button className="mk-c-event-cta">Predict</button>
        </div>
        <div className="mk-c-event mk-c-event-live">
          <div className="mk-c-event-icon"><Zap size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">{LIVE.homeFlag} {LIVE.home} <strong>{LIVE.homeScore}–{LIVE.awayScore}</strong> {LIVE.away} {LIVE.awayFlag}</div>
            <div className="mk-c-event-meta">{LIVE.minute}' · You: <strong>{LIVE.myPick}</strong> <span className="mk-c-ok">alive</span></div>
          </div>
        </div>
        <div className="mk-c-event mk-c-event-result">
          <div className="mk-c-event-icon mk-c-event-icon-ok"><CheckCircle size={14} /></div>
          <div className="mk-c-event-body">
            <div className="mk-c-event-title">France 2-1 Croatia · Correct</div>
            <div className="mk-c-event-meta">+5 pts · 1d ago</div>
          </div>
        </div>
      </div>

      {/* Insights "discover" strip — non-urgent, browsable */}
      <div className="mk-mix-discover">
        <div className="mk-mix-discover-head">
          <Sparkles size={12} /> Insights · meta-commentary on your bracket
        </div>
        <div className="mk-mix-discover-row">
          {INSIGHTS.map((ins, i) => (
            <div key={i} className={`mk-mix-ins mk-mix-ins-${ins.tone}`}>
              <span className="mk-mix-ins-kind">{ins.label}</span>
              <span className="mk-mix-ins-body">{ins.body}</span>
              <span className="mk-mix-ins-detail">{ins.detail}</span>
            </div>
          ))}
        </div>
      </div>

      {/* B's belowfold strip */}
      <div className="mk-mix-belowfold">
        <div className="mk-b-strip-row">
          <span className="mk-b-strip-label">Friends</span>
          {FRIENDS.map((f, i) => (
            <span key={i} className="mk-b-friend-chip">
              {f.name} #{f.rank} <RankDelta from={f.rank + f.delta} to={f.rank} />
            </span>
          ))}
        </div>
        <div className="mk-b-strip-row">
          <span className="mk-b-strip-label">Leagues</span>
          <span className="mk-b-friend-chip">Global #{ME.rank}/{ME.rankTotal.toLocaleString()}</span>
          <span className="mk-b-friend-chip">Office #4/12</span>
          <span className="mk-b-friend-chip">Family #2/8</span>
        </div>
      </div>
    </div>
  );
}

// ───────────────────────────── shell ─────────────────────────────
const TABS = [
  { id: 'A',   label: 'A · Terminal',    sub: 'Density everywhere · insights as a pane' },
  { id: 'B',   label: 'B · Trader',      sub: 'Hero + content + insights rail' },
  { id: 'C',   label: 'C · Live Pulse',  sub: 'Single event stream · insights inline' },
  { id: 'MIX', label: 'Mix',             sub: 'Hero + stream + discover strip' },
];

export default function DashboardMockups() {
  const [tab, setTab] = useState('B');
  return (
    <div className="mk-shell">
      <div className="mk-tabs">
        <div className="mk-tabs-title">Dashboard mockups</div>
        <div className="mk-tabs-row" role="tablist">
          {TABS.map(t => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              className={`mk-tab ${tab === t.id ? 'mk-tab-active' : ''}`}
              onClick={() => setTab(t.id)}
            >
              <span className="mk-tab-label">{t.label}</span>
              <span className="mk-tab-sub">{t.sub}</span>
            </button>
          ))}
        </div>
        <div className="mk-tabs-help">
          Resize browser to test mobile (≤640px). Sample data only — no live state.
        </div>
      </div>
      <div className="mk-canvas">
        {tab === 'A'   && <MockA />}
        {tab === 'B'   && <MockB />}
        {tab === 'C'   && <MockC />}
        {tab === 'MIX' && <MockMix />}
      </div>
    </div>
  );
}
