/**
 * /api/feedback.js — Alpha feedback collection
 * 
 * Stores in Firestore AND sends email via Resend.
 * No auth required (public endpoint).
 *
 * Env vars needed:
 *   RESEND_API_KEY — from resend.com (free tier)
 *   FEEDBACK_EMAIL — destination email (default: sumitwkhan@gmail.com)
 *
 * IMPORTANT: Resend free tier can only send TO the email you signed up with.
 * So FEEDBACK_EMAIL should be the same email you used to create your Resend account.
 * Don't send to support@goaloracle.io unless you've verified that domain in Resend.
 */

import { corsHeaders, db } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const errors = [];

  try {
    const { email, name, type, message, userId, displayName, timestamp } = req.body || {};

    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message are required' });
    }

    const typeLabel = (type || 'general').charAt(0).toUpperCase() + (type || 'general').slice(1);
    const fromName = (name || '').trim() || displayName || 'Anonymous';
    const ts = timestamp || new Date().toISOString();

    // 1) Store in Firestore
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
    } catch (fsErr) {
      console.error('Firestore write failed:', fsErr.message);
      errors.push('firestore: ' + fsErr.message);
    }

    // 2) Send email via Resend
    const resendKey = process.env.RESEND_API_KEY;
    const destEmail = process.env.FEEDBACK_EMAIL || 'sumitwkhan@gmail.com';

    if (!resendKey) {
      console.error('RESEND_API_KEY not set — skipping email');
      errors.push('no RESEND_API_KEY env var');
    } else {
      try {
        const emailRes = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${resendKey}`,
          },
          body: JSON.stringify({
            from: 'GoalOracle <onboarding@resend.dev>',
            to: [destEmail],
            reply_to: email.trim(),
            subject: `[GoalOracle] ${typeLabel} feedback from ${fromName}`,
            html: [
              '<div style="font-family:sans-serif;max-width:600px">',
              `<h2 style="color:#333">New ${typeLabel} Feedback</h2>`,
              '<table style="width:100%;border-collapse:collapse;margin:16px 0">',
              `<tr><td style="padding:8px;color:#666;width:100px">From</td><td style="padding:8px"><strong>${fromName}</strong> &lt;${email.trim()}&gt;</td></tr>`,
              `<tr><td style="padding:8px;color:#666">Type</td><td style="padding:8px">${typeLabel}</td></tr>`,
              userId ? `<tr><td style="padding:8px;color:#666">User ID</td><td style="padding:8px;font-family:monospace;font-size:12px">${userId}</td></tr>` : '',
              `<tr><td style="padding:8px;color:#666">Time</td><td style="padding:8px">${ts}</td></tr>`,
              '</table>',
              `<div style="background:#f5f5f5;padding:16px;border-radius:8px;white-space:pre-wrap;line-height:1.6">${message.trim().replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`,
              '<p style="color:#999;font-size:12px;margin-top:16px">Reply to this email to respond to the user.</p>',
              '</div>',
            ].join(''),
          }),
        });

        const emailData = await emailRes.json().catch(() => ({}));

        if (!emailRes.ok) {
          console.error('Resend API error:', emailRes.status, JSON.stringify(emailData));
          errors.push(`resend ${emailRes.status}: ${JSON.stringify(emailData)}`);
        }
      } catch (emailErr) {
        console.error('Resend fetch failed:', emailErr.message);
        errors.push('resend fetch: ' + emailErr.message);
      }
    }

    // Return success if at least Firestore worked
    if (errors.length === 0) {
      return res.status(200).json({ success: true });
    } else if (errors.some(e => e.startsWith('firestore'))) {
      // Both failed
      return res.status(500).json({ error: 'Failed to save feedback', details: errors });
    } else {
      // Firestore worked, email didn't — still success from user's perspective
      return res.status(200).json({ success: true, emailWarning: errors });
    }
  } catch (e) {
    console.error('Feedback handler error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
