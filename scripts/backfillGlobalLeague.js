/**
 * One-time migration: backfill /leagues/global-simple/members/{userId}
 *
 * Reads every user doc, checks if a member doc already exists, and creates
 * one if missing. Safe to run multiple times — existing docs are skipped.
 *
 * Usage:
 *   node scripts/backfillGlobalLeague.js
 *
 * Requires env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 * (reads from .env if present via dotenv, or set them in your shell)
 */

import admin from 'firebase-admin';

// Attempt dotenv for local runs — fine if it's not installed
try { await import('dotenv/config'); } catch {}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  });
}

const db = admin.firestore();
const LEAGUE_ID = 'global-simple';
const membersCol = db.collection('leagues').doc(LEAGUE_ID).collection('members');

async function run() {
  const usersSnap = await db.collection('users').get();
  const total = usersSnap.size;
  let added = 0;
  let idx = 0;

  for (const userDoc of usersSnap.docs) {
    idx++;
    const userId = userDoc.id;
    const userData = userDoc.data();
    console.log(`Processing user ${idx} of ${total} — ${userId}`);

    const memberRef = membersCol.doc(userId);
    const memberSnap = await memberRef.get();

    if (memberSnap.exists) {
      continue;
    }

    await memberRef.set({
      userId,
      displayName: userData.displayName || 'Anonymous',
      joinedAt: userData.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      totalAccuracy: 0,
      submittedAt: null,
      hasSubmitted: false,
    });
    added++;
  }

  // Update memberCount on the league doc to reflect reality
  const finalSnap = await membersCol.get();
  await db.collection('leagues').doc(LEAGUE_ID).update({
    memberCount: finalSnap.size,
  });

  console.log(`Complete. Added ${added} new members to ${LEAGUE_ID}.`);
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
