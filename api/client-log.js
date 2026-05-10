import { applyCors } from './_lib/firebase.js';

// Server-side capture of critical client-side events that we otherwise
// can't see (mobile users with no DevTools, silent Firebase Auth
// failures, etc). Posts go to Vercel runtime logs where the operator
// can review them. Intentionally minimal — no DB writes, no auth, just
// a console.log so the event lands in Vercel's runtime logs.
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
]);

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

  return res.status(200).json({ ok: true });
}
