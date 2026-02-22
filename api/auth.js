import { admin, corsHeaders, verifyAuth } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({});
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const userId = claims.userId || claims.sub;
  if (!userId) return res.status(500).json({ error: 'No user ID in auth claims' });

  try {
    const firebaseToken = await admin.auth().createCustomToken(userId);
    return res.status(200).json({ firebaseToken });
  } catch (e) {
    console.error('[auth] Failed to mint Firebase token:', e.message);
    return res.status(500).json({ error: 'Failed to create Firebase token' });
  }
}
