import { describe, it, expect } from 'vitest';
import { LEVELS } from './levels';
import { isLevelBeatable, validateLevel } from './playability';
import { SAFE_GAP, SAFE_RISE, MAX_JUMP_HEIGHT, MAX_JUMP_DIST } from './constants';

describe('bread-to-toaster levels', () => {
  it('has a sane jump envelope', () => {
    // Sanity-check the derived physics so a bad constant is caught here
    // rather than as an unbeatable level.
    expect(MAX_JUMP_HEIGHT).toBeGreaterThan(120);
    expect(MAX_JUMP_DIST).toBeGreaterThan(180);
    expect(SAFE_GAP).toBeLessThan(MAX_JUMP_DIST);
    expect(SAFE_RISE).toBeLessThan(MAX_JUMP_HEIGHT);
  });

  it('defines a non-empty level list ending in a boss', () => {
    expect(LEVELS.length).toBeGreaterThanOrEqual(4);
    expect(LEVELS[LEVELS.length - 1].isBoss).toBe(true);
  });

  for (const level of LEVELS) {
    describe(`level ${level.id} — ${level.name}`, () => {
      it('passes structural validation', () => {
        expect(validateLevel(level)).toEqual([]);
      });

      it('is reachable from start to toaster', () => {
        expect(isLevelBeatable(level)).toBe(true);
      });

      it('has a goal positioned ahead of the start', () => {
        expect(level.goal.x).toBeGreaterThan(level.start.x);
      });
    });
  }
});
