import { db } from '../config/firebase';
import { collection, onSnapshot, query, where } from 'firebase/firestore';

// ---- Auth token management ----
// Set by the main app when Privy provides a token
let _authToken = null;
export function setAuthToken(token) { _authToken = token; }

async function apiCall(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (_authToken) opts.headers['Authorization'] = `Bearer ${_authToken}`;
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`/api/${endpoint}`, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'API request failed');
  return data;
}

// ---- USERS (write via API) ----
export async function createOrUpdateUser(privyUser) {
  if (!privyUser) return null;
  const emailAddr = typeof privyUser.email === 'string' ? privyUser.email : privyUser.email?.address || null;
  const walletAddr = typeof privyUser.wallet === 'string' ? privyUser.wallet : privyUser.wallet?.address || null;

  const data = await apiCall('user', 'POST', {
    email: emailAddr,
    walletAddress: walletAddr,
    displayName: emailAddr?.split('@')[0] || (walletAddr ? walletAddr.slice(0, 8) : 'Anonymous'),
  });
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

export async function joinLeague(leagueId, userId) {
  await apiCall('leagues', 'POST', { action: 'join', leagueId });
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
  return data.leaderboard;
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
