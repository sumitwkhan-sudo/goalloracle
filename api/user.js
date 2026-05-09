import { db, applyCors, verifyAuth } from './_lib/firebase.js';
import {
  validateDisplayNameServer,
  normalizeEmail,
  getClientIp,
  ipHash,
  isValidVisitorId,
  recordFingerprintForUser,
  isDisplayNameTakenByOther,
  pickDefaultDisplayName,
} from './_lib/security.js';
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
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { displayName, usernameSet, deviceFingerprint, walletAddress } = req.body;
    const userId = claims.userId || claims.sub;
    if (!userId) return res.status(500).json({ error: 'No user ID in auth claims' });

    // Wallet self-link: allow the user to set their own walletAddress
    // through this server path (rules block direct client writes), but
    // validate format here so the field is never garbage.
    let walletUpdate;
    if (walletAddress !== undefined) {
      const trimmed = String(walletAddress || '').trim();
      if (trimmed === '') {
        walletUpdate = null; // explicit clear
      } else if (/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        walletUpdate = trimmed;
      } else {
        return res.status(400).json({ error: 'Invalid EVM wallet address' });
      }
    }

    // Trust the verified token's email over anything in the body — the body
    // value is attacker-controlled and could otherwise overwrite the address
    // tied to the account.
    const email = (claims.email || '').toLowerCase().trim() || null;

    if (displayName !== undefined) {
      const err = validateDisplayNameServer(displayName);
      if (err) return res.status(400).json({ error: err });
      if (await isDisplayNameTakenByOther(db, displayName, userId)) {
        return res.status(409).json({ error: 'That username is already taken' });
      }
    }

    await ensureGlobalLeague();

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();

    if (!userSnap.exists) {
      // New user
      console.log(`[user] NEW: ${userId}, email=${email}`);
      const ip = getClientIp(req);
      const baseName = email?.split('@')[0] || 'Player';
      const defaultName = await pickDefaultDisplayName(db, baseName);
      await userRef.set({
        id: userId,
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        role: 'user',
        leagues: ['global', 'global-simple'],
        email: email || null,
        emailDedupeKey: email ? normalizeEmail(email) : null,
        walletAddress: null,
        displayName: defaultName,
        displayNameLower: defaultName.toLowerCase(),
        usernameSet: false,
        signupIpHash: ipHash(ip),
        deviceFingerprint: isValidVisitorId(deviceFingerprint) ? deviceFingerprint : null,
      });
      if (isValidVisitorId(deviceFingerprint)) {
        await recordFingerprintForUser(db, deviceFingerprint, userId, ip).catch(() => {});
      }
      // Add to both global leagues' member lists + subcollection
      const memberDisplayName = defaultName;
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
          displayName: memberDisplayName,
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
      if (email) {
        updates.email = email;
        updates.emailDedupeKey = normalizeEmail(email);
      }
      if (walletUpdate !== undefined) updates.walletAddress = walletUpdate;
      if (displayName && displayName.trim()) {
        const trimmed = displayName.trim();
        updates.displayName = trimmed;
        updates.displayNameLower = trimmed.toLowerCase();
      }
      if (usernameSet === true) updates.usernameSet = true;

      // Ensure user's leagues array includes both globals (idempotent)
      const userLeagues = userSnap.data().leagues || [];
      const missingFromUser = [];
      if (!userLeagues.includes('global')) missingFromUser.push('global');
      if (!userLeagues.includes('global-simple')) missingFromUser.push('global-simple');
      if (missingFromUser.length > 0) {
        updates.leagues = FieldValue.arrayUnion(...missingFromUser);
      }

      // Authoritative backfill: check each global LEAGUE's members array and
      // add the user if missing. This runs regardless of what the user doc
      // says, fixing the drift where memberCount was incremented but the
      // members array was never populated.
      const [globalSnap, globalSimpleSnap] = await Promise.all([
        db.collection('leagues').doc('global').get(),
        db.collection('leagues').doc('global-simple').get(),
      ]);
      const ensureMember = (snap, leagueId) => {
        if (!snap.exists) return null;
        const members = snap.data().members || [];
        if (members.includes(userId)) return null;
        return db.collection('leagues').doc(leagueId).update({
          members: FieldValue.arrayUnion(userId),
          memberCount: FieldValue.increment(1),
        }).catch(e => console.warn(`[user] failed to add ${userId} to ${leagueId}.members:`, e.message));
      };
      const leaguePromises = [
        ensureMember(globalSnap, 'global'),
        ensureMember(globalSimpleSnap, 'global-simple'),
      ].filter(Boolean);
      if (leaguePromises.length > 0) await Promise.all(leaguePromises);

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
