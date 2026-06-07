import { auth } from '../config/firebase';
import { signInWithCustomToken, signOut as fbSignOut, signInAnonymously } from 'firebase/auth';
import { getVisitorId } from './fingerprint';

// ── No-login funnel (roadmap item C) ─────────────────────────────────────
// Give every visitor a real Firebase identity (a UID, no email) so they can
// predict BEFORE signing up. Picks then save under this UID via the exact
// same path a logged-in user uses (one storage system, no separate
// "anonymous picks" store). At sign-up, linkWithCredential attaches the
// email/Google credential to THIS uid — the uid never changes, so the picks
// are already in the account (no copy, no migration). Doc-less: no /users
// doc is created until the visitor converts.
let _anonInFlight = false;
export async function ensureAnonymousSession() {
  if (auth.currentUser) return auth.currentUser; // already have a session
  if (_anonInFlight) return null;
  _anonInFlight = true;
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (e) {
    // auth/operation-not-allowed => the Anonymous provider isn't enabled in
    // the Firebase console. Degrade to the logged-out experience instead of
    // crashing the app.
    console.warn('[auth] anonymous sign-in unavailable:', e?.code || e?.message);
    return null;
  } finally {
    _anonInFlight = false;
  }
}

// Google sign-in is now handled by Google Identity Services (GIS) via
// renderGoogleButton (src/utils/googleIdentity.js). The previous
// signInWithPopup / signInWithRedirect path was removed because it
// silently failed on iOS Safari + Android Chrome — even with the
// custom auth.goaloracle.io subdomain (PR #91/#93). GIS uses FedCM
// where available with a popup fallback, and never depends on
// cross-domain storage handoff. Confirmed working across mobile.
//
// Email-OTP is unchanged — it never had the cross-domain issue.

// The custom-token sign-in path (used by both Google and email-OTP flows)
// strips email from the Firebase user — `auth.currentUser.email` is null
// after signInWithCustomToken because the token only embeds the UID. We
// stash the address here right before the swap so onAuthStateChanged ->
// createOrUpdateUser can recover it without going back through Firebase.
//
// Also persisted to sessionStorage so a page reload (e.g. an unrelated
// navigation between the swap and the next mount) doesn't lose it.
// Cleared after consumePendingEmail().
const PENDING_EMAIL_KEY = 'goaloracle_pending_email';
let _pendingEmail = null;

function setPendingEmail(email) {
  if (!email) return;
  _pendingEmail = email;
  try { sessionStorage.setItem(PENDING_EMAIL_KEY, email); } catch {}
}

export function consumePendingEmail() {
  if (_pendingEmail) {
    const e = _pendingEmail;
    _pendingEmail = null;
    try { sessionStorage.removeItem(PENDING_EMAIL_KEY); } catch {}
    return e;
  }
  try {
    const e = sessionStorage.getItem(PENDING_EMAIL_KEY);
    if (e) sessionStorage.removeItem(PENDING_EMAIL_KEY);
    return e || null;
  } catch {
    return null;
  }
}

// GIS doesn't need swap-in-flight tracking the way the old redirect path
// did — there's no transient Google-managed Firebase user mid-flow. The
// flag is kept exported only because goaloracle.jsx historically gated on
// it; it always returns false now.
export function isAuthSwapInFlight() { return false; }

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = { error: 'Bad response' }; }
  if (!res.ok) {
    // Prefer the user-facing `message` over the machine-readable `error` code.
    const err = new Error(data?.message || data?.error || `Request failed (${res.status})`);
    err.payload = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

async function safeFingerprint() {
  try { return await getVisitorId(); } catch { return null; }
}

// Fire-and-forget client-side breadcrumb to /api/client-log so we can see
// what's happening in Vercel logs for mobile users who have no DevTools.
// Never throws — auth flow continues regardless of the log endpoint's state.
function clientLog(tag, data) {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([JSON.stringify({ tag, data })], { type: 'application/json' });
      navigator.sendBeacon('/api/client-log', blob);
      return;
    }
  } catch {}
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, data }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

// signInWithCustomToken occasionally fails with auth/network-request-failed
// on flaky mobile networks and on Safari configs where the first attempt
// races storage init. We hold the freshly-minted custom token (a failed
// sign-in does NOT consume it, unlike the one-time email code), so retrying
// is safe and never re-hits /api/auth/*. Retries ONLY on the network error
// code; any other failure throws immediately. Logs each failure so we can
// see real device/browser data for mobile users without DevTools.
async function signInWithCustomTokenRetry(token, step) {
  const MAX_ATTEMPTS = 3;
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await signInWithCustomToken(auth, token);
    } catch (err) {
      lastErr = err;
      const retriable = err?.code === 'auth/network-request-failed';
      clientLog('auth.customtoken.error', {
        step,
        attempt,
        code: err?.code || null,
        message: err?.message || null,
        ua: typeof navigator !== 'undefined' ? navigator.userAgent : null,
        retriable,
      });
      if (!retriable || attempt === MAX_ATTEMPTS) throw err;
      await new Promise((r) => setTimeout(r, attempt * 600));
    }
  }
  throw lastErr;
}

export async function requestEmailCode(email) {
  return postJSON('/api/auth/request-code', { email });
}

export async function verifyEmailCode(email, code) {
  const deviceFingerprint = await safeFingerprint();
  const { firebaseToken } = await postJSON('/api/auth/verify-code', { email, code, deviceFingerprint });
  // Stash before the swap so onAuthStateChanged can backfill the user doc.
  setPendingEmail(email);
  await signInWithCustomTokenRetry(firebaseToken, 'email');
  return auth.currentUser;
}

// Exchange a Google ID token (obtained from GIS) for a Firebase session.
// The /api/auth/google endpoint already accepts Google ID tokens — this
// is the same server-side path the old popup/redirect flow used, just
// invoked with a credential we got from GIS instead of from Firebase's
// own OAuth dance.
//
// Called by LoginScreen.jsx after the GIS button callback fires.
export async function exchangeGoogleCredential(googleIdToken) {
  if (!googleIdToken) throw new Error('No Google credential provided');
  console.log('[auth] exchangeGoogleCredential: posting to /api/auth/google');
  clientLog('auth.gis.exchange-start', {});
  const deviceFingerprint = await safeFingerprint();
  const { firebaseToken, email: serverEmail } = await postJSON('/api/auth/google', {
    idToken: googleIdToken,
    deviceFingerprint,
  });
  console.log('[auth] exchangeGoogleCredential: server returned firebaseToken; signing in');
  setPendingEmail(serverEmail);
  await signInWithCustomTokenRetry(firebaseToken, 'google');
  clientLog('auth.gis.exchange-complete', { uid: auth.currentUser?.uid || null });
  console.log('[auth] exchangeGoogleCredential: done. uid=', auth.currentUser?.uid);
  return auth.currentUser;
}

// Compatibility shim — the old useEffect in goaloracle.jsx that ran
// completeGoogleRedirectIfNeeded on every mount is being removed in
// the same PR. This stub keeps the import resolving for any leftover
// references during deploy and is safe to delete later.
export async function completeGoogleRedirectIfNeeded() {
  return null;
}

export async function signOut() {
  await fbSignOut(auth);
}
