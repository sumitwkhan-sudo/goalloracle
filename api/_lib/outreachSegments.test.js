/**
 * Tests for the shared outreach segment resolver (B2d). Uses a tiny in-memory
 * Firestore double — enough for resolveSegment's collection().get() calls.
 */

import { describe, test, expect } from 'vitest';
import { resolveSegment, SEGMENTS } from './outreachSegments.js';

function makeDb({ users, preds }) {
  const col = (name) => ({
    get: async () => ({
      docs: (name === 'users' ? users : preds).map((x) => ({
        id: x.id,
        data: () => x,
      })),
    }),
  });
  return { collection: col };
}

// Helpers to build prediction docs.
const started = (id, userId, leagueId = 'global-simple') => ({
  id, userId, leagueId, groupPredictions: { A: { ranking: ['x', 'y', 'z', 'w'] } },
});
const complete = (id, userId, leagueId = 'global-simple') => ({
  id, userId, leagueId, isComplete: true, groupPredictions: { A: { ranking: ['x', 'y', 'z', 'w'] } },
});
const empty = (id, userId, leagueId = 'global-simple') => ({ id, userId, leagueId });

describe('resolveSegment (B2d)', () => {
  const users = [
    { id: 'noPicks', email: 'a@x.com' },
    { id: 'startedOnly', email: 'b@x.com' },
    { id: 'done', email: 'c@x.com' },
    { id: 'optedOut', email: 'd@x.com', emailOptOut: true },
    { id: 'noEmail' },
    { id: 'unsub', email: 'e@x.com', unsubscribedFromReminders: true },
  ];
  const preds = [
    started('startedOnly__global-simple', 'startedOnly'),
    complete('done__global-simple', 'done'),
    started('optedOut__global-simple', 'optedOut'),
    empty('done2__global-simple', 'noPicks'), // empty doc → no picks
  ];

  test('no_picks: users with zero picks, email, not opted out', async () => {
    const { userIds } = await resolveSegment(makeDb({ users, preds }), 'no_picks');
    // noPicks qualifies; startedOnly/done don't; optedOut/noEmail/unsub filtered out.
    expect(userIds.sort()).toEqual(['noPicks']);
  });

  test('started_incomplete: started somewhere, nothing complete', async () => {
    const { userIds } = await resolveSegment(makeDb({ users, preds }), 'started_incomplete');
    expect(userIds.sort()).toEqual(['startedOnly']);
  });

  test('global_incomplete: global bracket not complete (incl. never-started)', async () => {
    const { userIds } = await resolveSegment(makeDb({ users, preds }), 'global_incomplete');
    // Everyone eligible except the completed one — noPicks + startedOnly.
    expect(userIds.sort()).toEqual(['noPicks', 'startedOnly']);
  });

  test('completed_global: only finished global brackets', async () => {
    const { userIds } = await resolveSegment(makeDb({ users, preds }), 'completed_global');
    expect(userIds.sort()).toEqual(['done']);
  });

  test('global_ko_not_resubmitted: in Global + not saved since the reseed cutoff', async () => {
    const CUTOFF = Date.UTC(2026, 5, 26, 0, 0, 0); // mirrors KNOCKOUT_REPICK_CUTOFF_MS
    const u = [
      { id: 'stale', email: 's@x.com' },     // bracket last saved BEFORE cutoff → email them
      { id: 'relocked', email: 'r@x.com' },   // re-saved AFTER cutoff → excluded
      { id: 'nopick', email: 'n@x.com' },     // competing? no Global picks → excluded
    ];
    const p = [
      { ...started('stale__global-simple', 'stale'), updatedAt: CUTOFF - 86400000 },
      { ...started('relocked__global-simple', 'relocked'), updatedAt: CUTOFF + 3600000 },
    ];
    const { userIds } = await resolveSegment(makeDb({ users: u, preds: p }), 'global_ko_not_resubmitted');
    expect(userIds.sort()).toEqual(['stale']);
  });

  test('opted-out + no-email users never appear in any segment', async () => {
    for (const seg of Object.keys(SEGMENTS)) {
      const { userIds } = await resolveSegment(makeDb({ users, preds }), seg);
      expect(userIds).not.toContain('optedOut');
      expect(userIds).not.toContain('unsub');
      expect(userIds).not.toContain('noEmail');
    }
  });

  test('unknown segment throws', async () => {
    await expect(resolveSegment(makeDb({ users, preds }), 'nope')).rejects.toThrow(/Unknown segment/);
  });
});
