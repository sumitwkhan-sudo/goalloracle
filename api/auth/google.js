import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { db, admin, applyCors } from '../_lib/firebase.js';
import {
  normalizeEmail,
  isDisposableEmailDomain,
  getClientIp,
  ipHash,
  isIpBanned,
  checkAndRecordSignupForIp,
  checkFingerprintAllowsNewAccount,
  recordFingerprintForUser,
  findUserByDedupeKey,
  isValidVisitorId,
} from '../_lib/security.js';

function newUserId() {
  return `auth_${crypto.randomUUID().replace(/-/g, '')}`;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { idToken, deviceFingerprint } = req.body || {};
  if (!idToken || typeof idToken !== 'string') return res.status(400).json({ error: 'Missing idToken' });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!clientId) return res.status(500).json({ error: 'Google OAuth not configured' });

  const ip = getClientIp(req);
  if (await isIpBanned(db, ip)) return res.status(403).json({ error: 'Access denied' });

  try {
    const client = new OAuth2Client(clientId);
    const ticket = await client.verifyIdToken({ idToken, audience: clientId });
    const payload = ticket.getPayload();
    if (!payload?.email) return res.status(400).json({ error: 'Email missing from Google token' });
    if (payload.email_verified === false) return res.status(400).json({ error: 'Google email is not verified' });

    const email = payload.email.toLowerCase().trim();
    if (isDisposableEmailDomain(email)) return res.status(400).json({ error: 'Please use a real email address' });

    const existing = await findUserByDedupeKey(db, email);
    const isNewUser = !existing;

    if (isNewUser) {
      const fpCheck = await checkFingerprintAllowsNewAccount(db, deviceFingerprint);
      if (!fpCheck.allowed) {
        return res.status(429).json({ error: 'This device has reached the maximum number of accounts.' });
      }
      const ipCheck = await checkAndRecordSignupForIp(db, ip);
      if (!ipCheck.allowed) {
        return res.status(429).json({ error: 'Too many new accounts from this network recently. Try again tomorrow.' });
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
      email,
      _signup: isNewUser ? {
        emailDedupeKey: normalizeEmail(email),
        signupIpHash: ipHash(ip),
        deviceFingerprint: isValidVisitorId(deviceFingerprint) ? deviceFingerprint : null,
      } : null,
    });
  } catch (e) {
    console.error('[auth/google] error:', e);
    return res.status(401).json({ error: 'Invalid Google token' });
  }
}
