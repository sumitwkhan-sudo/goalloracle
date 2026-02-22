import { db } from '../config/firebase';
import { collection, onSnapshot, query, where, doc, getDoc, getDocFromServer, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, arrayUnion, arrayRemove, increment, serverTimestamp } from 'firebase/firestore';

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
  // Fast load via read-only GET endpoint
  const data = await apiCall('debug-user');
  const user = data.user;

  // Background: sync email & wallet to Firestore via POST (fire-and-forget)
  // This ensures Google/email login data gets persisted even though GET is read-only
  try {
    let emailAddr = null;
    if (typeof privyUser.email === 'string') emailAddr = privyUser.email;
    else if (privyUser.email?.address) emailAddr = privyUser.email.address;
    else if (privyUser.google?.email) emailAddr = privyUser.google.email;
    else {
      const emailAccount = privyUser.linked_accounts?.find(a => a.type === 'email' || a.type === 'google_oauth');
      if (emailAccount) emailAddr = emailAccount.email || emailAccount.address;
    }
    const walletAddr = typeof privyUser.wallet === 'string' ? privyUser.wallet : privyUser.wallet?.address || null;

    if (emailAddr || walletAddr) {
      // Don't await — fire and forget so UI isn't blocked
      apiCall('user', 'POST', { email: emailAddr, walletAddress: walletAddr })
        .then(res => { if (res?.user) console.log('[auth] user data synced'); })
        .catch(e => console.warn('[auth] background sync failed:', e.message));
    }
  } catch (e) {
    console.warn('[auth] email extraction failed:', e.message);
  }

  return user;
}

// Separate function for when we actually need to write user data
export async function writeUserData(privyUser) {
  if (!privyUser) return null;
  let emailAddr = null;
  if (typeof privyUser.email === 'string') emailAddr = privyUser.email;
  else if (privyUser.email?.address) emailAddr = privyUser.email.address;
  else if (privyUser.google?.email) emailAddr = privyUser.google.email;
  else {
    const emailAccount = privyUser.linked_accounts?.find(a => a.type === 'email' || a.type === 'google_oauth');
    if (emailAccount) emailAddr = emailAccount.email || emailAccount.address;
  }
  const walletAddr = typeof privyUser.wallet === 'string' ? privyUser.wallet : privyUser.wallet?.address || null;
  const data = await apiCall('user', 'POST', { email: emailAddr, walletAddress: walletAddr });
  return data.user;
}

export async function updateUserProfile(updates) {
  const data = await apiCall('user', 'POST', updates);
  return data.user;
}

export async function getUserRole(userId) {
  return 'user'; // Role comes from createOrUpdateUser response
}

// ---- LEAGUES (direct Firestore client SDK — no API calls) ----
export async function createLeague(leagueData, creatorId) {
  console.log('[createLeague] called with:', JSON.stringify(leagueData), 'creator:', creatorId);
  const { name, type, visibility, passcode, entryFee, currency, prizeDistribution, pointsSystem, matchScope, selectedGroups, selectedRounds } = leagueData;
  if (!name?.trim()) throw new Error('Name required');

  if (type === 'paid' && prizeDistribution) {
    const total = (prizeDistribution.first || 0) + (prizeDistribution.second || 0) + (prizeDistribution.third || 0);
    if (total !== 100) throw new Error('Prize distribution must total 100%');
  }
  if (visibility === 'private' && !passcode?.trim()) throw new Error('Passcode required for private leagues');

  const leagueId = name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
  const leagueRef = doc(db, 'leagues', leagueId);
  const userRef = doc(db, 'users', creatorId);

  await setDoc(leagueRef, {
    id: leagueId,
    name: name.trim(),
    type: type || 'free',
    visibility: visibility || 'public',
    passcode: visibility === 'private' ? passcode.trim().toUpperCase() : null,
    entryFee: entryFee || 0,
    currency: currency || 'USDC',
    prizeDistribution: prizeDistribution || { first: 50, second: 30, third: 20 },
    pointsSystem: pointsSystem || { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 },
    matchScope: matchScope || 'all',
    selectedGroups: selectedGroups || null,
    selectedRounds: selectedRounds || null,
    createdBy: creatorId,
    members: [creatorId],
    memberCount: 1,
    createdAt: serverTimestamp(),
    status: 'active',
  });
  console.log('[createLeague] SUCCESS — written to Firestore, id:', leagueId, 'passcode:', visibility === 'private' ? passcode : 'N/A');

  // Verify write actually persisted to server (memoryLocalCache resolves setDoc optimistically)
  try {
    const verify = await getDocFromServer(leagueRef);
    if (!verify.exists()) {
      throw new Error('League write was rejected by Firestore — check security rules in Firebase Console');
    }
    console.log('[createLeague] VERIFIED on server, passcode:', verify.data()?.passcode);
  } catch (verifyErr) {
    console.error('[createLeague] Server verification failed:', verifyErr);
    throw new Error('League was not saved. Firestore may be rejecting writes — check security rules.');
  }

  // Update user doc in background
  updateDoc(userRef, { leagues: arrayUnion(leagueId) }).catch(() => {});
  return leagueId;
}

export async function joinLeague(leagueId, userId, passcode = null) {
  const leagueRef = doc(db, 'leagues', leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error('League not found');

  const league = leagueSnap.data();
  if (league.members?.includes(userId)) throw new Error('Already a member');

  if (league.visibility === 'private') {
    if (!passcode) throw new Error('This is a private league. A passcode is required to join.');
    if (passcode.trim().toUpperCase() !== league.passcode) throw new Error('Incorrect passcode');
  }

  await Promise.all([
    updateDoc(leagueRef, { members: arrayUnion(userId), memberCount: increment(1) }),
    updateDoc(doc(db, 'users', userId), { leagues: arrayUnion(leagueId) }),
  ]);
}

export async function deleteLeague(leagueId) {
  if (leagueId === 'global') throw new Error('Cannot delete the global league');

  const leagueRef = doc(db, 'leagues', leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error('League not found');

  const league = leagueSnap.data();

  // Delete the league doc first (instant UI feedback)
  await deleteDoc(leagueRef);

  // Background cleanup: remove from members + delete predictions
  const memberIds = league.members || [];
  memberIds.forEach(mid => {
    updateDoc(doc(db, 'users', mid), { leagues: arrayRemove(leagueId) }).catch(() => {});
  });

  // Delete predictions for this league in background
  getDocs(query(collection(db, 'predictions'), where('leagueId', '==', leagueId)))
    .then(snap => {
      if (snap.empty) return;
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      return batch.commit();
    })
    .catch(e => console.error('Prediction cleanup failed:', e.message));
}

export async function leaveLeague(leagueId, userId) {
  const leagueRef = doc(db, 'leagues', leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error('League not found');

  const league = leagueSnap.data();
  if (!league.members?.includes(userId)) throw new Error('Not a member');
  if (league.createdBy === userId) throw new Error('League creator cannot leave. Delete the league instead.');

  await Promise.all([
    updateDoc(leagueRef, { members: arrayRemove(userId), memberCount: increment(-1) }),
    updateDoc(doc(db, 'users', userId), { leagues: arrayRemove(leagueId) }),
  ]);

  // Delete predictions in background
  getDocs(query(collection(db, 'predictions'), where('userId', '==', userId), where('leagueId', '==', leagueId)))
    .then(snap => {
      if (snap.empty) return;
      const batch = writeBatch(db);
      snap.docs.forEach(d => batch.delete(d.ref));
      return batch.commit();
    })
    .catch(e => console.error('Prediction cleanup failed:', e.message));
}

export function subscribeToUserLeagues(userId, callback) {
  const q = query(collection(db, 'leagues'), where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    console.log('[db] userLeagues snapshot:', snap.docs.length, 'docs for', userId);
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => { console.error('[db] userLeagues error:', err.message, err.code); callback([]); });
}

export function subscribeToAllLeagues(callback) {
  return onSnapshot(collection(db, 'leagues'), (snap) => {
    console.log('[db] allLeagues snapshot:', snap.docs.length, 'docs');
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  }, (err) => { console.error('[db] allLeagues error:', err.message, err.code); callback([]); });
}

// ---- PREDICTIONS (write via API, read via Firestore) ----
// ---- PREDICTIONS (direct Firestore client SDK) ----
// Lock predictions 5 minutes before kickoff
const LOCK_BUFFER_MS = 5 * 60 * 1000;
function isMatchLocked(match) {
  if (!match?.date || !match?.time) return false;
  const [hh, mm] = match.time.split(':').map(Number);
  const utcHour = hh + 4; // EDT offset
  const date = new Date(`${match.date}T00:00:00Z`);
  date.setUTCHours(utcHour, mm, 0, 0);
  return Date.now() >= date.getTime() - LOCK_BUFFER_MS;
}

export async function saveBatchPredictions(userId, leagueId, predictions, matchData = null) {
  if (!leagueId || !predictions) throw new Error('Missing leagueId or predictions');

  const batch = writeBatch(db);
  let count = 0;
  const locked = [];

  for (const [matchId, pred] of Object.entries(predictions)) {
    if (!pred.result) continue;

    // Client-side lock check (also enforced by security rules)
    if (matchData) {
      const match = matchData.find(m => String(m.id) === String(matchId));
      if (match && isMatchLocked(match)) {
        locked.push(matchId);
        continue;
      }
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

  if (count > 0) await batch.commit();
  return { saved: count, locked: locked.length > 0 ? locked : undefined };
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