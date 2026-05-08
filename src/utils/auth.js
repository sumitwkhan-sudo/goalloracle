import { auth } from '../config/firebase';
import {
  signInWithCustomToken,
  signInWithPopup,
  GoogleAuthProvider,
  signOut as fbSignOut,
} from 'firebase/auth';

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
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  // Pull the Google ID token out of the OAuth credential, send to our server,
  // get back a Firebase custom token bound to the user's legacy did:privy:* UID
  // (if they had one). Then we re-sign-in with that custom token so all
  // downstream Firestore reads/writes hit the right doc.
  const credential = GoogleAuthProvider.credentialFromResult(result);
  const googleIdToken = credential?.idToken;
  if (!googleIdToken) throw new Error('Google sign-in returned no ID token');
  const { firebaseToken, uid } = await postJSON('/api/auth/google', { idToken: googleIdToken });
  if (uid !== result.user.uid) {
    await signInWithCustomToken(auth, firebaseToken);
  }
  return auth.currentUser;
}

export async function signOut() {
  await fbSignOut(auth);
}
