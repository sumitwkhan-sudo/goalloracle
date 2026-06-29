/**
 * stageLock.js — Quick Picks stage lock model.
 *
 * Each section of a user's Quick Picks payload locks 5 minutes before the
 * FIRST match of its stage kicks off. After lock, that section is frozen
 * for everyone — later stages remain editable so users can refine their
 * bracket as the tournament progresses.
 *
 * Stages and their first-match locks (all UTC, EDT = UTC-4 during Jun/Jul):
 *
 *   groupPredictions + bestThirdPicks   gs01     2026-06-11 19:00 UTC
 *   knockoutPredictions.roundOf32       r32-01   2026-06-28 19:00 UTC
 *   knockoutPredictions.roundOf16       r16-02   2026-07-04 17:00 UTC
 *   knockoutPredictions.quarterFinals   qf-01    2026-07-09 20:00 UTC
 *   knockoutPredictions.semiFinals      sf-01    2026-07-14 19:00 UTC
 *   knockoutPredictions.thirdPlace      3rd      2026-07-18 21:00 UTC
 *   knockoutPredictions.final           final    2026-07-19 19:00 UTC
 *
 * Server (api/simple-predictions) and client (src/utils/db) both use this
 * file so there is exactly one source of truth for lock times.
 */

import WORLD_CUP_MATCHES from '../data/matches.js';

const LOCK_BUFFER_MS = 5 * 60 * 1000;

// Identical to api/predictions.js + api/copy-predictions.js + points.js.
// Kept as a local function rather than imported so this file stays usable
// as a single import unit on both client and server.
function kickoffUtcMs(match) {
  const [hh, mm] = match.time.split(':').map(Number);
  const date = new Date(`${match.date}T00:00:00Z`);
  date.setUTCHours(hh + 4, mm, 0, 0);
  return date.getTime();
}

const STAGE_MATCHES = {
  groupStage: WORLD_CUP_MATCHES.filter(m => !m.isKnockout),
  roundOf32: WORLD_CUP_MATCHES.filter(m => m.id.startsWith('r32-')),
  roundOf16: WORLD_CUP_MATCHES.filter(m => m.id.startsWith('r16-')),
  quarterFinals: WORLD_CUP_MATCHES.filter(m => m.id.startsWith('qf-')),
  semiFinals: WORLD_CUP_MATCHES.filter(m => m.id.startsWith('sf-')),
  thirdPlace: WORLD_CUP_MATCHES.filter(m => m.id === '3rd'),
  final: WORLD_CUP_MATCHES.filter(m => m.id === 'final'),
};

function earliestKickoff(matches) {
  if (!matches || matches.length === 0) return Infinity;
  return matches.reduce((min, m) => Math.min(min, kickoffUtcMs(m)), Infinity);
}

export const STAGE_FIRST_KICKOFF_UTC = Object.fromEntries(
  Object.entries(STAGE_MATCHES).map(([stage, ms]) => [stage, earliestKickoff(ms)])
);

// All known stage names. Keep in dependency order.
export const STAGES = [
  'groupStage',
  'roundOf32',
  'roundOf16',
  'quarterFinals',
  'semiFinals',
  'thirdPlace',
  'final',
];

export function stageLockTimeUtc(stage) {
  const ms = STAGE_FIRST_KICKOFF_UTC[stage];
  if (ms === undefined) throw new Error(`Unknown Quick Picks stage: ${stage}`);
  return ms - LOCK_BUFFER_MS;
}

export function isStageLocked(stage, now = Date.now()) {
  return now >= stageLockTimeUtc(stage);
}

// Human countdown for a "locks in …" label. Single source of truth shared by
// the dashboard nudge rows and the knockout lock-in CTA. Returns 'LOCKED' once
// the deadline has passed, else the largest two units: 'Xd Xh' / 'Xh Xm' / 'Xm'.
export function formatLockDelta(ms) {
  if (ms <= 0) return 'LOCKED';
  const d = Math.floor(ms / 86400000);
  const h = Math.floor((ms % 86400000) / 3600000);
  const mi = Math.floor((ms % 3600000) / 60000);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${mi}m`;
  return `${mi}m`;
}

// Returns the section names of a Quick Picks payload that have changed
// AND belong to a stage whose lock has already fired. Used by the server
// endpoint to reject illegal mutations and by the UI to gate widgets.
export function lockedSectionsInUpdate(partial, oldDoc, now = Date.now()) {
  if (!partial || typeof partial !== 'object') return [];
  const old = oldDoc || {};
  const locked = [];

  if (Object.prototype.hasOwnProperty.call(partial, 'groupPredictions')) {
    if (!sectionEqual(partial.groupPredictions, old.groupPredictions)) {
      if (isStageLocked('groupStage', now)) locked.push('groupPredictions');
    }
  }
  if (Object.prototype.hasOwnProperty.call(partial, 'bestThirdPicks')) {
    if (!sectionEqual(partial.bestThirdPicks, old.bestThirdPicks)) {
      if (isStageLocked('groupStage', now)) locked.push('bestThirdPicks');
    }
  }

  if (Object.prototype.hasOwnProperty.call(partial, 'knockoutPredictions')) {
    const oldKo = old.knockoutPredictions || {};
    const nextKo = partial.knockoutPredictions || {};
    const rounds = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
    for (const round of rounds) {
      if (!Object.prototype.hasOwnProperty.call(nextKo, round)) continue;
      if (sectionEqual(nextKo[round], oldKo[round])) continue;

      // Per-GAME lock: only the individual matches whose own kickoff has
      // passed (5-min buffer) are frozen — the rest of the round stays
      // editable. Flag each changed-and-locked match separately so the
      // server reverts just that pick, not the whole round.
      const o = knockoutPickMap(oldKo[round]);
      const n = knockoutPickMap(nextKo[round]);
      const ids = new Set([...Object.keys(o.map), ...Object.keys(n.map)]);
      for (const id of ids) {
        if (o.map[id] === n.map[id]) continue; // unchanged pick
        if (isMatchKickoffLocked(id, now)) locked.push(`knockoutPredictions.${round}.${id}`);
      }

      // Entries without a matchId can't be checked per-game; fall back to the
      // whole-round stage lock so they can't be used to dodge the per-game
      // check. (Real prediction docs always carry matchId; this guards legacy
      // shapes only.)
      if ((o.noId.length || n.noId.length)
        && JSON.stringify(o.noId) !== JSON.stringify(n.noId)
        && isStageLocked(round, now)) {
        locked.push(`knockoutPredictions.${round}`);
      }
    }
  }

  return locked;
}

function sectionEqual(a, b) {
  // Treat undefined/null/empty-array/empty-object as "no change against
  // a missing section" so the very first save (where old[section] is
  // undefined) doesn't trip the locked-section check.
  const norm = (v) => {
    if (v === undefined || v === null) return null;
    if (Array.isArray(v) && v.length === 0) return null;
    if (typeof v === 'object' && Object.keys(v).length === 0) return null;
    return v;
  };
  // Compare with OBJECT keys sorted recursively (so { A, B } === { B, A })
  // but ARRAY order preserved (ranking order is meaningful). Important now
  // that the submit handler re-sends groupPredictions verbatim: a re-send
  // that differs only in key order must read as "unchanged" and not trip a
  // false locked-section 403 once a stage has locked.
  return JSON.stringify(sortKeysDeep(norm(a))) === JSON.stringify(sortKeysDeep(norm(b)));
}

// Recursively rebuild objects with sorted keys; arrays keep their order.
// Delegates all other serialization semantics (undefined/null handling) to
// the JSON.stringify in sectionEqual by returning a normalized structure.
function sortKeysDeep(v) {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeysDeep(v[k]);
    return out;
  }
  return v;
}

// Returns a map { stage: { lockedAt, lockedNow } } for the UI to render.
export function stageLockState(now = Date.now()) {
  const out = {};
  for (const stage of STAGES) {
    const lockedAt = stageLockTimeUtc(stage);
    out[stage] = { lockedAt, lockedNow: now >= lockedAt };
  }
  return out;
}

// Map a match-id to the Quick Picks stage that controls its lock. Used
// by the bracket UI to render a single match cell as locked when its
// stage's first match has kicked off — even if THIS specific match
// hasn't started yet.
export function stageForMatchId(matchId) {
  if (!matchId) return null;
  if (matchId.startsWith('gs')) return 'groupStage';
  if (matchId.startsWith('r32-')) return 'roundOf32';
  if (matchId.startsWith('r16-')) return 'roundOf16';
  if (matchId.startsWith('qf-')) return 'quarterFinals';
  if (matchId.startsWith('sf-')) return 'semiFinals';
  if (matchId === '3rd') return 'thirdPlace';
  if (matchId === 'final') return 'final';
  return null;
}

export function isMatchStageLocked(matchId, now = Date.now()) {
  const stage = stageForMatchId(matchId);
  if (!stage) return false;
  return isStageLocked(stage, now);
}

// ── Per-match (game-by-game) lock ──────────────────────────────────────────
// Knockout predictions lock on a per-GAME basis: each match's pick freezes 5
// minutes before THAT match kicks off, independent of the rest of its round.
// So once the first R32 game starts, only that game is locked — every other
// knockout game stays editable until its own kickoff.
const MATCH_BY_ID = Object.fromEntries(WORLD_CUP_MATCHES.map((m) => [m.id, m]));

export function matchKickoffLockTimeUtc(matchId) {
  const m = MATCH_BY_ID[matchId];
  if (!m) return Infinity; // unknown id → never kickoff-locked
  return kickoffUtcMs(m) - LOCK_BUFFER_MS;
}

export function isMatchKickoffLocked(matchId, now = Date.now()) {
  return now >= matchKickoffLockTimeUtc(matchId);
}

// Map a knockout round's pick array to { matchId: winnerId } plus any entries
// that lack a matchId (legacy/edge — can't be checked per-game).
function knockoutPickMap(arr) {
  const map = {};
  const noId = [];
  if (Array.isArray(arr)) {
    for (const p of arr) {
      if (!p) continue;
      if (p.matchId) map[p.matchId] = p.winnerId ?? null;
      else noId.push(p.winnerId ?? null);
    }
  }
  return { map, noId };
}
