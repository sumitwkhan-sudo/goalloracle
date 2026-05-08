/**
 * One-time migration: clear walletAddress on every user doc.
 *
 * Run AFTER cutting over from Privy to email-OTP/Google auth. The existing
 * walletAddress values point to Privy embedded wallets that are no longer
 * accessible (Privy custodied the keys), so showing balances or paying out
 * to them would be wrong. Sweepstakes payouts use admin-assigned external
 * EVM addresses going forward (set via the Admin → Users tab).
 *
 * Usage:
 *   node scripts/clearPrivyWallets.js [--dry-run]
 *
 * Requires env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

import admin from 'firebase-admin';

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
const dryRun = process.argv.includes('--dry-run');

async function main() {
  console.log(`[clear-privy-wallets] starting${dryRun ? ' (DRY RUN)' : ''}`);
  const snap = await db.collection('users').get();
  const docs = snap.docs.filter(d => d.data().walletAddress);
  console.log(`[clear-privy-wallets] ${docs.length} users have a walletAddress`);

  if (dryRun) {
    docs.slice(0, 20).forEach(d => {
      const u = d.data();
      console.log(`  ${d.id}  email=${u.email || '-'}  wallet=${u.walletAddress}`);
    });
    if (docs.length > 20) console.log(`  ... +${docs.length - 20} more`);
    console.log('[clear-privy-wallets] dry run — nothing written');
    return;
  }

  let updated = 0;
  for (let i = 0; i < docs.length; i += 400) {
    const batch = db.batch();
    docs.slice(i, i + 400).forEach(d => batch.update(d.ref, { walletAddress: null }));
    await batch.commit();
    updated += Math.min(400, docs.length - i);
    console.log(`[clear-privy-wallets] cleared ${updated}/${docs.length}`);
  }
  console.log(`[clear-privy-wallets] done — cleared ${updated} wallet(s)`);
}

main().catch(e => { console.error(e); process.exit(1); });
