/**
 * leaderboardCache — the Quick Picks leaderboard computation + a materialized
 * cache for the huge global league.
 *
 * WHY: computing the board live fans out ~4 document reads PER MEMBER (user
 * doc + prediction doc + composite & legacy score lookups). At 5k members
 * that's ~20,000 Firestore reads per origin hit — recomputed every time the
 * 60s edge cache expired, around the clock. That fan-out was the entire GCP
 * Firestore bill. The board itself only changes when a match result lands
 * (scores) or a user edits picks (labels), so we persist the computed rows
 * into a few chunk docs under /leaderboardCache and serve those (~5 reads).
 *
 * Rebuild triggers:
 *   - score recompute (poll-results ingest + admin result corrections)
 *   - lazily by the endpoint when the cache is older than CACHE_FRESH_MS
 * Private leagues stay on the live path — they're small.
 */

import { buildLiveGroupStandings } from './bracketResolver.js';
import { scoreGroupStage } from '../../src/utils/scoringSimple.js';
import { isStageLocked } from '../../src/utils/stageLock.js';
import { FieldValue } from 'firebase-admin/firestore';

export const CACHE_FRESH_MS = 15 * 60 * 1000; // serve cache up to 15 min old
const CHUNK_ROWS = 1500; // ~350KB of JSON per chunk doc — well under 1MB

const BRACKET_ROUNDS = [['roundOf32', 16], ['roundOf16', 8], ['quarterFinals', 4], ['semiFinals', 2], ['thirdPlace', 1], ['final', 1]];

// Map one member's docs to a leaderboard row. Kept standalone so the
// endpoint can rebuild a single (authenticated) caller's row for the
// own-row freshness overlay without recomputing the whole board.
export function buildRow({ userId, user, pred, score, knockoutOnly, groupStageStarted, liveStandings }) {
  const u = user || { displayName: userId.slice(0, 8), usernameSet: false };
  const ts = pred?.submittedAt || pred?.updatedAt;
  const finalPick = pred?.knockoutPredictions?.final?.[0];
  const winner = finalPick?.winnerId || null;
  const runnerUp = finalPick?.loserId || null;

  const groups = pred?.groupPredictions || {};
  const thirds = Array.isArray(pred?.bestThirdPicks) ? pred.bestThirdPicks : [];
  const ko = pred?.knockoutPredictions || {};
  const groupsDone = Object.values(groups).filter(g => Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)).length;
  const thirdsDone = thirds.filter(Boolean).length;
  let bracketDone = 0;
  for (const [k] of BRACKET_ROUNDS) {
    bracketDone += (ko[k] || []).filter(p => p && p.winnerId).length;
  }
  const QP_TOTAL_PICKS = knockoutOnly ? 32 : (12 + 8 + 32);
  const totalPicked = groupsDone + Math.min(thirdsDone, 8) + bracketDone;
  const picksLeft = Math.max(0, QP_TOTAL_PICKS - totalPicked);
  const isComplete = !!(pred?.isComplete || winner);
  const s = score || { totalScore: 0, totalAccuracy: 0 };

  // Live group score is a GROUP-STAGE feature (the UI hides it afterwards) —
  // skip the per-user compute entirely once the group stage is locked.
  const liveGroupScore = groupStageStarted && liveStandings && pred?.groupPredictions
    ? scoreGroupStage(pred.groupPredictions, liveStandings)
    : 0;

  return {
    userId,
    displayName: u.displayName,
    usernameSet: u.usernameSet,
    country: u.country || null,
    hasSubmitted: !!pred,
    isComplete,
    picksLeft,
    groupsDone,
    thirdsDone: Math.min(thirdsDone, 8),
    bracketDone,
    submittedAt: ts?._seconds ? ts._seconds * 1000 : ts?.toMillis ? ts.toMillis() : ts || null,
    totalScore: s.totalScore,
    totalAccuracy: s.totalAccuracy,
    liveGroupScore,
    winner,
    runnerUp,
  };
}

// Rank by TOTAL POINTS, then live group score, then submitted, then earliest
// submission, then name — the published ordering (see scoring rules).
export function sortRows(leaderboard) {
  leaderboard.sort((a, b) => {
    if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
    if ((b.liveGroupScore || 0) !== (a.liveGroupScore || 0)) {
      return (b.liveGroupScore || 0) - (a.liveGroupScore || 0);
    }
    if (a.hasSubmitted !== b.hasSubmitted) return b.hasSubmitted ? 1 : -1;
    if (a.submittedAt && b.submittedAt && a.submittedAt !== b.submittedAt) {
      return a.submittedAt - b.submittedAt;
    }
    if (a.submittedAt && !b.submittedAt) return -1;
    if (b.submittedAt && !a.submittedAt) return 1;
    return a.displayName.localeCompare(b.displayName);
  });
  return leaderboard;
}

// Full live computation — the expensive path (reads scale with member count).
export async function buildLeaderboardRows(db, admin, leagueId) {
  const leagueSnap = await db.collection('leagues').doc(leagueId).get();
  if (!leagueSnap.exists) return null;
  const members = leagueSnap.data().members || [];
  const knockoutOnly = leagueSnap.data().knockoutOnly === true;
  if (members.length === 0) return { leaderboard: [], groupStageStarted: isStageLocked('groupStage') };

  const chunk = (arr, n) => {
    const out = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  // Once the group stage is locked the Live column is hidden and the live
  // group standings are irrelevant — skip both collection scans.
  const groupStageOver = isStageLocked('groupStage');

  const compositeIds = members.map(uid => `${uid}__${leagueId}`);
  const [userSnaps, predSnaps, resultsSnap, liveSnap] = await Promise.all([
    Promise.all(chunk(members, 30).map(batch =>
      db.collection('users').where('id', 'in', batch).get())),
    Promise.all(chunk(compositeIds, 30).map(batch =>
      db.collection('simplePredictions')
        .where(admin.firestore.FieldPath.documentId(), 'in', batch)
        .get())),
    groupStageOver ? Promise.resolve(null) : db.collection('matchResults').get(),
    groupStageOver ? Promise.resolve(null) : db.collection('liveMatchScores').get(),
  ]);

  let groupStageStarted = true;
  let liveStandings = null;
  if (!groupStageOver && resultsSnap) {
    const resultsMap = {};
    resultsSnap.forEach(d => { resultsMap[d.id] = d.data(); });
    if (liveSnap) {
      liveSnap.forEach(d => {
        const ls = d.data();
        const official = resultsMap[d.id];
        if (official && official.completed === true) return;
        if (typeof ls?.homeScore !== 'number' || typeof ls?.awayScore !== 'number') return;
        resultsMap[d.id] = { homeScore: ls.homeScore, awayScore: ls.awayScore, completed: true, live: true };
      });
    }
    const built = buildLiveGroupStandings(resultsMap);
    liveStandings = built.standings;
    groupStageStarted = built.matchesPlayed > 0;
  }

  const users = {};
  userSnaps.forEach(snap => snap.docs.forEach(d => {
    const u = d.data();
    users[d.id] = {
      displayName: u.displayName || u.email?.split('@')[0] || d.id.slice(0, 8),
      usernameSet: u.usernameSet || false,
      country: u.country || null,
    };
  }));

  const preds = {};
  predSnaps.forEach(snap => snap.docs.forEach(d => {
    const data = d.data();
    // The doc id is authoritative (userId FIELD can be absent on older docs).
    const sep = d.id.indexOf('__');
    const uid = sep >= 0 ? d.id.slice(0, sep) : (data.userId || d.id);
    if (uid) preds[uid] = data;
  }));

  // Legacy single-doc fallback for global members without a composite doc.
  if (leagueId === 'global-simple') {
    const missing = members.filter(uid => !preds[uid]);
    if (missing.length > 0) {
      const legacySnaps = await Promise.all(chunk(missing, 30).map(batch =>
        db.collection('simplePredictions')
          .where(admin.firestore.FieldPath.documentId(), 'in', batch)
          .get()));
      legacySnaps.forEach(snap => snap.docs.forEach(d => {
        if (!preds[d.id]) preds[d.id] = d.data();
      }));
    }
  }

  // Stored scores. Composite path for everyone; legacy path ONLY for global
  // members whose composite score lookup came back empty (the old code
  // fetched BOTH refs for every member — doubling the biggest read block).
  const scoresByUser = {};
  const readScoreRefs = async (refs) => {
    for (let i = 0; i < refs.length; i += 100) {
      const snaps = await db.getAll(...refs.slice(i, i + 100));
      snaps.forEach(s => {
        if (!s.exists) return;
        const d = s.data();
        if (!d.userId) return;
        if (scoresByUser[d.userId] === undefined) {
          scoresByUser[d.userId] = {
            totalScore: typeof d.totalScore === 'number' ? d.totalScore : 0,
            totalAccuracy: typeof d.totalAccuracy === 'number' ? d.totalAccuracy : 0,
          };
        }
      });
    }
  };
  await readScoreRefs(members.map(uid =>
    db.collection('simplePredictions').doc(`${uid}__${leagueId}`).collection('scores').doc(leagueId)));
  if (leagueId === 'global-simple') {
    const missingScore = members.filter(uid => scoresByUser[uid] === undefined && preds[uid]);
    if (missingScore.length > 0) {
      await readScoreRefs(missingScore.map(uid =>
        db.collection('simplePredictions').doc(uid).collection('scores').doc(leagueId)));
    }
  }

  const leaderboard = members.map(userId => buildRow({
    userId,
    user: users[userId],
    pred: preds[userId],
    score: scoresByUser[userId],
    knockoutOnly,
    groupStageStarted,
    liveStandings,
  }));

  return { leaderboard: sortRows(leaderboard), groupStageStarted };
}

// ── Materialized cache (global league) ─────────────────────────────────────

export async function rebuildLeaderboardCache(db, admin, leagueId) {
  const data = await buildLeaderboardRows(db, admin, leagueId);
  if (!data) return null;
  const chunks = [];
  for (let i = 0; i < data.leaderboard.length; i += CHUNK_ROWS) {
    chunks.push(JSON.stringify(data.leaderboard.slice(i, i + CHUNK_ROWS)));
  }
  const batch = db.batch();
  batch.set(db.collection('leaderboardCache').doc(leagueId), {
    leagueId,
    updatedAt: FieldValue.serverTimestamp(),
    updatedAtMs: Date.now(),
    chunkCount: chunks.length,
    rowCount: data.leaderboard.length,
    groupStageStarted: data.groupStageStarted,
  });
  chunks.forEach((json, i) => {
    batch.set(db.collection('leaderboardCache').doc(`${leagueId}__chunk${i}`), { json, i });
  });
  await batch.commit();
  return data;
}

// Returns { leaderboard, groupStageStarted, ageMs } or null (missing/stale).
export async function readLeaderboardCache(db, leagueId, maxAgeMs = CACHE_FRESH_MS) {
  const metaSnap = await db.collection('leaderboardCache').doc(leagueId).get();
  if (!metaSnap.exists) return null;
  const meta = metaSnap.data();
  const ageMs = Date.now() - (meta.updatedAtMs || 0);
  if (ageMs > maxAgeMs) return null;
  const chunkRefs = Array.from({ length: meta.chunkCount || 0 }, (_, i) =>
    db.collection('leaderboardCache').doc(`${leagueId}__chunk${i}`));
  if (chunkRefs.length === 0) return { leaderboard: [], groupStageStarted: !!meta.groupStageStarted, ageMs };
  const snaps = await db.getAll(...chunkRefs);
  const leaderboard = [];
  for (const s of snaps) {
    if (!s.exists) return null; // partial cache — treat as miss
    leaderboard.push(...JSON.parse(s.data().json));
  }
  return { leaderboard, groupStageStarted: !!meta.groupStageStarted, ageMs };
}
