import crypto from 'crypto';
import { Resend } from 'resend';
import { db, admin, applyCors } from '../_lib/firebase.js';
import {
  normalizeEmail,
  isDisposableEmailDomain,
  getClientIp,
  isIpBanned,
  checkAndRecordCodeRequestForIp,
} from '../_lib/security.js';
import { FieldValue } from 'firebase-admin/firestore';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CODES_PER_HOUR = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Index code docs by the dedupe key so alias attempts (foo+1@gmail.com,
// foo+2@gmail.com) all share one rate-limit bucket per real mailbox.
function hashDedupe(dedupe) {
  return crypto.createHash('sha256').update(dedupe).digest('hex');
}

function hashCode(code, dedupe) {
  return crypto.createHash('sha256').update(`${dedupe}:${code}`).digest('hex');
}

function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

function buildEmailHtml(code) {
  return `<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 16px; color: #111;">
  <h2 style="margin: 0 0 16px; font-size: 22px;">Your GoalOracle sign-in code</h2>
  <p style="font-size: 15px; line-height: 1.5; color: #333;">Enter this 6-digit code to finish signing in. It expires in 5 minutes.</p>
  <div style="font-size: 36px; font-weight: 700; letter-spacing: 8px; margin: 24px 0; padding: 16px 0; text-align: center; background: #f5f5f7; border-radius: 12px; color: #111;">${code}</div>
  <p style="font-size: 13px; color: #777; line-height: 1.5;">If you didn't request this, you can safely ignore this email.</p>
</body></html>`;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });
  if (isDisposableEmailDomain(email)) return res.status(400).json({ error: 'Please use a real email address' });

  const ip = getClientIp(req);
  if (await isIpBanned(db, ip)) return res.status(403).json({ error: 'Access denied' });

  const ipCheck = await checkAndRecordCodeRequestForIp(db, ip);
  if (!ipCheck.allowed) {
    return res.status(429).json({ error: 'Too many sign-in attempts from this network. Try again later.' });
  }

  const dedupe = normalizeEmail(email);
  const docId = hashDedupe(dedupe);
  const now = Date.now();

  try {
    const ref = db.collection('authCodes').doc(docId);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;

    // Rate limit: max 3 codes per dedupe-key per hour
    if (existing?.history) {
      const recent = existing.history.filter(t => now - t < RATE_WINDOW_MS);
      if (recent.length >= MAX_CODES_PER_HOUR) {
        return res.status(429).json({ error: 'Too many codes requested. Try again in an hour.' });
      }
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = hashCode(code, dedupe);

    // Bind the code to this browser session: a random token in an
    // httpOnly cookie, with its sha256 stored on the authCodes doc.
    // verify-code requires the same cookie value, so an intercepted code
    // can't be redeemed from a different device or tab.
    const sessionToken = crypto.randomBytes(24).toString('base64url');
    const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');

    const newHistory = [...(existing?.history || []).filter(t => now - t < RATE_WINDOW_MS), now];

    await ref.set({
      email: email.toLowerCase().trim(),
      dedupe,
      codeHash,
      sessionTokenHash,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      history: newHistory,
    }, { merge: false });

    // 600s = slightly longer than CODE_TTL_MS so the cookie outlives the
    // code itself and we can produce clean error messages on retries.
    const isProd = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    res.setHeader('Set-Cookie',
      `goaloracle_signin_session=${sessionToken}; HttpOnly; Path=/; Max-Age=600; SameSite=Lax${isProd ? '; Secure' : ''}`
    );

    if (!process.env.RESEND_API_KEY) {
      // Dev fallback: log code to server logs so local dev still works.
      console.log(`[auth] DEV: code for ${email} = ${code}`);
    } else {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.RESEND_FROM_EMAIL || 'GoalOracle <noreply@goaloracle.com>';
      const result = await resend.emails.send({
        from,
        to: email.toLowerCase().trim(),
        subject: `${code} is your GoalOracle sign-in code`,
        html: buildEmailHtml(code),
      });
      if (result.error) {
        console.error('[auth] Resend send failed:', result.error);
        return res.status(500).json({ error: 'Failed to send email' });
      }
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('[auth/request-code] error:', e);
    return res.status(500).json({ error: e.message });
  }
}
