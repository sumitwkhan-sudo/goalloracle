/**
 * /api/simple-consensus
 *
 * Returns aggregated crowd-consensus data for a Quick Picks league.
 * Loops the same simplePredictions docs as /api/simple-leaderboard
 * (members → batched 'in' queries) and tallies pick frequencies per
 * group position, best-third pick, knockout slot, and end-state
 * (champion / runner-up / third place).
 *
 * Response is edge-cached for 5 minutes — consensus shifts slowly
 * even with thousands of users.
 */

import { db, admin, corsHeaders } from './_lib/firebase.js';

const ROUND_KEYS = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({});
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const { leagueId } = req.query;
  if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });

  try {
    const leagueSnap = await db.collection('leagues').doc(leagueId).get();
    if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
    const members = leagueSnap.data().members || [];

    // Empty league: return a well-shaped empty payload so the client
    // doesn't have to special-case missing keys.
    if (members.length === 0) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
      return res.status(200).json(emptyPayload());
    }

    const preds = {};
    const compositeIds = members.map((uid) => `${uid}__${leagueId}`);
    for (let i = 0; i < compositeIds.length; i += 30) {
      const batch = compositeIds.slice(i, i + 30);
      const snap = await db.collection('simplePredictions')
        .where(admin.firestore.FieldPath.documentId(), 'in', batch)
        .get();
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data?.userId) preds[data.userId] = data;
      });
    }
    // Legacy fallback for global-simple — same pattern as the leaderboard route.
    if (leagueId === 'global-simple') {
      const missing = members.filter((uid) => !preds[uid]);
      for (let i = 0; i < missing.length; i += 30) {
        const batch = missing.slice(i, i + 30);
        const legacy = await db.collection('simplePredictions')
          .where(admin.firestore.FieldPath.documentId(), 'in', batch)
          .get();
        legacy.docs.forEach((d) => { if (!preds[d.id]) preds[d.id] = d.data(); });
      }
    }

    const groups = {};        // { A: { teamId: { 1: count, 2: count, ... } } }
    const bestThird = {};     // { teamId: count }
    const knockout = {};      // { roundKey: { matchId: { teamId: count } } }
    const champion = {};
    const runnerUp = {};
    const thirdPlace = {};

    let userCount = 0;
    let bestThirdSubmittedCount = 0;
    const knockoutSubmittedCounts = {};
    const groupSubmittedCounts = {};

    for (const userId of members) {
      const pred = preds[userId];
      if (!pred) continue;
      userCount++;

      // Group rankings: tally each team's appearances at each finishing position.
      const gp = pred.groupPredictions || {};
      for (const [groupKey, gData] of Object.entries(gp)) {
        const ranking = Array.isArray(gData?.ranking) ? gData.ranking : [];
        if (ranking.length !== 4 || !ranking.every(Boolean)) continue;
        groupSubmittedCounts[groupKey] = (groupSubmittedCounts[groupKey] || 0) + 1;
        if (!groups[groupKey]) groups[groupKey] = {};
        ranking.forEach((teamId, idx) => {
          const pos = idx + 1;
          if (!groups[groupKey][teamId]) groups[groupKey][teamId] = {};
          groups[groupKey][teamId][pos] = (groups[groupKey][teamId][pos] || 0) + 1;
        });
      }

      // Best-third picks.
      const bt = Array.isArray(pred.bestThirdPicks) ? pred.bestThirdPicks.filter(Boolean) : [];
      if (bt.length > 0) {
        bestThirdSubmittedCount++;
        bt.forEach((teamId) => { bestThird[teamId] = (bestThird[teamId] || 0) + 1; });
      }

      // Knockout winners by round / matchId. Also derive champion / runner-up
      // / third place from the appropriate round-final picks.
      const ko = pred.knockoutPredictions || {};
      for (const round of ROUND_KEYS) {
        const slots = Array.isArray(ko[round]) ? ko[round] : [];
        for (const slot of slots) {
          if (!slot?.winnerId || !slot?.matchId) continue;
          knockoutSubmittedCounts[round] = (knockoutSubmittedCounts[round] || 0) + 1;
          if (!knockout[round]) knockout[round] = {};
          if (!knockout[round][slot.matchId]) knockout[round][slot.matchId] = {};
          knockout[round][slot.matchId][slot.winnerId] =
            (knockout[round][slot.matchId][slot.winnerId] || 0) + 1;
        }
      }
      const finalSlot = (ko.final || [])[0];
      if (finalSlot?.winnerId) champion[finalSlot.winnerId] = (champion[finalSlot.winnerId] || 0) + 1;
      if (finalSlot?.loserId) runnerUp[finalSlot.loserId] = (runnerUp[finalSlot.loserId] || 0) + 1;
      const thirdSlot = (ko.thirdPlace || [])[0];
      if (thirdSlot?.winnerId) thirdPlace[thirdSlot.winnerId] = (thirdPlace[thirdSlot.winnerId] || 0) + 1;
    }

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      totalUsers: userCount,
      computedAt: Date.now(),
      groups: normalizeGroups(groups, groupSubmittedCounts),
      bestThird: normalizeFlat(bestThird, bestThirdSubmittedCount, 8),
      knockout: normalizeKnockout(knockout, knockoutSubmittedCounts),
      champion: normalizeFlat(champion, sumValues(champion)),
      runnerUp: normalizeFlat(runnerUp, sumValues(runnerUp)),
      thirdPlace: normalizeFlat(thirdPlace, sumValues(thirdPlace)),
    });
  } catch (e) {
    console.error('[simple-consensus] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

function emptyPayload() {
  return {
    totalUsers: 0,
    computedAt: Date.now(),
    groups: {},
    bestThird: {},
    knockout: {},
    champion: {},
    runnerUp: {},
    thirdPlace: {},
  };
}

function sumValues(obj) {
  return Object.values(obj).reduce((s, n) => s + n, 0);
}

// Group rankings: each user contributes one rank for each team in their
// submitted ranking, so the per-position denominator is the number of users
// who submitted that group, NOT the total of counts.
function normalizeGroups(groups, perGroupCount) {
  const out = {};
  for (const [groupKey, teams] of Object.entries(groups)) {
    const denom = perGroupCount[groupKey] || 0;
    if (denom === 0) continue;
    out[groupKey] = {};
    for (const [teamId, posCounts] of Object.entries(teams)) {
      out[groupKey][teamId] = {};
      for (const [pos, count] of Object.entries(posCounts)) {
        out[groupKey][teamId][pos] = count / denom;
      }
    }
  }
  return out;
}

// Best-third: each user picks 8 teams. Denominator should be (users with
// best-thirds submitted) * 8 if you want "what fraction of picks landed on
// this team," but the more useful metric for the UI is "what fraction of
// users picked this team," so we use users-submitted as the denominator.
function normalizeFlat(obj, denom) {
  if (!denom || denom <= 0) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k] = v / denom;
  return out;
}

// Knockout: each round has its own denominator (number of users who picked
// any winner in that round). Per-match consensus is each team's count over
// the round denominator, which mirrors "X% of users who reached this round
// picked Team A."
function normalizeKnockout(knockout, perRoundCount) {
  const out = {};
  for (const [round, matches] of Object.entries(knockout)) {
    out[round] = {};
    for (const [matchId, teams] of Object.entries(matches)) {
      const denom = sumValues(teams) || 1;
      out[round][matchId] = {};
      for (const [teamId, count] of Object.entries(teams)) {
        out[round][matchId][teamId] = count / denom;
      }
    }
  }
  return out;
}
