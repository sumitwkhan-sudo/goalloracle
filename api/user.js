import { db, corsHeaders, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') return res.status(200).json({});
  Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { email, walletAddress, displayName, usernameSet } = req.body;
    const userId = claims.userId;

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    const userData = {
      id: userId,
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Always update email and wallet if provided (these come from Privy)
    if (email) userData.email = email;
    if (walletAddress) userData.walletAddress = walletAddress;

    if (!userSnap.exists) {
      // New user — set defaults
      userData.createdAt = FieldValue.serverTimestamp();
      userData.role = 'user';
      userData.leagues = ['global'];
      userData.email = email || null;
      userData.walletAddress = walletAddress || null;
      userData.displayName = email?.split('@')[0] || (walletAddress ? walletAddress.slice(0, 8) : 'Anonymous');
      userData.usernameSet = false;
    } else {
      // Existing user — only update displayName if explicitly provided (from profile edit or username prompt)
      if (displayName) userData.displayName = displayName;
      if (usernameSet === true) userData.usernameSet = true;
    }

    await userRef.set(userData, { merge: true });
    const fresh = await userRef.get();

    return res.status(200).json({ user: { id: fresh.id, ...fresh.data() } });
  } catch (e) {
    console.error('User creation error:', e);
    return res.status(500).json({ error: e.message });
  }
}
