import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// authDomain MUST be auth.goaloracle.io — our Firebase-Hosting custom
// subdomain. It shares the registrable domain (goaloracle.io) with the
// SPA, so the OAuth handler's IndexedDB is FIRST-PARTY storage from the
// SPA's perspective. This is the only configuration that works reliably
// on iOS Safari (ITP) and Android Chrome (storage partitioning) for the
// signInWithRedirect mobile flow:
//   https://firebase.google.com/docs/auth/web/redirect-best-practices
//
// The previous version of this file also accepted *.firebaseapp.com and
// *.web.app values from VITE_FIREBASE_AUTH_DOMAIN as a "fallback". That
// turned out to be a footgun: PR #91 changed the hardcoded value to
// auth.goaloracle.io but the Vercel env var was still set to
// goaloracle-f348f.firebaseapp.com, so the *.firebaseapp.com branch
// matched and the env var silently overrode the new hardcoded value.
// Mobile sign-in continued failing because Firebase kept loading from
// the cross-site host.
//
// New rule: only auth.goaloracle.io (or empty) is honoured. Anything
// else logs a warning and falls back to the hardcoded canonical. The
// console.log on success means the operator can verify the actual
// resolved value in DevTools without guessing.
const FIREBASE_AUTH_HOST = 'auth.goaloracle.io';
function resolveAuthDomain() {
  const raw = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  if (raw && raw !== FIREBASE_AUTH_HOST && typeof console !== 'undefined') {
    console.warn(
      '[firebase] VITE_FIREBASE_AUTH_DOMAIN is "' + raw + '" — overriding to "' +
      FIREBASE_AUTH_HOST + '" because only the custom subdomain works on mobile.',
    );
  }
  if (typeof console !== 'undefined') {
    console.log('[firebase] authDomain resolved to:', FIREBASE_AUTH_HOST);
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
