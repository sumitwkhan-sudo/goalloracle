import crypto from 'crypto';
import { db, admin, corsHeaders } from '../_lib/firebase.js';
import {
  normalizeEmail,
  getClientIp,
  ipHash,
  isIpBanned,
  checkAndRecordSignupForIp,
  checkFingerprintAllowsNewAccount,
  recordFingerprintForUser,
  findUserByDedupeKey,
  constantTimeEqualHex,
  isValidVisitorId,
} from '../_lib/security.js';
import { FieldValue } from 'firebase-admin/firestore';

const MAX_ATTEMPTS = 5;

function hashDedupe(dedupe) {
  return crypto.createHash('sha256').update(dedupe).digest('hex');
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

  const { email, code, deviceFingerprint } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if (!/^\d{6}$/.test(code || '')) return res.status(400).json({ error: 'Invalid code' });

  const ip = getClientIp(req);
  if (await isIpBanned(db, ip)) return res.status(403).json({ error: 'Access denied' });

  const dedupe = normalizeEmail(email);
  const docId = hashDedupe(dedupe);

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

    const candidate = crypto.createHash('sha256').update(`${dedupe}:${code}`).digest('hex');
    if (!constantTimeEqualHex(candidate, data.codeHash)) {
      await ref.update({ attempts: (data.attempts || 0) + 1 }).catch(() => {});
      return res.status(400).json({ error: 'Incorrect code' });
    }

    // Success — invalidate the code immediately
    await ref.delete().catch(() => {});

    const existing = await findUserByDedupeKey(db, email);
    const isNewUser = !existing;

    if (isNewUser) {
      // Anti-Sybil checks gate ONLY new-account creation. Existing users are
      // never blocked from signing in — including from a previously-banned
      // IP, since a ban targets the actor, not their old account.
      const fpCheck = await checkFingerprintAllowsNewAccount(db, deviceFingerprint);
      if (!fpCheck.allowed) {
        return res.status(429).json({
          error: 'This device has reached the maximum number of accounts.',
        });
      }
      const ipCheck = await checkAndRecordSignupForIp(db, ip);
      if (!ipCheck.allowed) {
        return res.status(429).json({
          error: 'Too many new accounts from this network recently. Try again tomorrow.',
        });
      }
    }

    const uid = existing?.id || newUserId();
    const firebaseToken = await admin.auth().createCustomToken(uid);

    if (isNewUser && isValidVisitorId(deviceFingerprint)) {
      await recordFingerprintForUser(db, deviceFingerprint, uid, ip);
    }

    return res.status(200).json({
      firebaseToken,
      uid,
      isNewUser,
      // Pass these back so /api/user can persist them on the user doc on
      // first write without re-collecting from the client.
      _signup: isNewUser ? {
        emailDedupeKey: dedupe,
        signupIpHash: ipHash(ip),
        deviceFingerprint: isValidVisitorId(deviceFingerprint) ? deviceFingerprint : null,
      } : null,
    });
  } catch (e) {
    console.error('[auth/verify-code] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
