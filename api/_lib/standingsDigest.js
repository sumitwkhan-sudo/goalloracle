/**
 * standingsDigest — data plumbing for the "Where you stand" engagement email.
 *
 * One shared computation (leaderboards for every league, eliminated-team set,
 * points still winnable on unlocked games, auto-drafted results recap), then a
 * cheap per-user ctx lookup. Consumed by the admin action `standingsDigestRun`
 * (canary preview + chunked scheduled send) and rendered by the
 * `standingsDigest` template in outreachEmail.js.
 *
 * Read cost: users + all simplePredictions + leagues + matchResults — a few
 * thousand one-time reads per run, NOT per recipient.
 */

import WORLD_CUP_MATCHES from '../../src/data/matches.js';
import { isMatchKickoffLocked } from '../../src/utils/stageLock.js';
import { calculateSimpleScore, KNOCKOUT_POINTS_PER_PICK } from '../../src/utils/scoringSimple.js';
import { buildSimpleActuals, resolveActualBracket } from './bracketResolver.js';
import { getRoundForMatchId } from '../../src/utils/bracketUtils.js';

const GLOBAL_IDS = new Set(['global', 'global-simple']);

function hasAnyPicks(doc) {
  if (!doc) return false;
  const groups = doc.groupPredictions || {};
  if (Object.values(groups).some((g) => Array.isArray(g?.ranking) && g.ranking.filter(Boolean).length > 0)) return true;
  if (Array.isArray(doc.bestThirdPicks) && doc.bestThirdPicks.length > 0) return true;
  const ko = doc.knockoutPredictions || {};
  return Object.values(ko).some((arr) => Array.isArray(arr) && arr.some((p) => p?.winnerId));
}

function tsMillis(ts) {
  if (!ts) return Infinity; // never-submitted sorts last on ties
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts._seconds) return ts._seconds * 1000;
  return Infinity;
}

// Rank a league's prediction docs the same way the leaderboard does:
// total points desc, then earliest submission, then userId for stability.
function rankLeague(docs, actuals) {
  const scored = docs.map((d) => ({
    userId: d.userId,
    score: calculateSimpleScore(d, actuals).totalScore || 0,
    submittedAtMs: tsMillis(d.submittedAt),
    champion: d.knockoutPredictions?.final?.[0]?.winnerId || null,
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.submittedAtMs !== b.submittedAtMs) return a.submittedAtMs - b.submittedAtMs;
    return String(a.userId).localeCompare(String(b.userId));
  });
  const byUser = {};
  scored.forEach((s, i) => { byUser[s.userId] = { rank: i + 1, ...s }; });
  return { ordered: scored, byUser, total: scored.length, leaderPoints: scored[0]?.score || 0 };
}

export async function buildStandingsDigestData(db) {
  const [usersSnap, predsSnap, leaguesSnap, resultsSnap] = await Promise.all([
    db.collection('users').get(),
    db.collection('simplePredictions').get(),
    db.collection('leagues').get(),
    db.collection('matchResults').get(),
  ]);

  const results = {};
  resultsSnap.forEach((d) => { results[d.id] = d.data(); });
  const actuals = buildSimpleActuals(results);

  // Group prediction docs per league. Skip the legacy /simplePredictions/{uid}
  // docs (no leagueId) — the composite global doc supersedes them, and double
  // counting a user would corrupt ranks.
  const docsByLeague = {};
  predsSnap.forEach((d) => {
    const data = d.data();
    if (!data?.userId || !data?.leagueId) return;
    if (!hasAnyPicks(data)) return;
    (docsByLeague[data.leagueId] = docsByLeague[data.leagueId] || []).push(data);
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

  // Rank every Quick Picks league that has entrants (global + private/public).
  const ranks = {};
  for (const [leagueId, docs] of Object.entries(docsByLeague)) {
    if (leagueMeta[leagueId]?.predictionMode === 'classic') continue;
    ranks[leagueId] = rankLeague(docs, actuals);
  }
  const global = ranks['global-simple'] || { byUser: {}, total: 0, leaderPoints: 0 };

  // Eliminated teams: lost a decided knockout game, or (all groups complete)
  // never reached the real R32 at all. Drives the champion-alive/out branch.
  const { resolved, allGroupsComplete } = resolveActualBracket(results);
  const eliminated = new Set();
  const koWinners = actuals.knockoutResults || {};
  const inR32 = new Set();
  for (const m of WORLD_CUP_MATCHES.filter((x) => x.id.startsWith('r32-'))) {
    const r = resolved[m.id];
    if (r) { inR32.add(r.home); inR32.add(r.away); }
  }
  for (const [matchId, r] of Object.entries(resolved)) {
    const w = koWinners[matchId]?.winnerId;
    if (!w) continue;
    if (r.home && r.home !== w) eliminated.add(r.home);
    if (r.away && r.away !== w) eliminated.add(r.away);
  }
  const teamEliminated = (team) => {
    if (!team) return false;
    if (eliminated.has(team)) return true;
    if (allGroupsComplete && inR32.size >= 32 && !inR32.has(team)) return true;
    return false;
  };

  // Points still winnable: knockout games whose kickoff lock hasn't fired.
  let pointsRemaining = 0;
  for (const m of WORLD_CUP_MATCHES.filter((x) => x.isKnockout)) {
    if (isMatchKickoffLocked(m.id)) continue;
    pointsRemaining += KNOCKOUT_POINTS_PER_PICK[getRoundForMatchId(m.id)] || 0;
  }

  // Auto-draft recap from decided knockout results, latest four in
  // chronological order. Factual by construction; the operator edits the
  // narrative color before sending.
  const decided = WORLD_CUP_MATCHES
    .filter((m) => m.isKnockout && resolved[m.id] && koWinners[m.id]?.winnerId)
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));
  const recapBits = decided.slice(-4).map((m) => {
    const r = resolved[m.id];
    const w = koWinners[m.id].winnerId;
    const loser = r.home === w ? r.away : r.home;
    return `${w} beat ${loser}`;
  });
  const autoRecap = recapBits.length
    ? `The knockouts are heating up: ${recapBits.join('; ')}. Nobody's bracket is safe.`
    : `The knockout rounds are under way — and nobody's bracket is safe.`;

  // Per-user: biggest non-global Quick Picks league they have an entry in.
  const biggestLeagueFor = (userId) => {
    let best = null;
    for (const [leagueId, r] of Object.entries(ranks)) {
      if (GLOBAL_IDS.has(leagueId)) continue;
      const entry = r.byUser[userId];
      if (!entry) continue;
      const size = leagueMeta[leagueId]?.memberCount || r.total;
      if (!best || size > best.size) {
        best = { leagueId, name: leagueMeta[leagueId]?.name || leagueId, rank: entry.rank, total: r.total, size };
      }
    }
    return best;
  };

  // Eligible recipients: email on file, not opted out, has global picks.
  const eligible = [];
  usersSnap.forEach((d) => {
    const u = d.data();
    if (!u.email || u.emailOptOut === true) return;
    if (!global.byUser[d.id]) return;
    eligible.push({ id: d.id, email: u.email, displayName: u.displayName || null });
  });

  const ctxFor = (userId, recap) => {
    const g = global.byUser[userId];
    if (!g) return null;
    const league = biggestLeagueFor(userId);
    return {
      recap,
      globalRank: g.rank,
      globalTotal: global.total,
      globalPoints: g.score,
      leaderPoints: global.leaderPoints,
      leagueName: league?.name || null,
      leagueRank: league?.rank || null,
      leagueTotal: league?.total || null,
      champion: g.champion,
      championAlive: g.champion ? !teamEliminated(g.champion) : null,
      pointsRemaining,
    };
  };

  return { eligible, ctxFor, autoRecap, pointsRemaining, globalTotal: global.total };
}
