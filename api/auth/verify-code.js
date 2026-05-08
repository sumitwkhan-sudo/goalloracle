import crypto from 'crypto';
import { db, admin, corsHeaders } from '../_lib/firebase.js';

const MAX_ATTEMPTS = 5;

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function hashCode(code, email) {
  return crypto.createHash('sha256').update(`${email.toLowerCase().trim()}:${code}`).digest('hex');
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// Find an existing user doc by email, preferring legacy did:privy:* IDs so
// existing users keep all their predictions/leagues. Falls back to the most
// recently created doc if multiple match.
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

  const { email, code } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if (!/^\d{6}$/.test(code || '')) return res.status(400).json({ error: 'Invalid code' });

  const normalized = email.toLowerCase().trim();
  const docId = hashEmail(normalized);

  try {
    const ref = db.collection('authCodes').doc(docId);
    const snap = await ref.get();
    if (!snap.exists) return res.status(400).json({ error: 'No code found. Request a new one.' });

    const data = snap.data();
    if (Date.now() > data.expiresAt) {
      await ref.delete().catch(() => {});
      return res.status(400).json({ error: 'Code expired. Request a new one.' });
    }
    if ((data.attempts || 0) >= MAX_ATTEMPTS) {
      await ref.delete().catch(() => {});
      return res.status(429).json({ error: 'Too many attempts. Request a new code.' });
    }

    const candidate = hashCode(code, normalized);
    if (candidate !== data.codeHash) {
      await ref.update({ attempts: (data.attempts || 0) + 1 }).catch(() => {});
      return res.status(400).json({ error: 'Incorrect code' });
    }

    // Success — invalidate the code immediately
    await ref.delete().catch(() => {});

    const existing = await findUserByEmail(normalized);
    const uid = existing?.id || newUserId();

    const firebaseToken = await admin.auth().createCustomToken(uid);
    return res.status(200).json({ firebaseToken, uid, isNewUser: !existing });
  } catch (e) {
    console.error('[auth/verify-code] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
