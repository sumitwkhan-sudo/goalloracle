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

import { applyCors, verifyAuth, db } from './_lib/firebase.js';
import {
  parseFootballDataResponse,
  parseApiSportsResponse,
  compareResults,
} from './_lib/oracleParsers.js';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

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
  return parseFootballDataResponse(data);
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
    url = `https://v3.football.api-sports.io/fixtures?id=${fixtureId}`;
  } else if (matchDate) {
    url = `https://v3.football.api-sports.io/fixtures?league=1&season=2026&date=${matchDate}`;
  } else {
    throw new Error('Need fixtureId or matchDate');
  }

  const resp = await fetch(url, { headers: { 'x-apisports-key': apiKey } });
  if (!resp.ok) throw new Error(`api-sports.io: ${resp.status}`);
  const data = await resp.json();
  return parseApiSportsResponse(data, { fixtureId, homeTeam, awayTeam });
}


// ─────────────────────────────────────────────────────────────────
// CONTRACT SUBMISSION (placeholder until deployed)
// ─────────────────────────────────────────────────────────────────
async function submitToContract(matchId, result) {
  console.log(`[Oracle] Contract not yet deployed — match: ${matchId}`);
  return [];
}
