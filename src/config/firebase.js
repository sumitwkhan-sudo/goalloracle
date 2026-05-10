import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// authDomain MUST be the Firebase-managed *.firebaseapp.com host so
// signInWithPopup / signInWithRedirect navigates to Firebase's hosted
// /__/auth/handler page natively. If we point it at our own origin,
// Firebase's auth handler isn't actually served there — Vercel's
// catch-all rewrite serves index.html instead, so the popup renders
// the landing page instead of the OAuth handler. (We tried proxying
// /__/auth/* to firebaseapp.com via vercel.json — the relative
// iframe/script fetches inside Firebase's auth page break under that
// proxy, so it's not a viable workaround.)
//
// We hardcode the canonical value here as a defensive fallback because
// the Vercel env var has historically been set to other values
// (goaloracle.io during a custom-handler experiment) which silently
// breaks Google sign-in for every user. Hardcoding the project's
// stable auth host means a misconfigured env var can't blank the
// popup. The other config fields can stay on env vars — those don't
// have the same project-bound invariant.
const FIREBASE_AUTH_HOST = 'goaloracle-f348f.firebaseapp.com';
function resolveAuthDomain() {
  const raw = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  // Accept the env var only if it ends with firebaseapp.com or web.app
  // (the two Firebase-managed hosts that actually serve the OAuth
  // handler). Anything else (custom domain, empty string, garbage)
  // falls back to the hardcoded project host.
  if (/\.firebaseapp\.com$|\.web\.app$/.test(raw)) return raw;
  if (raw && raw !== FIREBASE_AUTH_HOST && typeof console !== 'undefined') {
    console.warn(
      '[firebase] VITE_FIREBASE_AUTH_DOMAIN is "' + raw + '" — overriding to "' +
      FIREBASE_AUTH_HOST + '" because Google sign-in only works on the firebase-managed host.',
    );
  }
  return FIREBASE_AUTH_HOST;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: resolveAuthDomain(),
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
// Use memory cache instead of IndexedDB — avoids Safari ITP blocking
export const db = initializeFirestore(app, { localCache: memoryLocalCache() });
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
