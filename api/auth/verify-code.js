import crypto from 'crypto';
import { db, admin, applyCors } from '../_lib/firebase.js';
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
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

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

    // Verify the session-binding cookie matches the one set in request-code.
    // Defends against codes intercepted in transit (forwarded mail, etc.) —
    // they can't be redeemed from a different browser session.
    if (data.sessionTokenHash) {
      const cookieHeader = req.headers.cookie || '';
      const cookies = Object.fromEntries(
        cookieHeader.split(';').map(s => {
          const idx = s.indexOf('=');
          if (idx < 0) return [s.trim(), ''];
          return [s.slice(0, idx).trim(), s.slice(idx + 1).trim()];
        }).filter(([k]) => k)
      );
      const sessionToken = cookies['goaloracle_signin_session'] || '';
      if (!sessionToken) {
        return res.status(400).json({ error: 'Sign-in session expired. Request a new code from this browser.' });
      }
      const candidateSessionHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
      if (!constantTimeEqualHex(candidateSessionHash, data.sessionTokenHash)) {
        return res.status(400).json({ error: 'Sign-in session does not match. Request a new code from this browser.' });
      }
    }

    // Success — invalidate the code immediately + clear the session cookie.
    await ref.delete().catch(() => {});
    res.setHeader('Set-Cookie', 'goaloracle_signin_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');

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
