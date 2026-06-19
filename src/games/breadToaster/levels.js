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
 * Difficulty ramps across levels: longer stages, more pits/hazards, and
 * taller climbs. Geometry stays within the jump envelope (validated by
 * the test suite) so every level is provably beatable. The boss adds two
 * sweeping rolling pins in separate zones — a timing challenge that's
 * hard but always fair (the zones never overlap).
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
    width: 2400,
    start: { x: 60, y: G },
    goal: { x: 2280, y: G },
    surfaces: [
      { x: 0, y: G, w: 560 },        // floor A
      { x: 700, y: G, w: 520 },      // floor B (after a pit)
      { x: 1360, y: G, w: 1040 },    // floor C (after a pit)
      { x: 880, y: 420, w: 150 },    // optional high shelf
    ],
    hazards: [
      { x: 950, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1550, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 1950, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 2,
    name: 'Up the Shelves',
    isBoss: false,
    width: 2700,
    start: { x: 50, y: G },
    goal: { x: 2600, y: G },
    surfaces: [
      { x: 0, y: G, w: 360 },        // floor A
      { x: 460, y: 440, w: 130 },    // step 1
      { x: 700, y: 370, w: 130 },    // step 2
      { x: 950, y: G, w: 520 },      // floor B
      { x: 1580, y: 440, w: 120 },   // step 3 (over a pit)
      { x: 1820, y: G, w: 880 },     // floor C
    ],
    hazards: [
      { x: 1050, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1250, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2000, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2300, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2500, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 3,
    name: 'The Spice Climb',
    isBoss: false,
    width: 3050,
    start: { x: 40, y: G },
    goal: { x: 2950, y: G },
    surfaces: [
      { x: 0, y: G, w: 280 },        // floor A
      { x: 370, y: 460, w: 110 },    // climb 1
      { x: 580, y: 400, w: 110 },    // climb 2
      { x: 790, y: 340, w: 110 },    // climb 3 (high)
      { x: 1000, y: 400, w: 110 },   // step down
      { x: 1230, y: G, w: 540 },     // floor B
      { x: 1880, y: 430, w: 110 },   // climb 4 (over a pit)
      { x: 2100, y: 360, w: 110 },   // climb 5
      { x: 2320, y: G, w: 730 },     // floor C
    ],
    hazards: [
      { x: 1350, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1500, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 1680, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2450, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2650, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2850, y: G, w: 52, h: 30, type: 'puddle' },
    ],
  },
  {
    id: 4,
    name: 'Boss: The Rolling Pins',
    isBoss: true,
    width: 1800,
    start: { x: 40, y: G },
    goal: { x: 1650, y: 470 },
    surfaces: [
      { x: 0, y: G, w: 1600 },       // arena floor
      { x: 1600, y: 470, w: 160 },   // raised toaster ledge
    ],
    hazards: [
      { x: 820, y: G, w: 52, h: 30, type: 'puddle' }, // spill between the pin zones
    ],
    // Two rolling pins sweep separate, non-overlapping zones — time your
    // jumps over each to cross to the toaster ledge.
    boss: {
      type: 'rollingPin',
      pins: [
        { x0: 220, x1: 720, speed: 1.35, phase: 0, w: 80, h: 34 },
        { x0: 900, x1: 1480, speed: 1.1, phase: 0, w: 80, h: 34 },
      ],
    },
  },
];

export const LEVEL_COUNT = LEVELS.length;
