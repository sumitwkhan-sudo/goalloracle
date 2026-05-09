/**
 * /api/health.js — Oracle API health check
 * Tests connectivity to football-data.org without consuming match data.
 * Admin-only endpoint.
 */

import { applyCors, verifyAuth, db } from './_lib/firebase.js';

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

  const results = {
    timestamp: new Date().toISOString(),
    firebase: { status: 'connected', latency: null },
    oracle1: { name: 'Football-Data.org', status: 'unknown', latency: null, error: null, keySet: false },
    contract: { address: process.env.VERIFIER_CONTRACT || null, deployed: !!process.env.VERIFIER_CONTRACT, rpc: !!process.env.POLYGON_RPC_URL },
    envVars: {},
  };

  results.firebase.status = 'connected';

  const envKeys = [
    'FOOTBALL_DATA_API_KEY',
    'ORACLE_PRIVATE_KEY_1',
    'VERIFIER_CONTRACT',
    'POLYGON_RPC_URL',
  ];
  envKeys.forEach(k => {
    results.envVars[k] = !!process.env[k];
  });

  // Ping competitions endpoint (lightweight, no match data) to confirm key + connectivity.
  const key1 = process.env.FOOTBALL_DATA_API_KEY;
  results.oracle1.keySet = !!key1;
  if (key1) {
    const t1 = Date.now();
    try {
      const resp = await fetch('https://api.football-data.org/v4/competitions/WC', {
        headers: { 'X-Auth-Token': key1 },
        signal: AbortSignal.timeout(8000),
      });
      results.oracle1.latency = Date.now() - t1;
      if (resp.ok) {
        const data = await resp.json();
        results.oracle1.status = 'connected';
        results.oracle1.competition = data.name || 'FIFA World Cup';
        results.oracle1.season = data.currentSeason?.startDate || null;
      } else if (resp.status === 429) {
        results.oracle1.status = 'rate_limited';
        results.oracle1.error = 'Rate limited (10 req/min). Try again shortly.';
      } else {
        results.oracle1.status = 'error';
        results.oracle1.error = `HTTP ${resp.status}`;
      }
    } catch (e) {
      results.oracle1.latency = Date.now() - t1;
      results.oracle1.status = 'error';
      results.oracle1.error = e.message || 'Connection failed';
    }
  } else {
    results.oracle1.status = 'no_key';
    results.oracle1.error = 'FOOTBALL_DATA_API_KEY not set in environment';
  }

  return res.status(200).json(results);
}
