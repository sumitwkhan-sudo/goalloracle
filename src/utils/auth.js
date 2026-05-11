import { auth } from '../config/firebase';
import { signInWithCustomToken, signOut as fbSignOut } from 'firebase/auth';
import { getVisitorId } from './fingerprint';

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

export async function requestEmailCode(email) {
  return postJSON('/api/auth/request-code', { email });
}

export async function verifyEmailCode(email, code) {
  const deviceFingerprint = await safeFingerprint();
  const { firebaseToken } = await postJSON('/api/auth/verify-code', { email, code, deviceFingerprint });
  // Stash before the swap so onAuthStateChanged can backfill the user doc.
  setPendingEmail(email);
  await signInWithCustomToken(auth, firebaseToken);
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
  await signInWithCustomToken(auth, firebaseToken);
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
