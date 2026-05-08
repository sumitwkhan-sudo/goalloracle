/**
 * One-time migration: hydrate users.email from a Privy export.
 *
 * Some legacy users signed up via wallet-only or Twitter and have no email
 * recorded in /users. Without an email they can't sign in to the new
 * email-OTP flow. This script reads a CSV export from Privy mapping
 * did:privy:* IDs to verified email addresses, and writes the email back
 * onto the matching user doc when missing.
 *
 * CSV format (header required):
 *   id,email
 *   did:privy:abc123,player@example.com
 *
 * Usage:
 *   node scripts/importPrivyEmails.js path/to/privy-export.csv [--dry-run] [--overwrite]
 *
 * Behavior:
 *   - Default: only fills in email for users with no email on file.
 *   - --overwrite: always overwrite (use with caution; only if the Privy
 *     export is more authoritative than what the app has captured).
 *
 * Requires env vars: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 */

import admin from 'firebase-admin';
import fs from 'fs';

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
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const overwrite = args.includes('--overwrite');
const csvPath = args.find(a => !a.startsWith('--'));

if (!csvPath) {
  console.error('Usage: node scripts/importPrivyEmails.js path/to/privy-export.csv [--dry-run] [--overwrite]');
  process.exit(1);
}

function parseCsv(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const header = lines.shift().split(',').map(s => s.trim().toLowerCase());
  const idIdx = header.indexOf('id');
  const emailIdx = header.indexOf('email');
  if (idIdx < 0 || emailIdx < 0) throw new Error('CSV must have id,email columns');
  return lines.map(line => {
    const cols = line.split(',');
    return { id: (cols[idIdx] || '').trim(), email: (cols[emailIdx] || '').trim().toLowerCase() };
  }).filter(r => r.id && r.email);
}

async function main() {
  console.log(`[import-privy-emails] reading ${csvPath}${dryRun ? ' (DRY RUN)' : ''}${overwrite ? ' (OVERWRITE)' : ''}`);
  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8'));
  console.log(`[import-privy-emails] ${rows.length} (id, email) pairs in CSV`);

  let updated = 0, skippedExisting = 0, missingDoc = 0;
  for (const { id, email } of rows) {
    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    if (!snap.exists) { missingDoc++; continue; }
    const cur = snap.data();
    if (cur.email && !overwrite) { skippedExisting++; continue; }
    if (cur.email === email) { skippedExisting++; continue; }
    if (dryRun) {
      console.log(`  would update ${id}: ${cur.email || '(empty)'} -> ${email}`);
    } else {
      await ref.update({ email });
    }
    updated++;
  }

  console.log(`[import-privy-emails] updated=${updated} skipped(existing)=${skippedExisting} missingDoc=${missingDoc}`);
}

main().catch(e => { console.error(e); process.exit(1); });
