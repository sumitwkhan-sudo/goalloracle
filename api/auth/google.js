import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { db, admin, corsHeaders } from '../_lib/firebase.js';

async function findUserByEmail(email) {
  const snap = await db.collection('users').where('email', '==', email).get();
  if (snap.empty) return null;
  const docs = snap.docs;
  if (docs.length === 1) return { id: docs[0].id, ...docs[0].data() };
  const privyDocs = docs.filter(d => d.id.startsWith('did:privy:'));
  if (privyDocs.length > 0) return { id: privyDocs[0].id, ...privyDocs[0].data() };
  return { id: docs[0].id, ...docs[0].data() };
}

function newUserId() {
  return `auth_${crypto.randomUUID().replace(/-/g, '')}`;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({});
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { idToken } = req.body || {};
  if (!idToken || typeof idToken !== 'string') return res.status(400).json({ error: 'Missing idToken' });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });

  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.email) return res.status(400).json({ error: 'Email missing from Google token' });
    if (payload.email_verified === false) return res.status(400).json({ error: 'Google email is not verified' });

    const email = payload.email.toLowerCase().trim();
    const existing = await findUserByEmail(email);
    const uid = existing?.id || newUserId();

    const firebaseToken = await admin.auth().createCustomToken(uid);
    return res.status(200).json({ firebaseToken, uid, isNewUser: !existing, email });
  } catch (e) {
    console.error('[auth/google] error:', e);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
}
