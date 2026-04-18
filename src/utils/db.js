import { db, auth } from '../config/firebase';
import { collection, doc, getDoc, getDocFromServer, setDoc, updateDoc, deleteDoc, addDoc, onSnapshot, query, where, writeBatch, arrayUnion, arrayRemove, increment, serverTimestamp, getDocs, getCountFromServer, documentId } from 'firebase/firestore';
import { signInWithCustomToken } from 'firebase/auth';
import WORLD_CUP_MATCHES from '../data/matches';

// ---- Auth token management (kept for admin API calls) ----
let _authToken = null;
export function setAuthToken(token) { _authToken = token; }

// ---- Firebase Auth bridge ----
let _firebaseAuthed = false;

export async function signIntoFirebase(privyToken) {
  if (_firebaseAuthed) return true;
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${privyToken}` },
    });
    if (!res.ok) throw new Error(`Auth bridge failed (${res.status})`);
    const { firebaseToken } = await res.json();
    await signInWithCustomToken(auth, firebaseToken);
    _firebaseAuthed = true;
    console.log('[auth] Firebase Auth signed in');
    return true;
  } catch (e) {
    console.error('[auth] Firebase sign-in failed:', e.message);
    return false;
  }
}

export function resetFirebaseAuth() {
  _firebaseAuthed = false;
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
export async function createOrUpdateUser(privyUser) {
  if (!privyUser) return null;
  const userId = privyUser.id;
  if (!userId) return null;

  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  // Extract email
  let emailAddr = null;
  if (typeof privyUser.email === 'string') emailAddr = privyUser.email;
  else if (privyUser.email?.address) emailAddr = privyUser.email.address;
  else if (privyUser.google?.email) emailAddr = privyUser.google.email;
  else {
    const emailAccount = privyUser.linked_accounts?.find(a => a.type === 'email' || a.type === 'google_oauth');
    if (emailAccount) emailAddr = emailAccount.email || emailAccount.address;
  }
  const walletAddr = typeof privyUser.wallet === 'string' ? privyUser.wallet : privyUser.wallet?.address || null;

  if (userSnap.exists()) {
    const userData = { id: userSnap.id, ...userSnap.data() };
    console.log('[auth] loaded user from Firestore:', userData.displayName, userData.role);

    // Background sync: update email & wallet if provided (fire-and-forget)
    try {
      const updates = { updatedAt: serverTimestamp() };
      if (emailAddr) updates.email = emailAddr;
      if (walletAddr) updates.walletAddress = walletAddr;
      updateDoc(userRef, updates).catch(e => console.warn('[auth] background sync failed:', e.message));
    } catch (e) {
      console.warn('[auth] email extraction failed:', e.message);
    }

    return userData;
  }

  // New user — create directly in Firestore
  console.log('[auth] new user, creating in Firestore...');
  try {
    const displayName = emailAddr?.split('@')[0] || (walletAddr ? walletAddr.slice(0, 8) : 'Anonymous');
    await setDoc(userRef, {
      id: userId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      role: 'user',
      leagues: ['global', 'global-simple'],
      email: emailAddr || null,
      walletAddress: walletAddr || null,
      displayName,
      usernameSet: false,
    });

    // Global league membership handled by /api/user on background sync

    // Read back the created doc
    const fresh = await getDoc(userRef);
    return { id: fresh.id, ...fresh.data() };
  } catch (e) {
    console.error('[auth] failed to create user:', e.message);
    return null;
  }
}

export async function updateUserProfile(userId, updates) {
  const userRef = doc(db, 'users', userId);
  const safeUpdates = { updatedAt: serverTimestamp() };
  if (updates.displayName && updates.displayName.trim()) safeUpdates.displayName = updates.displayName.trim();
  if (updates.usernameSet === true) safeUpdates.usernameSet = true;
  if (updates.email) safeUpdates.email = updates.email;
  if (updates.walletAddress) safeUpdates.walletAddress = updates.walletAddress;
  await updateDoc(userRef, safeUpdates);
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

export function subscribeToUserLeagues(userId, callback) {
  const q = query(collection(db, 'leagues'), where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    console.log('[db] userLeagues snapshot:', snap.docs.length, 'docs for', userId);
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => { console.error('[db] userLeagues error:', err.message, err.code); callback([]); });
}

export async function fetchAllLeagues() {
  const snap = await getDocs(collection(db, 'leagues'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ---- PREDICTIONS (direct Firestore writes with client-side lock check) ----
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
  return { leaderboard: data.leaderboard, userNames: data.userNames || {} };
}

// ---- SIMPLE MODE PREDICTIONS (direct Firestore writes) ----
// Data lives under /simplePredictions/{userId} — one document per user covering
// all leagues. Per-league scores live in /simplePredictions/{userId}/scores/{leagueId}.
// submittedAt is set once, on first save, and never updated — it's the tiebreaker.

export function subscribeToSimplePrediction(userId, callback) {
  const ref = doc(db, 'simplePredictions', userId);
  return onSnapshot(ref, (snap) => {
    callback(snap.exists() ? { id: snap.id, ...snap.data() } : null);
  }, (err) => { console.error('[db] simplePrediction error:', err.message); callback(null); });
}

export async function getSimplePrediction(userId) {
  const snap = await getDoc(doc(db, 'simplePredictions', userId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function saveSimplePrediction(userId, partial) {
  if (!userId) throw new Error('Missing userId');
  const ref = doc(db, 'simplePredictions', userId);

  const payload = { userId, updatedAt: serverTimestamp() };
  if (partial.groupPredictions !== undefined) payload.groupPredictions = partial.groupPredictions;
  if (partial.bestThirdPicks !== undefined) payload.bestThirdPicks = partial.bestThirdPicks;
  if (partial.knockoutPredictions !== undefined) payload.knockoutPredictions = partial.knockoutPredictions;
  if (partial.isComplete !== undefined) payload.isComplete = partial.isComplete;

  await setDoc(ref, payload, { merge: true });
}

export async function getSimpleLeaderboard(leagueId) {
  const data = await apiCall(`simple-leaderboard?leagueId=${leagueId}`);
  return data;
}

export function subscribeToSimpleScore(userId, leagueId, callback) {
  const ref = doc(db, 'simplePredictions', userId, 'scores', leagueId);
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
export async function fetchPlatformStats() {
  const [usersCount, leaguesCount] = await Promise.all([
    getCountFromServer(collection(db, 'users')),
    getCountFromServer(collection(db, 'leagues')),
  ]);
  return {
    totalPlayers: usersCount.data().count,
    activeLeagues: leaguesCount.data().count,
    totalPrizePools: 0,
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

export async function setUserRole(userId, role, adminId) {
  await apiCall('admin', 'POST', { action: 'setRole', targetUserId: userId, newRole: role });
}

export async function checkOracleHealth() {
  return await apiCall('health');
}
