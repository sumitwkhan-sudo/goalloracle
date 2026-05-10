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

// Detect environments where signInWithPopup is unreliable. Mobile browsers
// (especially in-app webviews like Instagram / FB / Twitter) routinely
// block popups, close the parent tab, or lose session state across the
// popup boundary. Firebase's documented fallback is signInWithRedirect.
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

async function safeFingerprint() {
  try { return await getVisitorId(); } catch { return null; }
}

export async function requestEmailCode(email) {
  return postJSON('/api/auth/request-code', { email });
}

export async function verifyEmailCode(email, code) {
  const deviceFingerprint = await safeFingerprint();
  const { firebaseToken } = await postJSON('/api/auth/verify-code', { email, code, deviceFingerprint });
  await signInWithCustomToken(auth, firebaseToken);
  return auth.currentUser;
}

// Common path for both popup and redirect flows: take the Google ID token
// from a Firebase auth result, swap it for an API-issued custom token, drop
// the popup/redirect-managed Firebase user, and sign in with the custom
// token so the rest of the app sees the canonical legacy UID.
async function completeGoogleSignIn(result) {
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const googleIdToken = credential?.idToken;
  if (!googleIdToken) throw new Error('Google sign-in returned no ID token');
  const deviceFingerprint = await safeFingerprint();
  const { firebaseToken } = await postJSON('/api/auth/google', { idToken: googleIdToken, deviceFingerprint });
  await fbSignOut(auth);
  _swapInFlight = false;
  await signInWithCustomToken(auth, firebaseToken);
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

  if (shouldUseRedirect()) {
    // Redirect flow — does not resume in this function. The app reloads
    // back to the origin URL and completeGoogleRedirectIfNeeded() picks
    // up where we left off on the next mount.
    return startRedirectFlow(provider);
  }

  // Desktop popup flow with redirect fallback. Chrome's COOP and some
  // ad blockers will close the popup mid-auth; the redirect flow works
  // there because it doesn't depend on cross-window communication.
  _swapInFlight = true;
  try {
    const result = await signInWithPopup(auth, provider);
    return await completeGoogleSignIn(result);
  } catch (e) {
    _swapInFlight = false;
    if (POPUP_KILL_CODES.has(e?.code)) {
      console.warn('[auth] popup failed (', e.code, ') — falling back to redirect');
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
export async function completeGoogleRedirectIfNeeded() {
  let result;
  try {
    result = await getRedirectResult(auth);
  } catch (e) {
    console.error('[auth] getRedirectResult threw:', e?.code, e?.message);
    _swapInFlight = false;
    try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
    throw e;
  }
  // Always drain the flag at this point — either we found a result and we
  // commit the swap, or there was no result and the flag is stale.
  try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
  if (!result) {
    _swapInFlight = false;
    return null;
  }
  console.log('[auth] redirect result received, completing sign-in for', result.user?.email);
  _swapInFlight = true;
  try {
    return await completeGoogleSignIn(result);
  } catch (e) {
    console.error('[auth] redirect swap failed:', e?.message || e);
    _swapInFlight = false;
    throw e;
  }
}

export async function signOut() {
  await fbSignOut(auth);
}
