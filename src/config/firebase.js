import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// authDomain selects where Firebase's OAuth handler is served. There are
// THREE valid shapes we accept:
//
//   1. auth.goaloracle.io          — our custom subdomain on Firebase
//                                    Hosting. Same registrable domain as
//                                    the SPA (goaloracle.io), so storage
//                                    at the auth handler is FIRST-PARTY
//                                    from the SPA's perspective. This is
//                                    the official Firebase workaround for
//                                    Safari ITP + Chrome storage
//                                    partitioning that breaks mobile
//                                    signInWithRedirect.
//                                    https://firebase.google.com/docs/auth/web/redirect-best-practices
//
//   2. *.firebaseapp.com           — the default Firebase-managed host.
//                                    Works on desktop. Breaks silently on
//                                    mobile in 2025+ browsers because the
//                                    cross-domain credential handoff
//                                    requires third-party storage access
//                                    that ITP / partitioning blocks.
//
//   3. *.web.app                   — Firebase Hosting alternate domain.
//                                    Same characteristics as #2.
//
// Anything else (e.g. raw `goaloracle.io` — which we tried and reverted
// in PR #79, because Vercel's catch-all rewrite serves index.html at
// /__/auth/handler instead of Firebase's actual handler) gets ignored
// and the hardcoded canonical value below is used.
//
// We hardcode auth.goaloracle.io as the canonical value because the
// Vercel env var has historically been set to wrong values (raw
// goaloracle.io, the firebaseapp.com fallback, empty) that silently
// break Google sign-in. The hardcoded value means a misconfigured env
// var can't blank the popup or strand mobile users.
const FIREBASE_AUTH_HOST = 'auth.goaloracle.io';
function resolveAuthDomain() {
  const raw = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  // Accept the env var only if it matches one of the three valid shapes
  // documented above.
  if (raw === FIREBASE_AUTH_HOST) return raw;
  if (/\.firebaseapp\.com$|\.web\.app$/.test(raw)) return raw;
  if (raw && raw !== FIREBASE_AUTH_HOST && typeof console !== 'undefined') {
    console.warn(
      '[firebase] VITE_FIREBASE_AUTH_DOMAIN is "' + raw + '" — overriding to "' +
      FIREBASE_AUTH_HOST + '" because Google sign-in only works on a Firebase-served auth host.',
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
