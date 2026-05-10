/**
 * /api/reminders/unsubscribe — public, no-auth opt-out endpoint reached
 * via the link in the reminder email footer (CAN-SPAM compliance: every
 * marketing email needs a one-click unsubscribe).
 *
 * Token = HMAC-SHA256(userId, CRON_SECRET).slice(0,32) — same primitive
 * used to generate the link in api/_lib/reminderEmail.js.
 *
 * On success, sets `unsubscribedFromReminders: true` on the user doc
 * and renders a small confirmation page so the user knows the opt-out
 * went through. We accept GET so plain links in email clients work.
 */

import { db, applyCors } from '../_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { verifyUnsubscribeToken } from '../_lib/reminderEmail.js';

function htmlPage(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${title}</title>
<style>
  body{margin:0;background:#0b0d11;color:#e8eaed;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
  .card{max-width:420px;padding:32px 28px;background:#13161c;border:1px solid rgba(255,184,0,0.18);border-radius:14px;text-align:center}
  h1{margin:0 0 12px;font-size:22px;font-weight:800}
  p{margin:0 0 12px;color:#cfd2d9;line-height:1.5}
  a{color:#ffb800;text-decoration:none}
</style>
</head>
<body><div class="card">${body}</div></body></html>`;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = (req.query?.u || '').toString();
  const token = (req.query?.t || '').toString();
  if (!userId || !token) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(htmlPage('Invalid link', '<h1>Invalid unsubscribe link</h1><p>The link looks malformed. <a href="/">Back to GoalOracle</a></p>'));
  }

  const secret = process.env.CRON_SECRET;
  if (!verifyUnsubscribeToken(userId, token, secret)) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(403).send(htmlPage('Invalid link', '<h1>Couldn\'t verify the link</h1><p>This unsubscribe link looks invalid or has been tampered with. <a href="/">Back to GoalOracle</a></p>'));
  }

  try {
    await db.collection('users').doc(userId).set({
      unsubscribedFromReminders: true,
      unsubscribedFromRemindersAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(htmlPage('Something went wrong', `<h1>Couldn't process unsubscribe</h1><p>Try again, or email us. (${e.message})</p>`));
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(htmlPage(
    'You\'re unsubscribed',
    '<h1>You\'re off the list.</h1><p>You won\'t get any more bracket reminder emails. (We still send transactional stuff like account or league activity if those happen.)</p><p><a href="/">Back to GoalOracle</a></p>',
  ));
}
