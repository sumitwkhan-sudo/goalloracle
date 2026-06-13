/**
 * Pure logic + config schema for the daily leaderboard-movement digest
 * (api/cron/rank-digest.js). Firebase-free so the movement math + config
 * validation are unit-testable in isolation.
 */

export const RANK_DIGEST_DEFAULTS = {
  enabled: false,       // master on/off — OFF until the operator enables it
  sendHourUtc: 13,      // daily send hour (UTC); set to ~2h after the last game
  upThreshold: 20,      // email when a user climbs >= this many places
  downThreshold: 30,    // email when a user drops >= this many places
  subjectUp: '',        // '' => template default
  subjectDown: '',
  introUp: '',          // '' => template default
  introDown: '',
  skipNext: false,      // operator one-shot override: skip the next send
};

// Compute the day's movers from the current ranks and the baseline snapshot.
//   current = { ranks: {uid: rank}, names: {uid}, submitted: Set<uid>, total }
//   prevRanks = { uid: rank } | null
// Up >= upThreshold OR down >= downThreshold, submitted users only, and only
// users present in BOTH snapshots (a brand-new user has no movement). Returns
// movers sorted biggest-first.
export function computeMovers(current, prevRanks, cfg) {
  if (!prevRanks || !current?.ranks) return [];
  const up = Math.max(1, Number(cfg?.upThreshold) || 20);
  const down = Math.max(1, Number(cfg?.downThreshold) || 30);
  const submitted = current.submitted || new Set();
  const names = current.names || {};
  const movers = [];
  for (const [uid, rank] of Object.entries(current.ranks)) {
    if (!submitted.has(uid)) continue; // only engaged (submitted) players
    const prev = prevRanks[uid];
    if (prev == null) continue;
    const climbed = prev - rank;   // smaller rank number is better
    const dropped = rank - prev;
    if (climbed >= up) movers.push({ uid, direction: 'up', places: climbed, newRank: rank, name: names[uid] });
    else if (dropped >= down) movers.push({ uid, direction: 'down', places: dropped, newRank: rank, name: names[uid] });
  }
  movers.sort((a, b) => b.places - a.places);
  return movers;
}

// Per-user email context (movement + operator-customized copy).
export function ctxFor(mover, cfg, total) {
  return {
    direction: mover.direction,
    places: mover.places,
    newRank: mover.newRank,
    total,
    subject: mover.direction === 'up' ? (cfg.subjectUp || '') : (cfg.subjectDown || ''),
    intro: mover.direction === 'up' ? (cfg.introUp || '') : (cfg.introDown || ''),
  };
}

// Validate + coerce an operator config patch (admin setter). Only known keys,
// clamped to safe ranges; copy fields length-capped. Returns the clean patch.
export function sanitizeConfigPatch(patch = {}) {
  const out = {};
  if ('enabled' in patch) out.enabled = !!patch.enabled;
  if ('skipNext' in patch) out.skipNext = !!patch.skipNext;
  if ('sendHourUtc' in patch) {
    const h = Math.round(Number(patch.sendHourUtc));
    if (Number.isFinite(h) && h >= 0 && h <= 23) out.sendHourUtc = h;
  }
  if ('upThreshold' in patch) {
    const n = Math.round(Number(patch.upThreshold));
    if (Number.isFinite(n) && n >= 1 && n <= 500) out.upThreshold = n;
  }
  if ('downThreshold' in patch) {
    const n = Math.round(Number(patch.downThreshold));
    if (Number.isFinite(n) && n >= 1 && n <= 500) out.downThreshold = n;
  }
  for (const k of ['subjectUp', 'subjectDown']) {
    if (k in patch) out[k] = String(patch[k] ?? '').slice(0, 160);
  }
  for (const k of ['introUp', 'introDown']) {
    if (k in patch) out[k] = String(patch[k] ?? '').slice(0, 600);
  }
  return out;
}
