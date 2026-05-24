/**
 * /api/unsubscribe — CAN-SPAM-compliant one-click unsubscribe.
 *
 * Hit from the link in every outreach email's footer. Verifies the
 * HMAC token tied to the userId, then sets emailOptOut: true on the
 * user doc. Returns a tiny HTML confirmation page (no SPA shell —
 * email clients prefer a flat URL).
 *
 * GET only. No auth required (the token IS the auth).
 */

import { db, applyCors } from './_lib/firebase.js';
import { unsubscribeToken } from './_lib/outreachEmail.js';
import { FieldValue } from 'firebase-admin/firestore';

function page(title, body) {
  return `<!doctype html><html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="robots" content="noindex,nofollow" />
<title>${title} · GoalOracle</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Manrope', Helvetica, Arial, sans-serif; background: #f5f5f7; color: #111; margin: 0; padding: 48px 16px; }
  .card { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 40px 32px; box-shadow: 0 6px 24px rgba(15,23,42,0.06); text-align: center; }
  .accent { height: 6px; width: 64px; background: linear-gradient(90deg, #00D4FF, #FF2D87, #FFB800); border-radius: 3px; margin: 0 auto 20px; }
  h1 { font-size: 22px; margin: 0 0 12px; letter-spacing: -0.4px; }
  p { font-size: 15px; line-height: 1.55; color: #3c3c43; margin: 0 0 12px; }
  a.btn { display: inline-block; margin-top: 16px; padding: 12px 24px; border-radius: 999px; background: #0a0a0f; color: #fff; text-decoration: none; font-weight: 600; }
  .small { font-size: 12px; color: #6e6e80; margin-top: 24px; }
</style>
</head><body>
<div class="card">
  <div class="accent"></div>
  <h1>${title}</h1>
  ${body}
  <p class="small">GoalOracle · Free skill-based World Cup 2026 prediction contest</p>
</div>
</body></html>`;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    res.status(405).setHeader('Content-Type', 'text/html');
    return res.send(page('Method not allowed', '<p>Open this URL in your browser to unsubscribe.</p>'));
  }

  const { u: userId, t: token } = req.query;
  if (!userId || !token) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(400).send(page('Invalid unsubscribe link', '<p>The link you opened is missing the verification token. If you arrived here from an email, please reply to that email and ask to be removed.</p>'));
  }

  const expected = unsubscribeToken(String(userId));
  if (expected !== String(token)) {
    res.setHeader('Content-Type', 'text/html');
    return res.status(403).send(page('Invalid unsubscribe link', '<p>The verification token on this link is invalid. If you arrived here from an email, please reply to that email and ask to be removed.</p>'));
  }

  try {
    await db.collection('users').doc(String(userId)).set({
      emailOptOut: true,
      emailOptOutAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error('[unsubscribe] write failed:', e.message);
    res.setHeader('Content-Type', 'text/html');
    return res.status(500).send(page('Something went wrong', '<p>We could not record your unsubscribe. Please reply to the email you received and we will remove you manually.</p>'));
  }

  res.setHeader('Content-Type', 'text/html');
  return res.status(200).send(page("You're unsubscribed", `
    <p>You will no longer receive lifecycle emails from GoalOracle.</p>
    <p>This does not affect transactional notifications about your account or the contest (e.g., prize winner notifications).</p>
    <a class="btn" href="https://goaloracle.io/">Back to GoalOracle</a>
  `));
}
