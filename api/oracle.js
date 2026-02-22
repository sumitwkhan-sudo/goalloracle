/**
 * /api/oracle.js — Multi-source match result oracle
 *
 * TWO FREE DATA SOURCES:
 *   1. Football-Data.org  — free, 10 req/min
 *   2. API-Sports.io      — free, 100 req/day (direct, NOT via RapidAPI)
 *
 * Environment Variables:
 *   FOOTBALL_DATA_API_KEY  — from football-data.org/client/register
 *   APISPORTS_API_KEY      — from dashboard.api-football.com (direct signup)
 *   ORACLE_PRIVATE_KEY_1   — wallet for on-chain oracle 1 (later)
 *   ORACLE_PRIVATE_KEY_2   — wallet for on-chain oracle 2 (later)
 *   VERIFIER_CONTRACT      — GoalOracleVerifier address (later)
 *   POLYGON_RPC_URL        — Polygon RPC endpoint
 */

import { corsHeaders, verifyAuth, db } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v)); return res.status(200).json({}); }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const userDoc = await db.collection('users').doc(claims.userId).get();
  const role = userDoc.data()?.role;
  if (role !== 'superadmin' && role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { matchId, fifaMatchId, apiSportsFixtureId, matchDate, homeTeam, awayTeam } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId required' });

  try {
    let source1 = null;
    let source2 = null;

    // Source 1: Football-Data.org
    try { source1 = await fetchFootballDataOrg(fifaMatchId); }
    catch (e) { console.error('Source 1 error:', e.message); }

    // Source 2: API-Sports.io (direct)
    try { source2 = await fetchApiSports(apiSportsFixtureId, matchDate, homeTeam, awayTeam); }
    catch (e) { console.error('Source 2 error:', e.message); }

    // Need at least 2 sources
    if (!source1 && !source2) {
      return res.status(503).json({ error: 'Both data sources failed' });
    }
    if (!source1 || !source2) {
      const available = source1 || source2;
      await db.collection('matchResults').doc(matchId).set({
        status: 'partial',
        availableSource: available,
        missingSource: !source1 ? 'football-data.org' : 'api-sports.io',
        checkedAt: new Date().toISOString(),
      }, { merge: true });
      return res.status(206).json({
        warning: 'Only 1 source returned data — need 2 for verification',
        availableSource: available,
      });
    }

    // Compare
    const agreement = compareResults(source1, source2);

    if (!agreement.match) {
      await db.collection('matchResults').doc(matchId).set({
        status: 'disputed',
        source1, source2,
        disagreement: agreement.details,
        checkedAt: new Date().toISOString(),
      }, { merge: true });
      return res.status(409).json({
        error: 'Sources disagree — manual review needed',
        source1, source2, disagreement: agreement.details,
      });
    }

    // Both agree → verified
    const verifiedResult = {
      homeScore: source1.homeScore,
      awayScore: source1.awayScore,
      extraTime: source1.extraTime || false,
      penalties: source1.penalties || false,
      penHome: source1.penHome || 0,
      penAway: source1.penAway || 0,
      completed: true,
      verified: true,
      verifiedAt: new Date().toISOString(),
      sources: ['football-data.org', 'api-sports.io'],
      confirmations: 2,
    };

    await db.collection('matchResults').doc(matchId).set(verifiedResult);

    // Submit to smart contract if deployed
    let txHashes = [];
    if (process.env.VERIFIER_CONTRACT && process.env.POLYGON_RPC_URL) {
      txHashes = await submitToContract(matchId, verifiedResult);
    }

    return res.status(200).json({ success: true, matchId, result: verifiedResult, txHashes });
  } catch (e) {
    console.error('Oracle error:', e);
    return res.status(500).json({ error: e.message });
  }
}


// ─────────────────────────────────────────────────────────────────
// SOURCE 1: Football-Data.org
// Free: 10 req/min, World Cup = competition 2000
// Sign up: https://www.football-data.org/client/register
// Key emailed instantly
// ─────────────────────────────────────────────────────────────────
async function fetchFootballDataOrg(fifaMatchId) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY not set');
  if (!fifaMatchId) throw new Error('fifaMatchId required');

  const resp = await fetch(
    `https://api.football-data.org/v4/matches/${fifaMatchId}`,
    { headers: { 'X-Auth-Token': apiKey } }
  );
  if (!resp.ok) throw new Error(`football-data.org: ${resp.status}`);
  const data = await resp.json();

  if (data.status !== 'FINISHED') throw new Error(`Not finished: ${data.status}`);

  const ft = data.score?.fullTime || {};
  const pen = data.score?.penalties || {};
  const duration = data.score?.duration;

  return {
    source: 'football-data.org',
    homeScore: ft.home ?? 0,
    awayScore: ft.away ?? 0,
    extraTime: duration === 'EXTRA_TIME' || duration === 'PENALTY_SHOOTOUT',
    penalties: duration === 'PENALTY_SHOOTOUT',
    penHome: pen.home ?? 0,
    penAway: pen.away ?? 0,
  };
}


// ─────────────────────────────────────────────────────────────────
// SOURCE 2: API-Sports.io (API-Football direct — NOT RapidAPI)
// Free: 100 req/day, resets midnight UTC
// Sign up: https://dashboard.api-football.com/register
// Key on dashboard under Account → My Access
// Base URL: https://v3.football.api-sports.io/
// Header: x-apisports-key (NOT x-rapidapi-key)
// World Cup 2026 league ID = 1 (FIFA World Cup)
// ─────────────────────────────────────────────────────────────────
async function fetchApiSports(fixtureId, matchDate, homeTeam, awayTeam) {
  const apiKey = process.env.APISPORTS_API_KEY;
  if (!apiKey) throw new Error('APISPORTS_API_KEY not set');

  let url;
  if (fixtureId) {
    // Direct fixture lookup (fastest, 1 request)
    url = `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`;
  } else if (matchDate) {
    // Search by date + World Cup league
    url = `https://v3.football.api-sports.io/fixtures?league=1&season=2026&date=${matchDate}`;
  } else {
    throw new Error('Need fixtureId or matchDate');
  }

  const resp = await fetch(url, {
    headers: {
      'x-apisports-key': apiKey,
    },
  });
  if (!resp.ok) throw new Error(`api-sports.io: ${resp.status}`);
  const data = await resp.json();

  const fixtures = data.response;
  if (!fixtures || fixtures.length === 0) throw new Error('No fixtures found');

  // Find the right match
  let fixture;
  if (fixtureId) {
    fixture = fixtures[0];
  } else {
    // Match by team name
    fixture = fixtures.find(f => {
      const h = f.teams?.home?.name?.toLowerCase() || '';
      const a = f.teams?.away?.name?.toLowerCase() || '';
      const ht = homeTeam?.toLowerCase() || '';
      const at = awayTeam?.toLowerCase() || '';
      return (h.includes(ht) || ht.includes(h)) && (a.includes(at) || at.includes(a));
    });
  }

  if (!fixture) throw new Error(`Match not found: ${homeTeam} vs ${awayTeam}`);

  const status = fixture.fixture?.status?.short;
  if (status !== 'FT' && status !== 'AET' && status !== 'PEN') {
    throw new Error(`Match not finished: ${status}`);
  }

  const goals = fixture.goals || {};
  const score = fixture.score || {};
  const penScore = score.penalty || {};
  const etScore = score.extratime || {};

  const hasET = status === 'AET' || status === 'PEN' ||
    (etScore.home != null && (etScore.home > 0 || etScore.away > 0));
  const hasPen = status === 'PEN' ||
    (penScore.home != null && (penScore.home > 0 || penScore.away > 0));

  return {
    source: 'api-sports.io',
    homeScore: goals.home ?? 0,
    awayScore: goals.away ?? 0,
    extraTime: hasET,
    penalties: hasPen,
    penHome: penScore.home ?? 0,
    penAway: penScore.away ?? 0,
  };
}


// ─────────────────────────────────────────────────────────────────
// COMPARISON
// ─────────────────────────────────────────────────────────────────
function compareResults(s1, s2) {
  const checks = [
    { field: 'homeScore', a: s1.homeScore, b: s2.homeScore },
    { field: 'awayScore', a: s1.awayScore, b: s2.awayScore },
    { field: 'extraTime', a: s1.extraTime, b: s2.extraTime },
    { field: 'penalties', a: s1.penalties, b: s2.penalties },
  ];
  if (s1.penalties || s2.penalties) {
    checks.push({ field: 'penHome', a: s1.penHome, b: s2.penHome });
    checks.push({ field: 'penAway', a: s1.penAway, b: s2.penAway });
  }
  const failures = checks.filter(c => c.a !== c.b);
  if (failures.length === 0) return { match: true };
  return { match: false, details: failures.map(f => `${f.field}: src1=${f.a}, src2=${f.b}`).join('; ') };
}


// ─────────────────────────────────────────────────────────────────
// CONTRACT SUBMISSION (placeholder until deployed)
// ─────────────────────────────────────────────────────────────────
async function submitToContract(matchId, result) {
  console.log(`[Oracle] Contract not yet deployed — match: ${matchId}`);
  return [];
}
