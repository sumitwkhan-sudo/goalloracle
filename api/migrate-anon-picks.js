/**
 * /api/migrate-anon-picks — preserve a no-login visitor's Global bracket at
 * sign-up (roadmap item C, phase iv).
 *
 * The existing sign-in mints a NEW Firebase UID (Privy/GIS custom token) and
 * replaces the anonymous session — it is NOT linkWithCredential, so the
 * anonymous UID's picks would otherwise be orphaned. This endpoint migrates
 * the anonymous UID's Global Quick Picks doc to the new real UID.
 *
 * Security: the caller must (a) be authenticated as a REAL (non-anonymous)
 * account [Authorization bearer = new UID], and (b) PROVE they controlled the
 * anonymous session by sending its still-valid ID token (verified to be
 * sign_in_provider === 'anonymous'). So a real user can only claim an
 * anonymous bracket they actually created — not an arbitrary one. We also
 * never overwrite picks the new account already has.
 */

import { db, admin, applyCors, verifyAuth } from './_lib/firebase.js';
import { FieldValue } from 'firebase-admin/firestore';
import { migrationDecision, anonDocId } from './_lib/anonMigration.js';
import { dayId } from './_lib/funnelHealth.js';

// Increment today's funnel-health counter for this migration outcome so the
// admin "Funnel Health" control can monitor the conversion path without
// trawling Vercel logs. Best-effort — never blocks/fails the migration.
async function recordMigration(outcome) {
  try {
    const id = dayId();
    await db.collection('funnelHealth').doc(id).set({
      date: id,
      migration: { [outcome]: FieldValue.increment(1) },
      updatedAt: FieldValue.serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.warn('[migrate-anon-picks] health write failed:', e?.message);
  }
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });
  if (claims.provider === 'anonymous') {
    return res.status(403).json({ error: 'Target must be a real (signed-up) account' });
  }
  const newUid = claims.userId;

  const { anonIdToken } = req.body || {};
  if (!anonIdToken) return res.status(400).json({ error: 'anonIdToken required' });

  // Prove the caller controlled the anonymous session.
  let anonUid;
  try {
    const decoded = await admin.auth().verifyIdToken(anonIdToken);
    if (decoded.firebase?.sign_in_provider !== 'anonymous') {
      return res.status(403).json({ error: 'Provided token is not an anonymous session' });
    }
    anonUid = decoded.uid;
  } catch (e) {
    return res.status(403).json({ error: 'Invalid anonymous token' });
  }
  try {
    const srcRef = db.collection('simplePredictions').doc(anonDocId(anonUid));
    const tgtRef = db.collection('simplePredictions').doc(anonDocId(newUid));
    const [srcSnap, tgtSnap] = await Promise.all([srcRef.get(), tgtRef.get()]);

    const src = srcSnap.exists ? srcSnap.data() : null;
    const tgt = tgtSnap.exists ? tgtSnap.data() : null;
    const decision = migrationDecision({ anonUid, newUid, srcData: src, tgtData: tgt });
    if (!decision.migrate) {
      await recordMigration(decision.reason);
      return res.status(200).json({ migrated: false, reason: decision.reason });
    }

    await tgtRef.set({
      userId: newUid,
      leagueId: 'global-simple',
      groupPredictions: src.groupPredictions || {},
      bestThirdPicks: src.bestThirdPicks || [],
      knockoutPredictions: src.knockoutPredictions || {},
      // isComplete derived from the bracket (Final winner), mirroring the
      // server-authoritative rule everywhere else.
      isComplete: decision.isComplete,
      updatedAt: FieldValue.serverTimestamp(),
      // Preserve the original first-submit time — submittedAt is the
      // leaderboard tiebreaker, so a converted user keeps the moment they
      // actually locked their bracket, not the moment they signed up. The
      // anon doc gets a submittedAt on its first autosave, so this is set.
      submittedAt: src.submittedAt || FieldValue.serverTimestamp(),
    }, { merge: true });

    // Clean up the orphaned anonymous doc so it never lingers.
    await srcRef.delete().catch(() => {});

    await recordMigration('migrated');
    return res.status(200).json({ migrated: true });
  } catch (e) {
    console.error('[migrate-anon-picks] error:', e?.message);
    await recordMigration('error');
    return res.status(500).json({ error: e.message });
  }
}
