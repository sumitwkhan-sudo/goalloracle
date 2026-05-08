import { auth } from '../config/firebase';
import {
  signInWithCustomToken,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
} from 'firebase/auth';

// Set true while a Google sign-in is mid-swap from the popup-created
// Firebase Auth UID to the legacy did:privy:* UID. The auth listener in
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

export async function signInWithGoogle() {
  // signInWithPopup unavoidably creates a Firebase Auth user with a fresh
  // Firebase-managed UID. We need to throw that UID away and sign in as the
  // legacy did:privy:* user instead. Suppress the listener for the popup +
  // sign-out states; let it run for the final custom-token sign-in.
  _swapInFlight = true;
  let firebaseToken;
  try {
    const provider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const googleIdToken = credential?.idToken;
    if (!googleIdToken) throw new Error('Google sign-in returned no ID token');
    const data = await postJSON('/api/auth/google', { idToken: googleIdToken });
    firebaseToken = data.firebaseToken;
    // Drop the popup-created Firebase Auth user. The listener for this state
    // is also suppressed by the flag.
    await fbSignOut(auth);
  } catch (e) {
    _swapInFlight = false;
    throw e;
  }
  // Clear the flag before the final sign-in so the listener processes the
  // legacy UID auth state normally.
  _swapInFlight = false;
  await signInWithCustomToken(auth, firebaseToken);
  return auth.currentUser;
}

export async function signOut() {
  await fbSignOut(auth);
}
