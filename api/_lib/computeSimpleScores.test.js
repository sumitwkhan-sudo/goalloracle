/**
 * Tests for recomputeSimpleScores (R2) using a minimal in-memory Firestore
 * double — enough to capture which score docs get written and with what.
 */

import { describe, test, expect } from 'vitest';
import { recomputeSimpleScores } from './computeSimpleScores.js';
import { buildSimpleActuals } from './bracketResolver.js';
import WORLD_CUP_MATCHES from '../../src/data/matches.js';

// ── fake Firestore ──
// Records batch .set() calls as { path, data }. Supports the exact surface
// recomputeSimpleScores uses: collection().get(), collection().doc()
// .collection().doc(), batch().set()/.commit().
function makeFakeDb(predictionDocs) {
  const writes = [];
  const docRef = (path) => ({
    _path: path,
    collection: (sub) => ({ doc: (id) => docRef(`${path}/${sub}/${id}`) }),
  });
  return {
    writes,
    collection: (name) => ({
      get: async () => ({
        docs: predictionDocs.map((d) => ({
          id: d.id,
          data: () => d.data,
        })),
      }),
      doc: (id) => docRef(`${name}/${id}`),
    }),
    batch: () => ({
      set: (ref, data) => { writes.push({ path: ref._path, data }); },
      commit: async () => {},
    }),
  };
}

function makeResult(home, away, opts = {}) {
  return {
    homeScore: home, awayScore: away, completed: true, verified: opts.verified !== false,
    extraTime: opts.extraTime || false, penalties: opts.penalties || false,
    penHome: opts.penHome || 0, penAway: opts.penAway || 0,
  };
}
function allGroupsCompleteResults() {
  const results = {};
  WORLD_CUP_MATCHES.filter((m) => !m.isKnockout).forEach((m) => { results[m.id] = makeResult(2, 1); });
  return results;
}

// Build a prediction doc that perfectly matches the actuals (max score).
function perfectPredictionFor(actuals) {
  const groupPredictions = {};
  for (const [g, order] of Object.entries(actuals.groupStandings)) {
    groupPredictions[g] = { ranking: [...order] };
  }
  const ROUND_BY_PREFIX = [
    ['roundOf32', 'r32-'], ['roundOf16', 'r16-'], ['quarterFinals', 'qf-'],
    ['semiFinals', 'sf-'], ['thirdPlace', '3rd'], ['final', 'final'],
  ];
  const knockoutPredictions = {};
  for (const [round, prefix] of ROUND_BY_PREFIX) {
    knockoutPredictions[round] = Object.entries(actuals.knockoutResults)
      .filter(([mId]) => mId.startsWith(prefix) || mId === prefix)
      .map(([mId, r]) => ({ matchId: mId, winnerId: r.winnerId }));
  }
  return { groupPredictions, bestThirdPicks: [...actuals.advancingThirds], knockoutPredictions };
}

describe('recomputeSimpleScores (R2)', () => {
  test('writes a score doc per prediction at the correct subcollection path', async () => {
    const actuals = buildSimpleActuals(allGroupsCompleteResults());
    const db = makeFakeDb([
      { id: 'userA__global-simple', data: { userId: 'userA', leagueId: 'global-simple', groupPredictions: {} } },
      { id: 'userB__priv1', data: { userId: 'userB', leagueId: 'priv1', groupPredictions: {} } },
    ]);
    const res = await recomputeSimpleScores(db, actuals);
    expect(res.scored).toBe(2);
    expect(res.written).toBe(2);
    expect(res.errors).toBe(0);
    const paths = db.writes.map((w) => w.path).sort();
    expect(paths).toEqual([
      'simplePredictions/userA__global-simple/scores/global-simple',
      'simplePredictions/userB__priv1/scores/priv1',
    ]);
  });

  test('legacy global doc (no separator) scores under global-simple', async () => {
    const actuals = buildSimpleActuals(allGroupsCompleteResults());
    const db = makeFakeDb([
      { id: 'legacyUser', data: { groupPredictions: {} } },
    ]);
    await recomputeSimpleScores(db, actuals);
    expect(db.writes[0].path).toBe('simplePredictions/legacyUser/scores/global-simple');
    expect(db.writes[0].data.userId).toBe('legacyUser');
    expect(db.writes[0].data.leagueId).toBe('global-simple');
  });

  test('a perfect bracket is stored with the max score + 100% accuracy', async () => {
    const results = allGroupsCompleteResults();
    WORLD_CUP_MATCHES.filter((m) => m.isKnockout).forEach((m) => { results[m.id] = makeResult(1, 0); });
    const actuals = buildSimpleActuals(results);
    const perfect = perfectPredictionFor(actuals);
    const db = makeFakeDb([
      { id: 'ace__global-simple', data: { userId: 'ace', leagueId: 'global-simple', ...perfect } },
    ]);
    await recomputeSimpleScores(db, actuals);
    const w = db.writes[0].data;
    expect(w.totalScore).toBe(209);
    expect(w.totalAccuracy).toBeCloseTo(1, 5);
    expect(w.breakdown).toBeDefined();
  });

  test('an empty bracket scores 0 (no crash)', async () => {
    const actuals = buildSimpleActuals(allGroupsCompleteResults());
    const db = makeFakeDb([
      { id: 'empty__global-simple', data: { userId: 'empty', leagueId: 'global-simple' } },
    ]);
    const res = await recomputeSimpleScores(db, actuals);
    expect(res.errors).toBe(0);
    expect(db.writes[0].data.totalScore).toBe(0);
  });

  test('no predictions: nothing written, no throw', async () => {
    const actuals = buildSimpleActuals({});
    const db = makeFakeDb([]);
    const res = await recomputeSimpleScores(db, actuals);
    expect(res).toEqual({ scored: 0, written: 0, errors: 0 });
    expect(db.writes).toEqual([]);
  });
});
