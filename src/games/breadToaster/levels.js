/**
 * Bread-to-Toaster — level data (slice 1: levels 1-3 + boss).
 *
 * A level is pure data so it can be validated by playability.test.js and
 * rendered by IssaGame.jsx without any shared mutable state.
 *
 * Coordinate system: x grows rightward, y grows downward, y = top edges.
 * `surfaces` are stand-on-able tops (the kitchen floor + floating props).
 * Collision is one-way-from-above (you land on tops, never bonk sides),
 * which keeps the platformer feel and avoids a whole class of stuck bugs.
 * A "pit" is simply the absence of a floor surface — fall in and you
 * respawn at the start.
 *
 * Adding levels 4-10 later is just appending entries before the boss.
 */

import { GROUND_Y } from './constants';

const G = GROUND_Y;

export const LEVELS = [
  {
    id: 1,
    name: 'Kitchen Counter',
    isBoss: false,
    width: 1820,
    start: { x: 60, y: G },
    goal: { x: 1700, y: G },
    surfaces: [
      { x: 0, y: G, w: 600 },        // floor A
      { x: 720, y: G, w: 1100 },     // floor B (after a small pit)
      { x: 1280, y: 420, w: 170 },   // optional high shelf
    ],
    hazards: [
      { x: 1000, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 2,
    name: 'Up the Shelves',
    isBoss: false,
    width: 1960,
    start: { x: 60, y: G },
    goal: { x: 1820, y: G },
    surfaces: [
      { x: 0, y: G, w: 400 },        // floor A
      { x: 480, y: 440, w: 140 },    // step 1
      { x: 720, y: 380, w: 140 },    // step 2
      { x: 980, y: G, w: 980 },      // floor B
    ],
    hazards: [
      { x: 1200, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 1500, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 3,
    name: 'The Spice Climb',
    isBoss: false,
    width: 2060,
    start: { x: 50, y: G },
    goal: { x: 1900, y: G },
    surfaces: [
      { x: 0, y: G, w: 300 },        // floor A
      { x: 380, y: 460, w: 120 },    // step 1
      { x: 600, y: 400, w: 120 },    // step 2
      { x: 840, y: 340, w: 120 },    // step 3 (high)
      { x: 1060, y: G, w: 1000 },    // floor B
    ],
    hazards: [
      { x: 1250, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1450, y: G, w: 60, h: 30, type: 'puddle' },
      { x: 1700, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 4,
    name: 'Boss: The Rolling Pin',
    isBoss: true,
    width: 1480,
    start: { x: 50, y: G },
    goal: { x: 1350, y: 470 },
    surfaces: [
      { x: 0, y: G, w: 1300 },       // arena floor
      { x: 1300, y: 470, w: 140 },   // raised toaster ledge
    ],
    hazards: [],
    // The hard obstacle: a rolling pin that sweeps the arena. The player
    // times jumps over it to cross to the toaster ledge.
    boss: { type: 'rollingPin', x0: 180, x1: 1120, speed: 1.15, w: 80, h: 34 },
  },
];

export const LEVEL_COUNT = LEVELS.length;
