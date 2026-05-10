import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// authDomain must be served from the same origin as the app. When it
// points at the Firebase-managed `*.firebaseapp.com` host, Safari ITP
// (and increasingly Chrome on iOS) treats the OAuth round-trip as
// third-party and partitions sessionStorage — the handler fails with
// "Unable to process request due to missing initial state. ...
// signInWithRedirect in a storage-partitioned browser environment."
//
// vercel.json rewrites /__/auth/:path* and /__/firebase/:path* to
// goaloracle-f348f.firebaseapp.com so we can serve the same handler
// from goaloracle.io (and any preview / localhost), keeping the OAuth
// hop on the same origin. The browser's storage stays first-party
// through the redirect.
//
// Firebase still needs each origin we serve from added to Firebase
// Console → Authentication → Settings → Authorized domains.
//
// At build time VITE_FIREBASE_AUTH_DOMAIN may legitimately be the
// firebaseapp.com host (legacy env var). At runtime we override to
// the current hostname so the SDK redirects to the same origin. SSR /
// build-time lookup falls back to the env var.
function resolveAuthDomain() {
  if (typeof window !== 'undefined' && window.location?.hostname) {
    return window.location.hostname;
  }
  return import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
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
