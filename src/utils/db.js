import { db, auth } from '../config/firebase';
import { collection, doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, query, where, writeBatch, arrayUnion, arrayRemove, increment, serverTimestamp, getDocs, getCountFromServer, documentId } from 'firebase/firestore';
import WORLD_CUP_MATCHES from '../data/matches';
import { getVisitorId } from './fingerprint';

// ---- Auth token management ----
// Cached Firebase ID token. Refreshed by goaloracle.jsx on auth state changes.
let _authToken = null;
export function setAuthToken(token) { _authToken = token; }

export function resetFirebaseAuth() {
  _authToken = null;
}

// ---- API helper (kept for admin + leaderboard endpoints only) ----
async function apiCall(endpoint, method = 'GET', body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
    signal: controller.signal,
  };
  if (_authToken) opts.headers['Authorization'] = `Bearer ${_authToken}`;
  if (body) opts.body = JSON.stringify(body);

  try {
    let res = await fetch(`/api/${endpoint}`, opts);

    // Auto-refresh on 401. The cached _authToken can go stale if the
    // 30-minute refresh interval in goaloracle.jsx missed a tick (browser
    // tabs throttle setInterval to ~60s minimum when inactive, so a long-
    // idle tab can end up sending an expired ID token). One forced
    // refresh + retry catches this without surfacing the failure.
    // Limited to a single retry to prevent loops when the user is
    // actually signed out.
    if (res.status === 401 && auth.currentUser) {
      try {
        const fresh = await auth.currentUser.getIdToken(true);
        _authToken = fresh;
        opts.headers['Authorization'] = `Bearer ${fresh}`;
        res = await fetch(`/api/${endpoint}`, opts);
      } catch (refreshErr) {
        console.warn('[apiCall] token refresh failed:', refreshErr?.message || refreshErr);
        // fall through with the original 401 — the catch below surfaces it
      }
    }

    clearTimeout(timeout);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`API ${endpoint} returned ${res.status}: non-JSON response`);
    }
    if (!res.ok) throw new Error(data.error || `API request failed (${res.status})`);
    return data;
  } catch(e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error(`API ${endpoint} timed out after 55s`);
    throw e;
  }
}

// Plain GET for PUBLIC endpoints (no Authorization header). Shared CDN caches
// won't serve requests that carry an Authorization header, so routing public,
// edge-cached endpoints (leaderboard ticker, live scores, actual bracket,
// consensus) through apiCall meant every logged-in client's calls bypassed the
// edge and hit the origin — each origin hit doing Firestore reads. These
// endpoints require no auth and return identical bodies for everyone, so
// fetching them anonymously lets one cached response serve all users.
async function publicApiGet(endpoint) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 55000);
  try {
    const res = await fetch(`/api/${endpoint}`, { signal: controller.signal });
    clearTimeout(timeout);
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`API ${endpoint} returned ${res.status}: non-JSON response`);
    }
    if (!res.ok) throw new Error(data.error || `API request failed (${res.status})`);
    return data;
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') throw new Error(`API ${endpoint} timed out after 55s`);
    throw e;
  }
}

// ---- Match lock logic (same as server) ----
const LOCK_BUFFER_MS = 5 * 60 * 1000;
const matchKickoffUTC = {};
WORLD_CUP_MATCHES.forEach(m => {
  const [hh, mm] = m.time.split(':').map(Number);
  const utcHour = hh + 4; // EDT offset
  const date = new Date(`${m.date}T00:00:00Z`);
  date.setUTCHours(utcHour, mm, 0, 0);
  matchKickoffUTC[m.id] = date.getTime();
});

function isMatchLocked(matchId) {
  const kickoff = matchKickoffUTC[matchId];
  if (!kickoff) return false;
  return Date.now() >= kickoff - LOCK_BUFFER_MS;
}

// ---- USERS (direct Firestore writes) ----
// authUser: { id, email } — id matches Firebase Auth UID (which the server
// chose at custom-token mint time so existing did:privy:* docs are reused).
export async function createOrUpdateUser(authUser) {
  if (!authUser) return null;
  const userId = authUser.id;
  if (!userId) return null;

  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  const emailAddr = (authUser.email || '').toLowerCase().trim() || null;

  // Sparse-doc detection (matches the server-side guard in api/user.js).
  // /api/auth/google merges {email, emailDedupeKey, emailUpdatedAt} into
  // /users/{uid} before this code runs. If the user has never been through
  // first-login init (no role/displayName/usernameSet/createdAt), the doc
  // is half-shaped — returning that to React causes downstream rendering
  // with no displayName / no role. Await /api/user's first-login init,
  // then re-read.
  const existingData = userSnap.exists() ? userSnap.data() : null;
  const isSparseDoc = !!existingData && (
    !existingData.role
    || !existingData.displayName
    || existingData.usernameSet === undefined
    || !existingData.createdAt
  );
  if (isSparseDoc) {
    console.log('[auth] sparse user doc detected — awaiting server first-login init');
    try {
      const deviceFingerprint = await getVisitorId().catch(() => null);
      await apiCall('user', 'POST', { deviceFingerprint });
    } catch (e) {
      console.warn('[auth] /api/user first-login init failed:', e.message);
    }
    const fresh = await getDoc(userRef);
    if (fresh.exists()) {
      const u = { id: fresh.id, ...fresh.data() };
      if (emailAddr && emailAddr !== u.email) u.email = emailAddr;
      return u;
    }
    return null;
  }

  // Kick off /api/user in the background — server-side backfills global league
  // membership (leagues/global, leagues/global-simple → members array) which
  // the client can't write through Firestore rules. Passing the device
  // fingerprint lets the server stamp it onto a freshly-created user doc so
  // multi-account checks see this account.
  getVisitorId()
    .catch(() => null)
    .then(deviceFingerprint => apiCall('user', 'POST', { deviceFingerprint }))
    .catch(e => console.warn('[auth] /api/user backfill failed:', e.message));

  if (userSnap.exists()) {
    const userData = { id: userSnap.id, ...userSnap.data() };
    console.log('[auth] loaded user from Firestore:', userData.displayName, userData.role);

    // Keep email fresh if the auth provider has one. Reflect the new value
    // on the returned object too — auth always provides an email now, so
    // any caller checking `u.email` should see the up-to-date value rather
    // than a stale or missing one from a pre-migration doc.
    if (emailAddr && emailAddr !== userData.email) {
      updateDoc(userRef, { email: emailAddr, updatedAt: serverTimestamp() })
        .catch(e => console.warn('[auth] background sync failed:', e.message));
      userData.email = emailAddr;
    }

    return userData;
  }

  // New user — create directly in Firestore
  console.log('[auth] new user, creating in Firestore...');
  try {
    const displayName = emailAddr?.split('@')[0] || 'Player';
    // Capture the referrer (if any) so admins can see which existing
    // user brought this person in. The ref code is captured client-side
    // from the URL on app load and stashed in sessionStorage; see
    // captureReferralFromUrl() below.
    let referredBy = null;
    try { referredBy = sessionStorage.getItem('goaloracle_ref') || null; } catch {}
    await setDoc(userRef, {
      id: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      role: 'user',
      leagues: ['global', 'global-simple'],
      email: emailAddr,
      walletAddress: null,
      displayName,
      // Lower-case index used by server-side uniqueness checks. Kept in
      // sync everywhere displayName is written.
      displayNameLower: displayName.toLowerCase(),
      usernameSet: false,
      // Gate for the post-signup passcode-first prompt. Existing users
      // created before this field was added simply lack it (undefined),
      // and the modal only shows on strict `=== false`, so they never
      // see the prompt — only freshly-created users do.
      onboardingComplete: false,
      ...(referredBy ? { referredBy } : {}),
    });

    // Read back the created doc
    const fresh = await getDoc(userRef);
    return { id: fresh.id, ...fresh.data() };
  } catch (e) {
    console.error('[auth] failed to create user:', e.message);
    return null;
  }
}

// Capture URL params that should survive the auth round-trip:
//   ?ref=USERID    — referral attribution
//   ?join=LEAGUE   — league auto-join after signup or on next mount
//   ?p=PASSCODE    — passcode for private league joins
// Stored in sessionStorage so the user doc / auto-join effect can read
// them once auth resolves. Idempotent — safe to call on every app mount.
export function captureReferralFromUrl() {
  try {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get('ref');
    if (ref && /^[A-Za-z0-9:_-]{3,80}$/.test(ref)) {
      sessionStorage.setItem('goaloracle_ref', ref);
    }
    const join = params.get('join');
    if (join && /^[A-Za-z0-9_-]{3,120}$/.test(join)) {
      sessionStorage.setItem('goaloracle_pending_join', join);
    }
    const passcode = params.get('p');
    if (passcode && /^[A-Za-z0-9_-]{3,40}$/.test(passcode)) {
      sessionStorage.setItem('goaloracle_pending_passcode', passcode);
    }
  } catch {}
}

export function consumePendingJoin() {
  try {
    if (typeof window === 'undefined') return null;
    const leagueId = sessionStorage.getItem('goaloracle_pending_join');
    if (!leagueId) return null;
    const passcode = sessionStorage.getItem('goaloracle_pending_passcode') || null;
    sessionStorage.removeItem('goaloracle_pending_join');
    sessionStorage.removeItem('goaloracle_pending_passcode');
    return { leagueId, passcode };
  } catch {
    return null;
  }
}

export async function updateUserProfile(userId, updates) {
  const userRef = doc(db, 'users', userId);
  // walletAddress, displayName, and usernameSet flow through /api/user so
  // the server can validate format, profanity, reserved-name overlaps, and
  // uniqueness. Direct client writes for these fields are blocked by
  // Firestore rules. Country / email / onboardingComplete still go via
  // Firestore direct write (cheap, no validation needed).
  const apiPayload = {};
  if (updates.walletAddress !== undefined) apiPayload.walletAddress = updates.walletAddress;
  if (updates.displayName && updates.displayName.trim()) apiPayload.displayName = updates.displayName.trim();
  if (updates.usernameSet === true) apiPayload.usernameSet = true;

  const safeUpdates = { updatedAt: serverTimestamp() };
  if (updates.email) safeUpdates.email = updates.email;
  if (updates.onboardingComplete === true) safeUpdates.onboardingComplete = true;
  if (typeof updates.country === 'string' && updates.country.trim()) safeUpdates.country = updates.country.trim().toUpperCase();

  // Run the validated API write (displayName/usernameSet/wallet) and the
  // direct Firestore write (country/onboarding/email) CONCURRENTLY — they
  // touch disjoint fields with no ordering dependency. This collapses the
  // old three-sequential-round-trip signup save (API → Firestore → read-back)
  // into a single wall-clock round-trip.
  const hasApi = Object.keys(apiPayload).length > 0;
  const hasFs = Object.keys(safeUpdates).length > 1;
  const [apiResp] = await Promise.all([
    hasApi ? apiCall('user', 'POST', apiPayload) : Promise.resolve(null),
    hasFs ? updateDoc(userRef, safeUpdates) : Promise.resolve(null),
  ]);

  // /api/user already returns the freshly-written user doc — reuse it instead
  // of a third read-back round-trip, merging in the fields we wrote straight
  // to Firestore (which the API doesn't echo) so the result matches what's
  // persisted. Only fall back to a read when no API write happened.
  if (apiResp?.user) {
    const merged = { ...apiResp.user };
    if (safeUpdates.email) merged.email = safeUpdates.email;
    if (safeUpdates.onboardingComplete === true) merged.onboardingComplete = true;
    if (safeUpdates.country) merged.country = safeUpdates.country;
    return merged;
  }
  const fresh = await getDoc(userRef);
  return { id: fresh.id, ...fresh.data() };
}

export async function getUserRole(userId) {
  return 'user';
}

// ---- LEAGUES (via API — uses admin SDK, bypasses client Firestore security rules) ----
export async function createLeague(leagueData, creatorId) {
  const data = await apiCall('leagues', 'POST', { action: 'create', ...leagueData });
  return data.leagueId;
}

export async function joinLeague(leagueId, userId, passcode = null) {
  await apiCall('leagues', 'POST', { action: 'join', leagueId, passcode });
}

// Look up a private league by its invite passcode. Server-side because
// new-format passcodes live in /leagues/{id}/private/auth and aren't
// readable by clients. Returns minimal public metadata, or throws when
// no league matches.
export async function lookupLeagueByPasscode(passcode) {
  const { league } = await apiCall('leagues', 'POST', { action: 'lookupByPasscode', passcode });
  return league;
}

// Fetch the invite passcode for a private league. Server verifies the
// caller is a member before returning the value (the passcode itself
// lives in a private subcollection that clients can't read directly).
// Returns the passcode string, or throws when the caller isn't a
// member / league isn't private / passcode is missing.
export async function getLeaguePasscode(leagueId) {
  const { passcode } = await apiCall('leagues', 'POST', { action: 'getPasscode', leagueId });
  return passcode || null;
}

// House Rules — edit (creator only). Pass empty string or null to clear.
export async function editLeagueHouseRules(leagueId, content) {
  return await apiCall('leagues', 'POST', { action: 'editHouseRules', leagueId, content: content == null ? '' : content });
}

// Acknowledge house rules (any member). Idempotent — server keeps the
// first-acknowledged timestamp and clears the houseRulesUpdatedSinceAck
// flag set by the creator's most recent edit.
export async function acknowledgeLeagueHouseRules(leagueId) {
  return await apiCall('leagues', 'POST', { action: 'acknowledgeHouseRules', leagueId });
}

// Report user-generated content. v1 only handles 'league_house_rules'.
export async function reportContent({ contentType, contentId, reason }) {
  return await apiCall('leagues', 'POST', { action: 'reportContent', contentType, contentId, reason: reason || null });
}

// ─── Creator-initiated emails (private leagues) ──────────
// Server enforces creator role + rate limits. UI surfaces the errors
// returned (429 for rate-limited, 400 for bad input, 403 for non-creator).

export async function creatorInviteByEmail(leagueId, emails, personalNote) {
  return await apiCall('leagues', 'POST', {
    action: 'creatorInvite',
    leagueId,
    emails,
    personalNote: personalNote || null,
  });
}

export async function creatorListNudgeEligible(leagueId) {
  return await apiCall('leagues', 'POST', { action: 'creatorListNudgeEligible', leagueId });
}

export async function creatorSendNudge(leagueId, userIds, personalNote) {
  return await apiCall('leagues', 'POST', {
    action: 'creatorNudge',
    leagueId,
    userIds,
    personalNote: personalNote || null,
  });
}

export async function leaveLeague(leagueId, userId) {
  await apiCall('leagues', 'POST', { action: 'leave', leagueId });
}

export async function deleteLeague(leagueId, userId) {
  await apiCall('leagues', 'POST', { action: 'delete', leagueId });
}

// Copy Classic-mode predictions from one league to another (current user).
// Simple-mode leagues share a single /simplePredictions/{userId} doc, so no
// copy is required — this helper rejects simple-mode requests server-side.
export async function copyPredictions(sourceLeagueId, targetLeagueId) {
  const data = await apiCall('copy-predictions', 'POST', { sourceLeagueId, targetLeagueId });
  return data;
}

// Hidden from all client views. Docs still exist in Firestore (admin SDK
// can still read/write) but never surface to users — including the admin
// dashboard. Sweep covers both the live snapshot and the all-leagues fetch.
const HIDDEN_LEAGUE_IDS = new Set(['global']);
const isVisibleLeague = (l) => l && !HIDDEN_LEAGUE_IDS.has(l.id);

export function subscribeToUserLeagues(userId, callback) {
  const q = query(collection(db, 'leagues'), where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    const docs = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isVisibleLeague);
    console.log('[db] userLeagues snapshot:', docs.length, 'docs for', userId);
    callback(docs);
  }, (err) => { console.error('[db] userLeagues error:', err.message, err.code); callback([]); });
}

export async function fetchAllLeagues() {
  const snap = await getDocs(collection(db, 'leagues'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isVisibleLeague);
}

// ---- PREDICTIONS (direct Firestore writes with client-side lock check) ----
// Reset (delete) all of the current user's classic predictions for a league.
// Goes through the API so we can batch-delete server-side (the Firestore rules
// don't allow client-side deletes on the predictions collection).
export async function resetClassicPredictions(leagueId) {
  if (!leagueId) throw new Error('Missing leagueId');
  return await apiCall('predictions', 'DELETE', { leagueId });
}

export async function saveBatchPredictions(userId, leagueId, predictions) {
  if (!leagueId || !predictions) throw new Error('Missing leagueId or predictions');

  const batch = writeBatch(db);
  let count = 0;
  const locked = [];

  for (const [matchId, pred] of Object.entries(predictions)) {
    if (!pred.result) continue;

    // Client-side lock check (same logic as server)
    if (isMatchLocked(matchId)) {
      locked.push(matchId);
      continue;
    }

    const ref = doc(db, 'predictions', `${userId}_${leagueId}_${matchId}`);
    batch.set(ref, {
      userId,
      leagueId,
      matchId,
      result: pred.result,
      score: { home: pred.score?.home || '', away: pred.score?.away || '' },
      extraTime: pred.extraTime || false,
      penalties: pred.penalties || false,
      updatedAt: serverTimestamp(),
      submittedAt: serverTimestamp(),
    }, { merge: true });
    count++;
  }

  await batch.commit();
  return count;
}

export function subscribeToUserPredictions(userId, leagueId, callback) {
  const q = query(collection(db, 'predictions'), where('userId', '==', userId), where('leagueId', '==', leagueId));
  return onSnapshot(q, (snap) => {
    const preds = {};
    snap.docs.forEach(d => { const data = d.data(); preds[data.matchId] = data; });
    callback(preds);
  }, () => callback({}));
}

export async function getLeagueLeaderboard(leagueId) {
  const data = await apiCall(`predictions?type=leaderboard&leagueId=${leagueId}`);
  return { leaderboard: data.leaderboard, userNames: data.userNames || {}, userCountries: data.userCountries || {} };
}

// ---- SIMPLE MODE PREDICTIONS (direct Firestore writes) ----
// Per-league predictions. Doc ID is a composite `${userId}__${leagueId}` so
// every league a user participates in keeps its own unique set of picks.
// submittedAt is set once, on first save, and never updated — it's the
// tiebreaker for the leaderboard.
//
// Backward compat: historical predictions for everyone's "Global Simple"
// league live at the legacy path `/simplePredictions/{userId}` (no leagueId
// suffix). Reads for `global-simple` fall back to that legacy doc when the
// composite doc doesn't exist; writes always go to the composite doc and
// migrate the legacy data across on first write.

const SIMPLE_LEAGUE_SEPARATOR = '__';
function simplePredDocId(userId, leagueId) {
  return `${userId}${SIMPLE_LEAGUE_SEPARATOR}${leagueId}`;
}

export function subscribeToSimplePrediction(userId, leagueId, callback) {
  if (!userId || !leagueId) { callback(null); return () => {}; }
  const compositeRef = doc(db, 'simplePredictions', simplePredDocId(userId, leagueId));
  let legacyChecked = false;
  return onSnapshot(compositeRef, async (snap) => {
    if (snap.exists()) {
      callback({ id: snap.id, userId, leagueId, ...snap.data() });
      legacyChecked = true;
      return;
    }
    // Composite doc doesn't exist. For global-simple, check the legacy
    // single-doc-per-user path so users don't lose their existing picks.
    if (!legacyChecked && leagueId === 'global-simple') {
      legacyChecked = true;
      try {
        const legacySnap = await getDoc(doc(db, 'simplePredictions', userId));
        if (legacySnap.exists()) {
          callback({ id: legacySnap.id, userId, leagueId, ...legacySnap.data() });
          return;
        }
      } catch (e) { /* ignore */ }
    }
    callback(null);
  }, (err) => { console.error('[db] simplePrediction error:', err.message); callback(null); });
}

export async function getSimplePrediction(userId, leagueId) {
  if (!userId || !leagueId) return null;
  const compositeSnap = await getDoc(doc(db, 'simplePredictions', simplePredDocId(userId, leagueId)));
  if (compositeSnap.exists()) return { id: compositeSnap.id, userId, leagueId, ...compositeSnap.data() };
  if (leagueId === 'global-simple') {
    const legacySnap = await getDoc(doc(db, 'simplePredictions', userId));
    if (legacySnap.exists()) return { id: legacySnap.id, userId, leagueId, ...legacySnap.data() };
  }
  return null;
}

// Quick Picks saves go through /api/simple-predictions, which enforces
// stage locks (group stage / R32 / R16 / QF / SF / 3rd / Final each freeze
// 5 minutes before that stage's first match kicks off). Direct Firestore
// writes are blocked by rules — without the server check a user could
// edit picks for matches already in progress.
export async function saveSimplePrediction(userId, leagueId, partial) {
  if (!userId) throw new Error('Missing userId');
  if (!leagueId) throw new Error('Missing leagueId');
  const body = { leagueId, partial: {} };
  if (partial.groupPredictions !== undefined) body.partial.groupPredictions = partial.groupPredictions;
  if (partial.bestThirdPicks !== undefined) body.partial.bestThirdPicks = partial.bestThirdPicks;
  if (partial.knockoutPredictions !== undefined) body.partial.knockoutPredictions = partial.knockoutPredictions;
  if (partial.isComplete !== undefined) body.partial.isComplete = partial.isComplete;
  await apiCall('simple-predictions', 'POST', body);
  markLeaderboardFresh();
  // Funnel: count the first prediction submit per browser. trackOnce gates
  // on localStorage so subsequent saves don't spam the event.
  try {
    const { trackOnce } = await import('./track');
    trackOnce('first_prediction_submitted', { league_id: leagueId, mode: 'simple' });
  } catch {}
}

// Replace the current user's simple prediction for a league with the payload
// from another league (typically their Global Simple picks). Overwrites
// groupPredictions / bestThirdPicks / knockoutPredictions / isComplete.
export async function copySimplePrediction(userId, sourceLeagueId, targetLeagueId) {
  if (!userId) throw new Error('Missing userId');
  if (!sourceLeagueId || !targetLeagueId) throw new Error('Missing sourceLeagueId or targetLeagueId');
  if (sourceLeagueId === targetLeagueId) throw new Error('Source and target must differ');
  const source = await getSimplePrediction(userId, sourceLeagueId);
  if (!source) return { copied: 0, payload: null };
  const payload = {
    groupPredictions: source.groupPredictions || {},
    bestThirdPicks: source.bestThirdPicks || [],
    knockoutPredictions: source.knockoutPredictions || {},
    // Derive completion from the bracket itself (Final winner present) rather
    // than copying the source's stored flag, which can be a stale false on a
    // finished Global bracket. The server recomputes this authoritatively too;
    // this keeps the intent explicit. Mirrors the leaderboard's rule.
    isComplete: !!(source.isComplete || source.knockoutPredictions?.final?.[0]?.winnerId),
  };
  await saveSimplePrediction(userId, targetLeagueId, payload);
  // Return the copied payload so the caller can hydrate the wizard directly
  // instead of racing the Firestore subscription for the freshly-written doc.
  return { copied: 1, payload };
}

// Push the caller's own Global knockout bracket to every other Quick Picks
// league they're in (server reads their membership + applies, lock-aware,
// skipping classic + knockout-only leagues). Returns { applied:[{leagueId,
// name}], count, skipped }.
export async function applyGlobalKnockoutToMyLeagues() {
  const out = await apiCall('leagues', 'POST', { action: 'applyGlobalKnockout' });
  markLeaderboardFresh();
  return out;
}

// Reset a user's simple prediction for a specific league. Server enforces
// that no stage has locked yet; once any stage starts, reset returns 403
// with the locked sections listed.
export async function resetSimplePrediction(userId, leagueId) {
  if (!userId || !leagueId) return;
  await apiCall('simple-predictions', 'DELETE', { leagueId });
  markLeaderboardFresh();
}

// No-login funnel (item C, phase iv): at sign-up, migrate the anonymous UID's
// Global bracket to the new real account UID. Caller is authed as the new
// account; anonIdToken proves control of the anon session.
// Permanently delete the CURRENT user's account (self-serve). The server
// wipes the user doc, all predictions, league memberships, and the Firebase
// Auth record — irreversible. The literal confirm string is required by the
// endpoint so nothing can trigger deletion without the typed confirmation UX.
export async function deleteMyAccount() {
  return await apiCall('user', 'DELETE', { confirm: 'DELETE' });
}

export async function migrateAnonPicks(anonIdToken) {
  const out = await apiCall('migrate-anon-picks', 'POST', { anonIdToken });
  markLeaderboardFresh();
  return out;
}

// ── Leaderboard freshness window ─────────────────────────────────────────
// The board is edge-cached (s-maxage 60 + SWR 300). A user who JUST saved
// picks must see them immediately, so for a few minutes after this browser
// writes picks we cache-bust (unique _ts param + auth header → guaranteed
// origin hit). Outside that window the cached board is perfectly fine — and
// the difference is enormous in Firestore reads: every origin hit reads
// ~3 docs PER LEAGUE MEMBER (users + predictions + scores), and global-simple
// holds every user. Busting on EVERY authed view (the old behavior) made each
// leaderboard visit a full-collection read and was the dominant line item on
// the GCP bill. localStorage (not memory) so the window survives the reload
// that often follows a submit.
const LB_FRESH_KEY = 'goaloracle_lb_fresh_until';
const LB_FRESH_WINDOW_MS = 3 * 60 * 1000;
function markLeaderboardFresh() {
  try { localStorage.setItem(LB_FRESH_KEY, String(Date.now() + LB_FRESH_WINDOW_MS)); } catch {}
}
function leaderboardNeedsFresh() {
  try { return Date.now() < Number(localStorage.getItem(LB_FRESH_KEY) || 0); } catch { return false; }
}

export async function getSimpleLeaderboard(leagueId) {
  if (_authToken && leaderboardNeedsFresh()) {
    // Recently saved in this browser → force an origin read so the user sees
    // their own just-submitted picks (server also sends private,no-store on
    // authed requests as defense-in-depth).
    return await apiCall(`simple-leaderboard?leagueId=${encodeURIComponent(leagueId)}&_ts=${Date.now()}`);
  }
  // Steady state: anonymous fetch → served from the shared 60s edge cache,
  // zero Firestore reads for the overwhelming majority of views.
  return await publicApiGet(`simple-leaderboard?leagueId=${encodeURIComponent(leagueId)}`);
}

// In-memory cache for crowd consensus. The endpoint already sets a
// 5-minute edge cache, but multiple components on one page (rarity
// card, boldest-call widget, contested-match card) share the data —
// no point hitting Vercel six times in one render.
const _consensusCache = new Map(); // leagueId -> { ts, promise }
const CONSENSUS_TTL_MS = 5 * 60 * 1000;

export async function getSimpleConsensus(leagueId) {
  const now = Date.now();
  const cached = _consensusCache.get(leagueId);
  if (cached && (now - cached.ts) < CONSENSUS_TTL_MS) return cached.promise;
  const promise = publicApiGet(`simple-consensus?leagueId=${encodeURIComponent(leagueId)}`)
    .catch((e) => {
      // Drop the cache entry on failure so the next caller retries.
      _consensusCache.delete(leagueId);
      throw e;
    });
  _consensusCache.set(leagueId, { ts: now, promise });
  return promise;
}

export function subscribeToSimpleScore(userId, leagueId, callback) {
  const ref = doc(db, 'simplePredictions', simplePredDocId(userId, leagueId), 'scores', leagueId);
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, () => callback(null));
}

// ---- FEEDBACK (direct Firestore write) ----
export async function submitFeedback(feedbackData) {
  await addDoc(collection(db, 'feedback'), {
    email: feedbackData.email?.trim() || '',
    name: feedbackData.name?.trim() || 'Anonymous',
    type: feedbackData.type || 'general',
    message: feedbackData.message?.trim() || '',
    userId: feedbackData.userId || null,
    displayName: feedbackData.displayName || null,
    timestamp: feedbackData.timestamp || new Date().toISOString(),
    createdAt: serverTimestamp(),
    status: 'new',
  });
}

// ---- MATCH RESULTS ----
export function subscribeToMatchResults(callback) {
  return onSnapshot(collection(db, 'matchResults'), (snap) => {
    const results = {};
    snap.docs.forEach(d => { results[d.id] = d.data(); });
    callback(results);
  }, () => callback({}));
}

// Near-real-time in-progress scores (/liveMatchScores), written every minute
// by the live-scores cron. Merge with matchResults via mergeLiveScores for
// "current" standings; this is provisional, never final.
export function subscribeToLiveScores(callback) {
  return onSnapshot(collection(db, 'liveMatchScores'), (snap) => {
    const live = {};
    snap.docs.forEach(d => { live[d.id] = d.data(); });
    callback(live);
  }, () => callback({}));
}

// Public fetch of the in-progress score feed via /api/live-scores (admin-SDK
// read). Used by the Standings page so live scores work WITHOUT a client-side
// Firestore rule for /liveMatchScores. Never throws — returns {} on failure.
export async function fetchLiveScores() {
  try {
    // Anonymous fetch — /api/live-scores is public + edge-cached (s-maxage 20);
    // carrying the auth header made every logged-in client's 60s poll bypass
    // the shared cache and re-read the collection at the origin.
    const data = await publicApiGet('live-scores');
    return data?.live || {};
  } catch {
    return {};
  }
}

// ── Short-lived caches for the GLOBAL knockout data (actual bracket + live
// scores). These payloads are identical for every user, so when an admin
// clicks through many users' picks — or a leaderboard renders several
// brackets — we should fetch them once, not once per open. Promise-cached
// (so concurrent callers share one in-flight request) with a small TTL that
// matches the endpoints' own edge cache. The wizard intentionally keeps using
// the uncached fetchers because it polls for freshness during live games.
let _abCache = { p: null, at: 0 };
export function fetchActualBracketCached(ttlMs = 60000) {
  const now = Date.now();
  if (_abCache.p && now - _abCache.at < ttlMs) return _abCache.p;
  const p = fetchActualBracket().catch((e) => { if (_abCache.p === p) _abCache = { p: null, at: 0 }; throw e; });
  _abCache = { p, at: now };
  return p;
}

let _lsCache = { p: null, at: 0 };
export function fetchLiveScoresCached(ttlMs = 30000) {
  const now = Date.now();
  if (_lsCache.p && now - _lsCache.at < ttlMs) return _lsCache.p;
  const p = fetchLiveScores().catch((e) => { if (_lsCache.p === p) _lsCache = { p: null, at: 0 }; throw e; });
  _lsCache = { p, at: now };
  return p;
}

export async function updateMatchResult(matchId, result, adminId) {
  await apiCall('admin', 'POST', { action: 'updateResult', matchId, ...result });
}

// Admin-only: list of leagues with creator displayName + private-league
// passcode joined server-side, plus a userNames map { userId: displayName }
// covering every member of every league (so the admin dashboard can
// render member lists without N extra requests). Used by AdminDashboard.
export async function fetchAdminLeaguesEnriched() {
  const data = await apiCall('admin?type=leaguesEnriched');
  return {
    leagues: data?.leagues || [],
    userNames: data?.userNames || {},
  };
}

// Admin outreach — list eligible users for a given email template.
// Filtered server-side (membership, no-picks, email present, opt-out,
// cooldown). Returns the list the operator will see before sending.
export async function adminListOutreachEligible(template = 'noPicksReminder', cooldownDays = 7) {
  return await apiCall('admin', 'POST', {
    action: 'outreachListEligibleUsers',
    template,
    cooldownDays,
  });
}

// Admin outreach — send a preview to the specified email address (or
// the admin's own account email when toEmail is omitted). Renders the
// template using the admin's user record as the recipient stand-in.
export async function adminSendOutreachPreview(template = 'noPicksReminder', toEmail = null) {
  return await apiCall('admin', 'POST', {
    action: 'outreachSendPreview',
    template,
    toEmail,
  });
}

// Admin outreach — render the email HTML (subject + html + text) without
// sending. Used by the in-tab iframe preview so the operator can see
// exactly what users will receive without leaving the dashboard.
export async function adminRenderOutreachPreview(template = 'noPicksReminder') {
  return await apiCall('admin', 'POST', {
    action: 'outreachRenderPreview',
    template,
  });
}

// Admin outreach — send the template to N randomly-picked users from
// the supplied pool. Used as a safety canary before the full batch.
// Server returns the userIds actually picked so the client can mark
// them excluded from the next "Send to N users" click.
export async function adminSendOutreachCanary(template = 'noPicksReminder', userIds = [], count = 3) {
  return await apiCall('admin', 'POST', {
    action: 'outreachSendCanary',
    template,
    userIds,
    count,
  });
}

// Admin outreach — last N outreach runs + per-template aggregate
// delivery/open/click stats from the Resend webhook data. Powers the
// Recent runs panel under the Outreach tab.
export async function fetchAdminOutreachRecentRuns(limit = 20) {
  const data = await apiCall(`admin?type=outreachRecentRuns&limit=${limit}`);
  return {
    runs: data?.runs || [],
    templateStats: data?.templateStats || {},
  };
}

// Admin copy-to-Global audit trail. Rows carry resolved actor/user/league
// names alongside the raw IDs (see api/admin.js type=globalSubmitLog).
export async function fetchAdminGlobalSubmitLog(limit = 50) {
  const data = await apiCall(`admin?type=globalSubmitLog&limit=${limit}`);
  return { rows: data?.rows || [] };
}

// Account-deletion audit (self-serve + admin-initiated). Each row snapshots
// the deleted user's name/email (their doc is gone) plus what was wiped.
export async function fetchAdminDeletionLog(limit = 100) {
  const data = await apiCall(`admin?type=deletionLog&limit=${limit}`);
  return { rows: data?.rows || [] };
}

// Undo an account deletion via Firestore point-in-time recovery (superadmin).
// Reads the user's docs as they existed just before `deletedAtMs` and writes
// them back; `logId` stamps the deletion-log row as recovered.
export async function adminRecoverDeletedUser(targetUserId, deletedAtMs, logId) {
  return await apiCall('admin', 'POST', { action: 'recoverDeletedUser', targetUserId, deletedAtMs, logId });
}

// Daily leaderboard-movement email config (+ last run / pending preview).
// See api/admin.js type=rankDigestConfig.
export async function fetchAdminRankDigestConfig() {
  const data = await apiCall('admin?type=rankDigestConfig');
  return data?.config || {};
}
export async function adminSetRankDigestConfig(config) {
  const data = await apiCall('admin', 'POST', { action: 'setRankDigestConfig', config });
  return data?.config || {};
}
export async function adminRankDigestPreviewNow() {
  return await apiCall('admin', 'POST', { action: 'rankDigestPreviewNow' });
}
export async function adminSeedRankBaseline(excludeLatestDay = true) {
  return await apiCall('admin', 'POST', { action: 'seedRankBaseline', excludeLatestDay });
}

// No-login funnel monitoring (item C). Daily anon-picks migration outcomes +
// custom-token sign-in error counts, newest day first, plus a derived
// { status: 'ok'|'watch', reasons[] } banner. See api/admin.js type=funnelHealth.
export async function fetchAdminFunnelHealth(days = 7) {
  const data = await apiCall(`admin?type=funnelHealth&days=${days}`);
  return {
    days: data?.days || [],
    totals: data?.totals || null,
    status: data?.status || 'ok',
    reasons: data?.reasons || [],
  };
}

// Per-user Quick Picks prediction-status map { userId -> {globalComplete,
// completeAny, startedAny, privateCompleteCount, ...} } for the admin Users
// table. See api/admin.js type=usersQpStatus.
export async function fetchAdminUsersQpStatus() {
  const data = await apiCall('admin?type=usersQpStatus');
  return data?.status || {};
}

// Per-user email-history map { userId -> { lastTemplate, lastSentAtMs,
// totalSent, lastOpenedAtMs } } for the admin Users table + the outreach
// recent-contact guardrail (item B1). See api/admin.js type=emailHistory.
export async function fetchAdminUsersEmailHistory() {
  const data = await apiCall('admin?type=emailHistory');
  return data?.history || {};
}

// Admin outreach — schedule a send for later. Validated server-side
// (must be in the future, max 1000 recipients per send, template must
// exist). Drained by the /api/cron/outreach-drain cron every 5 min.
export async function adminScheduleOutreach({ template, userIds, scheduledFor }) {
  return await apiCall('admin', 'POST', {
    action: 'outreachSchedule',
    template, userIds, scheduledFor,
  });
}

// Admin outreach — cancel a pending scheduled send. Once the drain
// cron flips the doc to 'sending' it can't be cancelled anymore.
export async function adminCancelScheduledOutreach(id, reason = null) {
  return await apiCall('admin', 'POST', {
    action: 'outreachCancelScheduled', id, reason,
  });
}

// Admin outreach — list scheduled outreach sends (pending first, then
// finished/cancelled). Powers the Scheduled panel under the Outreach tab.
export async function fetchAdminOutreachScheduled() {
  const data = await apiCall('admin?type=outreachScheduled');
  return data?.items || [];
}

// Admin outreach — send the chosen template to the supplied user list.
// Server re-validates eligibility per-user, throttles to respect Resend
// rate limits, and logs both per-user audit rows and a per-run summary.
export async function adminSendOutreachBatch(template = 'noPicksReminder', userIds = []) {
  return await apiCall('admin', 'POST', {
    action: 'outreachSendBatch',
    template,
    userIds,
  });
}

// Admin: send a custom one-off email (operator subject + plain-text body)
// to a single user, wrapped in the branded shell + sign-off (B2b). Logged
// to /outreachSent so it appears in the user's email history.
export async function adminSendOutreachCustom(targetUserId, subject, body) {
  return await apiCall('admin', 'POST', {
    action: 'outreachSendCustom',
    targetUserId, subject, body,
  });
}

// Admin (superadmin): add a user to any league, incl. private — bypasses
// the passcode gate (item H). Mirrors the join membership writes server-side.
export async function adminAddUserToLeague(leagueId, targetUserId) {
  return await apiCall('admin', 'POST', { action: 'addUserToLeague', leagueId, targetUserId });
}

// Admin (superadmin): copy a user's Global Quick Picks bracket into another
// QP league they're in — only if they have no picks there yet (never
// overwrites). Returns { applied } or { skipped, reason }.
export async function adminApplyGlobalPicksToLeague(targetUserId, leagueId) {
  return await apiCall('admin', 'POST', { action: 'applyGlobalPicksToLeague', targetUserId, leagueId });
}

// ── Bracket health: finished brackets stuck "not submitted" ──
// Lists docs with a Final winner picked but stored isComplete !== true.
export async function fetchAdminQpUnsubmitted() {
  return await apiCall('admin?type=qpUnsubmitted');
}
// Repair one doc (pass docId) or the whole backlog (pass { all: true }).
export async function adminRepairQpComplete({ docId = null, all = false } = {}) {
  return await apiCall('admin', 'POST', { action: 'repairQpComplete', docId, all });
}

// ── User & prediction insights (read-only aggregate analytics) ──
export async function fetchAdminUserInsights() {
  return await apiCall('admin?type=userInsights');
}

// One-time sweep: copy members' Global brackets into their leagues (where
// they have a Global bracket and no league picks yet). dryRun previews.
export async function adminSweepGlobalPicksToLeagues({ dryRun = true, leagueId = null } = {}) {
  return await apiCall('admin', 'POST', { action: 'sweepGlobalPicksToLeagues', dryRun, leagueId });
}

// ── Outreach automation rules (B2d) ──
export async function fetchAdminAutomationRules() {
  const data = await apiCall('admin?type=automationRules');
  return data?.rules || [];
}
export async function adminSaveAutomationRule(rule, id = null) {
  return await apiCall('admin', 'POST', { action: 'automationRuleSave', id, rule });
}
export async function adminDeleteAutomationRule(id) {
  return await apiCall('admin', 'POST', { action: 'automationRuleDelete', id });
}
// Dry-run: who WOULD a rule email right now (segment minus guardrail, capped)?
export async function adminPreviewAutomationRule({ segment, cooldownDays = 3, maxPerRun = 200 }) {
  return await apiCall('admin', 'POST', { action: 'automationRulePreview', segment, cooldownDays, maxPerRun });
}

// ---- PLATFORM STATS ----
// Routes through /api/public?type=stats so the client never needs read
// access to the entire /users collection (Firestore rules now restrict
// /users reads to the owning user).
export async function fetchPlatformStats() {
  const data = await fetch('/api/public?type=stats').then(r => r.json()).catch(() => ({}));
  return {
    totalPlayers: data.totalPlayers || 0,
    activeLeagues: data.activeLeagues || 0,
    totalPrizePools: data.totalPrizePools || 0,
  };
}

// ---- ADMIN (via API, server-side only) ----
export async function getAllUsers() {
  const data = await apiCall('admin?type=users');
  return data.users;
}

// Read-only user segmentation for the superadmin panel. Returns
// { generatedAt, segments: { A, B, C } } where each segment is
// { count, users: [...] }. Heavier full-collection scan server-side,
// so the admin UI calls this lazily on demand.
export async function adminGetUserSegments() {
  return await apiCall('admin?type=segments');
}

// Superadmin: copy each user's completed private Quick Picks bracket
// into the Global League. Server resolves each user's source league.
// mode: 'skip' (default) | 'overwrite'. Returns { summary, results }.
export async function adminCopyUsersToGlobal(userIds, mode = 'skip') {
  return await apiCall('admin', 'POST', { action: 'copyUsersToGlobal', userIds, mode });
}

export async function adminDeleteLeague(leagueId) {
  await apiCall('admin', 'POST', { action: 'deleteLeague', leagueId });
}

export async function adminRenameLeague(leagueId, name) {
  return await apiCall('admin', 'POST', { action: 'renameLeague', leagueId, name });
}

export async function adminBackfillCountries() {
  return await apiCall('admin', 'POST', { action: 'backfillCountries' });
}

export async function adminAssignWallet(targetUserId, walletAddress) {
  return await apiCall('admin', 'POST', { action: 'assignWallet', targetUserId, walletAddress });
}

export async function adminMigrateLeaguePasscodes() {
  return await apiCall('admin', 'POST', { action: 'migrateLeaguePasscodes' });
}

export async function adminBanIp(ip, reason) {
  return await apiCall('admin', 'POST', { action: 'banIp', ip, reason });
}

export async function adminUnbanIp(ip) {
  return await apiCall('admin', 'POST', { action: 'unbanIp', ip });
}

export async function adminListBannedIps() {
  return await apiCall('admin', 'POST', { action: 'listBannedIps' });
}

export async function adminInspectFingerprint(visitorId) {
  return await apiCall('admin', 'POST', { action: 'inspectFingerprint', visitorId });
}

export async function adminReconcileLeague(leagueId, matchId) {
  return await apiCall('admin', 'POST', {
    action: 'reconcile',
    leagueId,
    ...(matchId ? { matchId } : {}),
  });
}

// One-click oracle smoke test from the admin dashboard. Server-side fetches
// a recent finished match in `competition` (PL by default), runs both
// parsers, and verifies the two upstreams agree. Keys never leave the
// server.
export async function adminRunOracleSmokeTest(competition = 'PL') {
  return await apiCall('admin', 'POST', { action: 'oracleSmokeTest', competition });
}

// Trigger the auto-poll cron now (uses the operator's superadmin Bearer
// token instead of CRON_SECRET, so this works for verification without
// extra env config). Same handler runs on schedule.
export async function adminRunAutoPoll() {
  return await apiCall('cron/poll-results', 'POST');
}

// Trigger the daily report email now. Same handler that runs at 08:00 UTC,
// just on demand. Use this once after deploy to confirm the email lands.
export async function adminRunDailyReport() {
  return await apiCall('cron/daily-report', 'POST');
}

// Trigger the incomplete-bracket reminder cron now. `kind` is '24h' or
// '1h'; admin uses this to preview either email after deploy without
// waiting for the natural send window.
export async function adminRunReminderCron(kind = '24h', dryRun = false) {
  const qs = `?kind=${encodeURIComponent(kind)}${dryRun ? '&dryRun=1' : ''}`;
  return await apiCall(`cron/incomplete-bracket-reminder${qs}`, 'POST');
}

// Wipe a user from all deviceFingerprints + signupIps docs. Used to bring
// a test account back to "brand-new" state, or to unblock a user who got
// stuck behind the per-device account wall.
export async function adminClearAntiSybil(userId) {
  return await apiCall('admin', 'POST', { action: 'clearAntiSybilForUser', userId });
}

// Backfill user.email for any user docs missing it. Pulls from Firebase Auth
// where available; users where Firebase Auth also has no email need a fresh
// sign-in (the auth flow upserts email there).
export async function adminBackfillEmails(dryRun = false) {
  return await apiCall('admin', 'POST', { action: 'backfillEmails', dryRun });
}

// Diagnostic: returns the canonical Firestore state for a given email so we
// can see whether duplicate /users/* docs (one did:privy:* + one auth_*, or
// two auth_* with the same dedupe key) are stranding a user's sign-in.
// Read-only — superadmin gated server-side.
export async function adminInspectUser(email) {
  return await apiCall('admin', 'POST', { action: 'inspectUser', email });
}

// Persist prize-contest consent on the current user's doc. Used by:
//   - ContestConsentBanner Confirm button (existing users)
//   - WelcomeFlow submit (via createOrUpdateUser → /api/user)
// The consent shape mirrors src/config/legal.js#hasCurrentConsent. Server
// silently ignores malformed payloads; we throw here only on transport errors.
export async function setContestConsent({ rulesVersion, ageAttested, jurisdictionAttested }) {
  return await apiCall('user', 'POST', {
    consent: { rulesVersion, ageAttested, jurisdictionAttested },
    prizeIneligible: false,
  });
}

// Explicit opt-out from prize eligibility (banner Dismiss). The user keeps
// their leaderboard standing but isn't a winner candidate. Reversible by
// sending a fresh consent later.
export async function setPrizeIneligible() {
  return await apiCall('user', 'POST', { prizeIneligible: true });
}

// Fetch the current anti-Sybil bypass allowlist (Firestore-managed).
// Also returns env-var entries separately for visibility.
export async function adminGetAntiSybilBypassList() {
  return await apiCall('admin', 'POST', { action: 'getAntiSybilBypassList' });
}

// Replace the full anti-Sybil bypass allowlist. Pass the desired final
// state — server validates each entry parses as an email.
export async function adminSetAntiSybilBypassList(emails) {
  return await apiCall('admin', 'POST', { action: 'setAntiSybilBypassList', emails });
}

// ---- FEATURE FLAGS (admin-toggleable, read by every client on mount) ----
// Defaults: Classic is opt-in. Quick Picks is the product surface; the
// Classic flow is preserved in code for re-enabling later but stays
// hidden from the UI unless /settings/featureFlags has classicEnabled
// set to literal true. Same shape for enablePrizeLeagues — user-created
// Prize Leagues (entry fee + payout config) stay dormant in code until
// a superadmin flips this on from the admin console. Default false so
// the simplified Create League flow ships behind the flag.
export const DEFAULT_FEATURE_FLAGS = {
  quickPicksEnabled: true,
  classicEnabled: false,
  enablePrizeLeagues: false,
  // Knockout-real-reseed: when ON, the bracket wizard reflects the REAL
  // advancing teams (per group as they finish) and restricts each user to
  // advancing only teams they correctly predicted. Now LIVE for the
  // tournament — read default-ON below (only an explicit `false` disables
  // it). Sticky once enabled.
  knockoutRealReseed: true,
};

// The real Round-of-32 (per-side, resolved as groups finish) for the
// knockout-real-reseed feature. See api/actual-bracket.js. Never throws.
export async function fetchActualBracket() {
  try {
    // Anonymous fetch — /api/actual-bracket is public + edge-cached (s-maxage
    // 60); the auth header was defeating the shared cache (see publicApiGet).
    return await publicApiGet('actual-bracket');
  } catch {
    return { allGroupsComplete: false, groupsComplete: [], r32: {} };
  }
}

export async function fetchFeatureFlags() {
  try {
    const res = await fetch('/api/public?type=flags', { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_FEATURE_FLAGS };
    const data = await res.json();
    return {
      quickPicksEnabled: data.quickPicksEnabled !== false,
      classicEnabled: data.classicEnabled === true,
      enablePrizeLeagues: data.enablePrizeLeagues === true,
      knockoutRealReseed: data.knockoutRealReseed !== false,
    };
  } catch {
    return { ...DEFAULT_FEATURE_FLAGS };
  }
}

// Live subscription so admins flipping a flag in one tab propagate to
// other clients within a minute or two without a refresh. The error
// path is intentionally a NO-OP — if the subscription fails (e.g.
// Firestore rules block the read for an unauthenticated client) we
// keep whatever state was last set by fetchFeatureFlags(). Resetting
// to defaults here would undo any disabled flag the moment the page
// loads.
export function subscribeToFeatureFlags(callback) {
  const ref = doc(db, 'settings', 'featureFlags');
  return onSnapshot(ref, (snap) => {
    const data = snap.exists() ? (snap.data() || {}) : {};
    callback({
      quickPicksEnabled: data.quickPicksEnabled !== false,
      classicEnabled: data.classicEnabled === true,
      enablePrizeLeagues: data.enablePrizeLeagues === true,
      knockoutRealReseed: data.knockoutRealReseed !== false,
    });
  }, (err) => {
    console.warn('[featureFlags] subscription error (keeping last value):', err?.message || err);
  });
}

// Superadmin-only: flip a feature flag and write an audit-log entry.
// `reason` is optional free text for the audit trail (e.g. "launch ramp").
export async function adminSetFeatureFlag(flag, value, reason = null) {
  return await apiCall('admin', 'POST', { action: 'setFeatureFlag', flag, value: !!value, reason: reason || null });
}

// Returns the most recent N audit-log entries for a given flag (or all
// flags if `flag` is omitted). Superadmin-only.
export async function adminGetFeatureFlagAuditLog(flag = null, limit = 10) {
  return await apiCall('admin', 'POST', { action: 'getFeatureFlagAuditLog', flag, limit });
}

export async function setUserRole(userId, role, adminId) {
  await apiCall('admin', 'POST', { action: 'setRole', targetUserId: userId, newRole: role });
}

// Permanently delete a user. Wipes user doc, predictions (classic + simple),
// league memberships, anti-Sybil records, and the Firebase Auth account.
// Superadmin-only. Returns counts of what was cleaned up.
export async function adminDeleteUser(targetUserId) {
  return await apiCall('admin', 'POST', { action: 'deleteUser', targetUserId });
}

export async function checkOracleHealth() {
  return await apiCall('health');
}
