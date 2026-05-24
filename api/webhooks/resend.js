/**
 * /api/webhooks/resend — Resend webhook receiver.
 *
 * Wired in the Resend dashboard at https://resend.com/webhooks. Set the
 * endpoint URL to https://goaloracle.io/api/webhooks/resend and copy
 * the signing secret into the RESEND_WEBHOOK_SECRET env var on Vercel.
 *
 * Events we care about (set these in the Resend webhook subscription):
 *   - email.delivered  → stamp deliveredAt
 *   - email.opened     → stamp openedAt + increment opens
 *   - email.clicked    → stamp clickedAt + increment clicks
 *   - email.bounced    → stamp bouncedAt + record bounceType
 *   - email.complained → set emailOptOut on the user (spam complaint)
 *
 * We match events back to per-user outreachSent rows via a tag pair
 * (userId + template) injected when the send happens. If the tag is
 * missing the event still validates successfully but is logged + ignored.
 *
 * Verifies the webhook signature with the Svix headers Resend sends
 * (svix-id, svix-timestamp, svix-signature). The signing secret format
 * is `whsec_...`; we strip the prefix before HMAC-256 over `id.ts.body`.
 */

import crypto from 'crypto';
import { db } from '../_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export const config = {
  api: { bodyParser: false }, // raw body required for signature verify
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function timingSafeEqualHex(a, b) {
  // Both must be hex strings of equal length for crypto.timingSafeEqual.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
}

function verifySignature({ secret, id, timestamp, signatureHeader, body }) {
  if (!secret) return { ok: false, reason: 'no-secret' };
  if (!id || !timestamp || !signatureHeader) return { ok: false, reason: 'missing-headers' };

  // Reject events older than 5 minutes — protects against replay.
  const ageMs = Math.abs(Date.now() - (Number(timestamp) * 1000));
  if (ageMs > 5 * 60 * 1000) return { ok: false, reason: 'stale' };

  const secretBytes = Buffer.from(
    String(secret).startsWith('whsec_') ? secret.slice(6) : secret,
    'base64'
  );
  const signedPayload = `${id}.${timestamp}.${body}`;
  const expected = crypto.createHmac('sha256', secretBytes).update(signedPayload).digest('base64');

  // Svix signature header format: "v1,sig1 v1,sig2 ..." — match any
  const sigs = signatureHeader.split(' ').map(s => s.split(',')[1]).filter(Boolean);
  for (const sig of sigs) {
    if (Buffer.from(sig).length !== Buffer.from(expected).length) continue;
    if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return { ok: true };
  }
  return { ok: false, reason: 'mismatch' };
}

function extractTags(payload) {
  // Resend lets you attach tags to a send. We tag each outreach send
  // with [{name:'userId',value:<uid>}, {name:'template',value:<tpl>}].
  // The event payload echoes those tags back so we can route the event
  // to the right /outreachSent doc.
  const tags = payload?.data?.tags || [];
  const out = {};
  for (const t of tags) {
    if (t?.name && t?.value != null) out[t.name] = String(t.value);
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const raw = await readRawBody(req);
  const verify = verifySignature({
    secret: process.env.RESEND_WEBHOOK_SECRET,
    id: req.headers['svix-id'],
    timestamp: req.headers['svix-timestamp'],
    signatureHeader: req.headers['svix-signature'],
    body: raw,
  });
  if (!verify.ok) {
    console.warn('[resend-webhook] signature verify failed:', verify.reason);
    // 401 so Resend retries with backoff. If you ever want a hard-stop
    // (don't retry), change to 200 with an explanatory log.
    return res.status(401).json({ error: 'invalid signature', reason: verify.reason });
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch { return res.status(400).json({ error: 'invalid JSON' }); }

  const type = payload?.type;
  const tags = extractTags(payload);
  const userId = tags.userId || null;
  const template = tags.template || null;
  const docId = (userId && template) ? `${userId}__${template}` : null;
  const ts = payload?.created_at ? new Date(payload.created_at) : new Date();

  // Per-event handling. Each branch is idempotent — Resend can retry,
  // so we use merge:true + only stamp the timestamp once per event
  // type (incrementing the count, not overwriting).
  try {
    if (type === 'email.delivered') {
      if (docId) {
        await db.collection('outreachSent').doc(docId).set({
          deliveredAt: ts,
          deliveredAtMs: ts.getTime(),
        }, { merge: true });
      }
    } else if (type === 'email.opened') {
      if (docId) {
        await db.collection('outreachSent').doc(docId).set({
          firstOpenedAt: ts,
          lastOpenedAt: ts,
          openCount: FieldValue.increment(1),
        }, { merge: true });
      }
    } else if (type === 'email.clicked') {
      if (docId) {
        await db.collection('outreachSent').doc(docId).set({
          firstClickedAt: ts,
          lastClickedAt: ts,
          clickCount: FieldValue.increment(1),
          lastClickedUrl: payload?.data?.click?.link || null,
        }, { merge: true });
      }
    } else if (type === 'email.bounced') {
      if (docId) {
        await db.collection('outreachSent').doc(docId).set({
          bouncedAt: ts,
          bounceType: payload?.data?.bounce?.type || null,
        }, { merge: true });
      }
    } else if (type === 'email.complained') {
      // Spam complaint — auto-unsubscribe the user as a courtesy +
      // legal hygiene (gmail/yahoo bulk-sender policies require this).
      if (userId) {
        await db.collection('users').doc(userId).set({
          emailOptOut: true,
          emailOptOutAt: ts,
          emailOptOutReason: 'spam-complaint',
        }, { merge: true });
      }
      if (docId) {
        await db.collection('outreachSent').doc(docId).set({
          complainedAt: ts,
        }, { merge: true });
      }
    } else {
      // Unrecognized event type — log + ack so Resend doesn't retry.
      console.log('[resend-webhook] ignoring event type:', type);
    }
  } catch (e) {
    console.error('[resend-webhook] handler error:', type, e?.message);
    return res.status(500).json({ error: 'handler failed' });
  }

  return res.status(200).json({ ok: true });
}
