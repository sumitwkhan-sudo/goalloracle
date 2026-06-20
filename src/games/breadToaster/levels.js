/**
 * Bread-to-Toaster — level data (10 levels, a boss every 5th).
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
 * Difficulty ramps across levels: longer stages, tighter gaps, taller
 * climbs, more hazards. Geometry stays within the jump envelope (validated
 * by the test suite) so every level is provably beatable.
 *
 * Bosses appear every 5th level, each with its own mechanic:
 *   - Level 5  "Rolling Pins": pins sweep separate, non-overlapping zones
 *     (time your jumps over each).
 *   - Level 10 "Falling Cleavers": guillotine cleavers bob up and down;
 *     wait in the safe gaps and dash under each one while it's raised.
 * Both are hard but always fair — there is always a safe place to stand.
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
      { x: 0, y: G, w: 560 },
      { x: 700, y: G, w: 520 },
      { x: 1360, y: G, w: 1040 },
      { x: 880, y: 420, w: 150 },
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
      { x: 0, y: G, w: 360 },
      { x: 460, y: 440, w: 130 },
      { x: 700, y: 370, w: 130 },
      { x: 950, y: G, w: 520 },
      { x: 1580, y: 440, w: 120 },
      { x: 1820, y: G, w: 880 },
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
      { x: 0, y: G, w: 280 },
      { x: 370, y: 460, w: 110 },
      { x: 580, y: 400, w: 110 },
      { x: 790, y: 340, w: 110 },
      { x: 1000, y: 400, w: 110 },
      { x: 1230, y: G, w: 540 },
      { x: 1880, y: 430, w: 110 },
      { x: 2100, y: 360, w: 110 },
      { x: 2320, y: G, w: 730 },
    ],
    hazards: [
      { x: 1350, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1500, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 1680, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2450, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2650, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 4,
    name: 'Slippery Sink',
    isBoss: false,
    width: 3200,
    start: { x: 40, y: G },
    goal: { x: 3080, y: G },
    surfaces: [
      { x: 0, y: G, w: 260 },
      { x: 340, y: 450, w: 110 },
      { x: 540, y: G, w: 360 },
      { x: 980, y: 440, w: 110 },
      { x: 1180, y: 380, w: 110 },
      { x: 1380, y: G, w: 500 },
      { x: 1960, y: 440, w: 110 },
      { x: 2160, y: G, w: 1040 },
    ],
    hazards: [
      { x: 640, y: G, w: 40, h: 44, type: 'knife' },
      { x: 780, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 1500, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1650, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 1780, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2300, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2500, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2740, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2900, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 5,
    name: 'Boss: The Rolling Pins',
    isBoss: true,
    width: 1900,
    start: { x: 40, y: G },
    goal: { x: 1750, y: 470 },
    surfaces: [
      { x: 0, y: G, w: 1700 },
      { x: 1700, y: 470, w: 200 },
    ],
    hazards: [],
    boss: {
      type: 'rollingPin',
      pins: [
        { x0: 200, x1: 650, speed: 1.4, phase: 0, w: 80, h: 34 },
        { x0: 780, x1: 1180, speed: 1.2, phase: 0, w: 80, h: 34 },
        { x0: 1250, x1: 1640, speed: 1.55, phase: 1.0, w: 80, h: 34 },
      ],
    },
  },
  {
    id: 6,
    name: 'The Pantry',
    isBoss: false,
    width: 3420,
    start: { x: 40, y: G },
    goal: { x: 3300, y: G },
    surfaces: [
      { x: 0, y: G, w: 240 },
      { x: 360, y: 455, w: 100 },
      { x: 580, y: 395, w: 100 },
      { x: 800, y: 335, w: 100 },
      { x: 1020, y: G, w: 360 },
      { x: 1500, y: 430, w: 100 },
      { x: 1720, y: 360, w: 100 },
      { x: 1940, y: G, w: 500 },
      { x: 2560, y: 440, w: 100 },
      { x: 2780, y: G, w: 640 },
    ],
    hazards: [
      { x: 1100, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1280, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2050, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2200, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2350, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2900, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 3080, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 7,
    name: 'Hot Stove',
    isBoss: false,
    width: 3560,
    start: { x: 40, y: G },
    goal: { x: 3430, y: G },
    surfaces: [
      { x: 0, y: G, w: 220 },
      { x: 355, y: 460, w: 95 },
      { x: 585, y: 405, w: 95 },
      { x: 815, y: G, w: 360 },
      { x: 1310, y: 435, w: 95 },
      { x: 1540, y: 365, w: 95 },
      { x: 1770, y: G, w: 460 },
      { x: 2365, y: 440, w: 95 },
      { x: 2595, y: 370, w: 95 },
      { x: 2825, y: G, w: 735 },
    ],
    hazards: [
      { x: 900, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 1080, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1850, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2000, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2150, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2960, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 3120, y: G, w: 40, h: 44, type: 'knife' },
      { x: 3280, y: G, w: 52, h: 30, type: 'puddle' },
    ],
  },
  {
    id: 8,
    name: 'Freezer Burn',
    isBoss: false,
    width: 3660,
    start: { x: 40, y: G },
    goal: { x: 3540, y: G },
    surfaces: [
      { x: 0, y: G, w: 200 },
      { x: 340, y: 460, w: 90 },
      { x: 570, y: 400, w: 90 },
      { x: 800, y: 340, w: 90 },
      { x: 1030, y: G, w: 340 },
      { x: 1510, y: 430, w: 90 },
      { x: 1740, y: 360, w: 90 },
      { x: 1970, y: 300, w: 90 },
      { x: 2200, y: G, w: 420 },
      { x: 2760, y: 430, w: 90 },
      { x: 2990, y: G, w: 670 },
    ],
    hazards: [
      { x: 1100, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1250, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2280, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2430, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2560, y: G, w: 40, h: 44, type: 'knife' },
      { x: 3100, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 3280, y: G, w: 40, h: 44, type: 'knife' },
      { x: 3420, y: G, w: 52, h: 30, type: 'puddle' },
    ],
  },
  {
    id: 9,
    name: 'The Gauntlet',
    isBoss: false,
    width: 3860,
    start: { x: 40, y: G },
    goal: { x: 3740, y: G },
    surfaces: [
      { x: 0, y: G, w: 190 },
      { x: 335, y: 465, w: 85 },
      { x: 565, y: 400, w: 85 },
      { x: 795, y: 330, w: 85 },
      { x: 1025, y: G, w: 320 },
      { x: 1490, y: 420, w: 85 },
      { x: 1720, y: 345, w: 85 },
      { x: 1950, y: G, w: 400 },
      { x: 2495, y: 430, w: 85 },
      { x: 2725, y: 355, w: 85 },
      { x: 2955, y: 285, w: 85 },
      { x: 3185, y: G, w: 675 },
    ],
    hazards: [
      { x: 1100, y: G, w: 40, h: 44, type: 'knife' },
      { x: 1250, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 2050, y: G, w: 40, h: 44, type: 'knife' },
      { x: 2200, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 3280, y: G, w: 40, h: 44, type: 'knife' },
      { x: 3430, y: G, w: 52, h: 30, type: 'puddle' },
      { x: 3600, y: G, w: 40, h: 44, type: 'knife' },
    ],
  },
  {
    id: 10,
    name: 'Boss: The Falling Cleavers',
    isBoss: true,
    width: 2000,
    start: { x: 40, y: G },
    goal: { x: 1850, y: 470 },
    surfaces: [
      { x: 0, y: G, w: 1800 },
      { x: 1800, y: 470, w: 200 },
    ],
    hazards: [],
    boss: {
      type: 'choppers',
      // Cleavers bob between hiY (raised, safe) and loY (down, blocking).
      choppers: [
        { x: 360, w: 70, h: 210, hiY: 100, loY: 300, speed: 1.6, phase: 0 },
        { x: 720, w: 70, h: 210, hiY: 100, loY: 300, speed: 1.4, phase: 1.2 },
        { x: 1080, w: 70, h: 210, hiY: 100, loY: 300, speed: 1.7, phase: 0.6 },
        { x: 1440, w: 70, h: 210, hiY: 100, loY: 300, speed: 1.5, phase: 2.0 },
      ],
    },
  },
];

export const LEVEL_COUNT = LEVELS.length;
