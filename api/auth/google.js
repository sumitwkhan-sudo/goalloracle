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
  checkIpAllowsNewAccount,
  recordFingerprintForUser,
  recordIpForUser,
  getMaskedEmailForIp,
  isAntiSybilBypassEmail,
  findUserByDedupeKey,
  isValidVisitorId,
  SUPPORT_EMAIL,
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
      // Operator allowlist: emails in ANTI_SYBIL_BYPASS_EMAILS skip the
      // per-device + per-IP single-account checks. Lets the operator keep
      // multiple test accounts on their own laptop / phone during QA.
      const bypass = await isAntiSybilBypassEmail(db, email);
      // Device-fingerprint signal is LOG-ONLY — it no longer blocks signup. The
      // open-source fingerprint collides across same-model phones, so a hard
      // block here was rejecting legitimate first-time users. The per-IP rate
      // limit + cap below still stop bursty farming from one network. We keep
      // computing it purely for observability.
      if (!bypass) {
        try {
          const fpCheck = await checkFingerprintAllowsNewAccount(db, deviceFingerprint);
          if (!fpCheck.allowed) {
            console.warn(`[anti-sybil] fingerprint collision (non-blocking): ${fpCheck.count} accounts share this device fingerprint; allowing new signup`);
          }
        } catch { /* a monitoring read must never block a signup */ }
      }
      const ipUniqueCheck = bypass ? { allowed: true } : await checkIpAllowsNewAccount(db, ip);
      if (!ipUniqueCheck.allowed) {
        // Mask only — never reveal another account's full email to a new user
        // (the existing account belongs to a different person by construction,
        // since this only fires for a brand-new signup email).
        const maskedEmail = await getMaskedEmailForIp(db, ip);
        return res.status(429).json({
          error: 'ip_account_exists',
          message: "Looks like you've already got an account from this network.",
          maskedEmail,
          supportEmail: SUPPORT_EMAIL,
        });
      }
      const ipCheck = bypass ? { allowed: true } : await checkAndRecordSignupForIp(db, ip);
      if (!ipCheck.allowed) {
        return res.status(429).json({
          error: 'ip_rate_limit',
          message: 'Too many new accounts from this network recently. Try again tomorrow.',
          supportEmail: SUPPORT_EMAIL,
        });
      }
    }

    const uid = existing?.id || newUserId();
    const firebaseToken = await admin.auth().createCustomToken(uid);

    if (isNewUser) {
      if (isValidVisitorId(deviceFingerprint)) {
        await recordFingerprintForUser(db, deviceFingerprint, uid, ip);
      }
      await recordIpForUser(db, ip, uid);
    }

    // Persist the verified email server-side BEFORE returning the token.
    // Custom-token sign-in strips email from the Firebase user record, so
    // the client's createOrUpdateUser sees fbUser.email === null and used
    // to write null into Firestore. Writing here closes the loop:
    //   - new users: the doc gets created later by createOrUpdateUser; we
    //     write a sparse {email, emailDedupeKey} now and merge: true
    //     ensures a later setDoc with same fields keeps these.
    //   - existing users with email already populated: noop (merge).
    //   - existing users with email == null (legacy): we backfill it.
    try {
      await db.collection('users').doc(uid).set({
        email,
        emailDedupeKey: normalizeEmail(email),
        emailUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    } catch (e) {
      console.warn('[auth/google] email upsert failed:', e?.message);
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
