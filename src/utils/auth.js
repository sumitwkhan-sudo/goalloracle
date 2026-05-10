import { auth } from '../config/firebase';
import {
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as fbSignOut,
} from 'firebase/auth';
import { getVisitorId } from './fingerprint';

// Detect environments where signInWithPopup is unreliable. Mobile
// browsers (especially in-app webviews like Instagram / FB / Twitter)
// routinely block popups, close the parent tab, or lose session state
// across the popup boundary. Firebase's documented fallback is
// signInWithRedirect.
//
// We BRIEFLY tried always-redirect (PR #80) thinking it would fix the
// Chrome popup-stays-open quirk. Result: redirect-back to goaloracle.io
// rendered a blank page in some Chrome sessions, leaving users stuck
// with no sign-in path at all. Redirect-on-mobile / popup-on-desktop
// is the last known-working setup, so we go back to that. Chrome's
// popup-stays-open is annoying (the user has to manually close the
// orphan window) but is COSMETIC — auth succeeds, parent app gets
// the user.
function shouldUseRedirect() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // Touch + small viewport is the strongest signal. UA sniffing is the
  // backup when the device reports as desktop (e.g. iPad in desktop mode).
  const isMobileViewport = window.innerWidth <= 820;
  const isMobileUA = /Android|iPhone|iPad|iPod|webOS|Mobile|Mini|Opera Mini|IEMobile/i.test(ua);
  // Common in-app browsers — popup behavior is unreliable here even on
  // tablet form factors.
  const isInAppBrowser = /FBAN|FBAV|Instagram|Twitter|TikTok|WhatsApp|Line\//i.test(ua);
  return isMobileViewport || isMobileUA || isInAppBrowser;
}

// Sentinel used across the redirect round-trip. signInWithRedirect navigates
// away and reloads the page; in-memory state is lost. sessionStorage carries
// "we're mid-Google-sign-in, don't process transient Firebase Auth states"
// across the boundary so the onAuthStateChanged listener doesn't write a
// /users/{popup-uid} doc before we swap to the canonical UID.
//
// This flag is best-effort. iOS Safari's ITP can clear sessionStorage when
// the Firebase auth handler hops through goaloracle-XXX.firebaseapp.com.
// completeGoogleRedirectIfNeeded() therefore calls getRedirectResult()
// unconditionally — Firebase persists the credential in IndexedDB across
// the redirect, regardless of whether our flag survives.
const REDIRECT_FLAG = 'goaloracle_google_redirect_pending';

// The custom-token sign-in path (used by both Google and email-OTP flows)
// strips email from the Firebase user — `auth.currentUser.email` is null
// after signInWithCustomToken because the token only embeds the UID. We
// stash the address here right before the swap so onAuthStateChanged ->
// createOrUpdateUser can recover it without going back through Firebase.
//
// Also persisted to sessionStorage so the redirect round-trip (which
// reloads the page) doesn't lose it. Cleared after consumePendingEmail().
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

// Set true while a Google sign-in is mid-swap from the Firebase-managed UID
// (popup or redirect) to the API-issued custom token. The auth listener in
// goaloracle.jsx checks this and skips processing transient states so it
// doesn't write a spurious /users/{popup-uid} doc and trigger the
// username prompt for what is actually an existing user.
let _swapInFlight = false;
export function isAuthSwapInFlight() { return _swapInFlight; }

// Synchronous check at module load — sets the flag BEFORE goaloracle.jsx's
// onAuthStateChanged subscribes. Without this, the listener fires for the
// transient Google-managed UID before our async redirect handler runs.
try {
  if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(REDIRECT_FLAG) === '1') {
    _swapInFlight = true;
  }
} catch {}

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

// Fire-and-forget client-side breadcrumb to /api/client-log so we can see
// what's happening in Vercel logs for mobile users who have no DevTools.
// Never throws — auth flow continues regardless of the log endpoint's state.
function clientLog(tag, data) {
  try {
    // navigator.sendBeacon survives the page unload that signInWithRedirect
    // triggers right after we log. fetch() with keepalive would also work
    // but sendBeacon is more reliable on Safari.
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const blob = new Blob([JSON.stringify({ tag, data })], { type: 'application/json' });
      navigator.sendBeacon('/api/client-log', blob);
      return;
    }
  } catch {}
  // Fallback for environments without sendBeacon.
  try {
    fetch('/api/client-log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag, data }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

async function safeFingerprint() {
  try { return await getVisitorId(); } catch { return null; }
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

// Common path for both popup and redirect flows: take the Google ID token
// from a Firebase auth result, swap it for an API-issued custom token, drop
// the popup/redirect-managed Firebase user, and sign in with the custom
// token so the rest of the app sees the canonical legacy UID.
async function completeGoogleSignIn(result) {
  // Defensive: a stale REDIRECT_FLAG in sessionStorage (left by a previous
  // abandoned redirect attempt) would have set _swapInFlight=true at module
  // load and made the auth listener skip its first event. By the time we
  // get to this function the popup or redirect has resolved, so the flag
  // is no longer meaningful — drop it so subsequent listener fires aren't
  // silently swallowed.
  try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
  console.log('[auth] completeGoogleSignIn: extracting credential');
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const googleIdToken = credential?.idToken;
  if (!googleIdToken) {
    console.error('[auth] completeGoogleSignIn: no ID token in result. credential=', credential, 'result.user=', result?.user);
    throw new Error('Google sign-in returned no ID token');
  }
  // The popup-managed Firebase user still has the email at this point —
  // stash it before signing out so the post-swap createOrUpdateUser can
  // pick it up. The /api/auth/google response also returns it as a
  // belt-and-suspenders fallback.
  const popupEmail = result?.user?.email || null;
  console.log('[auth] completeGoogleSignIn: got idToken for', popupEmail);
  const deviceFingerprint = await safeFingerprint();
  console.log('[auth] completeGoogleSignIn: posting to /api/auth/google');
  const { firebaseToken, email: serverEmail } = await postJSON('/api/auth/google', { idToken: googleIdToken, deviceFingerprint });
  console.log('[auth] completeGoogleSignIn: server returned firebaseToken; swapping');
  setPendingEmail(popupEmail || serverEmail);
  await fbSignOut(auth);
  _swapInFlight = false;
  await signInWithCustomToken(auth, firebaseToken);
  console.log('[auth] completeGoogleSignIn: done. uid=', auth.currentUser?.uid);
  return auth.currentUser;
}

// Errors where the popup got killed by the browser (Chrome's COOP, ad
// blockers, sandbox flags, mid-auth tab close). For these specific
// failure modes we transparently retry with signInWithRedirect — the
// user goes through Google in the same tab instead of a popup.
const POPUP_KILL_CODES = new Set([
  'auth/popup-blocked',
  'auth/popup-closed-by-user',
  'auth/cancelled-popup-request',
  'auth/web-storage-unsupported',
]);

async function startRedirectFlow(provider) {
  _swapInFlight = true;
  try { sessionStorage.setItem(REDIRECT_FLAG, '1'); } catch {}
  // Capture that we're about to navigate away. sendBeacon should survive
  // the page unload that signInWithRedirect triggers next.
  clientLog('auth.redirect.start', { innerWidth: typeof window !== 'undefined' ? window.innerWidth : null });
  try {
    await signInWithRedirect(auth, provider);
  } catch (e) {
    _swapInFlight = false;
    try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
    throw e;
  }
  return null;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  const useRedirect = shouldUseRedirect();
  console.log('[auth] signInWithGoogle: useRedirect=', useRedirect, 'innerWidth=', typeof window !== 'undefined' ? window.innerWidth : '?');

  if (useRedirect) {
    // Redirect flow — does not resume in this function. The app reloads
    // back to the origin URL and completeGoogleRedirectIfNeeded() picks
    // up where we left off on the next mount.
    console.log('[auth] signInWithGoogle: starting redirect flow');
    return startRedirectFlow(provider);
  }

  // Desktop popup flow with redirect fallback. Chrome's COOP and some
  // ad blockers will close the popup mid-auth; the redirect flow works
  // there because it doesn't depend on cross-window communication.
  // We also race signInWithPopup against a watchdog timer — if the
  // popup hasn't resolved after POPUP_HANG_MS (Firebase's auth handler
  // can sometimes complete the OAuth handshake but fail to postMessage
  // back to the opener under aggressive COOP, leaving the popup
  // visibly open with the parent tab spinning), we fall back to the
  // redirect path so the user actually gets in.
  const POPUP_HANG_MS = 25_000;
  console.log('[auth] signInWithGoogle: opening popup with watchdog', POPUP_HANG_MS, 'ms');
  _swapInFlight = true;
  let watchdog = null;
  const watchdogP = new Promise((_, reject) => {
    watchdog = setTimeout(
      () => reject(Object.assign(new Error('Popup timed out'), { code: 'auth/popup-timeout' })),
      POPUP_HANG_MS,
    );
  });
  try {
    const result = await Promise.race([signInWithPopup(auth, provider), watchdogP]);
    if (watchdog) clearTimeout(watchdog);
    console.log('[auth] signInWithGoogle: popup resolved, calling completeGoogleSignIn');
    return await completeGoogleSignIn(result);
  } catch (e) {
    console.warn('[auth] signInWithGoogle: caught error', e?.code, e?.message);
    if (watchdog) clearTimeout(watchdog);
    _swapInFlight = false;
    if (POPUP_KILL_CODES.has(e?.code) || e?.code === 'auth/popup-timeout') {
      console.warn('[auth] popup failed (', e.code || e.message, ') — falling back to redirect');
      return startRedirectFlow(provider);
    }
    throw e;
  }
}

// Called on every app mount. Always calls getRedirectResult(): Firebase
// persists the redirect credential in IndexedDB across the OAuth round-trip
// regardless of whether our sessionStorage flag survived ITP / cross-domain
// hops. Gating on the flag would silently miss the credential whenever the
// flag was cleared. Cheap when no redirect is pending (returns null).
//
// Errors are SWALLOWED here, never re-thrown. Two reasons:
//   1. Most failure modes are transient (Safari ITP wipes
//      sessionStorage, "missing initial state") — the user should be
//      able to retry with email-OTP without the whole app crashing.
//   2. The caller wraps this in a top-level useEffect with no error
//      boundary; any uncaught throw freezes the React tree.
// Returns { error, code } shape so the caller can surface a toast
// without bringing the app down. Successful redirects still resolve
// to the auth.currentUser as before.
//
// Returns one of:
//   - auth.currentUser  (User object) — redirect completed, swap done
//   - { error, code }                  — redirect failed visibly
//   - { silentNull: true, wasRedirecting: bool } — getRedirectResult
//     returned null. `wasRedirecting` is true iff REDIRECT_FLAG was set
//     before we drained it, which means the user DID initiate a redirect
//     but Firebase couldn't recover the credential (typical on mobile
//     bfcache restore + Safari ITP + storage partitioning).
export async function completeGoogleRedirectIfNeeded() {
  // Snapshot REDIRECT_FLAG BEFORE we drain it so the caller can tell
  // "user intended to redirect, nothing came back" apart from "fresh
  // page load, no redirect was ever in flight".
  let hadRedirectFlag = false;
  try { hadRedirectFlag = sessionStorage.getItem(REDIRECT_FLAG) === '1'; } catch {}
  console.log('[auth] completeGoogleRedirectIfNeeded: REDIRECT_FLAG was', hadRedirectFlag ? 'SET' : 'unset');
  clientLog('auth.redirect.flag-snapshot', { hadRedirectFlag, hasCurrentUser: !!auth.currentUser });

  let result;
  try {
    result = await getRedirectResult(auth);
    console.log('[auth] getRedirectResult returned', result ? `user=${result.user?.uid}` : 'null');
    clientLog('auth.redirect.result', {
      hadRedirectFlag,
      hasResult: !!result,
      resultUid: result?.user?.uid || null,
      resultEmail: result?.user?.email || null,
      providerId: result?.providerId || null,
      operationType: result?.operationType || null,
    });
  } catch (e) {
    console.error('[auth] getRedirectResult threw:', e?.code, e?.message);
    clientLog('auth.redirect.result.error', { hadRedirectFlag, code: e?.code || null, message: e?.message || String(e) });
    _swapInFlight = false;
    try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
    return { error: e?.message || 'Google sign-in failed', code: e?.code || null, wasRedirecting: hadRedirectFlag };
  }
  // Always drain the flag at this point — either we found a result and we
  // commit the swap, or there was no result and the flag is stale.
  try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
  if (!result) {
    _swapInFlight = false;
    // Silent null: getRedirectResult returned nothing. If REDIRECT_FLAG
    // was set, the user DID initiate a redirect on this device and
    // Firebase couldn't recover the credential — surface a recovery UI.
    if (hadRedirectFlag) {
      console.warn('[auth] silent redirect failure: flag was set, getRedirectResult returned null');
      clientLog('auth.redirect.silent-null', {
        hadRedirectFlag,
        hasCurrentUser: !!auth.currentUser,
        currentUserUid: auth.currentUser?.uid || null,
        url: typeof window !== 'undefined' ? window.location.href : null,
      });
      return { silentNull: true, wasRedirecting: true };
    }
    return null;
  }
  console.log('[auth] redirect result received, completing sign-in for', result.user?.email);
  _swapInFlight = true;
  try {
    const completed = await completeGoogleSignIn(result);
    clientLog('auth.redirect.swap-complete', { uid: auth.currentUser?.uid || null });
    return completed;
  } catch (e) {
    console.error('[auth] redirect swap failed:', e?.message || e);
    clientLog('auth.redirect.swap-failed', { code: e?.code || null, message: e?.message || String(e) });
    _swapInFlight = false;
    return { error: e?.message || 'Google sign-in failed', code: e?.code || null, wasRedirecting: hadRedirectFlag };
  }
}

export async function signOut() {
  await fbSignOut(auth);
}
