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
    const res = await fetch(`/api/${endpoint}`, opts);
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
  if (Object.keys(apiPayload).length > 0) {
    await apiCall('user', 'POST', apiPayload);
  }

  const safeUpdates = { updatedAt: serverTimestamp() };
  if (updates.email) safeUpdates.email = updates.email;
  if (updates.onboardingComplete === true) safeUpdates.onboardingComplete = true;
  if (typeof updates.country === 'string' && updates.country.trim()) safeUpdates.country = updates.country.trim().toUpperCase();
  if (Object.keys(safeUpdates).length > 1) {
    await updateDoc(userRef, safeUpdates);
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
}

// Replace the current user's simple prediction for a league with the payload
// from another league (typically their Global Simple picks). Overwrites
// groupPredictions / bestThirdPicks / knockoutPredictions / isComplete.
export async function copySimplePrediction(userId, sourceLeagueId, targetLeagueId) {
  if (!userId) throw new Error('Missing userId');
  if (!sourceLeagueId || !targetLeagueId) throw new Error('Missing sourceLeagueId or targetLeagueId');
  if (sourceLeagueId === targetLeagueId) throw new Error('Source and target must differ');
  const source = await getSimplePrediction(userId, sourceLeagueId);
  if (!source) return { copied: 0 };
  await saveSimplePrediction(userId, targetLeagueId, {
    groupPredictions: source.groupPredictions || {},
    bestThirdPicks: source.bestThirdPicks || [],
    knockoutPredictions: source.knockoutPredictions || {},
    isComplete: !!source.isComplete,
  });
  return { copied: 1 };
}

// Reset a user's simple prediction for a specific league. Server enforces
// that no stage has locked yet; once any stage starts, reset returns 403
// with the locked sections listed.
export async function resetSimplePrediction(userId, leagueId) {
  if (!userId || !leagueId) return;
  await apiCall('simple-predictions', 'DELETE', { leagueId });
}

export async function getSimpleLeaderboard(leagueId) {
  const data = await apiCall(`simple-leaderboard?leagueId=${leagueId}`);
  return data;
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
  const promise = apiCall(`simple-consensus?leagueId=${encodeURIComponent(leagueId)}`)
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

export async function updateMatchResult(matchId, result, adminId) {
  await apiCall('admin', 'POST', { action: 'updateResult', matchId, ...result });
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

// ---- FEATURE FLAGS (admin-toggleable, read by every client on mount) ----
// Defaults: Classic is opt-in. Quick Picks is the product surface; the
// Classic flow is preserved in code for re-enabling later but stays
// hidden from the UI unless /settings/featureFlags has classicEnabled
// set to literal true.
export const DEFAULT_FEATURE_FLAGS = {
  quickPicksEnabled: true,
  classicEnabled: false,
};

export async function fetchFeatureFlags() {
  try {
    const res = await fetch('/api/public?type=flags', { cache: 'no-store' });
    if (!res.ok) return { ...DEFAULT_FEATURE_FLAGS };
    const data = await res.json();
    return {
      quickPicksEnabled: data.quickPicksEnabled !== false,
      classicEnabled: data.classicEnabled === true,
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
    });
  }, (err) => {
    console.warn('[featureFlags] subscription error (keeping last value):', err?.message || err);
  });
}

export async function adminSetFeatureFlag(flag, value) {
  return await apiCall('admin', 'POST', { action: 'setFeatureFlag', flag, value: !!value });
}

export async function setUserRole(userId, role, adminId) {
  await apiCall('admin', 'POST', { action: 'setRole', targetUserId: userId, newRole: role });
}

export async function checkOracleHealth() {
  return await apiCall('health');
}
