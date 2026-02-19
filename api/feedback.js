/**
 * /api/feedback.js — Alpha feedback collection
 * Stores feedback in Firestore AND sends email notification via Resend.
 * No auth required (public endpoint).
 *
 * Required env var: RESEND_API_KEY (free at resend.com, 100 emails/day)
 * Sends to: support@goaloracle.io (which forwards to sumitwkhan@gmail.com via ImprovMX)
 */

import { corsHeaders, db } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, name, type, message, userId, displayName, timestamp } = req.body;

    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message are required' });
    }

    // 1) Store in Firestore
    const docData = {
      email: email.trim(),
      name: (name || '').trim(),
      type: type || 'general',
      message: message.trim(),
      userId: userId || null,
      displayName: displayName || null,
      timestamp: timestamp || new Date().toISOString(),
      createdAt: new Date(),
      status: 'new',
    };

    await db.collection('feedback').add(docData);

    // 2) Send email notification via Resend
    const resendKey = process.env.RESEND_API_KEY;
    if (resendKey) {
      const typeLabel = (type || 'general').charAt(0).toUpperCase() + (type || 'general').slice(1);
      const fromName = name?.trim() || displayName || 'Anonymous';

      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: 'GoalOracle Feedback <onboarding@resend.dev>',
            to: ['support@goaloracle.io'],
            reply_to: email.trim(),
            subject: `[GoalOracle] ${typeLabel} feedback from ${fromName}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px;">
                <h2 style="color: #333;">New ${typeLabel} Feedback</h2>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                  <tr><td style="padding: 8px; color: #666; width: 100px;">From</td><td style="padding: 8px;"><strong>${fromName}</strong> &lt;${email.trim()}&gt;</td></tr>
                  <tr><td style="padding: 8px; color: #666;">Type</td><td style="padding: 8px;">${typeLabel}</td></tr>
                  ${userId ? `<tr><td style="padding: 8px; color: #666;">User ID</td><td style="padding: 8px; font-family: monospace; font-size: 12px;">${userId}</td></tr>` : ''}
                  <tr><td style="padding: 8px; color: #666;">Time</td><td style="padding: 8px;">${new Date(timestamp || Date.now()).toLocaleString('en-US', { timeZone: 'America/New_York' })} ET</td></tr>
                </table>
                <div style="background: #f5f5f5; padding: 16px; border-radius: 8px; white-space: pre-wrap; line-height: 1.6;">${message.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
                <p style="color: #999; font-size: 12px; margin-top: 16px;">Reply directly to this email to respond to the user.</p>
              </div>
            `,
          }),
        });
      } catch (emailErr) {
        // Log but don't fail the request — Firestore write already succeeded
        console.error('Resend email failed:', emailErr);
      }
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Feedback error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
