import crypto from 'crypto';
import { Resend } from 'resend';
import { db, admin, corsHeaders } from '../_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

const CODE_TTL_MS = 5 * 60 * 1000;
const MAX_CODES_PER_HOUR = 3;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase().trim()).digest('hex');
}

function hashCode(code, email) {
  return crypto.createHash('sha256').update(`${email.toLowerCase().trim()}:${code}`).digest('hex');
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
  if (req.method === 'OPTIONS') {
    Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
    return res.status(200).json({});
  }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Invalid email' });

  const normalized = email.toLowerCase().trim();
  const docId = hashEmail(normalized);
  const now = Date.now();

  try {
    const ref = db.collection('authCodes').doc(docId);
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;

    // Rate limit: max 3 codes per email per hour
    if (existing?.history) {
      const recent = existing.history.filter(t => now - t < RATE_WINDOW_MS);
      if (recent.length >= MAX_CODES_PER_HOUR) {
        return res.status(429).json({ error: 'Too many codes requested. Try again in an hour.' });
      }
    }

    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const codeHash = hashCode(code, normalized);

    const newHistory = [...(existing?.history || []).filter(t => now - t < RATE_WINDOW_MS), now];

    await ref.set({
      email: normalized,
      codeHash,
      expiresAt: now + CODE_TTL_MS,
      attempts: 0,
      createdAt: FieldValue.serverTimestamp(),
      history: newHistory,
    }, { merge: false });

    if (!process.env.RESEND_API_KEY) {
      // Dev fallback: log code to server logs so local dev still works.
      console.log(`[auth] DEV: code for ${normalized} = ${code}`);
    } else {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const from = process.env.RESEND_FROM_EMAIL || 'GoalOracle <noreply@goaloracle.com>';
      const result = await resend.emails.send({
        from,
        to: normalized,
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
