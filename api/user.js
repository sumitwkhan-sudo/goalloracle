import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

// Ensure global leagues exist (called once, cached)
let globalLeagueChecked = false;
async function ensureGlobalLeague() {
  if (globalLeagueChecked) return;

  const classicRef = db.collection('leagues').doc('global');
  const simpleRef = db.collection('leagues').doc('global-simple');
  const [classicSnap, simpleSnap] = await Promise.all([classicRef.get(), simpleRef.get()]);

  if (!classicSnap.exists) {
    await classicRef.set({
      id: 'global',
      name: 'Global League',
      type: 'free',
      visibility: 'public',
      passcode: null,
      entryFee: 0,
      currency: 'USDC',
      prizeDistribution: { first: 50, second: 30, third: 20 },
      pointsSystem: { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 },
      matchScope: 'all',
      selectedGroups: null,
      selectedRounds: null,
      predictionMode: 'classic',
      isGlobal: true,
      createdBy: 'system',
      members: [],
      memberCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      status: 'active',
    });
    console.log('[user] Created global league doc (classic)');
  } else if (classicSnap.data().predictionMode == null) {
    await classicRef.update({ predictionMode: 'classic', isGlobal: true });
  }

  if (!simpleSnap.exists) {
    await simpleRef.set({
      id: 'global-simple',
      name: 'Global League Simple',
      type: 'free',
      visibility: 'public',
      passcode: null,
      entryFee: 0,
      currency: 'USDC',
      prizeDistribution: { first: 50, second: 30, third: 20 },
      pointsSystem: null,
      matchScope: 'all',
      selectedGroups: null,
      selectedRounds: null,
      predictionMode: 'simple',
      isGlobal: true,
      createdBy: 'system',
      members: [],
      memberCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      status: 'active',
    });
    console.log('[user] Created global league doc (simple)');
  }

  globalLeagueChecked = true;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') { Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v)); return res.status(200).json({}); }
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { email, walletAddress, displayName, usernameSet } = req.body;
    const userId = claims.userId || claims.sub;
    if (!userId) return res.status(500).json({ error: 'No user ID in auth claims' });

    await ensureGlobalLeague();

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      // New user
      console.log(`[user] NEW: ${userId}, email=${email}`);
      await userRef.set({
        id: userId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        role: 'user',
        leagues: ['global', 'global-simple'],
        email: email || null,
        walletAddress: walletAddress || null,
        displayName: email?.split('@')[0] || (walletAddress ? walletAddress.slice(0, 8) : 'Anonymous'),
        usernameSet: false,
      });
      // Add to both global leagues' member lists + subcollection
      const displayName = email?.split('@')[0] || (walletAddress ? walletAddress.slice(0, 8) : 'Anonymous');
      await Promise.all([
        db.collection('leagues').doc('global').update({
          members: FieldValue.arrayUnion(userId),
          memberCount: FieldValue.increment(1),
        }),
        db.collection('leagues').doc('global-simple').update({
          members: FieldValue.arrayUnion(userId),
          memberCount: FieldValue.increment(1),
        }),
        db.collection('leagues').doc('global-simple').collection('members').doc(userId).set({
          userId,
          displayName,
          joinedAt: FieldValue.serverTimestamp(),
          totalAccuracy: 0,
          submittedAt: null,
          hasSubmitted: false,
        }),
      ]);
    } else {
      // Existing user — sync updates
      console.log(`[user] EXISTING: ${userId}, role=${userSnap.data().role}, name=${userSnap.data().displayName}`);
      const updates = { updatedAt: FieldValue.serverTimestamp() };
      if (email) updates.email = email;
      if (walletAddress) updates.walletAddress = walletAddress;
      if (displayName && displayName.trim()) updates.displayName = displayName.trim();
      if (usernameSet === true) updates.usernameSet = true;

      // Ensure user is in both global leagues (backfill for old accounts)
      const userLeagues = userSnap.data().leagues || [];
      const leaguesToAdd = [];
      if (!userLeagues.includes('global')) leaguesToAdd.push('global');
      if (!userLeagues.includes('global-simple')) leaguesToAdd.push('global-simple');
      if (leaguesToAdd.length > 0) {
        updates.leagues = FieldValue.arrayUnion(...leaguesToAdd);
        for (const leagueId of leaguesToAdd) {
          db.collection('leagues').doc(leagueId).update({
            members: FieldValue.arrayUnion(userId),
            memberCount: FieldValue.increment(1),
          }).catch(() => {});
        }
      }

      // Ensure global-simple members subcollection doc exists (backfill)
      const memberRef = db.collection('leagues').doc('global-simple').collection('members').doc(userId);
      memberRef.get().then((snap) => {
        if (!snap.exists) {
          memberRef.set({
            userId,
            displayName: userSnap.data().displayName || 'Anonymous',
            joinedAt: userSnap.data().createdAt || FieldValue.serverTimestamp(),
            totalAccuracy: 0,
            submittedAt: null,
            hasSubmitted: false,
          });
        }
      }).catch(() => {});

      await userRef.update(updates);
    }

    const fresh = await userRef.get();
    return res.status(200).json({ user: { id: fresh.id, ...fresh.data() } });
  } catch (e) {
    console.error('[user] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
