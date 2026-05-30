import { db, admin, applyCors } from './_lib/firebase.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { leagueId } = req.query;
  if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });

  try {
    const leagueSnap = await db.collection('leagues').doc(leagueId).get();
    if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
    const members = leagueSnap.data().members || [];
    if (members.length === 0) return res.status(200).json({ leaderboard: [] });

    // Read users + per-league predictions in parallel. Both are independent
    // 'in' queries (Firestore caps each at 30 ids), so we build every batch
    // up front and fire them concurrently instead of awaiting one batch at a
    // time. global-simple holds every signed-up user, so the old sequential
    // loops serialized into dozens of round-trips — the dominant source of
    // the hero-preview latency. Same queries, same results, just concurrent.
    const chunk = (arr, n) => {
      const out = [];
      for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
      return out;
    };

    const compositeIds = members.map(uid => `${uid}__${leagueId}`);
    const [userSnaps, predSnaps] = await Promise.all([
      Promise.all(chunk(members, 30).map(batch =>
        db.collection('users').where('id', 'in', batch).get())),
      Promise.all(chunk(compositeIds, 30).map(batch =>
        db.collection('simplePredictions')
          .where(admin.firestore.FieldPath.documentId(), 'in', batch)
          .get())),
    ]);

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
      if (data?.userId) preds[data.userId] = data;
    }));

    // Backward compat: for the Global Simple league, any member who doesn't
    // yet have a composite doc falls back to the legacy single-doc path
    // /simplePredictions/{userId}. Parallelized the same way.
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

    // Quick Picks completion budget: 12 group rankings + 8 best-thirds +
    // 32 bracket winners (R32:16, R16:8, QF:4, SF:2, 3rd:1, Final:1).
    const QP_TOTAL_PICKS = 12 + 8 + 32;
    const BRACKET_ROUNDS = [['roundOf32', 16], ['roundOf16', 8], ['quarterFinals', 4], ['semiFinals', 2], ['thirdPlace', 1], ['final', 1]];

    const leaderboard = members.map(userId => {
      const user = users[userId] || { displayName: userId.slice(0, 8), usernameSet: false };
      const pred = preds[userId];
      const ts = pred?.submittedAt || pred?.updatedAt;

      const finalPick = pred?.knockoutPredictions?.final?.[0];
      const winner = finalPick?.winnerId || null;
      const runnerUp = finalPick?.loserId || null;

      // Pick-count math used both for the "Complete" sort key and the
      // "N picks left" label on the row. Counting a group as "ranked"
      // requires all 4 positions filled; bracket rounds count any entry
      // with a winnerId.
      const groups = pred?.groupPredictions || {};
      const thirds = Array.isArray(pred?.bestThirdPicks) ? pred.bestThirdPicks : [];
      const ko = pred?.knockoutPredictions || {};
      const groupsDone = Object.values(groups).filter(g => Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)).length;
      const thirdsDone = thirds.filter(Boolean).length;
      let bracketDone = 0;
      for (const [k] of BRACKET_ROUNDS) {
        bracketDone += (ko[k] || []).filter(p => p && p.winnerId).length;
      }
      const totalPicked = groupsDone + Math.min(thirdsDone, 8) + bracketDone;
      const picksLeft = Math.max(0, QP_TOTAL_PICKS - totalPicked);
      // Picking the Final winner is the meaningful end-state for the user
      // even if they skipped the 3rd-Place match. Treat that — or the
      // explicit isComplete flag — as "done" so the leaderboard label
      // doesn't keep saying "In progress" for users who finished.
      const isComplete = !!(pred?.isComplete || winner);

      return {
        userId,
        displayName: user.displayName,
        usernameSet: user.usernameSet,
        country: user.country || null,
        hasSubmitted: !!pred,
        isComplete,
        picksLeft,
        submittedAt: ts?._seconds ? ts._seconds * 1000 : ts?.toMillis ? ts.toMillis() : ts || null,
        totalAccuracy: 0,
        winner,
        runnerUp,
      };
    });

    // Complete first, then submitted, then submission time, then alphabetical
    leaderboard.sort((a, b) => {
      if (a.isComplete !== b.isComplete) return b.isComplete ? 1 : -1;
      if (a.hasSubmitted !== b.hasSubmitted) return b.hasSubmitted ? 1 : -1;
      if (a.submittedAt && b.submittedAt) return a.submittedAt - b.submittedAt;
      if (a.submittedAt) return -1;
      if (b.submittedAt) return 1;
      return a.displayName.localeCompare(b.displayName);
    });

    // Edge-cache the board: it's identical for every caller (no per-user
    // fields) and tolerates brief staleness. Logged-in callers send an
    // Authorization header and bypass the shared CDN cache, so a user who
    // just submitted still gets a fresh board; the anonymous marketing-hero
    // ticker — the hot path — gets served from the edge. Mirrors the sibling
    // simple-consensus endpoint's caching.
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ leaderboard });
  } catch (e) {
    console.error('[simple-leaderboard] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
