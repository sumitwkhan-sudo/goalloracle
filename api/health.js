/**
 * /api/health.js — Oracle API health check
 * Tests connectivity to both data sources without consuming match data.
 * Admin-only endpoint.
 */

import { corsHeaders, verifyAuth, db } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

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
    oracle2: { name: 'API-Sports.io', status: 'unknown', latency: null, error: null, keySet: false },
    contract: { address: process.env.VERIFIER_CONTRACT || null, deployed: !!process.env.VERIFIER_CONTRACT, rpc: !!process.env.POLYGON_RPC_URL },
    envVars: {},
  };

  // Firebase is already connected if we got here
  results.firebase.status = 'connected';

  // Check env vars
  const envKeys = [
    'FOOTBALL_DATA_API_KEY',
    'APISPORTS_API_KEY',
    'ORACLE_PRIVATE_KEY_1',
    'ORACLE_PRIVATE_KEY_2',
    'VERIFIER_CONTRACT',
    'POLYGON_RPC_URL',
  ];
  envKeys.forEach(k => {
    results.envVars[k] = !!process.env[k];
  });

  // Test Oracle 1: Football-Data.org — ping competitions endpoint (lightweight, no match data)
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

  // Test Oracle 2: API-Sports.io — ping status endpoint (free, doesn't count toward quota)
  const key2 = process.env.APISPORTS_API_KEY;
  results.oracle2.keySet = !!key2;
  if (key2) {
    const t2 = Date.now();
    try {
      const resp = await fetch('https://v3.football.api-sports.io/status', {
        headers: { 'x-apisports-key': key2 },
        signal: AbortSignal.timeout(8000),
      });
      results.oracle2.latency = Date.now() - t2;
      if (resp.ok) {
        const data = await resp.json();
        const account = data.response?.account || {};
        const subscription = data.response?.subscription || {};
        const requests = data.response?.requests || {};
        results.oracle2.status = 'connected';
        results.oracle2.plan = subscription.plan || 'Free';
        results.oracle2.requestsToday = requests.current || 0;
        results.oracle2.requestsLimit = requests.limit_day || 100;
      } else {
        results.oracle2.status = 'error';
        results.oracle2.error = `HTTP ${resp.status}`;
      }
    } catch (e) {
      results.oracle2.latency = Date.now() - t2;
      results.oracle2.status = 'error';
      results.oracle2.error = e.message || 'Connection failed';
    }
  } else {
    results.oracle2.status = 'no_key';
    results.oracle2.error = 'APISPORTS_API_KEY not set in environment';
  }

  return res.status(200).json(results);
}
