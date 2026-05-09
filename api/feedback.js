/**
 * /api/feedback.js — Alpha feedback collection
 *
 * Stores in Firestore AND sends email via Resend.
 * No auth required (public endpoint).
 *
 * Env vars:
 *   RESEND_API_KEY  — from resend.com dashboard (required)
 *   FEEDBACK_EMAIL  — where to send notifications (default: sumitwkhan@gmail.com)
 *
 * Once goaloracle.io is verified in Resend, emails come from feedback@goaloracle.io.
 * Before verification, falls back to onboarding@resend.dev (can only send to the
 * email you signed up with on Resend).
 */

import { corsHeaders, db } from './_lib/firebase.js';
import { getClientIp, ipHash, escapeHtml, isIpBanned } from './_lib/security.js';
import { FieldValue } from 'firebase-admin/firestore';

const FEEDBACK_WINDOW_MS = 60 * 60 * 1000;
const MAX_FEEDBACK_PER_IP = 5;
const MAX_MESSAGE_LEN = 4000;

async function checkFeedbackRateLimit(ip) {
  if (!ip) return { allowed: true };
  const ref = db.collection('signupAttempts').doc(`fb_${ipHash(ip)}`);
  const now = Date.now();
  const snap = await ref.get();
  const history = snap.exists ? (snap.data().feedbackHistory || []) : [];
  const recent = history.filter(t => now - t < FEEDBACK_WINDOW_MS);
  if (recent.length >= MAX_FEEDBACK_PER_IP) return { allowed: false };
  await ref.set({
    feedbackHistory: [...recent, now],
    lastIp: ip,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { allowed: true };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, name, type, message, userId, displayName, timestamp } = req.body || {};

    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message are required' });
    }
    if (typeof message !== 'string' || message.length > MAX_MESSAGE_LEN) {
      return res.status(400).json({ error: 'Message too long' });
    }
    if (typeof email !== 'string' || email.length > 254) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const ip = getClientIp(req);
    if (await isIpBanned(db, ip)) return res.status(403).json({ error: 'Access denied' });

    const rl = await checkFeedbackRateLimit(ip);
    if (!rl.allowed) return res.status(429).json({ error: 'Too many submissions. Try again later.' });

    const typeLabel = (type || 'general').charAt(0).toUpperCase() + (type || 'general').slice(1);
    const fromName = (name || '').trim() || displayName || 'Anonymous';
    const ts = timestamp || new Date().toISOString();

    // Every value interpolated into the operator-bound email HTML must be
    // escaped — `name`, `email`, `type`, `userId`, `displayName`, and the
    // message body are all attacker-controlled in this anonymous endpoint.
    const safeMsg = escapeHtml(message.trim());
    const safeFromName = escapeHtml(fromName);
    const safeEmail = escapeHtml(email.trim());
    const safeType = escapeHtml(typeLabel);
    const safeUserId = escapeHtml(userId || '');
    const safeTs = escapeHtml(ts);

    // ─── 1) Store in Firestore ───
    let firestoreOk = false;
    try {
      await db.collection('feedback').add({
        email: email.trim(),
        name: fromName,
        type: type || 'general',
        message: message.trim(),
        userId: userId || null,
        displayName: displayName || null,
        timestamp: ts,
        createdAt: new Date(),
        status: 'new',
      });
      firestoreOk = true;
      console.log('Feedback saved to Firestore');
    } catch (fsErr) {
      console.error('Firestore write failed:', fsErr.message);
    }

    // ─── 2) Send email via Resend (with timeouts) ───
    let emailOk = false;
    const resendKey = process.env.RESEND_API_KEY;
    const destEmail = process.env.FEEDBACK_EMAIL || 'sumitwkhan@gmail.com';

    if (!resendKey) {
      console.error('RESEND_API_KEY env var is not set — cannot send email');
    } else {
      const emailHtml = `<div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
  <div style="background:#1a1a2e;padding:20px 24px;border-radius:12px 12px 0 0">
    <h2 style="color:#00d4ff;margin:0;font-size:18px">New ${safeType} Feedback</h2>
  </div>
  <div style="background:#ffffff;padding:20px 24px;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 12px 12px">
    <table style="width:100%;border-collapse:collapse;margin:0 0 16px">
      <tr><td style="padding:6px 8px;color:#888;font-size:13px;width:80px">From</td><td style="padding:6px 8px;font-size:14px"><strong>${safeFromName}</strong> &lt;${safeEmail}&gt;</td></tr>
      <tr><td style="padding:6px 8px;color:#888;font-size:13px">Type</td><td style="padding:6px 8px;font-size:14px">${safeType}</td></tr>
      ${userId ? `<tr><td style="padding:6px 8px;color:#888;font-size:13px">User ID</td><td style="padding:6px 8px;font-family:monospace;font-size:12px">${safeUserId}</td></tr>` : '<tr><td style="padding:6px 8px;color:#888;font-size:13px">User</td><td style="padding:6px 8px;font-size:14px;color:#888">Not signed in</td></tr>'}
      <tr><td style="padding:6px 8px;color:#888;font-size:13px">Time</td><td style="padding:6px 8px;font-size:14px">${safeTs}</td></tr>
    </table>
    <div style="background:#f8f9fa;padding:16px;border-radius:8px;white-space:pre-wrap;line-height:1.6;font-size:14px;color:#333">${safeMsg}</div>
    <p style="color:#aaa;font-size:11px;margin:16px 0 0">Hit reply to respond directly to the user.</p>
  </div>
</div>`;

      // Use verified domain sender if available, otherwise fall back to Resend's shared sender
      const senders = [
        'GoalOracle <feedback@goaloracle.io>',
        'GoalOracle <onboarding@resend.dev>',
      ];

      for (const sender of senders) {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 8000);
        try {
          const emailRes = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${resendKey}`,
            },
            signal: ac.signal,
            body: JSON.stringify({
              from: sender,
              to: [destEmail],
              reply_to: email.trim(),
              // Subject is plain text — strip newlines/control chars to
              // avoid header injection but otherwise leave readable.
              subject: `[GoalOracle] ${typeLabel} feedback from ${fromName}`.replace(/[\r\n]+/g, ' ').slice(0, 200),
              html: emailHtml,
            }),
          });
          clearTimeout(timer);

          const emailData = await emailRes.json().catch(() => ({}));
          console.log(`Resend response (${sender}):`, emailRes.status, JSON.stringify(emailData));

          if (emailRes.ok) {
            emailOk = true;
            break; // success, don't try fallback
          }

          // If domain not verified yet, try fallback
          if (emailRes.status === 403 || emailRes.status === 422) {
            console.log('Domain sender failed, trying fallback...');
            continue;
          }

          // Other error — log and break
          console.error('Resend error:', emailRes.status, JSON.stringify(emailData));
          break;
        } catch (fetchErr) {
          clearTimeout(timer);
          console.error(`Resend fetch error (${sender}):`, fetchErr.message);
          // If first sender timed out, try fallback
          if (fetchErr.name === 'AbortError') continue;
        }
      }
    }

    // Return result — succeed if at least Firestore worked
    if (firestoreOk || emailOk) {
      return res.status(200).json({
        success: true,
        saved: firestoreOk,
        emailed: emailOk,
      });
    } else {
      return res.status(500).json({ error: 'Failed to process feedback' });
    }
  } catch (e) {
    console.error('Feedback handler crash:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
