/**
 * alerts.js — operator alert email helper.
 *
 * Fires when something cron-driven fails in a way the operator needs to
 * know about. Used by both /api/cron/poll-results and /api/cron/daily-
 * report, plus an inline alert in /api/admin → updateResult when a
 * scored match's result changes.
 *
 * Design notes:
 *   - Always best-effort. Never throws. If Resend is down, swallow the
 *     error and log to console — alerts must not crash the cron itself.
 *   - Subject is deduped per (subject, day) so we don't spam if a flaky
 *     upstream fails 48 times in a row. The dedupe key lives in
 *     /alertsSent so it survives function restarts.
 *   - Every alert email includes a "What to do" section with concrete
 *     resolution steps. The operator should not have to read the source
 *     to know what to fix.
 */

import { db } from './firebase.js';
import { escapeHtml } from './security.js';
import { FieldValue } from 'firebase-admin/firestore';

const ALERT_DEDUPE_HOURS = 6;

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function alertHash(subject) {
  // Stable per-subject identifier for dedupe. Subject lines are stable
  // for any given failure mode by design, so a simple base64 of the
  // subject + date works.
  return Buffer.from(`${todayKey()}|${subject}`).toString('base64url').slice(0, 60);
}

/**
 * Send an operator alert email with a clear resolution step.
 *
 * @param {string} subject  Short subject line — should describe the failure.
 * @param {object} body
 *   .what       One-paragraph explanation of what failed.
 *   .why        Likely cause(s), bulleted.
 *   .resolution Concrete steps to fix — copy-pasteable where possible.
 *   .context    Optional dict of diagnostic key/value pairs.
 */
export async function sendOperatorAlert(subject, body) {
  try {
    const dedupeId = alertHash(subject);
    const ref = db.collection('alertsSent').doc(dedupeId);
    const snap = await ref.get();
    if (snap.exists) {
      const lastSent = snap.data().sentAt?.toMillis?.() || 0;
      if (Date.now() - lastSent < ALERT_DEDUPE_HOURS * 60 * 60 * 1000) {
        // Already alerted on this exact subject recently — skip.
        return { sent: false, reason: 'deduped' };
      }
    }

    const resendKey = process.env.RESEND_API_KEY;
    const to = process.env.REPORT_EMAIL || process.env.FEEDBACK_EMAIL || 'sumitwkhan@gmail.com';
    if (!resendKey) {
      console.error('[alert] RESEND_API_KEY not set, alert dropped:', subject);
      return { sent: false, reason: 'no-resend-key' };
    }

    const html = renderAlertHtml(subject, body);
    const senders = ['GoalOracle <alerts@goaloracle.io>', 'GoalOracle <onboarding@resend.dev>'];
    let sent = false;
    let lastError = null;
    for (const from of senders) {
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${resendKey}` },
          body: JSON.stringify({
            from,
            to: [to],
            subject: `[GoalOracle ALERT] ${subject}`,
            html,
          }),
        });
        if (r.ok) { sent = true; break; }
        if (r.status !== 403 && r.status !== 422) { lastError = `HTTP ${r.status}`; break; }
      } catch (e) { lastError = e.message; }
    }

    await ref.set({
      subject,
      sentAt: FieldValue.serverTimestamp(),
      sent,
      error: lastError,
    });
    if (!sent) console.error('[alert] send failed:', subject, lastError);
    return { sent, error: lastError };
  } catch (e) {
    console.error('[alert] handler crashed:', e.message);
    return { sent: false, reason: 'handler-crash', error: e.message };
  }
}

function renderAlertHtml(subject, body) {
  const { what, why, resolution, context } = body || {};
  return `<div style="font-family:-apple-system,sans-serif;max-width:680px;margin:0 auto;color:#111">
  <div style="background:#7a1d1d;color:#fff;padding:18px 24px;border-radius:10px 10px 0 0">
    <div style="font-size:13px;opacity:0.7">GoalOracle alert</div>
    <div style="font-size:20px;font-weight:700;margin-top:4px">${escapeHtml(subject)}</div>
    <div style="font-size:13px;opacity:0.7;margin-top:6px">${escapeHtml(new Date().toUTCString())}</div>
  </div>
  <div style="background:#fff;border:1px solid #e5e5e5;border-top:none;border-radius:0 0 10px 10px;padding:18px 24px">
    ${what ? `<h3 style="font-size:14px;color:#444;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px">What's broken</h3><p style="margin:0 0 16px;font-size:14px;line-height:1.5">${escapeHtml(what)}</p>` : ''}

    ${Array.isArray(why) && why.length ? `<h3 style="font-size:14px;color:#444;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px">Likely cause</h3><ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.6">${why.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}

    ${Array.isArray(resolution) && resolution.length ? `<h3 style="font-size:14px;color:#444;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px">What to do</h3><ol style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.6">${resolution.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>` : ''}

    ${context && Object.keys(context).length ? `<h3 style="font-size:14px;color:#444;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.5px">Diagnostic context</h3><table style="width:100%;border-collapse:collapse;font-size:13px;font-family:monospace;background:#f8f9fa;border-radius:6px"><tbody>${Object.entries(context).map(([k, v]) => `<tr><td style="padding:6px 12px;color:#666;width:30%">${escapeHtml(k)}</td><td style="padding:6px 12px">${escapeHtml(typeof v === 'string' ? v : JSON.stringify(v))}</td></tr>`).join('')}</tbody></table>` : ''}

    <p style="color:#999;font-size:12px;margin:24px 0 0;border-top:1px solid #eee;padding-top:12px">
      This alert is deduped — you'll get at most one of these per ${ALERT_DEDUPE_HOURS}h. If the underlying problem persists, it'll surface again in tomorrow's daily report.
    </p>
  </div>
</div>`;
}
