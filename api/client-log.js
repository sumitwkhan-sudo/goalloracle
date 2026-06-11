import { db, applyCors } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { dayId, normalizeAuthCode, normalizeStep, isTerminalAuthError } from './_lib/funnelHealth.js';

// Server-side capture of critical client-side events that we otherwise
// can't see (mobile users with no DevTools, silent Firebase Auth
// failures, etc). Posts go to Vercel runtime logs where the operator
// can review them. Mostly a console.log so the event lands in Vercel's
// runtime logs; a few critical tags ALSO bump a daily funnel-health
// counter (see HEALTH_COUNTED_TAGS) so the admin "Funnel Health" control
// can monitor them without trawling logs.
//
// Hardened against abuse:
//   - Method gate (POST only)
//   - Payload size cap (4 KB)
//   - Tag whitelist — only emits logs for tags we ship in our own code
//   - User-agent + referer fall back to "?" if missing
//
// Not auth-gated — clients can't reasonably authenticate before sign-in
// completes, and the signal we need to capture IS the failing sign-in.
const ALLOWED_TAGS = new Set([
  'auth.redirect.start',
  'auth.redirect.flag-snapshot',
  'auth.redirect.result',
  'auth.redirect.result.error',
  'auth.redirect.silent-null',
  'auth.redirect.swap-complete',
  'auth.redirect.swap-failed',
  'auth.bfcache.fired',
  'auth.popup.opened',
  'auth.popup.resolved',
  'auth.popup.error',
  // Custom-token sign-in path (email-OTP + Google/GIS). These were shipped
  // by auth.js (signInWithCustomTokenRetry, exchangeGoogleCredential) but
  // were missing from this whitelist, so the breadcrumbs were silently
  // dropped with a 400. Now allowed AND counted for funnel-health.
  'auth.customtoken.error',
  'auth.gis.exchange-start',
  'auth.gis.exchange-complete',
]);

// Tags that also bump the daily /funnelHealth counter. An unauthenticated
// abuser can only inflate a counter on one doc/day, not create storage.
const HEALTH_COUNTED_TAGS = new Set(['auth.customtoken.error']);

const MAX_PAYLOAD_BYTES = 4 * 1024;
const MAX_FIELD_LEN = 800;

function truncate(v) {
  if (v == null) return '';
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return s.length > MAX_FIELD_LEN ? s.slice(0, MAX_FIELD_LEN) + '…(truncated)' : s;
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (req.method !== 'POST') return res.status(405).end();

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid json' }); }
  }
  if (!body || typeof body !== 'object') return res.status(400).json({ error: 'invalid body' });

  // Cheap size check — Vercel limits body size already, this is defense
  // against unintentionally huge stack traces.
  try {
    if (JSON.stringify(body).length > MAX_PAYLOAD_BYTES) {
      return res.status(413).json({ error: 'payload too large' });
    }
  } catch {
    return res.status(400).json({ error: 'unserialisable body' });
  }

  const tag = String(body.tag || '');
  if (!ALLOWED_TAGS.has(tag)) {
    return res.status(400).json({ error: 'unknown tag' });
  }

  const data = body.data ?? {};
  const ua = req.headers['user-agent'] || '?';
  const ref = req.headers['referer'] || '?';
  const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim() || '?';

  // One-line summary so it's easy to scan in Vercel's log table.
  console.log(`[client-log] ${tag} ua=${truncate(ua)} ref=${truncate(ref)} ip=${truncate(ip)} data=${truncate(data)}`);

  // Persist a daily counter for the few tags the Funnel Health control
  // monitors. Best-effort — a health-write failure never fails the log post.
  if (HEALTH_COUNTED_TAGS.has(tag)) {
    try {
      const id = dayId();
      // The sign-in retry loop emits one breadcrumb PER attempt. Only the
      // TERMINAL one means the user actually couldn't sign in; the rest are
      // transient attempts that recovered on retry. Counting every attempt
      // triple-counts a single flaky session, so split them: terminal drives
      // the alert (total/byCode/byStep), transient is informational only.
      if (isTerminalAuthError(data)) {
        const code = normalizeAuthCode(data?.code);
        const step = normalizeStep(data?.step);
        await db.collection('funnelHealth').doc(id).set({
          date: id,
          authCustomToken: {
            total: FieldValue.increment(1),
            byCode: { [code]: FieldValue.increment(1) },
            byStep: { [step]: FieldValue.increment(1) },
          },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      } else {
        await db.collection('funnelHealth').doc(id).set({
          date: id,
          authCustomToken: { transient: FieldValue.increment(1) },
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } catch (e) {
      console.warn('[client-log] health write failed:', e?.message);
    }
  }

  return res.status(200).json({ ok: true });
}
