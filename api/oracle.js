/**
 * /api/oracle.js — Match result oracle (single source).
 *
 * Originally this used two providers (football-data.org + api-sports.io)
 * with cross-source verification. api-sports.io's free tier doesn't
 * include current World Cup data, so we now rely on football-data.org
 * alone. Result-correctness fallback: any user can email
 * support@goaloracle.io to contest a result; superadmins can override
 * via /api/admin → updateResult.
 *
 * Environment Variables:
 *   FOOTBALL_DATA_API_KEY  — from football-data.org/client/register
 *   VERIFIER_CONTRACT      — GoalOracleVerifier address (later)
 *   POLYGON_RPC_URL        — Polygon RPC endpoint
 */

import { applyCors, verifyAuth, db } from './_lib/firebase.js';
import { parseFootballDataResponse } from './_lib/oracleParsers.js';

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

  const { matchId, fifaMatchId } = req.body;
  if (!matchId) return res.status(400).json({ error: 'matchId required' });

  try {
    let result;
    try {
      result = await fetchFootballDataOrg(fifaMatchId);
    } catch (e) {
      console.error('football-data.org error:', e.message);
      return res.status(503).json({ error: `football-data.org unavailable: ${e.message}` });
    }

    const verifiedResult = {
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      extraTime: result.extraTime || false,
      penalties: result.penalties || false,
      penHome: result.penHome || 0,
      penAway: result.penAway || 0,
      completed: true,
      verified: true,
      verifiedAt: new Date().toISOString(),
      sources: ['football-data.org'],
      confirmations: 1,
    };

    await db.collection('matchResults').doc(matchId).set(verifiedResult);

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

async function submitToContract(matchId, result) {
  console.log(`[Oracle] Contract not yet deployed — match: ${matchId}`);
  return [];
}
