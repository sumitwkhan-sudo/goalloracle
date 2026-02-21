import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { email, walletAddress, displayName, usernameSet } = req.body;
    const userId = claims.userId || claims.sub;
    if (!userId) return res.status(500).json({ error: 'No user ID in auth claims' });

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
      // Auto-join global league (non-blocking)
      db.collection('leagues').doc('global').update({
        members: FieldValue.arrayUnion(userId),
        memberCount: FieldValue.increment(1),
      }).catch(() => {});
    } else {
      // Existing user — ONLY touch fields explicitly provided, never overwrite role/leagues/displayName
      console.log(`[user] EXISTING: ${userId}, role=${userSnap.data().role}, name=${userSnap.data().displayName}`);
      const updates = { updatedAt: FieldValue.serverTimestamp() };
      if (email) updates.email = email;
      if (walletAddress) updates.walletAddress = walletAddress;
      if (displayName && displayName.trim()) updates.displayName = displayName.trim();
      if (usernameSet === true) updates.usernameSet = true;
      await userRef.update(updates);
    }

    const fresh = await userRef.get();
    return res.status(200).json({ user: { id: fresh.id, ...fresh.data() } });
  } catch (e) {
    console.error('[user] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
