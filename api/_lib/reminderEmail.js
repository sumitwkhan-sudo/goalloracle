/**
 * api/_lib/reminderEmail.js — branded HTML template for the incomplete-
 * bracket reminder cron.
 *
 * Visual style mirrors the GoalOracle site (red-gold palette, hexagonal
 * GO logo, system-font stack). Copy is short, catchy, and slightly
 * funny — we want the user to smile, not feel scolded.
 *
 * The template returns { subject, html, text } so the cron can pass
 * them through to Resend's email API. Plain-text fallback is included
 * for spam-filter scoring.
 *
 * Unsubscribe link is HMAC-signed so the user can opt out without
 * authenticating. The token == HMAC-SHA256(userId, CRON_SECRET).
 */

import crypto from 'crypto';
import { escapeHtml } from './security.js';

// Hexagonal GO monogram, identical to the React logo in goaloracle.jsx.
// Inlined as a data URI so the email renders standalone (no remote-image
// blocking by mail clients).
const LOGO_SVG_DATA = (() => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 100 100" fill="none">
  <defs>
    <linearGradient id="goLogo" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#00D4FF"/>
      <stop offset="50%" stop-color="#FF2D87"/>
      <stop offset="100%" stop-color="#FFB800"/>
    </linearGradient>
  </defs>
  <path d="M50 4 L88 22 Q96 26 96 35 L96 65 Q96 74 88 78 L50 96 L12 78 Q4 74 4 65 L4 35 Q4 26 12 22 Z" fill="none" stroke="url(#goLogo)" stroke-width="5"/>
  <path d="M30 38 Q30 28 42 28 L52 28" stroke="url(#goLogo)" stroke-width="7" stroke-linecap="round" fill="none"/>
  <path d="M30 38 L30 58 Q30 68 42 68 L52 68 L52 55 L44 55" stroke="url(#goLogo)" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="66" cy="48" r="18" stroke="url(#goLogo)" stroke-width="7" fill="none"/>
</svg>`;
  return 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
})();

export function makeUnsubscribeToken(userId, secret) {
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(String(userId)).digest('hex').slice(0, 32);
}

export function verifyUnsubscribeToken(userId, token, secret) {
  if (!secret || !token) return false;
  const expected = makeUnsubscribeToken(userId, secret);
  if (!expected) return false;
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'hex'),
      Buffer.from(token, 'hex'),
    );
  } catch {
    return false;
  }
}

function formatDelta(ms) {
  if (ms <= 0) return 'right now';
  const h = Math.floor(ms / 3600000);
  const d = Math.floor(h / 24);
  if (d >= 1) {
    const remH = h - d * 24;
    return remH > 0 ? `${d} day${d === 1 ? '' : 's'} ${remH}h` : `${d} day${d === 1 ? '' : 's'}`;
  }
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

const QUIPS = [
  'Your bracket is yelling at you from the kitchen.',
  'Your unfinished bracket misses you.',
  'Picks don\'t make themselves. (We checked.)',
  'Your bracket is 73% vibes, 0% picks.',
];

function pickQuip(seed) {
  // Stable per-user-per-day choice so users don't get the same
  // line in both the 24h and 1h reminders.
  const idx = (seed || 0) % QUIPS.length;
  return QUIPS[idx];
}

/**
 * @param {object} args
 * @param {string} args.userId
 * @param {string} args.displayName
 * @param {number} args.picksMade  - 0..52
 * @param {number} args.kickoffMs  - kickoff timestamp (UTC ms)
 * @param {string} args.appUrl     - e.g. https://goaloracle.io
 * @param {string} [args.cronSecret]
 * @param {'24h'|'1h'} args.kind
 * @returns {{subject:string, html:string, text:string}}
 */
export function buildReminderEmail(args) {
  const { userId, displayName, picksMade, kickoffMs, appUrl, cronSecret, kind } = args;
  const remaining = 52 - Math.min(52, Math.max(0, picksMade || 0));
  const delta = formatDelta(kickoffMs - Date.now());
  const quip = pickQuip((userId || '').length + (kind === '1h' ? 1 : 0));
  const safeName = escapeHtml(displayName || 'there');
  const ctaUrl = `${appUrl.replace(/\/$/, '')}/?utm_source=reminder&utm_medium=email&utm_campaign=incomplete_bracket_${kind}`;

  const unsubToken = makeUnsubscribeToken(userId, cronSecret);
  const unsubUrl = unsubToken
    ? `${appUrl.replace(/\/$/, '')}/api/reminders/unsubscribe?u=${encodeURIComponent(userId)}&t=${unsubToken}`
    : null;

  const subject = kind === '1h'
    ? `Bracket locks in ${delta} — finish your picks`
    : `World Cup kicks off in ${delta} — your bracket isn't done`;

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#0b0d11;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#e8eaed">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px">
    <!-- Header / logo -->
    <div style="text-align:center;padding:8px 0 16px">
      <img src="${LOGO_SVG_DATA}" width="40" height="40" alt="GoalOracle" style="display:inline-block;vertical-align:middle"/>
      <span style="display:inline-block;vertical-align:middle;margin-left:10px;font-size:18px;font-weight:800;letter-spacing:0.5px;background:linear-gradient(90deg,#FFB800,#FF2D87);-webkit-background-clip:text;background-clip:text;color:transparent">GoalOracle</span>
    </div>

    <!-- Hero card -->
    <div style="background:linear-gradient(160deg,#1a1d24 0%,#13161c 100%);border:1px solid rgba(255,184,0,0.25);border-radius:16px;padding:28px 24px;text-align:center">
      <div style="font-size:14px;color:#ffb800;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">⚽ ${kind === '1h' ? 'Last call' : '24-hour reminder'}</div>
      <h1 style="margin:0 0 10px;font-size:24px;font-weight:800;line-height:1.25;color:#fff">${escapeHtml(quip)}</h1>
      <p style="margin:0 0 18px;font-size:16px;line-height:1.5;color:#cfd2d9">Hey ${safeName} — World Cup ’26 kicks off in <strong style="color:#ffb800">${escapeHtml(delta)}</strong> and your bracket still has <strong style="color:#ff2d87">${remaining}</strong> pick${remaining === 1 ? '' : 's'} to make. Once the opener whistles, group-stage picks freeze.</p>
      <p style="margin:0 0 24px;font-size:14px;line-height:1.5;color:#cfd2d9">You could also be missing out on <strong style="color:#ffb800">free prize giveaways worth up to $150 USD</strong>. Don't say we didn't warn you.</p>
      <a href="${ctaUrl}" style="display:inline-block;background:linear-gradient(90deg,#ffb800,#ff2d87);color:#0b0d11;text-decoration:none;font-weight:800;font-size:16px;padding:14px 28px;border-radius:10px">Finish my picks →</a>
    </div>

    <!-- Tip strip -->
    <div style="margin:18px 4px 0;font-size:13px;color:#9aa0a6;text-align:center;line-height:1.5">
      Quick Picks takes ~3 minutes. Drag, tap, done.
    </div>

    <!-- Footer / spam compliance -->
    <div style="margin:36px 0 0;padding-top:20px;border-top:1px solid rgba(255,255,255,0.08);text-align:center;font-size:11px;color:#6b6f76;line-height:1.6">
      <p style="margin:0 0 6px">You're getting this because you signed up for GoalOracle and haven't finished your bracket yet. We send at most two reminders per tournament.</p>
      ${unsubUrl ? `<p style="margin:0 0 6px"><a href="${unsubUrl}" style="color:#9aa0a6;text-decoration:underline">Unsubscribe from reminder emails</a></p>` : ''}
      <p style="margin:0;color:#52565d">GoalOracle · 2026 FIFA World Cup prediction game · Operated remotely</p>
    </div>
  </div>
</body>
</html>`;

  // Plain-text alternative — same content, no styling. Helps deliverability.
  const text = [
    `${quip}`,
    ``,
    `Hey ${displayName || 'there'} — World Cup '26 kicks off in ${delta} and your bracket still has ${remaining} pick${remaining === 1 ? '' : 's'} to make. Once the opener whistles, group-stage picks freeze.`,
    ``,
    `You could also be missing out on free prize giveaways worth up to $150 USD.`,
    ``,
    `Finish my picks: ${ctaUrl}`,
    ``,
    unsubUrl ? `Unsubscribe: ${unsubUrl}` : '',
    `GoalOracle · 2026 FIFA World Cup prediction game`,
  ].filter(Boolean).join('\n');

  return { subject, html, text };
}
