import admin from 'firebase-admin';

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();

// Origins allowed to call our API from a browser context. Anything not in
// this list (or matching the Vercel-preview pattern below) gets no
// Access-Control-Allow-Origin header, so the browser blocks the response.
// Server-to-server callers (social unfurlers, oracle pings) don't trip CORS
// at all and remain unaffected.
const STATIC_ALLOWED_ORIGINS = new Set([
  'https://goaloracle.io',
  'https://www.goaloracle.io',
  'http://localhost:5173',  // vite dev
  'http://localhost:4173',  // vite preview
  'http://localhost:3000',
]);

// Vercel deploy previews — pattern is goaloracle-<hash>-<team>.vercel.app or
// goaloracle-git-<branch>-<team>.vercel.app. Only this project's previews
// match; an attacker hosting their own vercel.app site is excluded.
const VERCEL_PREVIEW_RE = /^https:\/\/goaloracle[a-z0-9-]*\.vercel\.app$/i;

// Optional override: comma-separated list of additional origins. Useful for
// staging domains or one-off testing without code changes.
const ENV_ALLOWED = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

function isOriginAllowed(origin) {
  if (!origin) return false;
  if (STATIC_ALLOWED_ORIGINS.has(origin)) return true;
  if (VERCEL_PREVIEW_RE.test(origin)) return true;
  if (ENV_ALLOWED.includes(origin)) return true;
  return false;
}

// Apply CORS headers based on the request's Origin. Endpoints should call
// this once at the top of the handler, then handle OPTIONS preflight:
//
//   applyCors(req, res);
//   if (req.method === 'OPTIONS') return res.status(200).json({});
//
// If the origin isn't allowed, no Access-Control-Allow-Origin is set — the
// browser will reject the response, but server-side fetches still work.
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

async function verifyAuth(req) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return { userId: decoded.uid, sub: decoded.uid, email: decoded.email || null };
  } catch (e) {
    console.error('Token verification failed:', e.message);
    return null;
  }
}

export { db, admin, applyCors, verifyAuth };

