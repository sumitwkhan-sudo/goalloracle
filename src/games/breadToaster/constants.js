/**
 * Bread-to-Toaster — shared physics constants.
 *
 * Single source of truth for the game's physics so the live engine
 * (IssaGame.jsx) and the playability test can never drift apart. All
 * units are world pixels / seconds.
 */

export const WORLD_HEIGHT = 600;     // virtual world height; canvas scales to it
export const GROUND_Y = 520;         // y of the top of the kitchen floor
export const PLAYER_W = 40;
export const PLAYER_H = 40;

export const RUN_SPEED = 260;        // horizontal run speed (px/s)
export const GRAVITY = 1800;         // downward accel (px/s^2)
export const JUMP_SPEED = 720;       // initial upward speed on jump (px/s)
export const TERMINAL_VY = 1300;     // fall-speed cap (px/s)
export const COYOTE_TIME = 0.09;     // grace window to still jump after leaving a ledge (s)

// Derived jump envelope. These define what level geometry is reachable.
export const MAX_JUMP_HEIGHT = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY); // ~144
export const AIR_TIME = (2 * JUMP_SPEED) / GRAVITY;                       // ~0.8
export const MAX_JUMP_DIST = RUN_SPEED * AIR_TIME;                        // ~208

// Safety margins used to validate that levels are comfortably beatable
// (not pixel-perfect). A gap/rise within these is clearable by a kid.
export const SAFE_GAP = Math.round(MAX_JUMP_DIST * 0.72);   // ~150
export const SAFE_RISE = Math.round(MAX_JUMP_HEIGHT * 0.82); // ~118

// Hazards must be narrow enough to clear in one jump.
export const MAX_HAZARD_WIDTH = 70;
