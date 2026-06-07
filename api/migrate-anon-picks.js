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

const SEP = '__';

function hasPicks(d) {
  if (!d) return false;
  const g = d.groupPredictions || {};
  if (Object.values(g).some(v => Array.isArray(v?.ranking) && v.ranking.filter(Boolean).length > 0)) return true;
  if (Array.isArray(d.bestThirdPicks) && d.bestThirdPicks.length > 0) return true;
  const ko = d.knockoutPredictions || {};
  if (Object.values(ko).some(a => Array.isArray(a) && a.length > 0)) return true;
  return false;
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
  if (anonUid === newUid) return res.status(200).json({ migrated: false, reason: 'same_uid' });

  try {
    const srcRef = db.collection('simplePredictions').doc(`${anonUid}${SEP}global-simple`);
    const tgtRef = db.collection('simplePredictions').doc(`${newUid}${SEP}global-simple`);
    const [srcSnap, tgtSnap] = await Promise.all([srcRef.get(), tgtRef.get()]);

    if (!srcSnap.exists || !hasPicks(srcSnap.data())) {
      return res.status(200).json({ migrated: false, reason: 'no_anon_picks' });
    }
    const tgt = tgtSnap.exists ? tgtSnap.data() : null;
    // Never clobber picks the new account already made.
    if (tgt && (hasPicks(tgt) || tgt.submittedAt)) {
      return res.status(200).json({ migrated: false, reason: 'target_has_picks' });
    }

    const src = srcSnap.data();
    await tgtRef.set({
      userId: newUid,
      leagueId: 'global-simple',
      groupPredictions: src.groupPredictions || {},
      bestThirdPicks: src.bestThirdPicks || [],
      knockoutPredictions: src.knockoutPredictions || {},
      // isComplete derived from the bracket (Final winner), mirroring the
      // server-authoritative rule everywhere else.
      isComplete: !!(src.isComplete || src.knockoutPredictions?.final?.[0]?.winnerId),
      updatedAt: FieldValue.serverTimestamp(),
      submittedAt: FieldValue.serverTimestamp(),
    }, { merge: true });

    // Clean up the orphaned anonymous doc so it never lingers.
    await srcRef.delete().catch(() => {});

    return res.status(200).json({ migrated: true });
  } catch (e) {
    console.error('[migrate-anon-picks] error:', e?.message);
    return res.status(500).json({ error: e.message });
  }
}
