import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

// Ensure global league exists (called once, cached)
let globalLeagueChecked = false;
async function ensureGlobalLeague() {
  if (globalLeagueChecked) return;
  const ref = db.collection('leagues').doc('global');
  const snap = await ref.get();
  if (!snap.exists) {
    await ref.set({
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
      createdBy: 'system',
      members: [],
      memberCount: 0,
      createdAt: FieldValue.serverTimestamp(),
      status: 'active',
    });
    console.log('[user] Created global league doc');
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
        leagues: ['global'],
        email: email || null,
        walletAddress: walletAddress || null,
        displayName: email?.split('@')[0] || (walletAddress ? walletAddress.slice(0, 8) : 'Anonymous'),
        usernameSet: false,
      });
      // Add to global league members
      await db.collection('leagues').doc('global').update({
        members: FieldValue.arrayUnion(userId),
        memberCount: FieldValue.increment(1),
      });
    } else {
      // Existing user — sync updates
      console.log(`[user] EXISTING: ${userId}, role=${userSnap.data().role}, name=${userSnap.data().displayName}`);
      const updates = { updatedAt: FieldValue.serverTimestamp() };
      if (email) updates.email = email;
      if (walletAddress) updates.walletAddress = walletAddress;
      if (displayName && displayName.trim()) updates.displayName = displayName.trim();
      if (usernameSet === true) updates.usernameSet = true;

      // Ensure user is in global league (backfill for old accounts)
      const userLeagues = userSnap.data().leagues || [];
      if (!userLeagues.includes('global')) {
        updates.leagues = FieldValue.arrayUnion('global');
        db.collection('leagues').doc('global').update({
          members: FieldValue.arrayUnion(userId),
          memberCount: FieldValue.increment(1),
        }).catch(() => {});
      }

      await userRef.update(updates);
    }

    const fresh = await userRef.get();
    return res.status(200).json({ user: { id: fresh.id, ...fresh.data() } });
  } catch (e) {
    console.error('[user] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
