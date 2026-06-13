/**
 * Pure-logic coverage for the daily leaderboard-movement digest: who counts as
 * a mover, and config sanitization. These guard the email-recipient selection,
 * so a drift here would mis-target real emails.
 */
import { describe, test, expect } from 'vitest';
import { computeMovers, ctxFor, sanitizeConfigPatch, RANK_DIGEST_DEFAULTS } from './rankDigest.js';

const cfg = { upThreshold: 20, downThreshold: 30 };
const current = (ranks, submittedUids) => ({
  ranks,
  names: Object.fromEntries(Object.keys(ranks).map((u) => [u, u.toUpperCase()])),
  submitted: new Set(submittedUids ?? Object.keys(ranks)),
  total: Object.keys(ranks).length,
});

describe('computeMovers', () => {
  test('no baseline → no movers (first run never emails)', () => {
    expect(computeMovers(current({ a: 1 }), null, cfg)).toEqual([]);
  });

  test('climbed >= up threshold → up mover; below → nothing', () => {
    const cur = current({ a: 5, b: 50 });
    const prev = { a: 26, b: 60 }; // a climbed 21 (>=20), b climbed 10 (<20)
    const m = computeMovers(cur, prev, cfg);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ uid: 'a', direction: 'up', places: 21, newRank: 5 });
  });

  test('dropped >= down threshold → down mover; 20-drop is below 30 → nothing', () => {
    const cur = current({ a: 60, b: 25 });
    const prev = { a: 25, b: 5 }; // a dropped 35 (>=30), b dropped 20 (<30)
    const m = computeMovers(cur, prev, cfg);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ uid: 'a', direction: 'down', places: 35 });
  });

  test('only users present in BOTH snapshots count (new users excluded)', () => {
    const cur = current({ a: 1, newbie: 2 });
    const prev = { a: 40 }; // newbie has no prior rank
    const m = computeMovers(cur, prev, cfg);
    expect(m.map((x) => x.uid)).toEqual(['a']);
  });

  test('only submitted users are eligible', () => {
    const cur = current({ a: 1 }, []); // a not submitted
    const prev = { a: 40 };
    expect(computeMovers(cur, prev, cfg)).toEqual([]);
  });

  test('sorted biggest mover first', () => {
    const cur = current({ a: 1, b: 2, c: 100 });
    const prev = { a: 30, b: 80, c: 50 }; // a +29, b +78, c -50
    const m = computeMovers(cur, prev, cfg);
    expect(m.map((x) => x.uid)).toEqual(['b', 'c', 'a']); // 78, 50, 29
  });
});

describe('sanitizeConfigPatch', () => {
  test('coerces + clamps known fields, drops unknowns', () => {
    const p = sanitizeConfigPatch({
      enabled: 1, sendHourUtc: '9', upThreshold: '15', downThreshold: 999,
      subjectUp: 'x'.repeat(300), evil: 'nope', skipNext: true,
    });
    expect(p.enabled).toBe(true);
    expect(p.sendHourUtc).toBe(9);
    expect(p.upThreshold).toBe(15);
    expect(p.downThreshold).toBeUndefined(); // 999 out of [1,500] range → rejected
    expect(p.subjectUp.length).toBe(160);
    expect(p.skipNext).toBe(true);
    expect('evil' in p).toBe(false);
  });
  test('rejects out-of-range hour', () => {
    expect(sanitizeConfigPatch({ sendHourUtc: 25 }).sendHourUtc).toBeUndefined();
    expect(sanitizeConfigPatch({ sendHourUtc: -1 }).sendHourUtc).toBeUndefined();
  });
  test('defaults are safe (disabled)', () => {
    expect(RANK_DIGEST_DEFAULTS.enabled).toBe(false);
  });
});

describe('ctxFor', () => {
  test('carries movement + operator copy overrides', () => {
    const c = ctxFor({ direction: 'up', places: 22, newRank: 4 }, { subjectUp: 'Hi', introUp: 'Yo' }, 500);
    expect(c).toMatchObject({ direction: 'up', places: 22, newRank: 4, total: 500, subject: 'Hi', intro: 'Yo' });
  });
});
