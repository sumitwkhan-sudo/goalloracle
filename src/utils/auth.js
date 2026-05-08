import { auth } from '../config/firebase';
import {
  signInWithCustomToken,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  GoogleAuthProvider,
  signOut as fbSignOut,
} from 'firebase/auth';

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
// "we're mid-Google-sign-in, swap UIDs when you come back" across the boundary.
const REDIRECT_FLAG = 'goaloracle_google_redirect_pending';

// Set true while a Google sign-in is mid-swap from the popup-created
// Firebase Auth user to the API-issued custom token. The auth listener in
// goaloracle.jsx checks this and skips processing transient states so it
// doesn't write a spurious /users/{popup-uid} doc and trigger the
// username prompt for what is actually an existing user.
let _swapInFlight = false;
export function isAuthSwapInFlight() { return _swapInFlight; }

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data;
  try { data = await res.json(); } catch { data = { error: 'Bad response' }; }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export async function requestEmailCode(email) {
  return postJSON('/api/auth/request-code', { email });
}

export async function verifyEmailCode(email, code) {
  const { firebaseToken } = await postJSON('/api/auth/verify-code', { email, code });
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
  const { firebaseToken } = await postJSON('/api/auth/google', { idToken: googleIdToken });
  await fbSignOut(auth);
  _swapInFlight = false;
  await signInWithCustomToken(auth, firebaseToken);
  return auth.currentUser;
}

export async function signInWithGoogle() {
  const provider = new GoogleAuthProvider();
  _swapInFlight = true;

  if (shouldUseRedirect()) {
    // Redirect flow — does not resume in this function. The app reloads
    // back to the origin URL and completeGoogleRedirectIfNeeded() picks
    // up where we left off on the next mount.
    try {
      sessionStorage.setItem(REDIRECT_FLAG, '1');
    } catch {}
    try {
      await signInWithRedirect(auth, provider);
    } catch (e) {
      _swapInFlight = false;
      try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
      throw e;
    }
    return null;
  }

  // Desktop popup flow.
  try {
    const result = await signInWithPopup(auth, provider);
    return await completeGoogleSignIn(result);
  } catch (e) {
    _swapInFlight = false;
    throw e;
  }
}

// Called on every app mount. If the user just came back from a Google
// redirect, this completes the sign-in and writes the canonical session.
// No-op on every other mount. Returns null if nothing to do, the signed-in
// user otherwise.
export async function completeGoogleRedirectIfNeeded() {
  let pending = false;
  try { pending = sessionStorage.getItem(REDIRECT_FLAG) === '1'; } catch {}
  if (!pending) return null;
  try { sessionStorage.removeItem(REDIRECT_FLAG); } catch {}
  _swapInFlight = true;
  try {
    const result = await getRedirectResult(auth);
    if (!result) { _swapInFlight = false; return null; }
    return await completeGoogleSignIn(result);
  } catch (e) {
    _swapInFlight = false;
    throw e;
  }
}

export async function signOut() {
  await fbSignOut(auth);
}
