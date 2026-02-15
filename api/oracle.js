/**
 * /api/oracle.js — Multi-source match result oracle
 *
 * Fetches results from 2+ independent football data APIs and
 * submits them to the GoalOracleVerifier smart contract.
 *
 * Data Sources:
 *   1. Football-Data.org (free tier available)
 *   2. API-Football (via RapidAPI)
 *
 * Flow:
 *   1. Admin triggers verification for a matchId
 *   2. Server fetches result from Source A
 *   3. Server fetches result from Source B
 *   4. If both sources agree → submits to smart contract as 2 oracle txns
 *   5. Smart contract verifies 2+ confirmations → marks as VERIFIED
 *   6. Payout can proceed after dispute window (1hr)
 *
 * Environment Variables Required:
 *   FOOTBALL_DATA_API_KEY - from football-data.org
 *   RAPID_API_KEY         - from rapidapi.com (API-Football)
 *   ORACLE_PRIVATE_KEY_1  - wallet key for oracle source 1
 *   ORACLE_PRIVATE_KEY_2  - wallet key for oracle source 2
 *   VERIFIER_CONTRACT     - deployed GoalOracleVerifier address
 *   POLYGON_RPC_URL       - Polygon RPC endpoint
 */

import { corsHeaders, verifyAuth, db } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  // Only admins can trigger oracle verification
  const userDoc = await db.collection('users').doc(claims.userId).get();
  const role = userDoc.data()?.role;
  if (role !== 'superadmin' && role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { matchId, fifaMatchId } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId required' });

  try {
    // ── Source 1: Football-Data.org ──────────────────────────
    const source1 = await fetchFootballDataOrg(fifaMatchId);

    // ── Source 2: API-Football (RapidAPI) ────────────────────
    const source2 = await fetchApiFootball(fifaMatchId);

    // ── Compare results ─────────────────────────────────────
    const agreement = compareResults(source1, source2);

    if (!agreement.match) {
      // Sources disagree — flag for manual review
      await db.collection('matchResults').doc(matchId).set({
        status: 'disputed',
        source1,
        source2,
        disagreement: agreement.details,
        checkedAt: new Date().toISOString(),
      }, { merge: true });

      return res.status(409).json({
        error: 'Sources disagree — manual review needed',
        source1,
        source2,
        disagreement: agreement.details,
      });
    }

    // ── Sources agree — store verified result ───────────────
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
      sources: ['football-data.org', 'api-football'],
      confirmations: 2,
    };

    await db.collection('matchResults').doc(matchId).set(verifiedResult);

    // ── Submit to smart contract (if deployed) ──────────────
    let txHashes = [];
    if (process.env.VERIFIER_CONTRACT && process.env.POLYGON_RPC_URL) {
      txHashes = await submitToContract(matchId, verifiedResult);
    }

    return res.status(200).json({
      success: true,
      matchId,
      result: verifiedResult,
      txHashes,
    });

  } catch (e) {
    console.error('Oracle error:', e);
    return res.status(500).json({ error: e.message });
  }
}


// ─── Data Source Fetchers ────────────────────────────────────────

async function fetchFootballDataOrg(fifaMatchId) {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY not set');

  // Football-Data.org uses competition 2000 for World Cup
  const url = fifaMatchId
    ? `https://api.football-data.org/v4/matches/${fifaMatchId}`
    : null;

  if (!url) return null;

  const resp = await fetch(url, {
    headers: { 'X-Auth-Token': apiKey },
  });

  if (!resp.ok) throw new Error(`Football-Data API: ${resp.statusText}`);
  const data = await resp.json();

  const ft = data.score?.fullTime || {};
  const ht = data.score?.halfTime || {};
  const et = data.score?.extraTime || {};
  const pen = data.score?.penalties || {};

  return {
    source: 'football-data.org',
    homeScore: ft.home ?? 0,
    awayScore: ft.away ?? 0,
    extraTime: data.score?.duration === 'EXTRA_TIME' || (et.home != null && et.home > 0) || (et.away != null && et.away > 0),
    penalties: data.score?.duration === 'PENALTY_SHOOTOUT' || (pen.home != null),
    penHome: pen.home ?? 0,
    penAway: pen.away ?? 0,
    status: data.status,
    raw: data.score,
  };
}

async function fetchApiFootball(fifaMatchId) {
  const apiKey = process.env.RAPID_API_KEY;
  if (!apiKey) throw new Error('RAPID_API_KEY not set');

  // API-Football on RapidAPI
  const url = `https://api-football-v1.p.rapidapi.com/v3/fixtures?id=${fifaMatchId}`;

  const resp = await fetch(url, {
    headers: {
      'X-RapidAPI-Key': apiKey,
      'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com',
    },
  });

  if (!resp.ok) throw new Error(`API-Football: ${resp.statusText}`);
  const data = await resp.json();
  const fixture = data.response?.[0];

  if (!fixture) throw new Error('No fixture data from API-Football');

  const goals = fixture.goals || {};
  const score = fixture.score || {};

  return {
    source: 'api-football',
    homeScore: goals.home ?? 0,
    awayScore: goals.away ?? 0,
    extraTime: score.extratime?.home != null && score.extratime.home > 0,
    penalties: score.penalty?.home != null && score.penalty.home > 0,
    penHome: score.penalty?.home ?? 0,
    penAway: score.penalty?.away ?? 0,
    status: fixture.fixture?.status?.short,
    raw: score,
  };
}


// ─── Comparison ─────────────────────────────────────────────────

function compareResults(s1, s2) {
  if (!s1 || !s2) {
    return { match: false, details: 'One or both sources returned no data' };
  }

  const checks = [
    { field: 'homeScore', a: s1.homeScore, b: s2.homeScore },
    { field: 'awayScore', a: s1.awayScore, b: s2.awayScore },
    { field: 'extraTime', a: s1.extraTime, b: s2.extraTime },
    { field: 'penalties', a: s1.penalties, b: s2.penalties },
  ];

  // If penalties, also check shootout scores
  if (s1.penalties || s2.penalties) {
    checks.push({ field: 'penHome', a: s1.penHome, b: s2.penHome });
    checks.push({ field: 'penAway', a: s1.penAway, b: s2.penAway });
  }

  const failures = checks.filter(c => c.a !== c.b);

  if (failures.length === 0) {
    return { match: true };
  }

  return {
    match: false,
    details: failures.map(f => `${f.field}: source1=${f.a}, source2=${f.b}`).join('; '),
  };
}


// ─── Smart Contract Submission ──────────────────────────────────

async function submitToContract(matchId, result) {
  // This would use ethers.js to submit to Polygon
  // Placeholder — will be implemented when contract is deployed
  //
  // const { ethers } = await import('ethers');
  // const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
  //
  // Oracle 1 submission:
  // const wallet1 = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY_1, provider);
  // const contract1 = new ethers.Contract(VERIFIER_CONTRACT, ABI, wallet1);
  // const tx1 = await contract1.submitResult(matchId, ...result);
  //
  // Oracle 2 submission:
  // const wallet2 = new ethers.Wallet(process.env.ORACLE_PRIVATE_KEY_2, provider);
  // const contract2 = new ethers.Contract(VERIFIER_CONTRACT, ABI, wallet2);
  // const tx2 = await contract2.submitResult(matchId, ...result);
  //
  // return [tx1.hash, tx2.hash];

  console.log(`[Oracle] Would submit to contract for match ${matchId}`);
  return [];
}
