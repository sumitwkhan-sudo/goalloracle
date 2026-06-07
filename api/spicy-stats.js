/**
 * /api/spicy-stats
 *
 * Public, no-auth endpoint that returns post-ready insights from the
 * Quick Picks consensus. Sibling of /api/simple-consensus, which
 * returns raw per-team percentages for the UI; this endpoint is
 * formatted for social copy — top picks already sorted, headline
 * insights pre-computed.
 *
 * Default leagueId is `global-simple` (the platform-wide league
 * everyone is auto-joined to). Other public leagues can be queried
 * via ?leagueId=...
 *
 * Edge-cached for 5 minutes; consensus shifts slowly even at scale.
 */

import { db, admin, applyCors } from './_lib/firebase.js';

const TOP_N = 5;
const MIN_GROUP_SAMPLES = 5;

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const leagueId = req.query.leagueId || 'global-simple';

  try {
    const leagueSnap = await db.collection('leagues').doc(leagueId).get();
    if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
    const members = leagueSnap.data().members || [];

    if (members.length === 0) {
      res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
      return res.status(200).json(emptyPayload(leagueId));
    }

    const preds = await fetchPredictions(members, leagueId);
    const tallied = tally(members, preds);
    const formatted = format(tallied);

    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=60');
    return res.status(200).json({
      leagueId,
      totalUsers: tallied.userCount,
      computedAt: new Date().toISOString(),
      ...formatted,
    });
  } catch (e) {
    console.error('[spicy-stats] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}

async function fetchPredictions(members, leagueId) {
  const preds = {};
  const compositeIds = members.map((uid) => `${uid}__${leagueId}`);
  for (let i = 0; i < compositeIds.length; i += 30) {
    const batch = compositeIds.slice(i, i + 30);
    const snap = await db.collection('simplePredictions')
      .where(admin.firestore.FieldPath.documentId(), 'in', batch)
      .get();
    snap.docs.forEach((d) => {
      const data = d.data();
      // Key by the uid in the (authoritative) composite doc id, not the
      // stored userId field — field-less docs were being skipped and the
      // member dropped from the crowd stats. Mirrors api/simple-leaderboard.js.
      const sep = d.id.indexOf('__');
      const uid = sep >= 0 ? d.id.slice(0, sep) : (data.userId || d.id);
      if (uid) preds[uid] = data;
    });
  }
  // Legacy fallback for global-simple, same as /api/simple-consensus.
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
  return preds;
}

function tally(members, preds) {
  const champion = {};
  const runnerUp = {};
  const finalist = {};
  const thirdPlace = {};
  const bestThird = {};
  const finalPairs = {};
  const groupWinners = {};
  let userCount = 0;

  for (const userId of members) {
    const pred = preds[userId];
    if (!pred) continue;
    userCount++;

    const finalSlot = (pred.knockoutPredictions?.final || [])[0];
    const w = finalSlot?.winnerId;
    const l = finalSlot?.loserId;
    if (w) {
      champion[w] = (champion[w] || 0) + 1;
      finalist[w] = (finalist[w] || 0) + 1;
    }
    if (l) {
      runnerUp[l] = (runnerUp[l] || 0) + 1;
      finalist[l] = (finalist[l] || 0) + 1;
    }
    if (w && l) {
      const pair = [w, l].sort().join(' vs ');
      finalPairs[pair] = (finalPairs[pair] || 0) + 1;
    }

    const thirdSlot = (pred.knockoutPredictions?.thirdPlace || [])[0];
    if (thirdSlot?.winnerId) {
      thirdPlace[thirdSlot.winnerId] = (thirdPlace[thirdSlot.winnerId] || 0) + 1;
    }

    (pred.bestThirdPicks || []).filter(Boolean).forEach((t) => {
      bestThird[t] = (bestThird[t] || 0) + 1;
    });

    const gp = pred.groupPredictions || {};
    for (const [groupKey, gData] of Object.entries(gp)) {
      const ranking = Array.isArray(gData?.ranking) ? gData.ranking : [];
      const winner = ranking[0];
      if (!winner) continue;
      if (!groupWinners[groupKey]) groupWinners[groupKey] = {};
      groupWinners[groupKey][winner] = (groupWinners[groupKey][winner] || 0) + 1;
    }
  }

  return { champion, runnerUp, finalist, thirdPlace, bestThird, finalPairs, groupWinners, userCount };
}

function format({ champion, runnerUp, finalist, thirdPlace, bestThird, finalPairs, groupWinners, userCount }) {
  const topN = (obj, n = TOP_N) => Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([team, count]) => ({ team, count, percent: round1(count * 100 / userCount) }));

  const topPairs = (obj, n = 5) => Object.entries(obj)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([pair, count]) => ({ pair, count, percent: round1(count * 100 / userCount) }));

  const championTop = topN(champion);
  const runnerUpTop = topN(runnerUp);
  const finalistTop = topN(finalist);
  const thirdTop = topN(thirdPlace);
  const bestThirdTop = topN(bestThird, 8);
  const finalPairsTop = topPairs(finalPairs);

  const headlines = computeHeadlines({
    championTop,
    finalistTop,
    thirdTop,
    finalPairs,
    groupWinners,
    userCount,
  });

  return {
    headlines,
    champion: championTop,
    runnerUp: runnerUpTop,
    finalist: finalistTop,
    thirdPlace: thirdTop,
    bestThird: bestThirdTop,
    finalPairs: finalPairsTop,
    groupWinners: Object.fromEntries(
      Object.entries(groupWinners).map(([k, v]) => [k, topN(v, 4)])
    ),
  };
}

function computeHeadlines({ championTop, finalistTop, thirdTop, finalPairs, groupWinners, userCount }) {
  const top1 = finalistTop[0];
  const top2 = finalistTop[1];

  // "The math doesn't math" — % of users with team-A in final + % with team-B
  // in final can sum to >100% because each user picks two finalists. Tied to
  // the count of users who actually picked the pair: that delta is the spicy
  // bit ("X% have A, Y% have B, but only Z% have BOTH").
  let mathDoesntMath = null;
  if (top1 && top2) {
    const pairKey = [top1.team, top2.team].sort().join(' vs ');
    const bothCount = finalPairs[pairKey] || 0;
    mathDoesntMath = {
      team1: top1.team,
      team1Percent: top1.percent,
      team2: top2.team,
      team2Percent: top2.percent,
      sumPercent: round1(top1.percent + top2.percent),
      bothInFinalPercent: round1(bothCount * 100 / userCount),
    };
  }

  return {
    topChampion: championTop[0] || null,
    topThird: thirdTop[0] || null,
    mostContestedGroup: pickMostContestedGroup(groupWinners),
    consensusGroup: pickConsensusGroup(groupWinners),
    mathDoesntMath,
  };
}

function pickMostContestedGroup(groupWinners) {
  let result = null;
  let lowestTopShare = 100;
  for (const [group, teams] of Object.entries(groupWinners)) {
    const total = sumValues(teams);
    if (total < MIN_GROUP_SAMPLES) continue;
    const sorted = Object.entries(teams).sort((a, b) => b[1] - a[1]);
    const topShare = sorted[0][1] / total * 100;
    if (topShare < lowestTopShare) {
      lowestTopShare = topShare;
      result = {
        group,
        topTeam: sorted[0][0],
        topPercent: round1(topShare),
        secondTeam: sorted[1]?.[0] || null,
        secondPercent: sorted[1] ? round1(sorted[1][1] / total * 100) : null,
      };
    }
  }
  return result;
}

function pickConsensusGroup(groupWinners) {
  let result = null;
  let highestTopShare = 0;
  for (const [group, teams] of Object.entries(groupWinners)) {
    const total = sumValues(teams);
    if (total < MIN_GROUP_SAMPLES) continue;
    const sorted = Object.entries(teams).sort((a, b) => b[1] - a[1]);
    const topShare = sorted[0][1] / total * 100;
    if (topShare > highestTopShare) {
      highestTopShare = topShare;
      result = { group, topTeam: sorted[0][0], topPercent: round1(topShare) };
    }
  }
  return result;
}

function emptyPayload(leagueId) {
  return {
    leagueId,
    totalUsers: 0,
    computedAt: new Date().toISOString(),
    headlines: null,
    champion: [],
    runnerUp: [],
    finalist: [],
    thirdPlace: [],
    bestThird: [],
    finalPairs: [],
    groupWinners: {},
  };
}

function sumValues(obj) {
  return Object.values(obj).reduce((s, n) => s + n, 0);
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
