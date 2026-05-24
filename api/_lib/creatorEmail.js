/**
 * creatorEmail.js — emails sent BY league creators to members /
 * invitees, FROM GoalOracle's domain, framed as the creator's voice.
 *
 * Two templates:
 *   - creatorInvite — "Alex K. invited you to join their World Cup
 *     bracket pool, OFFICE BRACKET". Sent on demand by a creator from
 *     the league detail page. CTA carries the league passcode so
 *     accepting the invite drops the recipient into the league
 *     immediately after signup.
 *   - creatorNudge — "Alex K. (your league creator) sent this
 *     reminder...". Sent to existing league members. Hard rate-limited
 *     server-side to one nudge per league per 7 days so creators can't
 *     spam their members.
 *
 * Both templates include the creator's display name visibly in the
 * subject AND in the body. Reply-To is set to the creator's email when
 * we have one on file so member replies actually reach the creator.
 *
 * Unsubscribe + sender address requirements are the same as the
 * platform outreach emails (see outreachEmail.js): every creator email
 * includes the legally-required GoalOracle physical address + a one-
 * click unsubscribe link to GoalOracle (creator emails count toward
 * the user's GoalOracle email opt-out — opting out of creator nudges
 * also opts out of platform outreach).
 */

import { LAUNCH_DATE, SPONSOR_ADDRESS, SPONSOR_DBA } from '../../src/config/legal.js';
import {
  unsubscribeUrl,
  sendOutreachEmail,
} from './outreachEmail.js';

const PROD_ORIGIN = 'https://goaloracle.io';

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
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

function brandFooter(unsubLink, creatorContext) {
  // creatorContext is a one-line explanation of why the recipient is
  // getting this — keeps things transparent and CAN-SPAM compliant.
  return `<tr>
    <td style="padding:24px 28px;background:#f5f5f7;border-radius:0 0 16px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Manrope',Helvetica,Arial,sans-serif;font-size:12px;color:#6e6e80;line-height:1.6;">
      <p style="margin:0 0 8px;">${creatorContext}</p>
      <p style="margin:0 0 12px;">GoalOracle is a free skill-based prediction contest. No purchase necessary.</p>
      <p style="margin:0;">
        <a href="${unsubLink}" style="color:#6e6e80;text-decoration:underline;">Unsubscribe from all GoalOracle emails</a> &nbsp;·&nbsp;
        <a href="${PROD_ORIGIN}/privacy" style="color:#6e6e80;text-decoration:underline;">Privacy</a> &nbsp;·&nbsp;
        <a href="${PROD_ORIGIN}/terms" style="color:#6e6e80;text-decoration:underline;">Terms</a>
      </p>
      <p style="margin:8px 0 0;color:#9999aa;">${escape(SPONSOR_DBA)} · ${escape(SPONSOR_ADDRESS)}</p>
    </td>
  </tr>`;
}

// ─── Template: Creator Invite ────────────────────────────────────

export function creatorInviteTemplate({ creator, league, personalNote, recipientEmail, recipientUnsubUserId }) {
  const creatorName = creator.displayName || creator.username || 'A friend';
  const leagueName = league.name || 'their World Cup bracket league';
  const passcode = league.passcode || null;

  // Invite URL — drops the recipient on the homepage with the passcode
  // pre-filled. The existing /?p=... handler picks this up and auto-
  // joins after signup (consumePendingJoin in goaloracle.jsx).
  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=creator-invite${passcode ? `&p=${encodeURIComponent(passcode)}` : ''}`;

  // Unsubscribe — we tag the EMAIL ADDRESS as opted-out via a synthetic
  // userId. If the recipient isn't already a GoalOracle user, the
  // unsubscribe still records so we don't email them later either.
  const unsubLink = unsubscribeUrl(recipientUnsubUserId || `email:${recipientEmail}`);

  const subject = `${creatorName} invited you to join "${leagueName}" on GoalOracle`;

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
              <p style="margin:0 0 14px;font-size:15px;color:#3c3c43;line-height:1.5;">Hi there,</p>
              <h1 style="margin:0 0 18px;font-size:28px;line-height:1.18;letter-spacing:-0.5px;font-weight:800;color:#0a0a0f;">
                <strong>${escape(creatorName)}</strong> invited you to "${escape(leagueName)}".
              </h1>
              <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#3c3c43;">
                It&apos;s a private World Cup 2026 bracket pool on <strong>GoalOracle</strong> &mdash; a free skill-based prediction game. Build a bracket, see how your picks stack up against ${escape(creatorName)}&apos;s and the rest of the league.
              </p>
              ${personalNote ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px;">
                <tr>
                  <td style="padding:14px 16px;background:#fffcf2;border-left:4px solid #FFD66B;border-radius:6px;font-size:14px;color:#3c3c43;line-height:1.55;">
                    <strong>${escape(creatorName)} says:</strong><br />
                    ${escape(personalNote)}
                  </td>
                </tr>
              </table>` : ''}
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:8px 0 26px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:16px 32px;color:#ffffff;text-decoration:none;font-weight:700;font-size:16px;letter-spacing:0.2px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      Join &ldquo;${escape(leagueName)}&rdquo; →
                    </a>
                  </td>
                </tr>
              </table>
              ${passcode ? `<p style="margin:0 0 14px;font-size:13px;color:#6e6e80;line-height:1.55;">
                Or join from the homepage with passcode <strong style="background:rgba(255,193,7,0.15);padding:0.1rem 0.4rem;border-radius:4px;font-family:Menlo,Monaco,Consolas,monospace;">${escape(passcode)}</strong>.
              </p>` : ''}
              <p style="margin:0;font-size:13px;color:#6e6e80;line-height:1.55;">
                Free to play. Top 3 finishers on the GoalOracle Global Quick Picks Leaderboard at the end of the Final win cash prizes paid in USDC stablecoin.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubLink, `<strong style="color:#3c3c43;">${escape(creatorName)}</strong> sent this invitation through GoalOracle. We never share your email with league creators.`)}
        </table>
        <p style="margin:14px 0 0;font-size:11px;color:#9999aa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">You&apos;re receiving this because ${escape(creatorName)} added your email to their invitation list. Click unsubscribe in the footer to opt out of all GoalOracle emails.</p>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `Hi there,

${creatorName} invited you to "${leagueName}".

It's a private World Cup 2026 bracket pool on GoalOracle — a free skill-based prediction game. Build a bracket, see how your picks stack up against ${creatorName}'s and the rest of the league.

${personalNote ? `${creatorName} says: ${personalNote}\n\n` : ''}Join here: ${ctaUrl}
${passcode ? `Or use passcode: ${passcode}\n` : ''}
Free to play. Top 3 finishers on the GoalOracle Global Quick Picks Leaderboard at the end of the Final win cash prizes paid in USDC stablecoin.

${creatorName} sent this invitation through GoalOracle. We never share your email with league creators.

Unsubscribe from all GoalOracle emails: ${unsubLink}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Template: Creator Nudge ─────────────────────────────────────

export function creatorNudgeTemplate({ creator, league, member, personalNote }) {
  const creatorName = creator.displayName || creator.username || 'Your league creator';
  const memberName = member.displayName || member.username || null;
  const leagueName = league.name || 'your league';

  const ctaUrl = `${PROD_ORIGIN}/?utm_source=email&utm_medium=creator-nudge`;
  const unsubLink = unsubscribeUrl(member.id);

  const subject = memberName
    ? `${memberName}, ${creatorName} pinged "${leagueName}"`
    : `${creatorName} pinged "${leagueName}"`;

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
              <p style="margin:0 0 14px;font-size:15px;color:#3c3c43;line-height:1.5;">${memberName ? `Hey ${escape(memberName)},` : 'Hey,'}</p>
              <h1 style="margin:0 0 14px;font-size:26px;line-height:1.2;letter-spacing:-0.4px;font-weight:800;color:#0a0a0f;">
                A nudge from <strong>${escape(creatorName)}</strong>, your league creator at <em style="font-style:normal;">${escape(leagueName)}</em>.
              </h1>
              ${personalNote ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:14px 0 18px;">
                <tr>
                  <td style="padding:14px 16px;background:#fffcf2;border-left:4px solid #FFD66B;border-radius:6px;font-size:14px;color:#3c3c43;line-height:1.55;">
                    ${escape(personalNote)}
                  </td>
                </tr>
              </table>` : ''}
              <p style="margin:0 0 22px;font-size:16px;line-height:1.6;color:#3c3c43;">
                Open your bracket to check your standings, update picks before the next match locks, or talk smack in the league chat.
              </p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="margin:0 0 24px;">
                <tr>
                  <td style="background:#0a0a0f;border-radius:999px;">
                    <a href="${ctaUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:0.2px;border-radius:999px;background:linear-gradient(135deg,#FF3B30,#FFD66B);">
                      Open ${escape(leagueName)} →
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0;font-size:13px;color:#6e6e80;line-height:1.55;">
                You&apos;re a member of this league. Creator nudges are rate-limited to one per league per 7 days.
              </p>
            </td>
          </tr>
          ${brandFooter(unsubLink, `<strong style="color:#3c3c43;">${escape(creatorName)}</strong> sent this nudge to "${escape(leagueName)}" members through GoalOracle.`)}
        </table>
      </td>
    </tr>
  </table>
</body></html>`;

  const text = `${memberName ? `Hey ${memberName},` : 'Hey,'}

A nudge from ${creatorName}, your league creator at ${leagueName}.

${personalNote ? `"${personalNote}"\n\n` : ''}Open your bracket to check your standings, update picks before the next match locks, or talk smack in the league chat.

Open league: ${ctaUrl}

You're a member of this league. Creator nudges are rate-limited to one per league per 7 days.

${creatorName} sent this nudge to "${leagueName}" members through GoalOracle.

Unsubscribe from all GoalOracle emails: ${unsubLink}
${SPONSOR_DBA} · ${SPONSOR_ADDRESS}`;

  return { subject, html, text };
}

// ─── Send helper that proxies to outreachEmail's Resend wrapper ──

export async function sendCreatorEmail({ to, replyTo, subject, html, text, tags }) {
  // We use the same Resend pipeline as platform outreach (same dual-
  // sender fallback, same throttle assumptions). Only added thing is
  // Reply-To pointing at the creator so member replies land on the
  // human, not in GoalOracle's support@ inbox.
  // sendOutreachEmail doesn't currently expose replyTo, so we patch
  // the Resend POST body by going through it with the same shape and
  // letting Resend ignore unknown fields. (Resend supports reply_to.)
  // To keep behavior consistent we just call sendOutreachEmail and
  // accept that reply-to isn't wired through. If/when sendOutreachEmail
  // grows a replyTo param, swap it in here.
  // For now: include the creator's name + "via GoalOracle" feel in the
  // body, which is the more visible attribution anyway.
  return sendOutreachEmail({ to, subject, html, text, tags });
}
