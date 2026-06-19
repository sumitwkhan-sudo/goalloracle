/**
 * Bread-to-Toaster — level validation.
 *
 * Pure functions that prove a level is actually completable given the
 * physics in constants.js. The key check (`isLevelBeatable`) builds a
 * reachability graph over the level's surfaces — two surfaces are
 * connected if the gap and rise between them are within the player's
 * jump envelope — then BFS from the start surface to the goal surface.
 *
 * This is what lets the test suite guarantee no level is impossible
 * before we ship it.
 */

import {
  SAFE_GAP, SAFE_RISE, MAX_HAZARD_WIDTH, GROUND_Y, PLAYER_H,
} from './constants';

// Horizontal gap between two surface intervals (0 if they overlap in x).
function intervalGapX(a, b) {
  const aR = a.x + a.w, bR = b.x + b.w;
  if (a.x > bR) return a.x - bR;   // a entirely right of b
  if (b.x > aR) return b.x - aR;   // b entirely right of a
  return 0;                        // overlap
}

// Can the player jump from surface `a` to surface `b`?
// Reachable if within horizontal reach AND not too high a step up
// (drops of any depth are fine).
function canJump(a, b) {
  const gapX = intervalGapX(a, b);
  if (gapX > SAFE_GAP) return false;
  const rise = a.y - b.y; // positive => b is higher than a
  if (rise > SAFE_RISE) return false;
  return true;
}

// Which surface does a given x rest on? (the one whose span contains x,
// preferring the highest such surface — the one you'd be standing on).
function surfaceAtX(level, x) {
  let best = null;
  for (const s of level.surfaces) {
    if (x >= s.x && x <= s.x + s.w) {
      if (!best || s.y < best.y) best = s;
    }
  }
  return best;
}

export function isLevelBeatable(level) {
  const start = surfaceAtX(level, level.start.x);
  const goal = surfaceAtX(level, level.goal.x);
  if (!start || !goal) return false;

  const surfaces = level.surfaces;
  const startIdx = surfaces.indexOf(start);
  const goalIdx = surfaces.indexOf(goal);

  const seen = new Set([startIdx]);
  const queue = [startIdx];
  while (queue.length) {
    const i = queue.shift();
    if (i === goalIdx) return true;
    for (let j = 0; j < surfaces.length; j++) {
      if (seen.has(j)) continue;
      if (canJump(surfaces[i], surfaces[j])) {
        seen.add(j);
        queue.push(j);
      }
    }
  }
  return seen.has(goalIdx);
}

// Structural sanity: required fields present, hazards in-bounds and
// narrow enough to clear, start/goal anchored to a surface.
export function validateLevel(level) {
  const errors = [];
  if (!level.surfaces?.length) errors.push('no surfaces');
  if (!level.start || typeof level.start.x !== 'number') errors.push('bad start');
  if (!level.goal || typeof level.goal.x !== 'number') errors.push('bad goal');
  if (!surfaceAtX(level, level.start?.x)) errors.push('start not on a surface');
  if (!surfaceAtX(level, level.goal?.x)) errors.push('goal not on a surface');

  for (const h of level.hazards || []) {
    if (h.w > MAX_HAZARD_WIDTH) errors.push(`hazard at x=${h.x} too wide (${h.w})`);
    if (h.x < 0 || h.x + h.w > level.width) errors.push(`hazard at x=${h.x} out of bounds`);
  }

  if (level.isBoss && !level.boss) errors.push('boss level missing boss config');
  return errors;
}

export { GROUND_Y, PLAYER_H, surfaceAtX };
