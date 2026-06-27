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
import { stageLockTimeUtc } from '../../src/utils/stageLock.js';

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
  // Small header logo (B2 branding requirement). One lightweight image with
  // alt text + the wordmark kept as live text underneath, so the brand still
  // reads if the image is blocked — and we stay light on images for inbox
  // placement (B4). Absolute URL: email clients can't resolve relative paths.
  return `<tr>
    <td style="background:#06070d;padding:28px 28px 22px;text-align:left;border-radius:16px 16px 0 0;">
      <img src="${PROD_ORIGIN}/logo-lockup-trophy.png" width="148" alt="GoalOracle" style="display:block;width:148px;max-width:60%;height:auto;margin-bottom:14px;border:0;" />
      <div style="height:6px;width:64px;background:linear-gradient(90deg,#00D4FF,#FF2D87,#FFB800);border-radius:3px;margin-bottom:14px;"></div>
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;font-size:13px;color:#a8acb5;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;">World Cup 2026 Predictions</div>
    </td>
  </tr>`;
}

// Founder sign-off — appended to EVERY engagement email (B2 requirement),
// worded EXACTLY as below. signOffHtml renders inside the card body;
// signOffText is the plain-text twin for the multipart text/* alternative.
const SIGN_OFF_LINE = '- Sumit, Founder of GoalOracle.io and Football Lover';
function signOffHtml() {
  return `<p style="margin:26px 0 0;font-size:15px;line-height:1.5;color:#3c3c43;">${escape(SIGN_OFF_LINE)}</p>`;
}
function signOffText() {
  return `\n\n${SIGN_OFF_LINE}`;
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

// Template variable helpers (B2c). All optional + additive: a template uses
// the value only when ctx supplies it, otherwise it keeps its default copy,
// so enriching ctx can never break a send.
//
// First name: first whitespace-delimited token of displayName. Used for a
// lighter, more personal touch than the full handle.
export function firstNameOf(user) {
  const dn = (user?.displayName || user?.username || '').trim();
  if (!dn) return null;
  return dn.split(/\s+/)[0];
}
// Ordinal: 1 -> "1st", 2 -> "2nd", 11 -> "11th", 23 -> "23rd".
export function ordinal(n) {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 1) return null;
  const r10 = n % 10, r100 = n % 100;
  const suffix = (r100 >= 11 && r100 <= 13) ? 'th'
    : r10 === 1 ? 'st' : r10 === 2 ? 'nd' : r10 === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
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

  // Variable-aware rank line (B2c). When ctx supplies the user's live rank
  // we lead with it; otherwise fall back to the generic line. Additive —
  // never breaks if rank is absent.
  const rankOrd = ordinal(ctx?.rank);
  const rankLinePlain = rankOrd
    ? `You're currently ${rankOrd} on the global leaderboard — your bracket is scoring on every verified result, and the board is moving fast.`
    : `Group stage is in full swing. Your bracket is scoring on every verified result — and the global leaderboard is moving fast.`;
  const rankLineHtml = rankOrd
    ? `You're currently <strong>${escape(rankOrd)}</strong> on the global leaderboard — your bracket is scoring on every verified result, and the board is moving fast.`
    : `Group stage is in full swing. Your bracket is scoring on every verified result — and the global leaderboard is moving fast.`;

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
                ${rankLineHtml}
              </p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Open your bracket to see your hits and misses so far, and which group still has rounds left to play. Knockout picks open as soon as the group stage closes.
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

${rankLinePlain}

Open your bracket to see your hits and misses so far, and which group still has rounds left to play. Knockout picks open as soon as the group stage closes.

See your standings: ${ctaUrl}

Top 3 on the Global Quick Picks Leaderboard at the end of the Final win $150 / $100 / $50 in USDC. Group-stage points compound into the knockouts — every match counts.

Unsubscribe: ${unsubUrl}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Template: Daily Leaderboard Movement Digest ─────────────────
// Personalized per recipient. ctx (per-user, supplied by the rank-digest
// cron via the scheduled-send payload):
//   { direction:'up'|'down', places:number, newRank:number, total:number,
//     subject?:string, intro?:string }   subject/intro override the defaults
// (operator-customizable copy from /settings/rankDigest).
function rankDigestTemplate({ user, ctx }) {
  const up = ctx?.direction !== 'down';
  const places = Math.max(0, Math.round(Number(ctx?.places) || 0));
  const newRank = Number.isFinite(Number(ctx?.newRank)) ? Number(ctx.newRank) : null;
  const total = Number.isFinite(Number(ctx?.total)) ? Number(ctx.total) : null;
  const rankOrd = ordinal(newRank);

  const defaultSubject = up
    ? `🚀 You climbed ${places} spot${places === 1 ? '' : 's'} on the World Cup leaderboard!`
    : `📊 Your World Cup leaderboard update`;
  const subject = (ctx?.subject && String(ctx.subject).trim()) || defaultSubject;

  const emoji = up ? '🚀' : '💪';
  const headline = up
    ? `Up ${places} place${places === 1 ? '' : 's'}!`
    : `Down ${places} — time to climb back.`;
  const defaultIntro = up
    ? `Big moves on the pitch, big moves on the table. After today's games you surged up the Global League. Keep it rolling.`
    : `Today's results shook things up and you slipped a few spots — but there's a lot of football left and your bracket is still very much alive.`;
  const intro = (ctx?.intro && String(ctx.intro).trim()) || defaultIntro;
  const rankLine = rankOrd
    ? `You're now <strong>${escape(rankOrd)}</strong>${total ? ` of ${total.toLocaleString()}` : ''} in the Global League.`
    : '';

  const accent = up ? '#00c853' : '#ff7a18';
  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=lifecycle&utm_campaign=rank_digest`;
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
              <div style="font-size:40px;line-height:1;margin:0 0 10px;">${emoji}</div>
              <h1 style="margin:0 0 16px;font-size:28px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:#0a0a0f;">
                ${escape(headline)}
              </h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">${escape(intro)}</p>
              ${rankLine ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 22px;">
                <tr><td style="background:#f5f6f8;border-left:4px solid ${accent};border-radius:10px;padding:14px 18px;font-size:18px;color:#0a0a0f;">${rankLine}</td></tr>
              </table>` : ''}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 8px;">
                <tr><td style="border-radius:12px;background:#0a0a0f;">
                  <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:12px;">See the leaderboard →</a>
                </td></tr>
              </table>
              <p style="margin:18px 0 0;font-size:14px;line-height:1.6;color:#6e6e80;">
                Top 3 on the Global Quick Picks Leaderboard at the end of the Final win <strong>$150 / $100 / $50 in USDC</strong>. Every match counts.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubUrl)}
        </table>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${up ? 'You moved UP' : 'You dropped'} ${places} place${places === 1 ? '' : 's'} on the World Cup leaderboard.

${intro}${rankOrd ? `\n\nYou're now ${rankOrd}${total ? ` of ${total}` : ''} in the Global League.` : ''}

See the leaderboard: ${ctaUrl}

Top 3 on the Global Quick Picks Leaderboard at the end of the Final win $150 / $100 / $50 in USDC.

Unsubscribe: ${unsubUrl}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Template: Knockout Lock Reminder ────────────────────────────
// Group stage is done and the real Round-of-32 teams are now seeded into
// every user's bracket (knockout-real-reseed). This nudges users to come
// finalize their knockout winners before the R32 lock — while explicitly
// reassuring anyone happy with their bracket that they DON'T have to touch
// it: their original picks are saved and scoring unchanged (per-fixture
// scoring is seeding-independent). Honest, low-pressure urgency.

// Human-readable R32 lock date/time in ET, derived from the canonical
// stageLock constant so it can't drift. Falls back to a static string.
function r32LockText() {
  try {
    const ms = stageLockTimeUtc('roundOf32');
    const date = new Date(ms).toLocaleString('en-US', {
      timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric',
    });
    const time = new Date(ms).toLocaleString('en-US', {
      timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit',
    });
    const msLeft = ms - Date.now();
    const daysLeft = Math.max(0, Math.ceil(msLeft / 86400000));
    const hoursLeft = Math.max(0, Math.floor(msLeft / 3600000));
    // Tightening countdown — drives more urgency on the recurring 12h sends as
    // the lock approaches. Falls back gracefully when the lock has passed.
    let countdown;
    if (msLeft <= 0) countdown = 'Picks are locking now.';
    else if (hoursLeft < 24) countdown = `Less than a day left — about ${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'}.`;
    else countdown = `About ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} left.`;
    return { date, time, daysLeft, hoursLeft, countdown };
  } catch {
    return { date: 'Sunday, June 28', time: '2:55 PM', daysLeft: null, hoursLeft: null, countdown: '' };
  }
}

function knockoutReminderTemplate({ user, ctx }) {
  const name = user.displayName || user.username || null;
  const { date: lockDate, time: lockTime, countdown } = r32LockText();
  const subject = name
    ? `${name}, your knockout picks lock ${lockDate}`
    : `Your World Cup knockout picks lock ${lockDate}`;

  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=lifecycle&utm_campaign=knockout_lock_reminder`;
  // Deep-link straight to the create-league form for the friends' knockout pool.
  const leagueUrl = `${PROD_ORIGIN}/create?utm_source=email&utm_medium=lifecycle&utm_campaign=knockout_league`;
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
              <h1 style="margin:0 0 14px;font-size:28px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:#0a0a0f;">
                The real teams are in your bracket.
              </h1>
              <p style="margin:0 0 12px;font-size:15px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:#FF3B30;">
                Knockout picks lock ${escape(lockDate)}
              </p>
              <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:#3c3c43;">
                The group stage is done, and the teams that actually advanced are now seeded into your
                Round of 32. Come pick your winners through to the Final — any team you correctly called
                to the knockouts is yours to advance. Your picks lock <strong>${escape(lockDate)}</strong>${lockTime ? `, around <strong>${escape(lockTime)} ET</strong>` : ''}. ${escape(countdown)}
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:18px 36px;color:#ffffff;text-decoration:none;font-weight:800;font-size:17px;letter-spacing:0.3px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      Make my knockout picks →
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
                <tr>
                  <td style="padding:14px 16px;background:#eef7ff;border:1px solid #b8dcff;border-radius:8px;font-size:14px;color:#0a2540;line-height:1.55;">
                    <strong>Happy with your bracket already?</strong> You don't have to change a thing — your
                    original picks are saved and still scoring exactly as you submitted them. This is only if
                    you'd like to adjust now that the real teams are set.
                  </td>
                </tr>
              </table>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 18px;">
                <tr>
                  <td style="padding:14px 16px;background:#f4f0ff;border:1px solid #d6c8ff;border-radius:8px;font-size:14px;color:#2a1a4a;line-height:1.55;">
                    <strong>Playing with friends?</strong> Start a private league just for the knockout rounds —
                    it comes pre-filled with the real Round of 32, so everyone picks winners from the same 32 teams.
                    Fresh start, level field, pure knockout bragging rights.
                    <br />
                    <a href="${leagueUrl}" style="display:inline-block;margin-top:8px;color:#5b2bd6;text-decoration:underline;font-weight:700;">Start a knockout league →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6e6e80;line-height:1.55;">
                Top 3 on the Global Quick Picks Leaderboard at the end of the Final win <strong>$150 / $100 / $50 in USDC</strong>. Free entry, no purchase necessary.
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

THE REAL TEAMS ARE IN YOUR BRACKET.

The group stage is done, and the teams that actually advanced are now seeded into your Round of 32. Come pick your winners through to the Final — any team you correctly called to the knockouts is yours to advance.

Your knockout picks lock ${lockDate}${lockTime ? `, around ${lockTime} ET` : ''}. ${countdown}

Make my knockout picks: ${ctaUrl}

Happy with your bracket already? You don't have to change a thing — your original picks are saved and still scoring exactly as you submitted them. This is only if you'd like to adjust now that the real teams are set.

Playing with friends? Start a private league just for the knockout rounds — it comes pre-filled with the real Round of 32, so everyone picks winners from the same 32 teams. Fresh start, level field, pure knockout bragging rights. Start one here: ${leagueUrl}

Top 3 on the Global Quick Picks Leaderboard at the end of the Final win $150 / $100 / $50 in USDC. Free entry, no purchase necessary.

Unsubscribe: ${unsubUrl}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Template: Knockout Re-pick (group-stage chaos) ──────────────
// One-off re-engagement blast sent in the final group-stage days: the
// real results have shredded everyone's pre-tournament bracket, and the
// knockout bracket reseeds with the teams that actually advanced. Drives
// users back to re-pick their knockout winners before the R32 lock.
// Deep-links straight to the Global Quick Picks wizard (resumes at the
// knockout step). Result-specific copy is intentionally hard-coded for
// this campaign — the operator verifies it against live standings before
// sending. Targeted at the global_ko_not_resubmitted audience via the
// admin Outreach eligibility filter.

function knockoutRepickTemplate({ user }) {
  const subject = 'Germany lost. Your bracket needs you.';
  const preheader = 'One group day left, then knockout brackets lock.';
  const ctaUrl = `${PROD_ORIGIN}/quick-picks/global-simple?utm_source=email&utm_medium=campaign&utm_campaign=knockout_repick`;
  const unsubUrl = unsubscribeUrl(user.id);

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escape(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#eef0f3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;color:#111118;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;font-size:1px;line-height:1px;color:#eef0f3;">${escape(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#eef0f3;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;box-shadow:0 6px 24px rgba(15,23,42,0.06);">
          ${brandHeader()}
          <tr>
            <td style="padding:32px 28px 8px;">
              <p style="margin:0 0 14px;font-size:15px;color:#3c3c43;line-height:1.5;">${greeting(user)}</p>
              <h1 style="margin:0 0 16px;font-size:27px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:#0a0a0f;">
                The group stage broke everyone&rsquo;s bracket. Including yours.
              </h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Be honest &mdash; when you locked in your picks before kickoff, did you have Ecuador beating Germany?
              </p>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Because that just happened. Must-win, backs against the wall, and the young Ecuadorians did it, 2&ndash;1. Their coach said something I&rsquo;m stealing for GoalOracle: <em>&ldquo;You&rsquo;re a process, not a result.&rdquo;</em>
              </p>
              <p style="margin:0 0 10px;font-size:16px;line-height:1.6;color:#3c3c43;">
                And that was just one day of chaos:
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 20px;">
                <tr><td style="padding:6px 0;font-size:15.5px;line-height:1.5;color:#3c3c43;border-bottom:1px solid #f0f0f3;">&#9917;&nbsp; Australia bullied T&uuml;rkiye 2&ndash;0 &mdash; the trendy dark horse, gone.</td></tr>
                <tr><td style="padding:6px 0;font-size:15.5px;line-height:1.5;color:#3c3c43;border-bottom:1px solid #f0f0f3;">&#9917;&nbsp; Canada hung SIX on Qatar&hellip; then lost to Switzerland anyway.</td></tr>
                <tr><td style="padding:6px 0;font-size:15.5px;line-height:1.5;color:#3c3c43;border-bottom:1px solid #f0f0f3;">&#9917;&nbsp; South Africa reached the knockouts for the FIRST TIME.</td></tr>
                <tr><td style="padding:6px 0;font-size:15.5px;line-height:1.5;color:#3c3c43;border-bottom:1px solid #f0f0f3;">&#9917;&nbsp; The most draws in a single day since 1958 &mdash; New Zealand, the lowest-ranked team in the field, clawing back twice on Iran.</td></tr>
                <tr><td style="padding:6px 0;font-size:15.5px;line-height:1.5;color:#3c3c43;">&#9917;&nbsp; Messi (39) and Ronaldo (41) still scoring. The old kings aren&rsquo;t done.</td></tr>
              </table>
              <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Meanwhile Spain, France, Brazil, Portugal and the Netherlands are topping their groups and looking scary.
              </p>
              <p style="margin:0 0 12px;font-size:14px;font-weight:800;letter-spacing:1px;text-transform:uppercase;color:#FF3B30;">
                Here&rsquo;s why this matters now.
              </p>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">
                One final round of group games is left. When those whistles blow, the full 32-team knockout bracket gets set &mdash; and the bracket you picked weeks ago is about to be outdated. Some of your teams are out. Some snuck in the back door. The matchups are reshuffling.
              </p>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#0a0a0f;font-weight:700;">
                &#128073; Once the last group games finish, you re-select and lock in your knockout bracket.
              </p>
              <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:#3c3c43;">
                This is your reset. Pick who&rsquo;s actually hot, who&rsquo;s quietly cruising, who&rsquo;s limping in wounded &mdash; and win the Global League. <strong>$150 / $100 / $50 in USDC</strong> for the top 3.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:0 0 26px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:18px 34px;color:#ffffff;text-decoration:none;font-weight:800;font-size:16px;letter-spacing:0.3px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      Re-pick my knockout bracket &rarr;
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 4px;font-size:16px;line-height:1.6;color:#3c3c43;">
                The group stage humbled all of us. Now prove you learned from it.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubUrl)}
        </table>
        <p style="margin:14px 0 0;font-size:11px;color:#9999aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">You&rsquo;re receiving this because you signed up for GoalOracle.</p>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${greeting(user).replace(/<[^>]+>/g, '')}

The group stage broke everyone's bracket. Including yours.

Be honest -- when you locked in your picks before kickoff, did you have Ecuador beating Germany?

Because that just happened. Must-win, backs against the wall, and the young Ecuadorians did it, 2-1. Their coach said something I'm stealing for GoalOracle: "You're a process, not a result."

And that was just one day of chaos:
- Australia bullied Turkiye 2-0 -- the trendy dark horse, gone.
- Canada hung SIX on Qatar... then lost to Switzerland anyway.
- South Africa reached the knockouts for the FIRST TIME.
- The most draws in a single day since 1958 -- New Zealand, the lowest-ranked team in the field, clawing back twice on Iran.
- Messi (39) and Ronaldo (41) still scoring. The old kings aren't done.

Meanwhile Spain, France, Brazil, Portugal and the Netherlands are topping their groups and looking scary.

HERE'S WHY THIS MATTERS NOW.

One final round of group games is left. When those whistles blow, the full 32-team knockout bracket gets set -- and the bracket you picked weeks ago is about to be outdated. Some of your teams are out. Some snuck in the back door. The matchups are reshuffling.

Once the last group games finish, you re-select and lock in your knockout bracket.

This is your reset. Pick who's actually hot, who's quietly cruising, who's limping in wounded -- and win the Global League. $150 / $100 / $50 in USDC for the top 3.

Re-pick my knockout bracket: ${ctaUrl}

The group stage humbled all of us. Now prove you learned from it.

Free skill-based prediction contest. No purchase necessary. Top 3 on the Global Quick Picks Leaderboard at the end of the World Cup 2026 Final receive cash prizes in USDC.

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
  rankDigest: {
    id: 'rankDigest',
    label: 'Daily Leaderboard Movement',
    description: 'Personalized daily digest sent to users who moved up or down a configurable number of places on the Global League after the day\'s games. Driven by the rank-digest cron; per-user movement is supplied via the scheduled-send payload.',
    build: rankDigestTemplate,
  },
  knockoutReminder: {
    id: 'knockoutReminder',
    label: 'Knockout Lock Reminder',
    description: "Sent after the group stage, once the real Round-of-32 teams are seeded into brackets, to nudge users to finalize their knockout winners before the R32 lock (2026-06-28). Explicitly reassures users happy with their bracket that they don't need to change anything — original picks stay saved and scoring. Default eligibility: in the Global Quick Picks League, has email, not opted out — regardless of pick status.",
    build: knockoutReminderTemplate,
  },
  knockoutRepick: {
    id: 'knockoutRepick',
    label: 'Knockout Re-pick (group-stage chaos)',
    description: "One-off re-engagement blast for the final group-stage days: the real results have shredded everyone's pre-tournament bracket and the knockout bracket reseeds with the teams that actually advanced. Drives users back to re-pick their knockout winners before the R32 lock. Deep-links to the Global Quick Picks wizard. Default eligibility: in the Global Quick Picks League, has email, not opted out, AND has NOT re-locked their knockout bracket since the real R32 teams were set (drops out the moment they re-save). Result-specific copy is hard-coded — verify against live standings before sending.",
    build: knockoutRepickTemplate,
  },
};

// The footer table-row is the same across every template; we splice the
// founder sign-off in just before it so it lands at the end of the message
// body (above the legal footer) on EVERY engagement email, centrally —
// rather than editing each template. Returns html unchanged if the anchor
// isn't found (defensive), so a template that ever diverges still sends.
const FOOTER_ANCHOR = '<tr>\n    <td style="padding:24px 28px;background:#f5f5f7;';
function withSignOff({ subject, html, text }) {
  let outHtml = html;
  const idx = html.indexOf(FOOTER_ANCHOR);
  if (idx !== -1) {
    // Wrap the sign-off in the same body cell padding the templates use.
    const block = `          <tr><td style="padding:0 28px 28px;">${signOffHtml()}</td></tr>\n          `;
    outHtml = html.slice(0, idx) + block + html.slice(idx);
  }
  return { subject, html: outHtml, text: `${text}${signOffText()}` };
}

export function buildEmail(templateId, args) {
  const t = TEMPLATES[templateId];
  if (!t) throw new Error(`Unknown email template: ${templateId}`);
  return withSignOff(t.build(args));
}

// ─── Custom one-off email (B2b) ──────────────────────────────────
// Wraps an operator-authored subject + PLAIN-TEXT body into the same
// branded shell as the templates (logo header, greeting, footer) and the
// shared sign-off. The body is treated as untrusted plain text: HTML is
// escaped and line breaks become paragraphs, so an operator can't (even
// accidentally) inject markup, and the message stays light + personal for
// inbox placement. Blank lines separate paragraphs.
export function buildCustomEmail({ user, subject, body }) {
  const safeSubject = String(subject || '').slice(0, 200);
  const rawBody = String(body || '');
  const unsubUrl = unsubscribeUrl(user.id);

  // Plain text → escaped paragraphs (split on blank lines; single newlines
  // become <br>).
  const paragraphs = rawBody.replace(/\r\n/g, '\n').split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#3c3c43;">${escape(p).replace(/\n/g, '<br />')}</p>`)
    .join('\n              ');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="color-scheme" content="light only" />
<title>${escape(safeSubject)}</title>
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
              ${paragraphs}
            </td>
          </tr>
          ${brandFooter(unsubUrl)}
        </table>
        <p style="margin:14px 0 0;font-size:11px;color:#9999aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">You're receiving this because you signed up for GoalOracle.</p>
      </td>
    </tr>
  </table>
</body></html>`;

  const greetingText = (user.displayName || user.username) ? `Hey ${user.displayName || user.username},` : 'Hey,';
  const text = `${greetingText}\n\n${rawBody.trim()}`;

  return withSignOff({ subject: safeSubject, html, text });
}

// ─── Send ────────────────────────────────────────────────────────

export async function sendOutreachEmail({ to, subject, html, text, tags = [], from = null, replyTo = null }) {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error('[outreach] RESEND_API_KEY not set, email dropped:', subject);
    return { sent: false, reason: 'no-resend-key' };
  }
  // Dual-from fallback — prefer a verified goaloracle.io address (DKIM signs
  // for the whole domain, so support@ / hello@ both pass), fall back to
  // resend.dev if DKIM isn't set up yet (so local/dev sends still work). A
  // caller can override the primary From (e.g. support@ for 1:1 replies).
  const primaryFrom = from || 'GoalOracle <hello@goaloracle.io>';
  const senders = [primaryFrom, 'GoalOracle <onboarding@resend.dev>'];
  let sent = false;
  let lastError = null;
  for (const sender of senders) {
    try {
      const body = { from: sender, to: [to], subject, html, text };
      if (replyTo) body.reply_to = replyTo;
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
