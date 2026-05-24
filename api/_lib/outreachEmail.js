/**
 * outreachEmail.js — user-facing outreach email helper.
 *
 * Separate from alerts.js (which fires to the operator inbox). This is
 * for marketing/lifecycle emails that go to user inboxes — e.g. the
 * "you signed up but haven't picked your groups" nudge.
 *
 * Templates live as functions in TEMPLATES at the bottom. Each one
 * returns { subject, html, text } based on the user / context. To add
 * a new template, write a function + register it.
 *
 * Every email includes the legally-required unsubscribe link + sender
 * physical address (per CAN-SPAM 16 CFR 316.5). Unsubscribe token is a
 * truncated HMAC of the userId so URLs can't be forged.
 */

import crypto from 'crypto';
import { LAUNCH_DATE, SPONSOR_ADDRESS, SPONSOR_DBA } from '../../src/config/legal.js';

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const PROD_ORIGIN = 'https://goaloracle.io';
// Resend pushes back on rapid bursts; 100ms between sends keeps us well
// inside the free-tier limits while still draining a few-hundred-user
// batch in under a minute.
const SEND_DELAY_MS = 100;

export function unsubscribeToken(userId) {
  const secret = process.env.UNSUBSCRIBE_SECRET || process.env.RESEND_API_KEY || 'dev-only';
  return crypto.createHmac('sha256', secret).update(userId).digest('hex').slice(0, 16);
}

export function unsubscribeUrl(userId) {
  const t = unsubscribeToken(userId);
  return `${PROD_ORIGIN}/api/unsubscribe?u=${encodeURIComponent(userId)}&t=${t}`;
}

// ─── Templates ───────────────────────────────────────────────────
// Each template fn receives { user, ctx } and returns { subject, html, text }.
// `user` is the user doc; `ctx` is template-specific context the caller
// supplies (e.g. daysUntilKickoff, computed once and reused across the batch).

function daysBetween(a, b) {
  return Math.max(0, Math.ceil((b - a) / (1000 * 60 * 60 * 24)));
}

function daysUntilKickoff() {
  // LAUNCH_DATE from legal.js is a human string; parse cautiously.
  // Falls back to a sensible string if parsing breaks.
  try {
    const ko = new Date(LAUNCH_DATE);
    if (!isNaN(ko.getTime())) return daysBetween(Date.now(), ko.getTime());
  } catch { /* fall through */ }
  return null;
}

function brandHeader() {
  return `<tr>
    <td style="background:#06070d;padding:32px 28px 24px;text-align:left;border-radius:16px 16px 0 0;">
      <div style="height:6px;width:64px;background:linear-gradient(90deg,#00D4FF,#FF2D87,#FFB800);border-radius:3px;margin-bottom:18px;"></div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">GoalOracle</div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;font-size:13px;color:#a8acb5;margin-top:2px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">World Cup 2026 Predictions</div>
    </td>
  </tr>`;
}

function brandFooter(unsubUrl) {
  return `<tr>
    <td style="padding:24px 28px;background:#f5f5f7;border-radius:0 0 16px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;font-size:12px;color:#6e6e80;line-height:1.6;">
      <p style="margin:0 0 8px;font-weight:600;color:#3c3c43;">Free skill-based prediction contest. No purchase necessary.</p>
      <p style="margin:0 0 12px;">Top 3 finishers on the Global Quick Picks Leaderboard at the end of the World Cup 2026 Final receive cash prizes paid in USDC stablecoin.</p>
      <p style="margin:0;">
        <a href="${unsubUrl}" style="color:#6e6e80;text-decoration:underline;">Unsubscribe</a> &nbsp;·&nbsp;
        <a href="${PROD_ORIGIN}/privacy" style="color:#6e6e80;text-decoration:underline;">Privacy</a> &nbsp;·&nbsp;
        <a href="${PROD_ORIGIN}/official-rules" style="color:#6e6e80;text-decoration:underline;">Official Rules</a>
      </p>
      <p style="margin:8px 0 0;color:#9999aa;">${escape(SPONSOR_DBA)} · ${escape(SPONSOR_ADDRESS)}</p>
    </td>
  </tr>`;
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// "Hey {name}," — fall back to "Hey," when displayName is missing so it
// reads naturally instead of "Hey {undefined},"
function greeting(user) {
  const name = user.displayName || user.username || null;
  return name ? `Hey ${escape(name)},` : 'Hey,';
}

// ─── Template: No Picks Reminder ─────────────────────────────────

function noPicksReminderTemplate({ user, ctx }) {
  const days = ctx?.daysUntilKickoff ?? daysUntilKickoff();
  const daysLine = (days != null && days > 0)
    ? `The 2026 World Cup kicks off in <strong>${days} day${days === 1 ? '' : 's'}</strong>, and you haven't locked in your bracket yet.`
    : `The 2026 World Cup is around the corner, and you haven't locked in your bracket yet.`;

  const name = user.displayName || user.username || 'you';
  const subject = (days != null && days > 0 && days <= 30)
    ? `${name === 'you' ? 'Your' : `${name}, your`} World Cup bracket — ${days} day${days === 1 ? '' : 's'} to lock in`
    : `${name === 'you' ? 'Your' : `${name}, your`} World Cup bracket is waiting`;

  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=lifecycle&utm_campaign=no_picks_reminder`;
  const unsubUrl = unsubscribeUrl(user.id);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;color:#111118;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef0f3;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          ${brandHeader()}
          <tr>
            <td style="padding:32px 28px 8px;">
              <p style="margin:0 0 14px;font-size:15px;color:#3c3c43;line-height:1.5;">${greeting(user)}</p>
              <h1 style="margin:0 0 18px;font-size:28px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:#0a0a0f;">
                Your World Cup bracket is waiting.
              </h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">
                ${daysLine}
              </p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Takes <strong>10 minutes</strong>. No card, no fees. Top 3 finishers on the global leaderboard at the end of the Final win <strong>$150 / $100 / $50 in USDC</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:8px 0 28px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:16px 32px;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.2px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      Build my bracket →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#6e6e80;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">What you'll do</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;">
                <tr>
                  <td style="padding:10px 14px;background:#f5f5f7;border-radius:8px;font-size:14px;color:#3c3c43;line-height:1.5;">
                    <strong>1.</strong> Rank the 4 teams in each of the 12 groups · <strong>2.</strong> Pick the 8 best third-placed teams · <strong>3.</strong> Fill the knockout bracket through to the Final.
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6e6e80;line-height:1.55;">
                Predictions lock 5 minutes before each kickoff — you can update your picks as many times as you want before the lock fires.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubUrl)}
        </table>
        <p style="margin:14px 0 0;font-size:11px;color:#9999aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">You're receiving this because you signed up for GoalOracle.</p>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting(user).replace(/<[^>]+>/g, '')}

Your World Cup bracket is waiting.

${days != null && days > 0 ? `The 2026 World Cup kicks off in ${days} day${days === 1 ? '' : 's'}, and you haven't locked in your bracket yet.` : `The 2026 World Cup is around the corner, and you haven't locked in your bracket yet.`}

Takes 10 minutes. No card, no fees. Top 3 finishers on the global leaderboard at the end of the Final win $150 / $100 / $50 in USDC.

Build your bracket: ${ctaUrl}

What you'll do:
1. Rank the 4 teams in each of the 12 groups
2. Pick the 8 best third-placed teams
3. Fill the knockout bracket through to the Final

Predictions lock 5 minutes before each kickoff.

Free skill-based prediction contest. No purchase necessary. Top 3 on the Global Quick Picks Leaderboard at the end of the World Cup 2026 Final receive cash prizes in USDC.

Unsubscribe: ${unsubUrl}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Template: Welcome ───────────────────────────────────────────

function welcomeTemplate({ user, ctx }) {
  const days = ctx?.daysUntilKickoff ?? daysUntilKickoff();
  const name = user.displayName || user.username || null;
  const subject = name
    ? `Welcome to GoalOracle, ${name}`
    : `Welcome to GoalOracle`;

  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=lifecycle&utm_campaign=welcome`;
  const unsubUrl = unsubscribeUrl(user.id);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;color:#111118;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef0f3;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          ${brandHeader()}
          <tr>
            <td style="padding:32px 28px 8px;">
              <p style="margin:0 0 14px;font-size:15px;color:#3c3c43;line-height:1.5;">${greeting(user)}</p>
              <h1 style="margin:0 0 18px;font-size:28px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:#0a0a0f;">
                Welcome to GoalOracle.
              </h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Glad you&apos;re here. GoalOracle is a free skill-based prediction game for the FIFA World Cup 2026. ${(days != null && days > 0) ? `Kickoff is in <strong>${days} day${days === 1 ? '' : 's'}</strong>.` : `Kickoff is coming up fast.`}
              </p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Build your bracket in 10 minutes. No card, no fees. Top 3 finishers on the global leaderboard at the end of the Final win <strong>$150 / $100 / $50 in USDC</strong>.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:8px 0 28px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:16px 32px;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.2px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      Build my bracket →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#6e6e80;font-weight:600;letter-spacing:0.5px;text-transform:uppercase;">A quick tour</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 12px;">
                <tr>
                  <td style="padding:12px 14px;background:#f5f5f7;border-radius:8px;font-size:14px;color:#3c3c43;line-height:1.6;">
                    <strong>Quick Picks</strong> — 3-step guided wizard (rank groups, pick best thirds, fill bracket). Most users finish in ~10 minutes.<br />
                    <strong>Classic Predictions</strong> — predict every match&apos;s exact score, if you want the full hardcore experience.<br />
                    <strong>Private leagues</strong> — invite friends, set custom scoring, trash-talk included.
                  </td>
                </tr>
              </table>
              <p style="margin:18px 0 0;font-size:13px;color:#6e6e80;line-height:1.55;">
                Questions? Just reply to this email — it lands in our inbox.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubUrl)}
        </table>
        <p style="margin:14px 0 0;font-size:11px;color:#9999aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">You&apos;re receiving this because you recently signed up for GoalOracle.</p>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting(user).replace(/<[^>]+>/g, '')}

Welcome to GoalOracle.

GoalOracle is a free skill-based prediction game for the FIFA World Cup 2026.${days != null && days > 0 ? ` Kickoff is in ${days} day${days === 1 ? '' : 's'}.` : ''}

Build your bracket in 10 minutes. No card, no fees. Top 3 finishers on the global leaderboard at the end of the Final win $150 / $100 / $50 in USDC.

Start here: ${ctaUrl}

Quick tour:
- Quick Picks: 3-step guided wizard (rank groups, pick best thirds, fill bracket). ~10 minutes.
- Classic Predictions: predict every match's exact score.
- Private leagues: invite friends, set custom scoring.

Questions? Reply to this email.

Free skill-based prediction contest. No purchase necessary.

Unsubscribe: ${unsubUrl}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Template: Kickoff Tomorrow ──────────────────────────────────

function kickoffTomorrowTemplate({ user, ctx }) {
  const name = user.displayName || user.username || null;
  const subject = name
    ? `${name}, World Cup 2026 kicks off tomorrow`
    : `World Cup 2026 kicks off tomorrow`;

  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=lifecycle&utm_campaign=kickoff_tomorrow`;
  const unsubUrl = unsubscribeUrl(user.id);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;color:#111118;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef0f3;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          ${brandHeader()}
          <tr>
            <td style="padding:32px 28px 8px;">
              <p style="margin:0 0 14px;font-size:15px;color:#3c3c43;line-height:1.5;">${greeting(user)}</p>
              <h1 style="margin:0 0 14px;font-size:30px;line-height:1.15;letter-spacing:-0.6px;font-weight:800;color:#0a0a0f;">
                The World Cup kicks off tomorrow.
              </h1>
              <p style="margin:0 0 12px;font-size:15px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#FF3B30;">
                Last call to lock in your bracket
              </p>
              <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Predictions lock 5 minutes before each match. Mexico vs South Africa kicks off at <strong>15:00 ET</strong> at the Estadio Azteca. After that, the group-stage scoring opens — and you&apos;ll start the tournament with whatever picks you have on file.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:0 0 28px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:18px 36px;color:#ffffff;text-decoration:none;font-weight:800;font-size:17px;letter-spacing:0.3px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      Lock in my bracket →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
                <tr>
                  <td style="padding:14px 16px;background:#fff7e6;border:1px solid #ffd66b;border-radius:8px;font-size:14px;color:#3c2a00;line-height:1.55;">
                    <strong>Prize contest still open.</strong> Top 3 finishers on the Global Quick Picks Leaderboard at the end of the Final win <strong>$150 / $100 / $50 in USDC</strong>. Free entry, no purchase necessary.
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6e6e80;line-height:1.55;">
                Need 10 minutes? Use Quick Picks. Want full control? Classic Predictions lets you set the exact score for every match.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubUrl)}
        </table>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting(user).replace(/<[^>]+>/g, '')}

THE WORLD CUP KICKS OFF TOMORROW.

Last call to lock in your bracket. Predictions lock 5 minutes before each match. Mexico vs South Africa kicks off at 15:00 ET at the Estadio Azteca. After that, group-stage scoring opens.

Lock in your bracket: ${ctaUrl}

Prize contest still open. Top 3 finishers on the Global Quick Picks Leaderboard at the end of the Final win $150 / $100 / $50 in USDC. Free entry, no purchase necessary.

Need 10 minutes? Use Quick Picks. Want full control? Classic Predictions lets you set the exact score for every match.

Unsubscribe: ${unsubUrl}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Template: Mid-Tournament Nudge ──────────────────────────────

function midTournamentNudgeTemplate({ user, ctx }) {
  const name = user.displayName || user.username || null;
  const subject = name
    ? `${name}, see where you stand on the World Cup leaderboard`
    : `See where you stand on the World Cup leaderboard`;

  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=lifecycle&utm_campaign=mid_tournament_nudge`;
  const unsubUrl = unsubscribeUrl(user.id);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;color:#111118;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef0f3;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          ${brandHeader()}
          <tr>
            <td style="padding:32px 28px 8px;">
              <p style="margin:0 0 14px;font-size:15px;color:#3c3c43;line-height:1.5;">${greeting(user)}</p>
              <h1 style="margin:0 0 18px;font-size:28px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:#0a0a0f;">
                The tournament is on. See where you stand.
              </h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Group stage is in full swing. Your bracket is scoring on every verified result — and the global leaderboard is moving fast.
              </p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Open your bracket to see your current rank, your hits and misses so far, and which group still has rounds left to play. Knockout picks open as soon as the group stage closes.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:8px 0 28px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:16px 32px;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.2px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      See my standings →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
                <tr>
                  <td style="padding:12px 14px;background:#f5f5f7;border-radius:8px;font-size:13px;color:#3c3c43;line-height:1.55;">
                    <strong>Prize contest reminder.</strong> Top 3 on the Global Quick Picks Leaderboard at the end of the Final win <strong>$150 / $100 / $50 in USDC</strong>. Group-stage points compound into the knockouts — every match counts.
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6e6e80;line-height:1.55;">
                In a private league with friends? They&apos;re watching the same leaderboard. Bragging rights start now.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubUrl)}
        </table>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting(user).replace(/<[^>]+>/g, '')}

The tournament is on. See where you stand.

Group stage is in full swing. Your bracket is scoring on every verified result — and the global leaderboard is moving fast.

Open your bracket to see your current rank, your hits and misses so far, and which group still has rounds left to play. Knockout picks open as soon as the group stage closes.

See your standings: ${ctaUrl}

Top 3 on the Global Quick Picks Leaderboard at the end of the Final win $150 / $100 / $50 in USDC. Group-stage points compound into the knockouts — every match counts.

Unsubscribe: ${unsubUrl}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Registry ────────────────────────────────────────────────────

export const TEMPLATES = {
  noPicksReminder: {
    id: 'noPicksReminder',
    label: 'No Picks Reminder',
    description: 'For users who signed up but have not started their group-stage picks in the Global Quick Picks League.',
    build: noPicksReminderTemplate,
  },
  welcome: {
    id: 'welcome',
    label: 'Welcome (recent signups)',
    description: 'Soft welcome + brand intro for users who signed up recently. Default eligibility: signed up in the last 14 days, has email, not opted out, has never received this template before (no cooldown — single-shot per user).',
    build: welcomeTemplate,
  },
  kickoffTomorrow: {
    id: 'kickoffTomorrow',
    label: 'Kickoff Tomorrow (last call)',
    description: 'Urgent last-call alert sent the day before the tournament opener. Default eligibility: in the Global Quick Picks League, has email, not opted out — regardless of pick status (intentional — even users with locked picks may want the heads-up).',
    build: kickoffTomorrowTemplate,
  },
  midTournamentNudge: {
    id: 'midTournamentNudge',
    label: 'Mid-Tournament Nudge',
    description: "Sent during the group stage to bring users back to check their standings. Default eligibility: in the Global Quick Picks League, has email, not opted out, has at least one completed group ranking (so we don't nag users who haven't started — the No Picks Reminder is the right tool for that).",
    build: midTournamentNudgeTemplate,
  },
};

export function buildEmail(templateId, args) {
  const t = TEMPLATES[templateId];
  if (!t) throw new Error(`Unknown email template: ${templateId}`);
  return t.build(args);
}

// ─── Send ────────────────────────────────────────────────────────

export async function sendOutreachEmail({ to, subject, html, text, tags = [] }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('[outreach] RESEND_API_KEY not set, email dropped:', subject);
    return { sent: false, reason: 'no-resend-key' };
  }
  // Same dual-from fallback as the operator alerts — prefer the verified
  // goaloracle.io domain, fall back to resend.dev if DKIM isn't set up
  // yet (so local/dev sends still work).
  const senders = ['GoalOracle <hello@goaloracle.io>', 'GoalOracle <onboarding@resend.dev>'];
  let sent = false;
  let lastError = null;
  for (const from of senders) {
    try {
      const body = { from, to: [to], subject, html, text };
      // Resend tags: array of { name, value }. We send userId + template
      // so the webhook can route opened/clicked/bounced events back to
      // the right /outreachSent row. Resend echoes tags in webhook
      // payloads — see api/webhooks/resend.js.
      if (Array.isArray(tags) && tags.length > 0) body.tags = tags;
      const r = await fetch(RESEND_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
        body: JSON.stringify(body),
      });
      if (r.ok) { sent = true; break; }
      if (r.status !== 403 && r.status !== 422) { lastError = `HTTP ${r.status}`; break; }
    } catch (e) { lastError = e.message; }
  }
  return { sent, error: lastError };
}

// Sleep helper for batch throttling.
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
export const BATCH_DELAY_MS = SEND_DELAY_MS;
