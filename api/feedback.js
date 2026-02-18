/**
 * /api/feedback.js — Alpha feedback collection
 * Stores feedback in Firestore. No auth required (public endpoint).
 * support@goaloracle.io forwards to sumitwkhan@gmail.com
 */

import { corsHeaders, db } from './_lib/firebase.js';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, name, type, message, userId, timestamp } = req.body;

    if (!email || !message) {
      return res.status(400).json({ error: 'Email and message are required' });
    }

    // Store in Firestore
    const feedbackRef = db.collection('feedback');
    await feedbackRef.add({
      email: email.trim(),
      name: (name || '').trim(),
      type: type || 'general',
      message: message.trim(),
      userId: userId || null,
      timestamp: timestamp || new Date().toISOString(),
      createdAt: new Date(),
      status: 'new',
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Feedback error:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
