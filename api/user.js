import { db, applyCors, verifyAuth } from './_lib/firebase.js';
import {
  validateDisplayNameServer,
  normalizeEmail,
  getClientIp,
  getGeoFromRequest,
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
  if (req.method === 'DELETE') return handleSelfDelete(req, res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  try {
    const { displayName, usernameSet, deviceFingerprint, walletAddress, consent, prizeIneligible } = req.body;
    const userId = claims.userId || claims.sub;
    if (!userId) return res.status(500).json({ error: 'No user ID in auth claims' });

    // Prize-contest consent. Captured at WelcomeFlow submit (new users)
    // and at ContestConsentBanner Confirm (existing users). The shape
    // mirrors src/config/legal.js#hasCurrentConsent so the client and
    // server agree on what "valid consent" means without a shared file.
    //
    // We accept this on the same /api/user POST path so the banner +
    // welcome flow share one well-tested endpoint instead of inventing
    // a new one. Server validates the inner shape — anything else gets
    // ignored silently rather than blocking the request, since this
    // endpoint also handles unrelated wallet / displayName updates.
    let consentUpdate;
    if (consent && typeof consent === 'object') {
      const okShape = (
        typeof consent.rulesVersion === 'string'
        && consent.rulesVersion.length > 0
        && consent.rulesVersion.length < 32
        && consent.ageAttested === true
        && consent.jurisdictionAttested === true
      );
      if (okShape) {
        consentUpdate = {
          rulesVersion: consent.rulesVersion,
          ageAttested: true,
          jurisdictionAttested: true,
          timestamp: FieldValue.serverTimestamp(),
        };
      }
    }

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
    const existingData = userSnap.exists ? userSnap.data() : null;

    // Sparse-doc detection (Codex review item 7). /api/auth/google upserts
    // {email, emailDedupeKey, emailUpdatedAt} via set+merge on every Google
    // sign-in (api/auth/google.js:120-124). For a brand-new user, that runs
    // BEFORE the client's createOrUpdateUser, so userSnap.exists==true but
    // the doc is missing role / displayName / usernameSet / createdAt /
    // leagues. The pre-existing "EXISTING" branch only synced incremental
    // fields and assumed the rest was there — leaving the user with a
    // half-shaped profile (no displayName → no welcome modal trigger,
    // no leagues array → no per-league subscriptions, etc).
    //
    // Treat a sparse doc the same as a missing one: full first-login init
    // that fills in the schema while preserving the email/emailDedupeKey
    // that was already written.
    const isSparseDoc = existingData && (
      !existingData.role
      || !existingData.displayName
      || existingData.usernameSet === undefined
      || !existingData.createdAt
    );

    // Coarse, IP-derived location from Vercel edge headers (no raw IP stored).
    // Refreshed on every login so existing users backfill on their next visit.
    const geo = getGeoFromRequest(req);
    const geoFields = {};
    if (geo.country) geoFields.geoCountry = geo.country;
    if (geo.region) geoFields.geoRegion = geo.region;
    if (geo.city) geoFields.geoCity = geo.city;
    if (Object.keys(geoFields).length > 0) geoFields.geoUpdatedAt = FieldValue.serverTimestamp();

    if (!userSnap.exists || isSparseDoc) {
      // New user OR sparse-doc completion
      console.log(`[user] ${userSnap.exists ? 'SPARSE-COMPLETE' : 'NEW'}: ${userId}, email=${email || existingData?.email || null}`);
      const ip = getClientIp(req);
      const preservedEmail = email || existingData?.email || null;
      const baseName = preservedEmail?.split('@')[0] || 'Player';
      const defaultName = await pickDefaultDisplayName(db, baseName);
      // set+merge so any field already on the sparse doc (email,
      // emailDedupeKey, emailUpdatedAt) is preserved. createdAt only
      // gets written if missing — never stomp on a real createdAt.
      const initPayload = {
        id: userId,
        updatedAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
        role: existingData?.role || 'user',
        leagues: existingData?.leagues?.length ? existingData.leagues : ['global', 'global-simple'],
        email: preservedEmail,
        emailDedupeKey: preservedEmail ? normalizeEmail(preservedEmail) : (existingData?.emailDedupeKey || null),
        walletAddress: existingData?.walletAddress ?? null,
        displayName: existingData?.displayName || defaultName,
        displayNameLower: (existingData?.displayName || defaultName).toLowerCase(),
        usernameSet: existingData?.usernameSet === true ? true : false,
        signupIpHash: existingData?.signupIpHash || ipHash(ip),
        deviceFingerprint: existingData?.deviceFingerprint || (isValidVisitorId(deviceFingerprint) ? deviceFingerprint : null),
        ...geoFields,
      };
      if (!existingData?.createdAt) initPayload.createdAt = FieldValue.serverTimestamp();
      if (consentUpdate) initPayload.contestConsent = consentUpdate;
      if (prizeIneligible === true) initPayload.prizeIneligible = true;
      await userRef.set(initPayload, { merge: true });

      if (isValidVisitorId(deviceFingerprint) && !existingData?.deviceFingerprint) {
        await recordFingerprintForUser(db, deviceFingerprint, userId, ip).catch(() => {});
      }

      // Idempotent global-league membership (Codex review item 8). Read
      // the current members array before deciding to add — protects the
      // memberCount from drifting up if /api/user is invoked twice for
      // the same user (e.g. a retry from createOrUpdateUser, or the
      // sparse-doc-completion path firing after a real first-login).
      const memberDisplayName = initPayload.displayName;
      const [globalSnap, globalSimpleSnap] = await Promise.all([
        db.collection('leagues').doc('global').get(),
        db.collection('leagues').doc('global-simple').get(),
      ]);
      const idempotentAdd = (snap, leagueId) => {
        if (!snap.exists) return null;
        const members = snap.data().members || [];
        if (members.includes(userId)) return null;
        return db.collection('leagues').doc(leagueId).update({
          members: FieldValue.arrayUnion(userId),
          memberCount: FieldValue.increment(1),
        }).catch(e => console.warn(`[user] failed to add ${userId} to ${leagueId}:`, e.message));
      };
      const memberSubRef = db.collection('leagues').doc('global-simple').collection('members').doc(userId);
      const memberSubSnap = await memberSubRef.get();
      await Promise.all([
        idempotentAdd(globalSnap, 'global'),
        idempotentAdd(globalSimpleSnap, 'global-simple'),
        memberSubSnap.exists ? null : memberSubRef.set({
          userId,
          displayName: memberDisplayName,
          joinedAt: FieldValue.serverTimestamp(),
          totalAccuracy: 0,
          submittedAt: null,
          hasSubmitted: false,
        }),
      ].filter(Boolean));
    } else {
      // Existing user — sync updates
      console.log(`[user] EXISTING: ${userId}, role=${existingData.role}, name=${existingData.displayName}`);
      const updates = { updatedAt: FieldValue.serverTimestamp(), lastLoginAt: FieldValue.serverTimestamp(), ...geoFields };
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

      // Prize-contest consent: only write when supplied. Bumps overwrite
      // any prior consent (rules-version change requires fresh attestation).
      if (consentUpdate) updates.contestConsent = consentUpdate;
      // Explicit opt-out from the dismiss button on ContestConsentBanner.
      // We never auto-flag — must be explicit.
      if (prizeIneligible === true) updates.prizeIneligible = true;
      // Allow opting back IN: send prizeIneligible:false alongside a
      // fresh consent block.
      if (prizeIneligible === false && consentUpdate) updates.prizeIneligible = false;

      // Ensure user's leagues array includes both globals (idempotent)
      const userLeagues = existingData.leagues || [];
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
            displayName: existingData.displayName || 'Anonymous',
            joinedAt: existingData.createdAt || FieldValue.serverTimestamp(),
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

// ── Self-serve account deletion ─────────────────────────────────────────────
// DELETE /api/user — permanently delete YOUR OWN account. Same wipe routine
// the superadmin console uses (api/_lib/deleteUserAccount.js): user doc, all
// predictions, league memberships, sybil records, Firebase Auth record.
// Guards:
//  - must be authenticated (you can only delete yourself — the UID comes from
//    the verified token, never the body)
//  - body must carry confirm: 'DELETE' (the client only sends it after the
//    user types the word — a stray API call can't nuke an account)
//  - superadmins can't self-delete (operator-lockout protection; demote first)
// Deletion is logged to /adminLogs (action 'self_delete_account') so the
// operator can see churn and answer "where did my account go?" emails.
async function handleSelfDelete(req, res) {
  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  const userId = claims.userId || claims.sub;
  if (!userId) return res.status(500).json({ error: 'No user ID in auth claims' });

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.confirm !== 'DELETE') {
      return res.status(400).json({ error: 'Missing confirmation' });
    }

    const snap = await db.collection('users').doc(userId).get();
    if (!snap.exists) return res.status(404).json({ error: 'Account not found' });
    const user = snap.data();
    if (user.role === 'superadmin') {
      return res.status(403).json({ error: 'Superadmin accounts cannot self-delete. Demote the role first.' });
    }

    const { deleteUserAccount } = await import('./_lib/deleteUserAccount.js');
    const { admin } = await import('./_lib/firebase.js');
    const deleted = await deleteUserAccount(db, admin, userId);

    await db.collection('adminLogs').add({
      action: 'self_delete_account',
      targetUserId: userId,
      targetEmail: user.email || null,
      targetDisplayName: user.displayName || null,
      adminId: userId,
      timestamp: FieldValue.serverTimestamp(),
      deleted,
    });

    return res.status(200).json({ success: true, deleted });
  } catch (e) {
    console.error('[user] self-delete error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
