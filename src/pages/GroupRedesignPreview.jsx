/**
 * GroupRedesignPreview
 *
 * Temporary, undiscoverable design-exploration page for the Quick Picks
 * group-ranking step (wizard step 1). Stacks FOUR interactive layout
 * formats so we can pick a direction before touching the live wizard.
 *
 * Every format is real and draggable (@dnd-kit, same mechanic as the live
 * GroupCard) — NO tap-to-rank. Each format is shown at desktop width AND
 * inside a ~390px phone frame so mobile is visible side-by-side. Two
 * features are wired into all four: a FIFA-ranking hover on every team
 * (data from src/data/fifaRankings.js) and a "Randomize all" button
 * (+ per-group shuffle).
 *
 * Self-contained: local mock state only, no Firestore, no auth, nothing
 * saves. Route is intentionally obscure + noindex. Delete this file and its
 * route entry in goaloracle.jsx once a format is chosen.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { DndContext, PointerSensor, TouchSensor, KeyboardSensor, useSensor, useSensors, closestCenter } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, sortableKeyboardCoordinates, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Check, Shuffle, RotateCcw, ChevronRight, ChevronLeft } from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import TEAM_COLORS from '../data/teamColors';
import { getRank } from '../data/fifaRankings';

const GROUP_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const POSITIONS = ['1st', '2nd', '3rd', '4th'];

// Derive the 12 groups → 4 teams (alphabetical default, same as the live
// wizard) and a team→flag map, straight from the canonical fixture list.
function buildGroups() {
  const byGroup = {};
  const flags = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) continue;
    const letter = m.stage.replace('Group ', '');
    (byGroup[letter] = byGroup[letter] || new Map()).set(m.home, m.homeFlag);
    byGroup[letter].set(m.away, m.awayFlag);
  }
  const groups = {};
  for (const L of GROUP_LETTERS) {
    const entries = [...(byGroup[L] || new Map()).entries()].sort((a, b) => a[0].localeCompare(b[0]));
    groups[L] = entries.map(([name]) => name);
    for (const [name, flag] of entries) flags[name] = flag || TEAM_COLORS[name]?.flag || '🏳️';
  }
  return { groups, flags };
}

const { groups: BASE_GROUPS, flags: FLAGS } = buildGroups();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const freshRankings = () => Object.fromEntries(GROUP_LETTERS.map((L) => [L, [...BASE_GROUPS[L]]]));

// Local, per-instance state so each format (and each desktop/phone copy)
// can be played with independently without affecting the others.
function useGroupState() {
  const [rankings, setRankings] = useState(freshRankings);
  const [touched, setTouched] = useState({});

  const setGroupRanking = (L, arr) => {
    setRankings((p) => ({ ...p, [L]: arr }));
    setTouched((p) => ({ ...p, [L]: true }));
  };
  const shuffleGroup = (L) => {
    setRankings((p) => ({ ...p, [L]: shuffle(p[L]) }));
    setTouched((p) => ({ ...p, [L]: true }));
  };
  const randomizeAll = () => {
    setRankings((p) => Object.fromEntries(GROUP_LETTERS.map((L) => [L, shuffle(p[L])])));
    setTouched(Object.fromEntries(GROUP_LETTERS.map((L) => [L, true])));
  };
  const resetAll = () => {
    setRankings(freshRankings());
    setTouched({});
  };
  const count = GROUP_LETTERS.filter((L) => touched[L]).length;
  return { rankings, touched, count, setGroupRanking, shuffleGroup, randomizeAll, resetAll };
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

// A small FIFA-rank chip that reveals the team's world ranking on hover.
function RankChip({ team }) {
  const rank = getRank(team);
  return (
    <span className="gr-rank" tabIndex={0} aria-label={rank ? `FIFA ranking ${rank}` : 'FIFA ranking unavailable'}>
      {rank ? `#${rank}` : '—'}
      <span className="gr-tip" role="tooltip">
        {rank ? `FIFA World Ranking: #${rank}` : 'FIFA ranking unavailable'}
      </span>
    </span>
  );
}

// One draggable team row. `variant` swaps the visual treatment; in the
// "chips" variant the numbered medallion itself is the drag handle.
function SortableTeam({ team, position, variant }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: team });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    touchAction: 'none',
  };
  const flag = FLAGS[team];
  const n = position + 1;

  if (variant === 'chips') {
    return (
      <div ref={setNodeRef} style={style} className={`gr-row gr-row-chips ${isDragging ? 'is-drag' : ''}`}>
        <span
          ref={setActivatorNodeRef}
          className={`gr-medal gr-medal-${n}`}
          aria-label={`Drag ${team}`}
          {...attributes}
          {...listeners}
        >
          {n}
        </span>
        <span className="gr-flag" aria-hidden="true">{flag}</span>
        <span className="gr-name">{team}</span>
        <RankChip team={team} />
      </div>
    );
  }

  const dense = variant === 'dense';
  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`gr-row ${variant === 'rows-lg' ? 'gr-row-lg' : ''} ${dense ? 'gr-row-dense' : ''} ${isDragging ? 'is-drag' : ''}`}
      aria-label={`Reorder ${team}`}
      {...attributes}
      {...listeners}
    >
      {dense
        ? <span className={`gr-num gr-pos-${n}`}>{n}</span>
        : <span className="gr-grip" aria-hidden="true"><GripVertical size={15} /></span>}
      <span className="gr-flag" aria-hidden="true">{flag}</span>
      <span className="gr-name">{team}</span>
      <RankChip team={team} />
      {!dense && <span className={`gr-badge gr-pos-${n}`}>{POSITIONS[position]}</span>}
    </div>
  );
}

function GroupBlock({ group, ranking, touched, variant, className, onReorder, onShuffle }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const from = ranking.indexOf(active.id);
    const to = ranking.indexOf(over.id);
    if (from < 0 || to < 0) return;
    onReorder(arrayMove(ranking, from, to));
  };
  return (
    <div className={`gr-card ${touched ? 'is-touched' : ''} ${className || ''}`}>
      <div className="gr-card-head">
        <span className="gr-card-title">Group {group}</span>
        <span className="gr-card-head-actions">
          {touched && <span className="gr-check" aria-label="ranked"><Check size={12} /></span>}
          <button type="button" className="gr-icon-btn" onClick={onShuffle} title={`Shuffle Group ${group}`} aria-label={`Shuffle Group ${group}`}>
            <Shuffle size={13} />
          </button>
        </span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={ranking} strategy={verticalListSortingStrategy}>
          <div className="gr-card-rows">
            {ranking.map((team, i) => (
              <SortableTeam key={team} team={team} position={i} variant={variant} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </div>
  );
}

function Toolbar({ onRandomize, onReset, count }) {
  return (
    <div className="gr-toolbar">
      <button type="button" className="gr-btn gr-btn-primary" onClick={onRandomize}>
        <Shuffle size={14} /> Randomize all
      </button>
      <button type="button" className="gr-btn" onClick={onReset}>
        <RotateCcw size={14} /> Reset
      </button>
      <span className="gr-count">{count}/12 ranked</span>
    </div>
  );
}

// ── Format 1 — Condensed 4-up grid (FIFA-inspired) ──────────────────────
function FormatFourUp({ frame }) {
  const g = useGroupState();
  const cols = frame === 'phone' ? 1 : 4;
  return (
    <div className="gr-format">
      <Toolbar onRandomize={g.randomizeAll} onReset={g.resetAll} count={g.count} />
      <div className="gr-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {GROUP_LETTERS.map((L) => (
          <GroupBlock
            key={L}
            group={L}
            ranking={g.rankings[L]}
            touched={g.touched[L]}
            variant="rows"
            className="gr-card-compact"
            onReorder={(arr) => g.setGroupRanking(L, arr)}
            onShuffle={() => g.shuffleGroup(L)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Format 2 — Draggable position chips ─────────────────────────────────
function FormatChips({ frame }) {
  const g = useGroupState();
  const cols = frame === 'phone' ? 1 : 3;
  return (
    <div className="gr-format">
      <Toolbar onRandomize={g.randomizeAll} onReset={g.resetAll} count={g.count} />
      <p className="gr-hint">Drag the numbered medallion to re-order.</p>
      <div className="gr-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {GROUP_LETTERS.map((L) => (
          <GroupBlock
            key={L}
            group={L}
            ranking={g.rankings[L]}
            touched={g.touched[L]}
            variant="chips"
            onReorder={(arr) => g.setGroupRanking(L, arr)}
            onShuffle={() => g.shuffleGroup(L)}
          />
        ))}
      </div>
    </div>
  );
}

// ── Format 3 — Guided single-group focus ────────────────────────────────
function FormatGuided({ frame }) {
  const g = useGroupState();
  const [active, setActive] = useState('A');
  const idx = GROUP_LETTERS.indexOf(active);
  return (
    <div className="gr-format">
      <Toolbar onRandomize={g.randomizeAll} onReset={g.resetAll} count={g.count} />
      <div className="gr-tabs">
        {GROUP_LETTERS.map((L) => (
          <button
            key={L}
            type="button"
            className={`gr-tab ${L === active ? 'is-active' : ''} ${g.touched[L] ? 'is-done' : ''}`}
            onClick={() => setActive(L)}
            aria-label={`Group ${L}${g.touched[L] ? ' (ranked)' : ''}`}
          >
            {L}
          </button>
        ))}
      </div>
      <GroupBlock
        group={active}
        ranking={g.rankings[active]}
        touched={g.touched[active]}
        variant="rows-lg"
        className="gr-card-lg"
        onReorder={(arr) => g.setGroupRanking(active, arr)}
        onShuffle={() => g.shuffleGroup(active)}
      />
      <div className="gr-guide-nav">
        <button type="button" className="gr-btn" disabled={idx === 0} onClick={() => setActive(GROUP_LETTERS[idx - 1])}>
          <ChevronLeft size={14} /> Prev
        </button>
        <span className="gr-guide-pos">Group {active} · {idx + 1}/12</span>
        <button type="button" className="gr-btn gr-btn-primary" disabled={idx === 11} onClick={() => setActive(GROUP_LETTERS[idx + 1])}>
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

// ── Format 4 — Dense power-user matrix ──────────────────────────────────
function FormatMatrix({ frame }) {
  const g = useGroupState();
  const cols = frame === 'phone' ? 2 : 4;
  return (
    <div className="gr-format">
      <Toolbar onRandomize={g.randomizeAll} onReset={g.resetAll} count={g.count} />
      <div className="gr-grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}>
        {GROUP_LETTERS.map((L) => (
          <GroupBlock
            key={L}
            group={L}
            ranking={g.rankings[L]}
            touched={g.touched[L]}
            variant="dense"
            className="gr-card-dense"
            onReorder={(arr) => g.setGroupRanking(L, arr)}
            onShuffle={() => g.shuffleGroup(L)}
          />
        ))}
      </div>
    </div>
  );
}

const FORMATS = [
  {
    id: 'fourup',
    name: '1 · Condensed 4-up grid (FIFA-inspired)',
    blurb: 'Four group cards per row on desktop (vs today’s two) — closest to the FIFA reference, just tighter. Drag the rows to re-order; per-group shuffle in each header.',
    Component: FormatFourUp,
  },
  {
    id: 'chips',
    name: '2 · Draggable position chips',
    blurb: 'The numbered 1/2/3/4 medallion is the drag handle — you re-order by dragging the chip itself. Same drag mechanic, chip-forward look. Three per row on desktop.',
    Component: FormatChips,
  },
  {
    id: 'guided',
    name: '3 · Guided single-group focus',
    blurb: 'One group at a time, large and centered, with A–L tabs (green when ranked) and Prev/Next. Most hand-held; least overwhelming on a phone.',
    Component: FormatGuided,
  },
  {
    id: 'matrix',
    name: '4 · Dense power-user matrix',
    blurb: 'All 12 groups as a compact, low-chrome grid for fast entry — where "Randomize all" shines. Drag rows; numbers stand in for the position badges.',
    Component: FormatMatrix,
  },
];

export default function GroupRedesignPreview() {
  useNoIndexMeta();
  return (
    <div className="gr-page">
      <style>{GR_CSS}</style>
      <div className="gr-intro">
        <h1>Group prediction page — layout explorations</h1>
        <p>
          Four interactive directions for the group-ranking step, all keeping
          GoalOracle&rsquo;s look and the <strong>drag-to-rank</strong> mechanic
          (no tap-to-rank). Every team shows a <strong>FIFA-ranking chip</strong>
          {' '}(hover it), and each format has a <strong>Randomize all</strong>
          {' '}button plus per-group shuffle. Each is shown at desktop width and
          inside a phone frame. Nothing here saves — it&rsquo;s a sandbox.
        </p>
      </div>

      {FORMATS.map(({ id, name, blurb, Component }) => (
        <section key={id} className="gr-panel">
          <div className="gr-panel-head">
            <h2>{name}</h2>
            <p>{blurb}</p>
          </div>
          <div className="gr-frame-label">Desktop</div>
          <div className="gr-desktop"><Component frame="desktop" /></div>
          <div className="gr-frame-label">Mobile</div>
          <div className="gr-phone">
            <div className="gr-phone-notch" aria-hidden="true" />
            <div className="gr-phone-screen"><Component frame="phone" /></div>
          </div>
        </section>
      ))}

      <div className="gr-foot">
        Temporary preview — delete <code>src/pages/GroupRedesignPreview.jsx</code> and its route once a format is chosen.
      </div>
    </div>
  );
}

const GR_CSS = `
.gr-page {
  --gr-card: var(--bg-card, #fff);
  --gr-bg: var(--bg, #0e1525);
  --gr-elev: var(--bg-elev, #0a0f1a);
  --gr-text: var(--text, #e6ebf5);
  --gr-sec: var(--text-sec, #9aa6bb);
  --gr-dim: var(--text-dim, #6b7689);
  --gr-border: var(--border, #1e2740);
  --gr-primary: var(--primary, #7c5cff);
  --gr-soft: rgba(125,125,160,.10);
  min-height: 100vh;
  background: var(--gr-elev);
  color: var(--gr-text);
  font-family: var(--font, system-ui, -apple-system, sans-serif);
  padding: 2rem 1rem 5rem;
}
.gr-intro, .gr-panel, .gr-foot { max-width: 1140px; margin-left: auto; margin-right: auto; }
.gr-intro { margin-bottom: 1.5rem; }
.gr-intro h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
.gr-intro p { color: var(--gr-sec); font-size: .92rem; line-height: 1.55; margin: 0; }
.gr-panel { background: var(--gr-bg); border: 1px solid var(--gr-border); border-radius: 16px; padding: 1.25rem; margin-bottom: 2rem; }
.gr-panel-head h2 { font-size: 1.05rem; margin: 0 0 .3rem; }
.gr-panel-head p { color: var(--gr-sec); font-size: .85rem; line-height: 1.5; margin: 0 0 .5rem; }
.gr-frame-label { font-size: .68rem; text-transform: uppercase; letter-spacing: .09em; color: var(--gr-dim); font-weight: 700; margin: 1rem 0 .5rem; }
.gr-foot { text-align: center; color: var(--gr-dim); font-size: .78rem; margin-top: 1rem; }
.gr-foot code { background: var(--gr-soft); padding: 1px 5px; border-radius: 4px; }

/* Toolbar + buttons */
.gr-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.gr-hint { font-size: .74rem; color: var(--gr-dim); margin: -4px 0 10px; }
.gr-btn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 12px; border-radius: 9px; border: 1px solid var(--gr-border); background: var(--gr-card); color: var(--gr-text); font-size: .8rem; font-weight: 600; cursor: pointer; transition: background .12s, filter .12s; }
.gr-btn:hover { background: var(--gr-soft); }
.gr-btn:disabled { opacity: .4; cursor: not-allowed; }
.gr-btn-primary { background: var(--gr-primary); border-color: var(--gr-primary); color: #fff; }
.gr-btn-primary:hover { filter: brightness(1.08); background: var(--gr-primary); }
.gr-count { font-size: .75rem; color: var(--gr-sec); font-weight: 600; margin-left: auto; }

/* Grid + cards */
.gr-grid { display: grid; gap: 8px; }
.gr-card { background: var(--gr-card); border: 1px solid var(--gr-border); border-radius: 12px; padding: 8px; }
.gr-card.is-touched { border-color: rgba(0,230,118,.4); }
.gr-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.gr-card-title { font-weight: 700; font-size: .85rem; letter-spacing: .02em; }
.gr-card-head-actions { display: inline-flex; align-items: center; gap: 5px; }
.gr-check { color: #00c853; display: inline-flex; }
.gr-icon-btn { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; border-radius: 6px; border: 1px solid var(--gr-border); background: transparent; color: var(--gr-sec); cursor: pointer; }
.gr-icon-btn:hover { background: var(--gr-soft); color: var(--gr-text); }
.gr-card-rows { display: flex; flex-direction: column; gap: 4px; }
.gr-card-compact .gr-card-title { font-size: .8rem; }
.gr-card-dense { padding: 6px; }
.gr-card-dense .gr-card-title { font-size: .76rem; }
.gr-card-lg { max-width: 460px; margin: 0 auto; }

/* Rows */
.gr-row { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; background: var(--gr-soft); cursor: grab; }
.gr-row.is-drag { box-shadow: 0 6px 18px rgba(0,0,0,.28); }
.gr-row:active { cursor: grabbing; }
.gr-grip { color: var(--gr-dim); display: inline-flex; }
.gr-flag { font-size: 1.05rem; line-height: 1; }
.gr-name { flex: 1; font-size: .82rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gr-row-dense { padding: 3px 6px; gap: 6px; }
.gr-row-dense .gr-name { font-size: .74rem; }
.gr-row-dense .gr-flag { font-size: .95rem; }
.gr-row-lg { padding: 11px 13px; gap: 12px; }
.gr-row-lg .gr-flag { font-size: 1.6rem; }
.gr-row-lg .gr-name { font-size: 1.02rem; font-weight: 600; }

/* Position badge (rows) + number (dense) colours */
.gr-badge { font: 700 .6rem/1 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .04em; padding: 3px 6px; border-radius: 5px; }
.gr-num { width: 20px; height: 20px; border-radius: 5px; display: inline-flex; align-items: center; justify-content: center; font: 800 .72rem/1 system-ui, sans-serif; background: var(--gr-soft); }
.gr-pos-1 { color: #f59e0b; } .gr-badge.gr-pos-1 { background: rgba(245,158,11,.14); }
.gr-pos-2 { color: #9ca3af; } .gr-badge.gr-pos-2 { background: rgba(156,163,175,.16); }
.gr-pos-3 { color: #4fc3f7; } .gr-badge.gr-pos-3 { background: rgba(79,195,247,.14); }
.gr-pos-4 { color: var(--gr-dim); } .gr-badge.gr-pos-4 { background: var(--gr-soft); }

/* Draggable medallions (chips format) */
.gr-row-chips { cursor: default; }
.gr-medal { width: 28px; height: 28px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; font: 800 .82rem/1 system-ui, sans-serif; color: #0c1424; cursor: grab; flex: none; box-shadow: 0 1px 3px rgba(0,0,0,.25); }
.gr-medal:active { cursor: grabbing; }
.gr-medal-1 { background: #f59e0b; }
.gr-medal-2 { background: #cbd5e1; }
.gr-medal-3 { background: #4fc3f7; }
.gr-medal-4 { background: #64748b; color: #fff; }

/* FIFA rank chip + hover tooltip */
.gr-rank { position: relative; font: 600 .62rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--gr-sec); background: var(--gr-soft); border-radius: 5px; padding: 3px 5px; cursor: help; white-space: nowrap; flex: none; }
.gr-tip { position: absolute; bottom: calc(100% + 7px); right: 0; background: #0c1424; color: #fff; font: 500 .7rem/1.3 system-ui, sans-serif; padding: 6px 9px; border-radius: 7px; white-space: nowrap; opacity: 0; pointer-events: none; transform: translateY(3px); transition: opacity .12s, transform .12s; box-shadow: 0 8px 22px rgba(0,0,0,.35); z-index: 30; }
.gr-tip::after { content: ''; position: absolute; top: 100%; right: 12px; border: 5px solid transparent; border-top-color: #0c1424; }
.gr-rank:hover .gr-tip, .gr-rank:focus .gr-tip, .gr-rank:focus-visible .gr-tip { opacity: 1; transform: none; }

/* Guided format tabs + nav */
.gr-tabs { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 12px; }
.gr-tab { width: 30px; height: 30px; border-radius: 8px; border: 1px solid var(--gr-border); background: transparent; color: var(--gr-sec); font-weight: 700; font-size: .8rem; cursor: pointer; }
.gr-tab.is-active { background: var(--gr-primary); border-color: var(--gr-primary); color: #fff; }
.gr-tab.is-done { border-color: rgba(0,230,118,.55); color: #00c853; }
.gr-tab.is-active.is-done { color: #fff; }
.gr-guide-nav { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; max-width: 460px; margin-left: auto; margin-right: auto; }
.gr-guide-pos { font-size: .78rem; color: var(--gr-sec); font-weight: 600; }

/* Phone frame */
.gr-phone { width: 392px; max-width: 100%; margin: 0 auto; border: 10px solid #11161f; border-radius: 36px; background: #11161f; padding: 12px 10px; box-shadow: 0 16px 50px rgba(0,0,0,.4); position: relative; }
.gr-phone-notch { position: absolute; top: 10px; left: 50%; transform: translateX(-50%); width: 120px; height: 20px; background: #11161f; border-radius: 0 0 13px 13px; z-index: 2; }
.gr-phone-screen { background: var(--gr-bg); border-radius: 26px; padding: 26px 12px 16px; overflow: hidden; }
`;
