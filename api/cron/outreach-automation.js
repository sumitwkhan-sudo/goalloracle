/**
 * /api/cron/outreach-automation.js — evaluate + run enabled automation
 * rules (B2d-2). HIGH-RISK: this is the only place that auto-sends real
 * email with no per-send human, so it is built defensively.
 *
 * Each ENABLED rule in /automationRules is:
 *   { segment, template, hoursBeforeLock, cooldownDays, maxPerRun }
 *
 * Per rule, every run:
 *   1. Timing gate — if hoursBeforeLock is set, only fire when we're within
 *      that many hours before the group-stage lock (and not past it).
 *   2. Resolve the segment via the SHARED resolveSegment (identical to the
 *      admin dry-run preview), so what fires == what was previewed.
 *   3. Cooldown guardrail — drop anyone emailed (any template) within
 *      cooldownDays. Per-rule dedup — also drop anyone this exact rule
 *      already emailed (tracked on /automationRuleSends).
 *   4. Cap at maxPerRun.
 *   5. Send via the shared send path; log each to /outreachSent + a run
 *      summary to /outreachRuns; stamp per-rule dedup.
 *
 * Safety rails:
 *   - Rules are disabled by default; only enabled ones are even read.
 *   - maxPerRun is clamped on save AND re-clamped here.
 *   - A GLOBAL per-invocation cap stops a misconfigured set of rules from
 *     blasting thousands in one tick.
 *   - dryRun=1 query param resolves + reports WITHOUT sending.
 *
 * Auth: CRON_SECRET / x-vercel-cron, or a superadmin Bearer token (manual
 * trigger). Schedule is wired in vercel.json.
 */

import { db, applyCors, verifyAuth } from '../_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { buildEmail, sendOutreachEmail, TEMPLATES, firstNameOf, sleep, BATCH_DELAY_MS } from '../_lib/outreachEmail.js';
import { resolveSegment, SEGMENTS } from '../_lib/outreachSegments.js';
import { stageLockTimeUtc } from '../../src/utils/stageLock.js';

// Hard ceiling across ALL rules in a single invocation — a backstop against
// a misconfiguration sending more than this many emails in one tick.
const GLOBAL_MAX_PER_RUN = 1000;

async function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  if (req.headers['x-vercel-cron'] === '1') return true;
  const claims = await verifyAuth(req);
  if (!claims) return false;
  const snap = await db.collection('users').doc(claims.userId).get();
  return snap.exists && snap.data().role === 'superadmin';
}

// Most-recent successful send per user, across all templates — powers the
// cooldown guardrail. Read /outreachSent once for the whole invocation.
async function loadLastSentByUser() {
  const snap = await db.collection('outreachSent').get();
  const last = {};
  snap.docs.forEach((d) => {
    const x = d.data();
    if (!x.userId || x.sent === false) return;
    const ms = x.sentAt?._seconds ? x.sentAt._seconds * 1000
      : (typeof x.sentAt?.toMillis === 'function' ? x.sentAt.toMillis() : null);
    if (ms && (!last[x.userId] || ms > last[x.userId])) last[x.userId] = ms;
  });
  return last;
}

function timingAllows(rule, now) {
  if (rule.hoursBeforeLock == null) return true; // no timing gate
  // Which stage's lock the window is measured against. Defaults to the
  // group stage (back-compat); a rule can target a later lock — e.g.
  // `stage: 'roundOf32'` for a "finalize your knockout picks" nudge.
  let lockMs;
  try { lockMs = stageLockTimeUtc(rule.stage || 'groupStage'); } catch { return true; }
  const hoursLeft = (lockMs - now) / 3_600_000;
  // Fire only while we're inside the window and not past the lock.
  return hoursLeft > 0 && hoursLeft <= rule.hoursBeforeLock;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!(await isAuthorized(req))) return res.status(401).json({ error: 'Unauthorized' });

  const dryRun = req.query?.dryRun === '1';
  const now = Date.now();

  const rulesSnap = await db.collection('automationRules').where('enabled', '==', true).get();
  if (rulesSnap.empty) {
    return res.status(200).json({ ok: true, rules: 0, note: 'no enabled rules' });
  }

  const lastSentByUser = await loadLastSentByUser();
  let globalBudget = GLOBAL_MAX_PER_RUN;
  const summary = [];

  for (const ruleDoc of rulesSnap.docs) {
    const rule = { id: ruleDoc.id, ...ruleDoc.data() };
    const out = { ruleId: rule.id, name: rule.name || rule.id, segment: rule.segment, template: rule.template };

    // Validate + timing gate.
    if (!SEGMENTS[rule.segment] || !TEMPLATES[rule.template]) {
      summary.push({ ...out, skipped: 'invalid segment/template' });
      continue;
    }
    if (!timingAllows(rule, now)) {
      summary.push({ ...out, skipped: 'outside timing window' });
      continue;
    }

    // Resolve segment (shared with the dry-run preview).
    let userIds;
    try { ({ userIds } = await resolveSegment(db, rule.segment)); }
    catch (e) { summary.push({ ...out, error: e.message }); continue; }

    const cooldownMs = Math.max(1, Number(rule.cooldownDays) || 3) * 86400000;
    const cutoff = now - cooldownMs;

    // Per-rule dedup: who has this exact rule already emailed (ever)? Stored
    // as /automationRuleSends/{ruleId__userId}. Keeps a rule from re-hitting
    // the same user even if their last contact ages past the cooldown.
    const sendsSnap = await db.collection('automationRuleSends').where('ruleId', '==', rule.id).get();
    const alreadyByRule = new Set(sendsSnap.docs.map((d) => d.data().userId).filter(Boolean));

    const eligible = userIds.filter((uid) =>
      !alreadyByRule.has(uid) && !(lastSentByUser[uid] && lastSentByUser[uid] >= cutoff));

    const cap = Math.max(1, Math.min(1000, Number(rule.maxPerRun) || 200));
    const targets = eligible.slice(0, Math.min(cap, globalBudget));

    out.segmentSize = userIds.length;
    out.eligible = eligible.length;
    out.wouldSend = targets.length;

    if (dryRun) { summary.push({ ...out, dryRun: true }); continue; }

    let sent = 0, failed = 0;
    for (const uid of targets) {
      try {
        const userSnap = await db.collection('users').doc(uid).get();
        if (!userSnap.exists) continue;
        const user = { id: userSnap.id, ...userSnap.data() };
        if (!user.email || user.emailOptOut === true || user.unsubscribedFromReminders === true) continue;

        const { subject, html, text } = buildEmail(rule.template, {
          user, ctx: { firstName: firstNameOf(user) },
        });
        const r = await sendOutreachEmail({
          to: user.email, subject, html, text,
          tags: [
            { name: 'userId', value: uid },
            { name: 'template', value: rule.template },
            { name: 'ruleId', value: rule.id },
          ],
        });

        // Per-user history (cooldown guardrail reads this) + per-rule dedup.
        await db.collection('outreachSent').doc(`${uid}__${rule.template}`).set({
          userId: uid, template: rule.template,
          sentAt: FieldValue.serverTimestamp(), sent: r.sent, error: r.error || null,
          sentBy: `automation:${rule.id}`,
        }, { merge: true });
        await db.collection('automationRuleSends').doc(`${rule.id}__${uid}`).set({
          ruleId: rule.id, userId: uid, sentAt: FieldValue.serverTimestamp(), sent: r.sent,
        }, { merge: true });

        if (r.sent) { sent++; lastSentByUser[uid] = now; }
        else failed++;
        await sleep(BATCH_DELAY_MS);
      } catch (e) {
        failed++;
      }
    }

    globalBudget -= sent;
    out.sent = sent; out.failed = failed;
    summary.push(out);

    await db.collection('outreachRuns').add({
      template: rule.template, ruleId: rule.id, automation: true,
      triggeredBy: 'cron/outreach-automation', triggeredAt: FieldValue.serverTimestamp(),
      attempted: targets.length, sent, skipped: 0, failed,
    }).catch(() => {});

    await ruleDoc.ref.set({ lastRunAt: FieldValue.serverTimestamp(), lastRunSent: sent }, { merge: true });

    if (globalBudget <= 0) { summary.push({ note: 'global per-run cap reached' }); break; }
  }

  await db.collection('adminLogs').add({
    action: 'cron_outreach_automation', dryRun, timestamp: FieldValue.serverTimestamp(), summary,
  }).catch(() => {});

  return res.status(200).json({ ok: true, dryRun, rules: rulesSnap.size, summary });
}
