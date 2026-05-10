import { initializeApp } from 'firebase/app';
import { initializeFirestore, memoryLocalCache } from 'firebase/firestore';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';

// authDomain stays on the Firebase-managed *.firebaseapp.com host.
//
// We tried overriding to window.location.hostname so the OAuth round
// trip would stay first-party and avoid Safari ITP partitioning, but
// the vercel.json /__/auth/:path* rewrite to firebaseapp.com doesn't
// fully proxy the Firebase auth handler — relative iframe / script
// requests from the proxied page break and the popup renders blank.
// Reverted back to the project-managed host so the popup at least
// works for the 95% of users not hit by ITP. iOS Safari users who
// hit "missing initial state" should fall back to email-OTP, which
// the LoginScreen surfaces alongside Google.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
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
