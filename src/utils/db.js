import { db } from '../config/firebase';
import {
  collection, doc, setDoc, getDoc, getDocs, onSnapshot,
  query, where, orderBy, serverTimestamp, writeBatch,
  updateDoc, increment
} from 'firebase/firestore';

// ---- USERS ----
export async function createOrUpdateUser(privyUser) {
  if (!privyUser) return null;
  
  // Privy v3: user.id is the primary identifier
  // email can be at user.email?.address or user.email (string)
  // wallet can be at user.wallet?.address or user.wallet (string)
  const userId = privyUser.id || privyUser.wallet?.address || privyUser.wallet;
  if (!userId) return null;

  // Handle different Privy versions' user shapes
  const emailAddr = typeof privyUser.email === 'string' ? privyUser.email 
    : privyUser.email?.address || null;
  const walletAddr = typeof privyUser.wallet === 'string' ? privyUser.wallet 
    : privyUser.wallet?.address || null;

  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);

  const userData = {
    id: userId,
    email: emailAddr,
    walletAddress: walletAddr,
    displayName: emailAddr?.split('@')[0] ||
      (walletAddr ? walletAddr.slice(0, 8) : null) || 'Anonymous',
    updatedAt: serverTimestamp(),
  };

  if (!userSnap.exists()) {
    userData.createdAt = serverTimestamp();
    userData.role = 'user';
    userData.leagues = ['global'];
  }

  await setDoc(userRef, userData, { merge: true });
  const freshSnap = await getDoc(userRef);
  return { id: freshSnap.id, ...freshSnap.data() };
}

export async function getUserRole(userId) {
  if (!userId) return 'user';
  const snap = await getDoc(doc(db, 'users', userId));
  return snap.exists() ? (snap.data().role || 'user') : 'user';
}

export async function getAllUsers() {
  const snap = await getDocs(collection(db, 'users'));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function setUserRole(userId, role, adminId) {
  await updateDoc(doc(db, 'users', userId), { role });
  await setDoc(doc(db, 'adminLogs', `role_${userId}_${Date.now()}`), {
    action: 'set_user_role', userId, newRole: role, adminId, timestamp: serverTimestamp(),
  });
}

// ---- LEAGUES ----
export async function createLeague(leagueData, creatorId) {
  const leagueId = leagueData.name.toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
  const leagueRef = doc(db, 'leagues', leagueId);

  await setDoc(leagueRef, {
    id: leagueId,
    name: leagueData.name,
    type: leagueData.type,
    entryFee: leagueData.entryFee || 0,
    currency: leagueData.currency || 'USDC',
    prizeDistribution: leagueData.prizeDistribution || { first: 50, second: 30, third: 20 },
    pointsSystem: leagueData.pointsSystem || {
      correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1,
    },
    createdBy: creatorId,
    members: [creatorId],
    memberCount: 1,
    createdAt: serverTimestamp(),
    status: 'active',
  });

  const userRef = doc(db, 'users', creatorId);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const existing = userSnap.data().leagues || [];
    await updateDoc(userRef, { leagues: [...existing, leagueId] });
  }
  return leagueId;
}

export async function joinLeague(leagueId, userId) {
  const leagueRef = doc(db, 'leagues', leagueId);
  const leagueSnap = await getDoc(leagueRef);
  if (!leagueSnap.exists()) throw new Error('League not found');
  const league = leagueSnap.data();
  if (league.members.includes(userId)) throw new Error('Already a member');

  await updateDoc(leagueRef, {
    members: [...league.members, userId],
    memberCount: increment(1),
  });
  const userRef = doc(db, 'users', userId);
  const userSnap = await getDoc(userRef);
  if (userSnap.exists()) {
    const existing = userSnap.data().leagues || [];
    await updateDoc(userRef, { leagues: [...existing, leagueId] });
  }
}

export function subscribeToUserLeagues(userId, callback) {
  const q = query(collection(db, 'leagues'), where('members', 'array-contains', userId));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export function subscribeToAllLeagues(callback) {
  return onSnapshot(collection(db, 'leagues'), (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

// ---- PREDICTIONS ----
export async function saveBatchPredictions(userId, leagueId, predictions) {
  const batch = writeBatch(db);
  for (const [matchId, pred] of Object.entries(predictions)) {
    if (!pred.result) continue;
    const ref = doc(db, 'predictions', `${userId}_${leagueId}_${matchId}`);
    batch.set(ref, {
      userId, leagueId, matchId,
      result: pred.result,
      score: { home: pred.score?.home || '', away: pred.score?.away || '' },
      extraTime: pred.extraTime || false,
      penalties: pred.penalties || false,
      updatedAt: serverTimestamp(),
      submittedAt: serverTimestamp(),
    }, { merge: true });
  }
  await batch.commit();
}

export function subscribeToUserPredictions(userId, leagueId, callback) {
  const q = query(
    collection(db, 'predictions'),
    where('userId', '==', userId),
    where('leagueId', '==', leagueId)
  );
  return onSnapshot(q, (snap) => {
    const preds = {};
    snap.docs.forEach(d => { const data = d.data(); preds[data.matchId] = data; });
    callback(preds);
  });
}

export async function getLeagueLeaderboard(leagueId) {
  const q = query(collection(db, 'predictions'), where('leagueId', '==', leagueId));
  const snap = await getDocs(q);
  const byUser = {};
  snap.docs.forEach(d => {
    const data = d.data();
    if (!byUser[data.userId]) byUser[data.userId] = {};
    byUser[data.userId][data.matchId] = data;
  });
  return byUser;
}

// ---- MATCH RESULTS (Admin) ----
export async function updateMatchResult(matchId, result, adminId) {
  await setDoc(doc(db, 'matchResults', matchId), {
    matchId,
    homeScore: result.homeScore,
    awayScore: result.awayScore,
    extraTime: result.extraTime || false,
    penalties: result.penalties || false,
    completed: true,
    updatedBy: adminId,
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'adminLogs', `result_${matchId}_${Date.now()}`), {
    action: 'update_match_result', matchId, result, adminId, timestamp: serverTimestamp(),
  });
}

export function subscribeToMatchResults(callback) {
  return onSnapshot(collection(db, 'matchResults'), (snap) => {
    const results = {};
    snap.docs.forEach(d => { results[d.id] = d.data(); });
    callback(results);
  });
}

// ---- PLATFORM STATS ----
export function subscribeToPlatformStats(callback) {
  const u1 = onSnapshot(collection(db, 'users'), (snap) => {
    callback(prev => ({ ...prev, totalPlayers: snap.size }));
  });
  const u2 = onSnapshot(collection(db, 'leagues'), (snap) => {
    const leagues = snap.docs.map(d => d.data());
    callback(prev => ({
      ...prev,
      activeLeagues: leagues.length,
      totalPrizePools: leagues.reduce((s, l) => s + (l.entryFee || 0) * (l.memberCount || 0), 0),
    }));
  });
  return () => { u1(); u2(); };
}
