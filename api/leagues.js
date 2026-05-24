import { db, applyCors, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  // GET: list all leagues (public)
  if (req.method === 'GET') {
    try {
      const snap = await db.collection('leagues').get();
      const leagues = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ leagues });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const { action } = req.body;
  const userId = claims.userId;

  try {
    // ─── CREATE ───────────────────────────────────────────
    if (action === 'create') {
      const { name, type, visibility, passcode, entryFee, currency, prizeDistribution, pointsSystem, matchScope, selectedGroups, selectedRounds, predictionMode, houseRules } = req.body;
      if (!name?.trim()) return res.status(400).json({ error: 'Name required' });
      if (name.trim().length > 60) return res.status(400).json({ error: 'Name too long (max 60 chars)' });

      const mode = predictionMode === 'classic' ? 'classic' : 'simple';

      // Prize-league feature flag — load on every create so the server
      // is always source-of-truth even if a client has a stale flag value.
      // Caching here is unnecessary; create is rare.
      const flagSnap = await db.collection('settings').doc('featureFlags').get();
      const prizeLeaguesEnabled = flagSnap.exists && flagSnap.data()?.enablePrizeLeagues === true;
      // Numeric bounds — entryFee must be a non-negative finite number under
      // a sane cap; prize distribution percentages must be integers in [0..100].
      const fee = Number(entryFee || 0);
      if (!Number.isFinite(fee) || fee < 0 || fee > 10000) {
        return res.status(400).json({ error: 'Invalid entryFee' });
      }

      // Gate: reject any prize-league shape when the platform-wide flag
      // is off. Catches both old clients with a stale `true` and any
      // direct API calls. Returns 403 with the spec-mandated message.
      if (!prizeLeaguesEnabled) {
        if (type === 'paid' || fee > 0) {
          return res.status(403).json({ error: 'Prize leagues are currently disabled.' });
        }
      }

      if (prizeDistribution) {
        const { first = 0, second = 0, third = 0 } = prizeDistribution;
        const isPct = (v) => Number.isFinite(v) && Number.isInteger(v) && v >= 0 && v <= 100;
        if (!isPct(first) || !isPct(second) || !isPct(third)) {
          return res.status(400).json({ error: 'Invalid prizeDistribution' });
        }
        if (type === 'paid' && (first + second + third) !== 100) {
          return res.status(400).json({ error: 'Prize distribution must total 100%' });
        }
      }

      // House Rules validation: private leagues only, 500 char hard cap,
      // plain-text (HTML escaped on render — we store raw, render-time
      // sanitization). Whitespace-only stores as null.
      let houseRulesPersist = null;
      if (houseRules && typeof houseRules === 'object' && typeof houseRules.content === 'string') {
        const trimmed = houseRules.content.trim();
        if (trimmed) {
          if (visibility !== 'private') {
            return res.status(400).json({ error: 'House Rules are only allowed on private leagues.' });
          }
          if (trimmed.length > 500) {
            return res.status(400).json({ error: 'House Rules must be 500 characters or fewer.' });
          }
          houseRulesPersist = {
            content: trimmed,
            lastUpdatedAt: FieldValue.serverTimestamp(),
            lastUpdatedBy: userId,
          };
        }
      }

      if (pointsSystem) {
        const allowed = new Set(['correctResult', 'correctScore', 'penaltyBonus', 'extraTimeBonus']);
        for (const [k, v] of Object.entries(pointsSystem)) {
          if (!allowed.has(k)) return res.status(400).json({ error: `Unknown points key: ${k}` });
          if (!Number.isInteger(v) || v < 0 || v > 50) {
            return res.status(400).json({ error: `Invalid pointsSystem.${k}` });
          }
        }
      }

      if (visibility === 'private' && !passcode?.trim()) {
        return res.status(400).json({ error: 'Passcode required for private leagues' });
      }
      if (passcode && passcode.length > 32) {
        return res.status(400).json({ error: 'Passcode too long' });
      }

      // 4 hex chars of randomness defends against the (very rare) case of
      // two creates colliding on the same `slug-millisecond`. Without it
      // the second create would silently overwrite the first via `set`.
      const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const randomSuffix = Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');
      const leagueId = `${slug}-${Date.now()}-${randomSuffix}`;
      const leagueRef = db.collection('leagues').doc(leagueId);

      await leagueRef.set({
        id: leagueId,
        name: name.trim(),
        // type silently coerced to 'free' when prize leagues are off —
        // matches the simplified create flow (no type picker visible).
        type: prizeLeaguesEnabled ? (type || 'free') : 'free',
        visibility: visibility || 'public',
        // passcode is NOT stored on the public doc anymore — see private
        // subcollection write below. Field stays null for compatibility
        // with older readers that only check this property to know whether
        // a league is private.
        passcode: null,
        entryFee: prizeLeaguesEnabled ? (entryFee || 0) : 0,
        currency: currency || 'USDC',
        prizeDistribution: prizeLeaguesEnabled ? (prizeDistribution || { first: 50, second: 30, third: 20 }) : null,
        pointsSystem: pointsSystem || { correctResult: 3, correctScore: 5, penaltyBonus: 2, extraTimeBonus: 1 },
        matchScope: matchScope || 'all',
        selectedGroups: selectedGroups || null,
        selectedRounds: selectedRounds || null,
        predictionMode: mode,
        createdBy: userId,
        members: [userId],
        memberCount: 1,
        createdAt: FieldValue.serverTimestamp(),
        status: 'active',
        houseRules: houseRulesPersist,
      });

      // Private leagues: store the passcode in a server-only subdoc so
      // it never appears in any client-visible league read.
      if (visibility === 'private') {
        await leagueRef.collection('private').doc('auth').set({
          passcode: passcode.trim().toUpperCase(),
          createdAt: FieldValue.serverTimestamp(),
        });
      }

      // Respond immediately, update user doc in background
      res.status(200).json({ leagueId });
      db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) }).catch(() => {});

    // ─── JOIN ─────────────────────────────────────────────
    } else if (action === 'join') {
      const { leagueId, passcode } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (league.members?.includes(userId)) return res.status(400).json({ error: 'Already a member' });

      if (league.visibility === 'private') {
        if (!passcode) return res.status(403).json({ error: 'This is a private league. A passcode is required to join.' });
        // Read the canonical passcode from the private subcollection.
        // Fall back to the legacy `league.passcode` field for leagues
        // that haven't been migrated yet (see admin migrateLeaguePasscodes).
        const privSnap = await leagueRef.collection('private').doc('auth').get();
        const truePasscode = privSnap.exists ? (privSnap.data().passcode || null) : league.passcode;
        if (!truePasscode || passcode.trim().toUpperCase() !== truePasscode) {
          return res.status(403).json({ error: 'Incorrect passcode' });
        }
      }

      // Parallel writes. If the league has houseRules, also stamp the
      // member's per-league acknowledgment timestamp so the
      // HouseRulesCard on the league page knows whether to default to
      // expanded (first view) or collapsed (subsequent views).
      const hasHouseRules = !!(league.houseRules && league.houseRules.content);
      const memberWrites = [
        leagueRef.update({ members: FieldValue.arrayUnion(userId), memberCount: FieldValue.increment(1) }),
        db.collection('users').doc(userId).update({ leagues: FieldValue.arrayUnion(leagueId) }),
      ];
      if (hasHouseRules) {
        // Per-(user,league) doc keyed by composite ID. Cheap and avoids
        // a per-user array of acknowledgments that would balloon.
        const ackId = `${userId}__${leagueId}`;
        memberWrites.push(
          db.collection('leagueMemberAcks').doc(ackId).set({
            userId,
            leagueId,
            houseRulesAcknowledgedAt: FieldValue.serverTimestamp(),
          }, { merge: true })
        );
      }
      await Promise.all(memberWrites);
      return res.status(200).json({ success: true });

    // ─── LOOKUP BY PASSCODE ───────────────────────────────
    // Passcodes for new private leagues live in the
    // /leagues/{id}/private/auth subcollection — clients can't read
    // it directly, so they can't search for a matching league
    // locally. This action takes a passcode, scans private leagues
    // server-side, and returns minimal public metadata (or 404) so
    // the client can call the `join` action by id.
    //
    // Legacy private leagues stored the passcode on the public doc
    // itself; we check that field first as a fast path before
    // batch-fetching the subcollection auth docs.
    } else if (action === 'lookupByPasscode') {
      const raw = req.body?.passcode;
      if (!raw || typeof raw !== 'string') return res.status(400).json({ error: 'Passcode required' });
      const passcode = raw.trim().toUpperCase();
      if (!passcode) return res.status(400).json({ error: 'Passcode required' });

      const privateLeaguesSnap = await db.collection('leagues').where('visibility', '==', 'private').get();
      if (privateLeaguesSnap.empty) {
        return res.status(404).json({ error: 'No league found with that passcode' });
      }

      // Legacy match: passcode still on the public doc (unmigrated leagues).
      const legacyDoc = privateLeaguesSnap.docs.find(d => d.data().passcode === passcode);
      const publicView = (doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name || null,
          predictionMode: d.predictionMode || 'classic',
          memberCount: d.memberCount || 0,
          houseRules: d.houseRules || null,
          visibility: 'private',
        };
      };
      if (legacyDoc) {
        return res.status(200).json({ league: publicView(legacyDoc) });
      }

      // Subcollection match: batch-fetch every private/auth doc in one round trip.
      const authRefs = privateLeaguesSnap.docs.map(d =>
        db.collection('leagues').doc(d.id).collection('private').doc('auth')
      );
      const authSnaps = await db.getAll(...authRefs);
      for (let i = 0; i < authSnaps.length; i++) {
        const snap = authSnaps[i];
        if (snap.exists && snap.data()?.passcode === passcode) {
          return res.status(200).json({ league: publicView(privateLeaguesSnap.docs[i]) });
        }
      }
      return res.status(404).json({ error: 'No league found with that passcode' });

    // ─── LEAVE ────────────────────────────────────────────
    } else if (action === 'leave') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (!league.members?.includes(userId)) return res.status(400).json({ error: 'Not a member' });
      if (league.createdBy === userId) return res.status(400).json({ error: 'League creator cannot leave. Delete the league instead.' });

      // Parallel writes, respond immediately
      await Promise.all([
        leagueRef.update({ members: FieldValue.arrayRemove(userId), memberCount: FieldValue.increment(-1) }),
        db.collection('users').doc(userId).update({ leagues: FieldValue.arrayRemove(leagueId) }),
      ]);

      // Delete predictions in background (non-blocking)
      res.status(200).json({ success: true });
      db.collection('predictions').where('userId', '==', userId).where('leagueId', '==', leagueId).get()
        .then(snap => { if (!snap.empty) { const batch = db.batch(); snap.docs.forEach(d => batch.delete(d.ref)); return batch.commit(); } })
        .catch(e => console.error('Prediction cleanup failed:', e.message));

    // ─── GET PASSCODE (member-only) ──────────────────────
    // After the subcollection refactor in PR #121, the actual passcode
    // for a private league lives at /leagues/{id}/private/auth and
    // isn't readable from the public doc. Members still need to see
    // the passcode so they can invite others — this action returns
    // it after verifying the caller is in the league's members list.
    // Falls back to the legacy passcode on the public doc for any
    // unmigrated leagues.
    } else if (action === 'getPasscode') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      if (league.visibility !== 'private') {
        return res.status(400).json({ error: 'League is not private' });
      }
      if (!league.members?.includes(userId)) {
        return res.status(403).json({ error: 'Not a member of this league' });
      }

      // Legacy fast path: passcode still on the public doc.
      if (league.passcode) {
        return res.status(200).json({ passcode: league.passcode });
      }

      // Current path: passcode in the private/auth subcollection.
      const authSnap = await leagueRef.collection('private').doc('auth').get();
      if (!authSnap.exists || !authSnap.data()?.passcode) {
        return res.status(404).json({ error: 'No passcode on file for this league' });
      }
      return res.status(200).json({ passcode: authSnap.data().passcode });

    // ─── DELETE ────────────────────────────────────────────
    } else if (action === 'delete') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });
      if (leagueId === 'global' || leagueId === 'global-simple') return res.status(400).json({ error: 'Cannot delete a global league' });

      const [userSnap, leagueSnap] = await Promise.all([
        db.collection('users').doc(userId).get(),
        db.collection('leagues').doc(leagueId).get(),
      ]);

      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      const userRole = userSnap.data()?.role;
      if (league.createdBy !== userId && userRole !== 'superadmin' && userRole !== 'admin') {
        return res.status(403).json({ error: 'Only the league creator or an admin can delete a league' });
      }

      // Delete the league doc immediately and respond
      await db.collection('leagues').doc(leagueId).delete();
      res.status(200).json({ success: true, deleted: leagueId });

      // Background cleanup: predictions + member user docs (non-blocking)
      const memberIds = league.members || [];
      const cleanupPromises = memberIds.map(mid =>
        db.collection('users').doc(mid).update({ leagues: FieldValue.arrayRemove(leagueId) }).catch(() => {})
      );
      db.collection('predictions').where('leagueId', '==', leagueId).get()
        .then(snap => {
          const docs = snap.docs;
          for (let i = 0; i < docs.length; i += 500) {
            const batch = db.batch();
            docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
            cleanupPromises.push(batch.commit());
          }
          return Promise.all(cleanupPromises);
        })
        .catch(e => console.error('Delete cleanup failed:', e.message));

    // ─── EDIT HOUSE RULES (creator only) ──────────────────
    } else if (action === 'editHouseRules') {
      const { leagueId, content } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const league = leagueSnap.data();
      if (league.createdBy !== userId) {
        return res.status(403).json({ error: 'Only the league creator can edit House Rules' });
      }
      if (league.visibility !== 'private') {
        return res.status(400).json({ error: 'House Rules are only allowed on private leagues.' });
      }

      // null / empty / whitespace clears the field; non-empty replaces it.
      const trimmed = typeof content === 'string' ? content.trim() : '';
      if (trimmed.length > 500) {
        return res.status(400).json({ error: 'House Rules must be 500 characters or fewer.' });
      }
      const houseRulesUpdate = trimmed
        ? { content: trimmed, lastUpdatedAt: FieldValue.serverTimestamp(), lastUpdatedBy: userId }
        : null;

      await leagueRef.update({ houseRules: houseRulesUpdate });

      // Reset all members' acknowledgments so the updated rules
      // re-default to expanded on next view (with an "updated" badge).
      // Cheap: only writes for users who had acknowledged the prior rules.
      if (trimmed) {
        const acks = await db.collection('leagueMemberAcks').where('leagueId', '==', leagueId).get();
        const batch = db.batch();
        acks.docs.forEach((d) => {
          batch.update(d.ref, { houseRulesAcknowledgedAt: null, houseRulesUpdatedSinceAck: true });
        });
        if (!acks.empty) await batch.commit();
      }
      return res.status(200).json({ success: true });

    // ─── ACKNOWLEDGE HOUSE RULES (any member) ────────────
    } else if (action === 'acknowledgeHouseRules') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      // Idempotent — first ack stays; subsequent calls just stamp the time
      // (cheap, no harm). We never overwrite the FIRST acknowledgment time
      // to preserve the join-time signal.
      const ackId = `${userId}__${leagueId}`;
      await db.collection('leagueMemberAcks').doc(ackId).set({
        userId,
        leagueId,
        houseRulesAcknowledgedAt: FieldValue.serverTimestamp(),
        houseRulesUpdatedSinceAck: false,
      }, { merge: true });
      return res.status(200).json({ success: true });

    // ─── REPORT CONTENT (any member) ──────────────────────
    } else if (action === 'reportContent') {
      // Generic UGC report. v1 only supports content_type 'league_house_rules'
      // but the shape is reusable for other UGC later.
      const { contentType, contentId, reason } = req.body;
      if (contentType !== 'league_house_rules') {
        return res.status(400).json({ error: 'Unsupported content type' });
      }
      if (!contentId) return res.status(400).json({ error: 'contentId required' });

      // Verify the league exists and the reporter is a member. Prevents
      // spam reports from non-members.
      const leagueSnap = await db.collection('leagues').doc(contentId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const members = leagueSnap.data().members || [];
      if (!members.includes(userId)) return res.status(403).json({ error: 'Only members can report' });

      const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 500) : null;
      await db.collection('contentReports').add({
        reporterUserId: userId,
        contentType,
        contentId,
        reason: trimmedReason || null,
        status: 'pending',
        createdAt: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true });

    // ─── CREATOR INVITE BY EMAIL (creator only) ───────────
    // Lets a private-league creator email a list of addresses asking
    // them to join. The email is framed as coming from the creator
    // (subject + body both name them) but is sent from GoalOracle's
    // domain via Resend — recipients can hit Unsubscribe to opt out of
    // all GoalOracle email. Hard caps: 25 per call, 50 per league per
    // day. Recipients who are already league members are silently
    // skipped (we don't want to spam them).
    } else if (action === 'creatorInvite') {
      const { leagueId, emails: rawEmails, personalNote: rawNote } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });
      if (!Array.isArray(rawEmails) || rawEmails.length === 0) {
        return res.status(400).json({ error: 'emails required (non-empty array)' });
      }
      if (rawEmails.length > 25) {
        return res.status(400).json({ error: 'Max 25 invites per send' });
      }

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const league = leagueSnap.data();
      if (league.createdBy !== userId) {
        return res.status(403).json({ error: 'Only the league creator can send invites' });
      }
      if (league.visibility !== 'private') {
        return res.status(400).json({ error: 'Creator invites are only available on private leagues' });
      }

      const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, 200) : null;

      // Rate limit: 50 invites per league per 24h. Counts every audit row
      // (sent + failed) to prevent retry-storms from blowing past the cap.
      const ONE_DAY_MS = 24 * 60 * 60 * 1000;
      const since = new Date(Date.now() - ONE_DAY_MS);
      const recentInvitesSnap = await db.collection('leagueInvitesSent')
        .where('leagueId', '==', leagueId)
        .where('sentAt', '>', since)
        .get();
      const recentCount = recentInvitesSnap.size;
      if (recentCount + rawEmails.length > 50) {
        return res.status(429).json({
          error: `Daily invite limit reached for this league (${recentCount}/50 already sent in the last 24h).`,
        });
      }

      // Fetch creator + the league passcode (subcollection or legacy field)
      // so the invite CTA can carry it for one-tap join after signup.
      const [creatorSnap, authSnap] = await Promise.all([
        db.collection('users').doc(userId).get(),
        leagueRef.collection('private').doc('auth').get(),
      ]);
      const creator = creatorSnap.exists ? { id: creatorSnap.id, ...creatorSnap.data() } : { id: userId };
      const passcode = authSnap.exists ? (authSnap.data()?.passcode || null) : (league.passcode || null);
      const leagueForEmail = { ...league, passcode };

      // Sanitize, dedupe, lowercase, validate.
      const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const cleaned = [...new Set(rawEmails.map(e => String(e || '').trim().toLowerCase()).filter(Boolean))];

      const { creatorInviteTemplate, sendCreatorEmail } = await import('./_lib/creatorEmail.js');
      const { sleep, BATCH_DELAY_MS } = await import('./_lib/outreachEmail.js');

      const results = { sent: 0, skipped: 0, failed: 0, errors: [] };

      for (const email of cleaned) {
        try {
          if (!EMAIL_RE.test(email)) {
            results.skipped++;
            results.errors.push({ email, error: 'invalid email' });
            continue;
          }

          // If this email already belongs to a GoalOracle user, skip if
          // they're already in the league (no point inviting) or if
          // they've opted out of email.
          const existing = await db.collection('users').where('email', '==', email).limit(1).get();
          let recipientUid = null;
          if (!existing.empty) {
            const matched = existing.docs[0];
            recipientUid = matched.id;
            if (league.members?.includes(recipientUid)) { results.skipped++; continue; }
            if (matched.data()?.emailOptOut === true) { results.skipped++; continue; }
          }

          const { subject, html, text } = creatorInviteTemplate({
            creator,
            league: leagueForEmail,
            personalNote: note,
            recipientEmail: email,
            recipientUnsubUserId: recipientUid,
          });
          const r = await sendCreatorEmail({
            to: email,
            replyTo: creator.email || null,
            subject, html, text,
            tags: [
              { name: 'kind', value: 'creator-invite' },
              { name: 'leagueId', value: leagueId },
              { name: 'creatorId', value: userId },
            ],
          });

          await db.collection('leagueInvitesSent').add({
            leagueId,
            creatorId: userId,
            recipientEmail: email,
            recipientUserId: recipientUid || null,
            sentAt: FieldValue.serverTimestamp(),
            sent: !!r.sent,
            error: r.error || null,
          });

          if (r.sent) results.sent++;
          else { results.failed++; results.errors.push({ email, error: r.error || 'unknown' }); }

          await sleep(BATCH_DELAY_MS);
        } catch (e) {
          results.failed++;
          results.errors.push({ email, error: e?.message || 'crash' });
        }
      }

      return res.status(200).json(results);

    // ─── CREATOR NUDGE: LIST ELIGIBLE MEMBERS (creator only) ──
    // Returns the league's members (minus the creator themselves) with
    // displayName + email + opt-out status, plus the next time the
    // creator can send a nudge. Used to populate the "Send a Nudge"
    // modal on the league detail page.
    } else if (action === 'creatorListNudgeEligible') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const league = leagueSnap.data();
      if (league.createdBy !== userId) {
        return res.status(403).json({ error: 'Only the league creator can list members for nudges' });
      }

      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const since = new Date(Date.now() - SEVEN_DAYS_MS);
      const recentNudges = await db.collection('leagueCreatorNudges')
        .where('leagueId', '==', leagueId)
        .where('sentAt', '>', since)
        .orderBy('sentAt', 'desc')
        .limit(1)
        .get();
      let nextNudgeAvailableAt = null;
      let lastNudgeAt = null;
      if (!recentNudges.empty) {
        const lastTs = recentNudges.docs[0].data().sentAt;
        lastNudgeAt = lastTs?.toMillis ? lastTs.toMillis() : null;
        if (lastNudgeAt) {
          nextNudgeAvailableAt = new Date(lastNudgeAt + SEVEN_DAYS_MS).toISOString();
        }
      }

      const memberIds = (league.members || []).filter((id) => id !== userId);
      if (memberIds.length === 0) {
        return res.status(200).json({ members: [], nextNudgeAvailableAt, lastNudgeAt, predictionMode: league.predictionMode });
      }

      const memberRefs = memberIds.map((uid) => db.collection('users').doc(uid));
      const memberSnaps = await db.getAll(...memberRefs);
      const baseMembers = memberSnaps
        .filter((snap) => snap.exists)
        .map((snap) => {
          const d = snap.data();
          return {
            userId: snap.id,
            displayName: d.displayName || d.username || null,
            email: d.email || null,
            emailOptOut: d.emailOptOut === true,
          };
        })
        .filter((m) => m.email && !m.emailOptOut);

      // Phase enrichment — fetch per-member prediction state so the
      // client can filter by "missing group picks", "missing knockout",
      // etc. Different shape per league mode.
      const mode = league.predictionMode === 'classic' ? 'classic' : 'simple';
      let members = baseMembers;

      if (mode === 'simple') {
        // /simplePredictions/{userId}__{leagueId} is the canonical
        // composite-key shape (see simplePredDocId in src/utils/db.js).
        // Batch-fetch all in one round trip.
        const predRefs = baseMembers.map((m) =>
          db.collection('simplePredictions').doc(`${m.userId}__${leagueId}`)
        );
        const predSnaps = predRefs.length > 0 ? await db.getAll(...predRefs) : [];
        members = baseMembers.map((m, i) => {
          const snap = predSnaps[i];
          const pred = snap?.exists ? snap.data() : null;
          const groupPredictions = pred?.groupPredictions || {};
          // A group counts as "done" when all four positions are filled
          // — same rule the client uses (touchedCount in useGroupPredictions).
          const groupsDone = Object.values(groupPredictions)
            .filter((g) => Array.isArray(g?.ranking) && g.ranking.filter(Boolean).length === 4)
            .length;
          const bestThirds = Array.isArray(pred?.bestThirdPicks) ? pred.bestThirdPicks.length : 0;
          const ko = pred?.knockoutPredictions || {};
          const koCount = Object.values(ko)
            .filter(Array.isArray)
            .reduce((sum, arr) => sum + arr.length, 0);
          const TOTAL_GROUPS = 12;
          const TOTAL_THIRDS = 8;
          // 16 R32 + 8 R16 + 4 QF + 2 SF + 1 3rd + 1 Final = 32 knockout picks
          const TOTAL_KO = 32;
          let phase = 'done';
          if (groupsDone === 0 && bestThirds === 0 && koCount === 0) phase = 'not-started';
          else if (groupsDone < TOTAL_GROUPS) phase = 'groups';
          else if (bestThirds < TOTAL_THIRDS) phase = 'best-thirds';
          else if (koCount < TOTAL_KO) phase = 'knockout';
          return {
            ...m,
            phase,
            progress: {
              groupsDone, groupsTotal: TOTAL_GROUPS,
              bestThirdsDone: bestThirds, bestThirdsTotal: TOTAL_THIRDS,
              knockoutDone: koCount, knockoutTotal: TOTAL_KO,
            },
          };
        });
      } else {
        // Classic mode — count /predictions docs per (user, league).
        // Firestore allows `in` queries up to 30 values; chunk through
        // memberIds in case the league is large. Most private leagues
        // are well under this so a single round trip is typical.
        const CHUNK = 30;
        const TOTAL_CLASSIC = 104;
        const countByUid = new Map(baseMembers.map((m) => [m.userId, 0]));
        for (let i = 0; i < baseMembers.length; i += CHUNK) {
          const chunk = baseMembers.slice(i, i + CHUNK).map((m) => m.userId);
          const snap = await db.collection('predictions')
            .where('leagueId', '==', leagueId)
            .where('userId', 'in', chunk)
            .get();
          snap.docs.forEach((d) => {
            const uid = d.data()?.userId;
            if (uid && countByUid.has(uid)) {
              countByUid.set(uid, countByUid.get(uid) + 1);
            }
          });
        }
        members = baseMembers.map((m) => {
          const done = countByUid.get(m.userId) || 0;
          let phase;
          if (done === 0) phase = 'not-started';
          else if (done < TOTAL_CLASSIC) phase = 'in-progress';
          else phase = 'done';
          return {
            ...m,
            phase,
            progress: { classicDone: done, classicTotal: TOTAL_CLASSIC },
          };
        });
      }

      return res.status(200).json({
        members,
        nextNudgeAvailableAt,
        lastNudgeAt,
        predictionMode: mode,
      });

    // ─── CREATOR NUDGE: SEND (creator only) ───────────────
    // Sends the creatorNudge template to the supplied member userIds.
    // Hard rate-limited to ONCE per league per 7 days regardless of how
    // many or few members were targeted — keeps creator-to-member email
    // from drifting into spam territory. The audit row is written even
    // if zero sends succeeded so a retry storm can't bypass the limit.
    } else if (action === 'creatorNudge') {
      const { leagueId, userIds: rawTargets, personalNote: rawNote } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'League ID required' });
      if (!Array.isArray(rawTargets) || rawTargets.length === 0) {
        return res.status(400).json({ error: 'userIds required (non-empty array)' });
      }
      if (rawTargets.length > 200) {
        return res.status(400).json({ error: 'Too many recipients (max 200)' });
      }

      const leagueRef = db.collection('leagues').doc(leagueId);
      const leagueSnap = await leagueRef.get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const league = leagueSnap.data();
      if (league.createdBy !== userId) {
        return res.status(403).json({ error: 'Only the league creator can send nudges' });
      }

      const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
      const since = new Date(Date.now() - SEVEN_DAYS_MS);
      const recentNudges = await db.collection('leagueCreatorNudges')
        .where('leagueId', '==', leagueId)
        .where('sentAt', '>', since)
        .orderBy('sentAt', 'desc')
        .limit(1)
        .get();
      if (!recentNudges.empty) {
        const lastTs = recentNudges.docs[0].data().sentAt;
        const lastMs = lastTs?.toMillis ? lastTs.toMillis() : Date.now();
        return res.status(429).json({
          error: 'Nudges are limited to once per league every 7 days.',
          nextNudgeAvailableAt: new Date(lastMs + SEVEN_DAYS_MS).toISOString(),
        });
      }

      const note = typeof rawNote === 'string' ? rawNote.trim().slice(0, 200) : null;

      const memberSet = new Set(league.members || []);
      const validTargets = [...new Set(rawTargets)].filter((uid) => memberSet.has(uid) && uid !== userId);
      if (validTargets.length === 0) {
        return res.status(400).json({ error: 'No valid league members in the recipient list' });
      }

      const creatorSnap = await db.collection('users').doc(userId).get();
      const creator = creatorSnap.exists ? { id: creatorSnap.id, ...creatorSnap.data() } : { id: userId };

      const { creatorNudgeTemplate, sendCreatorEmail } = await import('./_lib/creatorEmail.js');
      const { sleep, BATCH_DELAY_MS } = await import('./_lib/outreachEmail.js');

      const results = { sent: 0, skipped: 0, failed: 0, errors: [] };
      const sentToUserIds = [];

      for (const uid of validTargets) {
        try {
          const memberSnap = await db.collection('users').doc(uid).get();
          if (!memberSnap.exists) { results.skipped++; continue; }
          const member = { id: memberSnap.id, ...memberSnap.data() };
          if (!member.email || member.emailOptOut === true) { results.skipped++; continue; }

          const { subject, html, text } = creatorNudgeTemplate({
            creator,
            league,
            member,
            personalNote: note,
          });
          const r = await sendCreatorEmail({
            to: member.email,
            replyTo: creator.email || null,
            subject, html, text,
            tags: [
              { name: 'kind', value: 'creator-nudge' },
              { name: 'leagueId', value: leagueId },
              { name: 'creatorId', value: userId },
              { name: 'userId', value: uid },
            ],
          });

          if (r.sent) { results.sent++; sentToUserIds.push(uid); }
          else { results.failed++; results.errors.push({ uid, error: r.error || 'unknown' }); }

          await sleep(BATCH_DELAY_MS);
        } catch (e) {
          results.failed++;
          results.errors.push({ uid, error: e?.message || 'crash' });
        }
      }

      // Always write the audit row — even on total failure — so the
      // 7-day rate limit kicks in and a retry loop can't keep emailing.
      await db.collection('leagueCreatorNudges').add({
        leagueId,
        creatorId: userId,
        targetCount: validTargets.length,
        sentCount: results.sent,
        skippedCount: results.skipped,
        failedCount: results.failed,
        personalNote: note,
        sentAt: FieldValue.serverTimestamp(),
        recipientUserIds: sentToUserIds,
      });

      return res.status(200).json({
        ...results,
        nextNudgeAvailableAt: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
      });

    } else {
      return res.status(400).json({ error: 'Invalid action. Use: create, join, lookupByPasscode, leave, getPasscode, delete, editHouseRules, acknowledgeHouseRules, reportContent, creatorInvite, creatorListNudgeEligible, or creatorNudge' });
    }
  } catch (e) {
    console.error('League error:', e);
    if (!res.headersSent) return res.status(500).json({ error: e.message });
  }
}
