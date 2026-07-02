/**
 * deleteUserAccount — the single permanent-account-deletion routine, shared by
 * the superadmin console (api/admin.js `deleteUser`) and the self-serve
 * "Delete my account" flow (DELETE /api/user). Callers do their own
 * authorization; this just performs the wipe and reports counts.
 *
 * Removes:
 *  - /users/{id}
 *  - /predictions where userId == id (classic mode)
 *  - /simplePredictions where userId == id (Quick Picks, every league),
 *    the legacy /simplePredictions/{id} doc, and its /scores subcollection
 *  - membership in every league: members array + memberCount, and the
 *    /leagues/{id}/members/{userId} subcollection doc (leaderboard reads it)
 *  - /leagueMemberAcks and /outreachSent rows for the user (PII-bearing)
 *  - their entry in deviceFingerprints + signupIps (frees the sybil slot)
 *  - their Firebase Auth account (so the same login can't silently
 *    re-attach to a stale doc)
 *
 * Leagues the user CREATED are intentionally left intact — other members
 * keep playing; only the creator's own membership is removed.
 */

import { FieldValue } from 'firebase-admin/firestore';

export async function deleteUserAccount(db, admin, targetUserId) {
  const cleanupOps = [];

  // Predictions (classic).
  const classicSnap = await db.collection('predictions').where('userId', '==', targetUserId).get();
  for (let i = 0; i < classicSnap.docs.length; i += 500) {
    const b = db.batch();
    classicSnap.docs.slice(i, i + 500).forEach(d => b.delete(d.ref));
    cleanupOps.push(b.commit());
  }

  // Simple predictions (Quick Picks) — composite docs keyed userId__leagueId,
  // plus the legacy single-doc path and its scores subcollection.
  const simpleSnap = await db.collection('simplePredictions').where('userId', '==', targetUserId).get();
  for (let i = 0; i < simpleSnap.docs.length; i += 500) {
    const b = db.batch();
    simpleSnap.docs.slice(i, i + 500).forEach(d => b.delete(d.ref));
    cleanupOps.push(b.commit());
  }
  const legacyRef = db.collection('simplePredictions').doc(targetUserId);
  cleanupOps.push(
    legacyRef.collection('scores').listDocuments()
      .then((refs) => Promise.all(refs.map((r) => r.delete())))
      .catch(() => {}),
  );
  cleanupOps.push(legacyRef.delete().catch(() => {}));

  // League memberships: members array + memberCount + members subcollection
  // doc (the global-simple leaderboard ranking reads the subcollection).
  const leaguesSnap = await db.collection('leagues').where('members', 'array-contains', targetUserId).get();
  for (let i = 0; i < leaguesSnap.docs.length; i += 250) {
    const b = db.batch();
    leaguesSnap.docs.slice(i, i + 250).forEach((d) => {
      b.update(d.ref, {
        members: FieldValue.arrayRemove(targetUserId),
        memberCount: FieldValue.increment(-1),
      });
      b.delete(d.ref.collection('members').doc(targetUserId));
    });
    cleanupOps.push(b.commit());
  }

  // PII-bearing per-user rows: house-rules acknowledgments + email send log.
  // Best-effort — absence of either collection/field must not fail the delete.
  cleanupOps.push(
    db.collection('leagueMemberAcks').where('userId', '==', targetUserId).get()
      .then((s) => Promise.all(s.docs.map((d) => d.ref.delete())))
      .catch(() => {}),
  );
  cleanupOps.push(
    db.collection('outreachSent').where('userId', '==', targetUserId).get()
      .then((s) => Promise.all(s.docs.map((d) => d.ref.delete())))
      .catch(() => {}),
  );

  // Anti-Sybil records (so the freed device/IP slot can be reused).
  const fpSnap = await db.collection('deviceFingerprints').where('userIds', 'array-contains', targetUserId).get();
  const ipSnap = await db.collection('signupIps').where('userIds', 'array-contains', targetUserId).get();
  const sybilBatch = db.batch();
  fpSnap.docs.forEach(d => sybilBatch.update(d.ref, { userIds: FieldValue.arrayRemove(targetUserId) }));
  ipSnap.docs.forEach(d => sybilBatch.update(d.ref, { userIds: FieldValue.arrayRemove(targetUserId) }));
  cleanupOps.push(sybilBatch.commit().catch(() => {}));

  // Wait for cleanup before deleting the user doc — avoids leaving dangling
  // memberships if the user-doc delete races ahead.
  await Promise.all(cleanupOps);

  await db.collection('users').doc(targetUserId).delete();

  // Firebase Auth account — best-effort. Custom-token UIDs (auth_*) may not
  // have a Firebase Auth record; 'user-not-found' is fine.
  try {
    await admin.auth().deleteUser(targetUserId);
  } catch (e) {
    if (e?.code !== 'auth/user-not-found') {
      console.warn('[deleteUserAccount] Firebase Auth delete failed:', e?.message);
    }
  }

  return {
    predictions: classicSnap.size,
    simplePredictions: simpleSnap.size,
    leagueMemberships: leaguesSnap.size,
    fingerprints: fpSnap.size,
    ips: ipSnap.size,
  };
}
