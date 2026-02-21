import { db } from '../config/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

// ---- Auth token management ----
// Set by the main app when Privy provides a token
let _authToken = null;
export function setAuthToken(token) { _authToken = token; }

async function apiCall(endpoint, method = 'GET', body = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
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
    if (e.name === 'AbortError') throw new Error(`API ${endpoint} timed out after 12s`);
    throw e;
  }
}

// ---- USERS (write via API) ----
export async function createOrUpdateUser(privyUser) {
  if (!privyUser) return null;
  // Privy v3.x: email can be in .email.address, .google.email, or linked_accounts
  let emailAddr = null;
  if (typeof privyUser.email === 'string') emailAddr = privyUser.email;
  else if (privyUser.email?.address) emailAddr = privyUser.email.address;
  else if (privyUser.google?.email) emailAddr = privyUser.google.email;
  else {
    // Check linked_accounts for email
    const emailAccount = privyUser.linked_accounts?.find(a => a.type === 'email' || a.type === 'google_oauth');
    if (emailAccount) emailAddr = emailAccount.email || emailAccount.address;
  }

  const walletAddr = typeof privyUser.wallet === 'string' ? privyUser.wallet : privyUser.wallet?.address || null;

  const data = await apiCall('user', 'POST', {
    email: emailAddr,
    walletAddress: walletAddr,
  });
  return data.user;
}

export async function updateUserProfile(updates) {
  const data = await apiCall('user', 'POST', updates);
  return data.user;
}

export async function getUserRole(userId) {
  return 'user'; // Role comes from createOrUpdateUser response
}

// ---- LEAGUES (write via API, read via Firestore) ----
export async function createLeague(leagueData, creatorId) {
  const data = await apiCall('leagues', 'POST', { action: 'create', ...leagueData });
  return data.leagueId;
}

export async function joinLeague(leagueId, userId, passcode = null) {
  await apiCall('leagues', 'POST', { action: 'join', leagueId, passcode });
}

export async function deleteLeague(leagueId) {
  await apiCall('leagues', 'POST', { action: 'delete', leagueId });
}

export async function leaveLeague(leagueId) {
  await apiCall('leagues', 'POST', { action: 'leave', leagueId });
}

export function subscribeToUserLeagues(userId, callback) {
  const q = query(collection(db, 'leagues'), where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, () => callback([]));
}

export function subscribeToAllLeagues(callback) {
  return onSnapshot(collection(db, 'leagues'), (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, () => callback([]));
}

// ---- PREDICTIONS (write via API, read via Firestore) ----
export async function saveBatchPredictions(userId, leagueId, predictions) {
  const data = await apiCall('predictions', 'POST', { leagueId, predictions });
  return data.saved;
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

// ---- MATCH RESULTS (read-only on client) ----
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

// ---- PLATFORM STATS (read via Firestore) ----
export function subscribeToPlatformStats(callback) {
  const u1 = onSnapshot(collection(db, 'users'), (snap) => {
    callback(prev => ({ ...prev, totalPlayers: snap.size }));
  }, () => {});
  const u2 = onSnapshot(collection(db, 'leagues'), (snap) => {
    const leagues = snap.docs.map(d => d.data());
    callback(prev => ({
      ...prev,
      activeLeagues: leagues.length,
      totalPrizePools: leagues.reduce((s, l) => s + (l.entryFee || 0) * (l.memberCount || 0), 0),
    }));
  }, () => {});
  return () => { u1(); u2(); };
}

// ---- ADMIN (via API) ----
export async function getAllUsers() {
  const data = await apiCall('admin?type=users');
  return data.users;
}

export async function setUserRole(userId, role, adminId) {
  await apiCall('admin', 'POST', { action: 'setRole', targetUserId: userId, newRole: role });
}

export async function checkOracleHealth() {
  return await apiCall('health');
}
