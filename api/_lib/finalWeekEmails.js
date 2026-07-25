/**
 * finalWeekEmails — data plumbing for the two end-of-tournament sends:
 *
 *  1. top10Contender (pre-Final): players who can still mathematically reach
 *     the global top 10 (gap to #10 ≤ points still winnable on unlocked
 *     games), plus the current top 10 themselves ("defend it"). Small
 *     audience, urgency framing, must land before the Final locks.
 *
 *  2. wcWrapped (post-Final): every player's personalized tournament recap —
 *     global rank + percentile, their position in each of their leagues,
 *     rarest correct call (their best call vs the crowd), champion verdict,
 *     with winner (top 3) and top-10 variants.
 *
 * Both are computed once per run and delivered as per-user payloads through
 * the existing chunked scheduled-send path (same as standingsDigest).
 */

import WORLD_CUP_MATCHES from '../../src/data/matches.js';
import { isMatchKickoffLocked } from '../../src/utils/stageLock.js';
import { calculateSimpleScore, KNOCKOUT_POINTS_PER_PICK, predictedAdvancers } from '../../src/utils/scoringSimple.js';
import { buildSimpleActuals, resolveActualBracket } from './bracketResolver.js';
import { getRoundForMatchId, ROUND_ORDER } from '../../src/utils/bracketUtils.js';
import { readLeaderboardCache, rebuildLeaderboardCache } from './leaderboardCache.js';

const GLOBAL_IDS = new Set(['global', 'global-simple']);
const ROUND_LABEL = {
  roundOf32: 'the Round of 32',
  roundOf16: 'the Round of 16',
  quarterFinals: 'the quarterfinals',
  semiFinals: 'the semifinals',
  thirdPlace: 'the 3rd-place match',
  final: 'the Final',
};

export function pointsStillWinnable(now = Date.now()) {
  let pts = 0;
  for (const m of WORLD_CUP_MATCHES.filter((x) => x.isKnockout)) {
    if (isMatchKickoffLocked(m.id, now)) continue;
    pts += KNOCKOUT_POINTS_PER_PICK[getRoundForMatchId(m.id)] || 0;
  }
  return pts;
}

// ── Email 1: top-10 contender alert ────────────────────────────────────────

export async function buildTop10ContenderData(db, admin) {
  // Board from the materialized cache (rebuild if stale) — ranks must be
  // current when we tell someone they're "9 points off the top 10".
  let board = await readLeaderboardCache(db, 'global-simple', 10 * 60 * 1000);
  if (!board) board = await rebuildLeaderboardCache(db, admin, 'global-simple');
  const rows = (board?.leaderboard || []).filter((r) => r.hasSubmitted);
  const total = rows.length;
  const remaining = pointsStillWinnable();
  if (rows.length < 10 || remaining === 0) {
    return { eligible: [], ctxFor: () => null, remaining, total, chasers: 0, defenders: 0 };
  }
  const tenthPoints = rows[9].totalScore || 0;

  const contenders = []; // { row, rank, isTop10, gap }
  rows.forEach((r, i) => {
    const rank = i + 1;
    if (rank <= 10) {
      contenders.push({ row: r, rank, isTop10: true, gap: 0 });
    } else {
      const gap = tenthPoints - (r.totalScore || 0);
      if (gap <= remaining) contenders.push({ row: r, rank, isTop10: false, gap });
    }
  });

  // Emails + opt-outs for just this small set.
  const refs = contenders.map((c) => db.collection('users').doc(c.row.userId));
  const byUid = {};
  for (let i = 0; i < refs.length; i += 300) {
    const snaps = await db.getAll(...refs.slice(i, i + 300));
    for (const s of snaps) if (s.exists) byUid[s.id] = s.data();
  }
  const eligible = [];
  const ctxByUid = {};
  for (const c of contenders) {
    const u = byUid[c.row.userId];
    if (!u || !u.email || u.emailOptOut === true) continue;
    eligible.push({ id: c.row.userId, email: u.email, displayName: u.displayName || null });
    ctxByUid[c.row.userId] = {
      rank: c.rank,
      total,
      points: c.row.totalScore || 0,
      tenthPoints,
      gap: c.gap,
      pointsRemaining: remaining,
      isTop10: c.isTop10,
    };
  }
  return {
    eligible,
    ctxFor: (uid) => ctxByUid[uid] || null,
    remaining,
    total,
    chasers: contenders.filter((c) => !c.isTop10).length,
    defenders: contenders.filter((c) => c.isTop10).length,
  };
}

// ── Email 2: World Cup Wrapped ──────────────────────────────────────────────

function hasAnyPicks(doc) {
  if (!doc) return false;
  const groups = doc.groupPredictions || {};
  if (Object.values(groups).some((g) => Array.isArray(g?.ranking) && g.ranking.filter(Boolean).length > 0)) return true;
  if (Array.isArray(doc.bestThirdPicks) && doc.bestThirdPicks.length > 0) return true;
  const ko = doc.knockoutPredictions || {};
  return Object.values(ko).some((arr) => Array.isArray(arr) && arr.some((p) => p?.winnerId));
}

function tsMillis(ts) {
  if (!ts) return Infinity;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts._seconds) return ts._seconds * 1000;
  return Infinity;
}

function rankLeague(docs, actuals) {
  const scored = docs.map((d) => ({
    userId: d.userId,
    score: calculateSimpleScore(d, actuals).totalScore || 0,
    submittedAtMs: tsMillis(d.submittedAt),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.submittedAtMs !== b.submittedAtMs) return a.submittedAtMs - b.submittedAtMs;
    return String(a.userId).localeCompare(String(b.userId));
  });
  const byUser = {};
  scored.forEach((s, i) => { byUser[s.userId] = { rank: i + 1, score: s.score }; });
  return { byUser, total: scored.length, ordered: scored };
}


// Group prediction docs per league with per-user DEDUP: a user can have both
// the composite `${uid}__${leagueId}` doc AND a legacy `${uid}` doc carrying
// the same userId+leagueId fields. Counting both double-ranks the user and
// inflates totals (the "#13 of 8,388" bug when only ~5.5k accounts exist).
// The composite doc wins; legacy fills in only when no composite exists.
function groupDocsByLeagueDeduped(predsSnap, leagueMeta) {
  const byKey = new Map(); // `${leagueId}|${userId}` -> { data, composite }
  predsSnap.forEach((d) => {
    const data = d.data();
    if (!data?.userId || !data?.leagueId) return;
    if (!hasAnyPicks(data)) return;
    if (leagueMeta[data.leagueId]?.predictionMode === 'classic') return;
    const key = `${data.leagueId}|${data.userId}`;
    const isComposite = d.id.includes('__');
    const prev = byKey.get(key);
    if (!prev || (isComposite && !prev.composite)) {
      byKey.set(key, { data, composite: isComposite });
    }
  });
  const docsByLeague = {};
  for (const { data } of byKey.values()) {
    (docsByLeague[data.leagueId] = docsByLeague[data.leagueId] || []).push(data);
  }
  return docsByLeague;
}

export async function buildWrappedData(db) {
  const [usersSnap, predsSnap, leaguesSnap, resultsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('simplePredictions').get(),
    db.collection('leagues').get(),
    db.collection('matchResults').get(),
  ]);

  const results = {};
  resultsSnap.forEach((d) => { results[d.id] = d.data(); });
  const actuals = buildSimpleActuals(results);
  const koWinners = actuals.knockoutResults || {};
  const { resolved } = resolveActualBracket(results);

  // The Wrapped may only fire once the Final has a decided winner.
  const finalWinner = koWinners.final?.winnerId || null;
  const finalDecided = !!finalWinner;
  const finalLoser = finalDecided && resolved.final
    ? (resolved.final.home === finalWinner ? resolved.final.away : resolved.final.home)
    : null;

  const leagueMeta = {};
  leaguesSnap.forEach((d) => {
    const l = d.data();
    leagueMeta[d.id] = {
      name: l.name || d.id,
      memberCount: l.memberCount || (Array.isArray(l.members) ? l.members.length : 0),
      predictionMode: l.predictionMode || 'simple',
    };
  });

  const docsByLeague = groupDocsByLeagueDeduped(predsSnap, leagueMeta);

  const ranks = {};
  for (const [leagueId, docs] of Object.entries(docsByLeague)) {
    ranks[leagueId] = rankLeague(docs, actuals);
  }
  const global = ranks['global-simple'] || { byUser: {}, total: 0 };

  // Crowd pick-popularity per knockout match (global docs only) — powers the
  // "best call" line: the user's CORRECT pick that the fewest others made.
  const pickCounts = {}; // matchId -> { total, byTeam: { team: n } }
  for (const doc of docsByLeague['global-simple'] || []) {
    const ko = doc.knockoutPredictions || {};
    for (const round of ROUND_ORDER) {
      for (const p of ko[round] || []) {
        if (!p?.matchId || !p?.winnerId) continue;
        const slot = (pickCounts[p.matchId] = pickCounts[p.matchId] || { total: 0, byTeam: {} });
        slot.total += 1;
        slot.byTeam[p.winnerId] = (slot.byTeam[p.winnerId] || 0) + 1;
      }
    }
  }

  // Where each eliminated team's run ended (for the champion verdict).
  const lostIn = {}; // team -> roundKey
  for (const [matchId, r] of Object.entries(resolved)) {
    const w = koWinners[matchId]?.winnerId;
    if (!w) continue;
    const round = getRoundForMatchId(matchId);
    const loser = r.home === w ? r.away : r.home;
    // Keep the LATEST round a team lost in (3rd-place loss shouldn't override
    // a semifinal exit story — order rounds by ROUND_ORDER index).
    if (loser) {
      const prev = lostIn[loser];
      if (!prev || ROUND_ORDER.indexOf(round) > ROUND_ORDER.indexOf(prev)) lostIn[loser] = round;
    }
  }

  const globalDocsByUser = {};
  for (const doc of docsByLeague['global-simple'] || []) globalDocsByUser[doc.userId] = doc;

  const eligible = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if (!u.email || u.emailOptOut === true) return;
    if (!global.byUser[d.id]) return;
    eligible.push({ id: d.id, email: u.email, displayName: u.displayName || null });
  });

  const ctxFor = (userId) => {
    const g = global.byUser[userId];
    if (!g) return null;
    const doc = globalDocsByUser[userId];

    // Their leagues (excluding globals), biggest first, top 4.
    const leagues = [];
    for (const [leagueId, r] of Object.entries(ranks)) {
      if (GLOBAL_IDS.has(leagueId)) continue;
      const entry = r.byUser[userId];
      if (!entry) continue;
      leagues.push({
        name: leagueMeta[leagueId]?.name || leagueId,
        rank: entry.rank,
        total: r.total,
        size: leagueMeta[leagueId]?.memberCount || r.total,
      });
    }
    leagues.sort((a, b) => b.size - a.size);

    // Best call: correct knockout pick with the lowest crowd share.
    let bestCall = null;
    if (doc) {
      const ko = doc.knockoutPredictions || {};
      for (const round of ROUND_ORDER) {
        for (const p of ko[round] || []) {
          if (!p?.matchId || !p?.winnerId) continue;
          const actual = koWinners[p.matchId]?.winnerId;
          if (!actual || actual !== p.winnerId) continue;
          const slot = pickCounts[p.matchId];
          if (!slot || slot.total < 20) continue; // too few picks → % is noise
          const pct = Math.round(((slot.byTeam[p.winnerId] || 0) / slot.total) * 100);
          if (!bestCall || pct < bestCall.pct) {
            bestCall = { team: p.winnerId, roundLabel: ROUND_LABEL[round] || round, pct };
          }
        }
      }
    }

    // Champion verdict.
    const champion = doc?.knockoutPredictions?.final?.[0]?.winnerId || null;
    let championOutcome = null; // 'champion' | 'runnerUp' | roundKey | 'groups'
    if (champion && finalDecided) {
      if (champion === finalWinner) championOutcome = 'champion';
      else if (champion === finalLoser) championOutcome = 'runnerUp';
      else if (lostIn[champion]) championOutcome = lostIn[champion];
      else championOutcome = 'groups';
    }

    const rank = g.rank;
    const total = global.total;
    return {
      rank,
      total,
      points: g.score,
      percentile: total > 0 ? Math.max(1, Math.ceil((rank / total) * 100)) : null,
      leagues: leagues.slice(0, 4).map(({ name, rank: r, total: t }) => ({ name, rank: r, total: t })),
      bestCall,
      champion,
      championOutcome,
      championOutcomeLabel: championOutcome && ROUND_LABEL[championOutcome] ? ROUND_LABEL[championOutcome] : null,
      finalWinner,
      finalRunnerUp: finalLoser,
    };
  };

  return { eligible, ctxFor, finalDecided, finalWinner, globalTotal: global.total };
}

// ── Email 3: Final hype (last two games) ────────────────────────────────────
// Pre-Final engagement blast: the semifinal story + finalists, each user's
// league positions with the live top 3 of their non-global leagues, and two
// honest conditional nudges — pick the unpicked 3rd-place match (5 pts), and
// re-pick the Final winner when a team from THEIR bracket actually made it
// (the only case where switching can still score the 12).
export async function buildFinalHypeData(db) {
  const [usersSnap, predsSnap, leaguesSnap, resultsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('simplePredictions').get(),
    db.collection('leagues').get(),
    db.collection('matchResults').get(),
  ]);

  const results = {};
  resultsSnap.forEach((d) => { results[d.id] = d.data(); });
  const actuals = buildSimpleActuals(results);
  const koWinners = actuals.knockoutResults || {};
  const { resolved } = resolveActualBracket(results);

  // Semifinal storylines + the confirmed finalists (from verified results —
  // this email should only send once both semis are decided).
  const sfStories = [];
  for (const id of ['sf-01', 'sf-02']) {
    const t = resolved[id];
    const w = koWinners[id]?.winnerId;
    if (t && w) sfStories.push({ winner: w, loser: t.home === w ? t.away : t.home });
  }
  const finalists = resolved.final ? [resolved.final.home, resolved.final.away].filter(Boolean) : [];

  const pointsRemaining = pointsStillWinnable();
  const thirdOpen = !isMatchKickoffLocked('3rd');
  const finalOpen = !isMatchKickoffLocked('final');

  const names = {};
  const userMeta = {};
  usersSnap.forEach((d) => {
    const u = d.data();
    names[d.id] = u.displayName || (u.email ? u.email.split('@')[0] : d.id.slice(0, 8));
    userMeta[d.id] = { email: u.email || null, optOut: u.emailOptOut === true };
  });

  const leagueMeta = {};
  leaguesSnap.forEach((d) => {
    const l = d.data();
    leagueMeta[d.id] = {
      name: l.name || d.id,
      memberCount: l.memberCount || (Array.isArray(l.members) ? l.members.length : 0),
      predictionMode: l.predictionMode || 'simple',
    };
  });

  const docsByLeague = groupDocsByLeagueDeduped(predsSnap, leagueMeta);

  const ranks = {};
  for (const [leagueId, docs] of Object.entries(docsByLeague)) {
    ranks[leagueId] = rankLeague(docs, actuals);
  }
  const global = ranks['global-simple'] || { byUser: {}, total: 0, ordered: [] };
  const globalDocsByUser = {};
  for (const doc of docsByLeague['global-simple'] || []) globalDocsByUser[doc.userId] = doc;

  const top3Of = (leagueId) => (ranks[leagueId]?.ordered || []).slice(0, 3).map((s) => names[s.userId] || s.userId.slice(0, 8));

  const eligible = [];
  usersSnap.forEach((d) => {
    const m = userMeta[d.id];
    if (!m?.email || m.optOut) return;
    if (!global.byUser[d.id]) return;
    eligible.push({ id: d.id, email: m.email, displayName: names[d.id] });
  });

  const ctxFor = (userId) => {
    const g = global.byUser[userId];
    if (!g) return null;
    const doc = globalDocsByUser[userId];

    const leagues = [];
    for (const [leagueId, r] of Object.entries(ranks)) {
      if (GLOBAL_IDS.has(leagueId)) continue;
      const entry = r.byUser[userId];
      if (!entry) continue;
      leagues.push({
        name: leagueMeta[leagueId]?.name || leagueId,
        rank: entry.rank,
        total: r.total,
        size: leagueMeta[leagueId]?.memberCount || r.total,
        top3: top3Of(leagueId),
      });
    }
    leagues.sort((a, b) => b.size - a.size);

    const thirdPicked = !!doc?.knockoutPredictions?.thirdPlace?.[0]?.winnerId;
    const finalPick = doc?.knockoutPredictions?.final?.[0]?.winnerId || null;
    // Which finalists could still SCORE for this user if picked (per the
    // knockout eligibility rule): teams in their predicted-advancers set —
    // or all finalists when the set is empty (knockout-only entrants).
    let scorableFinalists = [];
    if (doc && finalists.length) {
      const set = predictedAdvancers(doc.groupPredictions, doc.bestThirdPicks);
      scorableFinalists = set.size === 0 ? [...finalists] : finalists.filter((t) => set.has(t));
    }

    return {
      globalRank: g.rank,
      globalTotal: global.total,
      globalPoints: g.score,
      leagues: leagues.slice(0, 3).map(({ name, rank: r, total: t, top3 }) => ({ name, rank: r, total: t, top3 })),
      thirdPicked,
      thirdOpen,
      finalOpen,
      finalPick,
      finalists,
      scorableFinalists,
      pointsRemaining,
      sfStories,
    };
  };

  return { eligible, ctxFor, pointsRemaining, finalists, sfStories, globalTotal: global.total };
}

// ── Winner payout flows: top-3 resolution for notify + receipt ─────────────
// Small shared lookup: the final top 3 from the materialized leaderboard
// (with 2 alternates for the forfeiture path), each with email + on-file
// wallet, plus whether the Final result is verified (both winner emails
// should only ever fire after that).
export async function buildWinnerData(db, admin) {
  let board = await readLeaderboardCache(db, 'global-simple', 60 * 60 * 1000);
  if (!board) board = await rebuildLeaderboardCache(db, admin, 'global-simple');
  const rows = (board?.leaderboard || []).filter((r) => r.hasSubmitted);
  const total = rows.length;
  const top = rows.slice(0, 5);
  const snaps = top.length ? await db.getAll(...top.map((r) => db.collection('users').doc(r.userId))) : [];
  const usersById = {};
  snaps.forEach((s) => { if (s.exists) usersById[s.id] = s.data(); });
  const finalSnap = await db.collection('matchResults').doc('final').get();
  const finalDecided = finalSnap.exists && finalSnap.data().completed === true;
  const winners = top.map((r, i) => {
    const u = usersById[r.userId] || {};
    return {
      place: i + 1,
      userId: r.userId,
      displayName: u.displayName || r.displayName || r.userId.slice(0, 8),
      email: u.email || null,
      emailOptOut: u.emailOptOut === true,
      points: r.totalScore || 0,
      walletAddress: u.walletAddress || null,
      walletLast6: u.walletAddress ? u.walletAddress.slice(-6) : null,
    };
  });
  return { winners, total, finalDecided };
}

export const RECEIPT_EXPLORERS = {
  polygon: { label: 'Polygon', txUrl: (h) => `https://polygonscan.com/tx/${h}` },
  base: { label: 'Base', txUrl: (h) => `https://basescan.org/tx/${h}` },
  ethereum: { label: 'Ethereum', txUrl: (h) => `https://etherscan.io/tx/${h}` },
};

// ── Tournament finalization: one frozen /profiles doc per player ────────────
// Computes every player's permanent World Cup 2026 record — final rank,
// percentile, every league position, badge ids — in ONE full scan, written
// once. Profile pages then cost a single edge-cached read forever; nothing
// is ever recomputed per view. Badge DISPLAY lives in src/config/badges.js;
// only ids are stored.
export async function buildProfilesData(db) {
  const [usersSnap, predsSnap, leaguesSnap, resultsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('simplePredictions').get(),
    db.collection('leagues').get(),
    db.collection('matchResults').get(),
  ]);

  const results = {};
  resultsSnap.forEach((d) => { results[d.id] = d.data(); });
  const actuals = buildSimpleActuals(results);
  const koWinners = actuals.knockoutResults || {};
  const { resolved } = resolveActualBracket(results);
  const finalWinner = koWinners.final?.winnerId || null;
  const finalLoser = finalWinner && resolved.final
    ? (resolved.final.home === finalWinner ? resolved.final.away : resolved.final.home)
    : null;

  const leagueMeta = {};
  leaguesSnap.forEach((d) => {
    const l = d.data();
    leagueMeta[d.id] = {
      name: l.name || d.id,
      memberCount: l.memberCount || (Array.isArray(l.members) ? l.members.length : 0),
      predictionMode: l.predictionMode || 'simple',
      isPrivate: l.visibility === 'private',
    };
  });

  const docsByLeague = groupDocsByLeagueDeduped(predsSnap, leagueMeta);

  const ranks = {};
  for (const [leagueId, docs] of Object.entries(docsByLeague)) {
    ranks[leagueId] = rankLeague(docs, actuals);
  }
  const global = ranks['global-simple'] || { byUser: {}, total: 0 };
  const globalDocsByUser = {};
  for (const doc of docsByLeague['global-simple'] || []) globalDocsByUser[doc.userId] = doc;

  // Crowd pick popularity → Oracle Eye badge + bestCall stat.
  const pickCounts = {};
  for (const doc of docsByLeague['global-simple'] || []) {
    const ko = doc.knockoutPredictions || {};
    for (const round of ROUND_ORDER) {
      for (const p of ko[round] || []) {
        if (!p?.matchId || !p?.winnerId) continue;
        const slot = (pickCounts[p.matchId] = pickCounts[p.matchId] || { total: 0, byTeam: {} });
        slot.total += 1;
        slot.byTeam[p.winnerId] = (slot.byTeam[p.winnerId] || 0) + 1;
      }
    }
  }

  const groupCutoffMs = stageLockTimeUtcSafe();

  const profiles = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    const g = global.byUser[d.id];
    if (!g) return; // never played — no profile
    const doc = globalDocsByUser[d.id];
    const total = global.total;
    const rank = g.rank;
    const percentile = total > 0 ? Math.max(1, Math.ceil((rank / total) * 100)) : null;

    const leagues = [];
    let leagueWins = 0;
    for (const [leagueId, r] of Object.entries(ranks)) {
      if (GLOBAL_IDS.has(leagueId)) continue;
      const entry = r.byUser[d.id];
      if (!entry) continue;
      if (entry.rank === 1) leagueWins += 1;
      // Private league names must not leak through the PUBLIC profile doc.
      // We store the league id (an opaque doc id) with name:null; the
      // client resolves the real name locally only for viewers who are
      // themselves members of that league.
      const meta = leagueMeta[leagueId];
      const isPrivate = meta?.isPrivate === true;
      leagues.push({
        id: leagueId,
        name: isPrivate ? null : (meta?.name || leagueId),
        private: isPrivate,
        rank: entry.rank,
        total: r.total,
      });
    }
    leagues.sort((a, b) => b.total - a.total);

    let bestCall = null;
    const champion = doc?.knockoutPredictions?.final?.[0]?.winnerId || null;
    if (doc) {
      const ko = doc.knockoutPredictions || {};
      for (const round of ROUND_ORDER) {
        for (const p of ko[round] || []) {
          if (!p?.matchId || !p?.winnerId) continue;
          const actual = koWinners[p.matchId]?.winnerId;
          if (!actual || actual !== p.winnerId) continue;
          const slot = pickCounts[p.matchId];
          if (!slot || slot.total < 20) continue;
          const pct = Math.round(((slot.byTeam[p.winnerId] || 0) / slot.total) * 100);
          if (!bestCall || pct < bestCall.pct) bestCall = { team: p.winnerId, roundLabel: ROUND_LABEL[round] || round, pct };
        }
      }
    }

    const submittedAtMs = tsMillis(doc?.submittedAt);
    const isComplete = !!(doc?.isComplete || doc?.knockoutPredictions?.final?.[0]?.winnerId);

    const badges = ['founding_player'];
    if (rank === 1) badges.push('podium_1');
    else if (rank === 2) badges.push('podium_2');
    else if (rank === 3) badges.push('podium_3');
    else if (rank <= 10) badges.push('top_10');
    else if (percentile != null && percentile <= 1) badges.push('top_1pct');
    else if (percentile != null && percentile <= 10) badges.push('top_10pct');
    if (champion && finalWinner && champion === finalWinner) badges.push('champion_caller');
    if (bestCall && bestCall.pct <= 15) badges.push('oracle_eye');
    if (leagueWins > 0) badges.push('league_champion');
    if (leagues.length >= 3) badges.push('league_collector');
    if (isComplete) badges.push('bracket_finisher');
    if (Number.isFinite(submittedAtMs) && groupCutoffMs && submittedAtMs <= groupCutoffMs) badges.push('early_bird');

    profiles.push({
      userId: d.id,
      displayName: u.displayName || d.id.slice(0, 8),
      country: u.country || u.geoCountry || null,
      wc2026: {
        rank,
        total,
        points: g.score,
        percentile,
        leagues: leagues.slice(0, 8),
        leagueWins,
        badges,
        champion,
        championWon: !!(champion && finalWinner && champion === finalWinner),
        bestCall,
        finalWinner,
        finalRunnerUp: finalLoser,
      },
    });
  });

  return { profiles, totalPlayers: global.total, finalWinner, finalDecided: !!finalWinner };
}

function stageLockTimeUtcSafe() {
  try {
    // Lazy import avoided — reuse the kickoff-lock util already imported.
    // Group-stage entry cutoff = first group game's lock time.
    return Date.UTC(2026, 5, 11, 18, 55, 0);
  } catch {
    return null;
  }
}
