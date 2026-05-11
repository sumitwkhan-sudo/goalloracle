// Google Identity Services (GIS) wrapper. Replaces Firebase's
// signInWithPopup / signInWithRedirect for Google sign-in.
//
// Why not Firebase's built-in Google flow:
//
// signInWithPopup and signInWithRedirect both rely on cross-domain
// storage between goaloracle.io and the OAuth handler domain. iOS
// Safari ITP and Chrome storage partitioning silently break this on
// mobile in 2025+. The "auth.goaloracle.io subdomain workaround"
// (PR #91 / #93) turned out NOT to work on iOS Safari either —
// confirmed via /api/client-log breadcrumbs (auth.redirect.silent-null
// fired on every retry).
//
// GIS takes a different approach. It uses the browser's FedCM
// (Federated Credential Management) API where available, falling back
// to a popup or sheet otherwise. The credential is delivered directly
// via callback — no cross-domain storage handoff, no IndexedDB
// shenanigans. Works on iOS Safari, Android Chrome, desktop, in-app
// browsers.
//
// Output: a Google ID token (JWT signed by Google). We send that to
// /api/auth/google which already verifies Google ID tokens and returns
// a Firebase custom token. The rest of the auth flow (custom token
// sign-in, processFirebaseUser, etc) is unchanged.

const GIS_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let _scriptPromise = null;
function loadGisScript() {
  if (typeof window === 'undefined') return Promise.reject(new Error('window unavailable'));
  if (window.google?.accounts?.id) return Promise.resolve();
  if (_scriptPromise) return _scriptPromise;

  _scriptPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`);
    if (existing) {
      // Already loading or loaded by another component
      if (window.google?.accounts?.id) return resolve();
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Google Identity Services script failed to load')));
      return;
    }
    const s = document.createElement('script');
    s.src = GIS_SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => {
      if (window.google?.accounts?.id) resolve();
      else reject(new Error('Google Identity Services script loaded but window.google.accounts.id is undefined'));
    };
    s.onerror = () => reject(new Error('Google Identity Services script failed to load (network/blocked?)'));
    document.head.appendChild(s);
  });
  return _scriptPromise;
}

let _gisInitialized = false;
let _onCredentialCallback = null;

function ensureInitialized(clientId) {
  if (_gisInitialized) return;
  window.google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => {
      // Single shared callback — dispatches to whichever caller is
      // currently awaiting a credential. Set by signInWithGoogleGIS
      // and renderGoogleButton.
      if (typeof _onCredentialCallback === 'function') {
        const cb = _onCredentialCallback;
        _onCredentialCallback = null;
        cb(response);
      }
    },
    auto_select: false,
    use_fedcm_for_prompt: true,
    ux_mode: 'popup',
  });
  _gisInitialized = true;
}

function getClientId() {
  const id = (import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID || '').trim();
  if (!id) {
    throw new Error('VITE_GOOGLE_OAUTH_CLIENT_ID env var is not set. Add it on Vercel and redeploy.');
  }
  return id;
}

// Render Google's official Sign-In button into an existing DOM element.
// Returns a promise that resolves with the Google ID token when the
// user completes sign-in, or rejects if the script fails to load.
//
// `element` — DOM node (e.g. div) the button will be rendered into.
//             Google replaces its contents with their iframe.
// `options` — passed through to renderButton (theme, size, text, etc).
//             Defaults to a wide outline button matching most UIs.
//
// The returned promise resolves on successful sign-in. The button
// stays interactive — repeated clicks generate new credentials, but
// only the most recently-awaited promise receives one. For our
// LoginScreen use case there's only ever one in-flight click at a
// time, so this is fine.
export async function renderGoogleButton(element, options = {}) {
  await loadGisScript();
  const clientId = getClientId();
  ensureInitialized(clientId);

  return new Promise((resolve, reject) => {
    _onCredentialCallback = (response) => {
      if (response?.credential) {
        resolve(response.credential);
      } else {
        reject(new Error('Google sign-in returned no credential'));
      }
    };
    try {
      window.google.accounts.id.renderButton(element, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
        width: element?.clientWidth ? Math.min(element.clientWidth, 400) : 320,
        ...options,
      });
    } catch (e) {
      _onCredentialCallback = null;
      reject(e);
    }
  });
}

// Programmatic prompt as a fallback for environments where rendering
// Google's button isn't desired. Currently unused by LoginScreen but
// kept here for future flexibility.
export async function promptGoogleSignIn() {
  await loadGisScript();
  const clientId = getClientId();
  ensureInitialized(clientId);

  return new Promise((resolve, reject) => {
    _onCredentialCallback = (response) => {
      if (response?.credential) {
        resolve(response.credential);
      } else {
        reject(new Error('Google sign-in returned no credential'));
      }
    };
    try {
      window.google.accounts.id.prompt((notification) => {
        if (notification.isNotDisplayed?.() || notification.isSkippedMoment?.()) {
          _onCredentialCallback = null;
          reject(new Error('Google sign-in was dismissed or could not be displayed'));
        }
      });
    } catch (e) {
      _onCredentialCallback = null;
      reject(e);
    }
  });
}
