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
    // Privy server-auth returns userId (DID) — handle both field names for safety
    const userId = claims.userId || claims.sub;

    if (!userId) {
      console.error('No userId in claims:', JSON.stringify(claims));
      return res.status(500).json({ error: 'No user ID in auth claims' });
    }

    console.log(`[user] userId=${userId}, email=${email}, checking...`);

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists && email) {
      // User doc doesn't exist for this DID — check if there's an existing account with this email
      // This handles the case where Privy assigns a different DID (e.g., different login method)
      console.log(`[user] No doc for ${userId}, checking by email ${email}...`);
      const emailQuery = await db.collection('users').where('email', '==', email).limit(1).get();
      if (!emailQuery.empty) {
        const existingDoc = emailQuery.docs[0];
        const existingData = existingDoc.data();
        console.log(`[user] FOUND existing account by email: ${existingDoc.id} → migrating to ${userId}`);
        
        // Copy existing user data to new DID doc
        const migratedData = { ...existingData, id: userId, updatedAt: FieldValue.serverTimestamp() };
        delete migratedData.createdAt; // preserve original
        await userRef.set({ ...existingData, id: userId, updatedAt: FieldValue.serverTimestamp() }, { merge: false });
        
        // Update all league memberships from old ID to new ID
        const oldId = existingDoc.id;
        if (oldId !== userId) {
          const leagueIds = existingData.leagues || [];
          for (const lid of leagueIds) {
            try {
              const lRef = db.collection('leagues').doc(lid);
              await lRef.update({
                members: FieldValue.arrayRemove(oldId),
              });
              await lRef.update({
                members: FieldValue.arrayUnion(userId),
              });
              // Update createdBy if this user created the league
              const lSnap = await lRef.get();
              if (lSnap.exists && lSnap.data().createdBy === oldId) {
                await lRef.update({ createdBy: userId });
              }
            } catch (e) {
              console.error(`[user] Failed to migrate league ${lid}:`, e.message);
            }
          }
          
          // Update predictions from old ID to new ID
          const predsSnap = await db.collection('predictions').where('userId', '==', oldId).get();
          if (!predsSnap.empty) {
            for (const doc of predsSnap.docs) {
              const data = doc.data();
              const newDocId = doc.id.replace(oldId, userId);
              await db.collection('predictions').doc(newDocId).set({ ...data, userId });
              await doc.ref.delete();
            }
            console.log(`[user] Migrated ${predsSnap.size} predictions`);
          }
          
          // Don't delete old doc yet (in case of issues) — just mark it
          await existingDoc.ref.update({ migratedTo: userId, migratedAt: FieldValue.serverTimestamp() });
        }
        
        const fresh = await userRef.get();
        return res.status(200).json({ user: { id: fresh.id, ...fresh.data() } });
      }
    }

    if (!userSnap.exists) {
      // New user — set defaults
      console.log(`[user] NEW user: ${userId}, email=${email}`);
      const newUser = {
        id: userId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        role: 'user',
        leagues: ['global'],
        email: email || null,
        walletAddress: walletAddress || null,
        displayName: email?.split('@')[0] || (walletAddress ? walletAddress.slice(0, 8) : 'Anonymous'),
        usernameSet: false,
      };
      await userRef.set(newUser);

      // Auto-join global league
      const globalRef = db.collection('leagues').doc('global');
      const globalSnap = await globalRef.get();
      if (globalSnap.exists) {
        await globalRef.update({
          members: FieldValue.arrayUnion(userId),
          memberCount: FieldValue.increment(1),
        });
      }

      const fresh = await userRef.get();
      return res.status(200).json({ user: { id: fresh.id, ...fresh.data() } });
    }

    // Existing user — only update specific fields, NEVER overwrite role/leagues/displayName/usernameSet
    console.log(`[user] EXISTING user: ${userId}, role=${userSnap.data().role}, displayName=${userSnap.data().displayName}`);

    const updates = {
      updatedAt: FieldValue.serverTimestamp(),
    };

    // Only update contact info if provided (from Privy auth data)
    if (email) updates.email = email;
    if (walletAddress) updates.walletAddress = walletAddress;

    // Only update displayName if explicitly sent (from profile edit / username prompt)
    // and only if the user explicitly asked to change it
    if (displayName !== undefined && displayName !== null && displayName.trim() !== '') {
      updates.displayName = displayName.trim();
    }
    if (usernameSet === true) updates.usernameSet = true;

    await userRef.update(updates);
    const fresh = await userRef.get();

    return res.status(200).json({ user: { id: fresh.id, ...fresh.data() } });
  } catch (e) {
    console.error('User creation error:', e);
    return res.status(500).json({ error: e.message });
  }
}