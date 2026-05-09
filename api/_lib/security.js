// Shared security utilities for the auth + feedback + signup endpoints.
//
// Exposes:
//   normalizeEmail(email)        — canonical form for dedupe (Gmail dots/+, etc.)
//   isDisposableEmailDomain(d)   — known throwaway-mail blocklist
//   getClientIp(req)             — best-effort IP extraction behind Vercel
//   ipHash(ip)                   — sha256 hash, used as Firestore doc id
//   hasIpExceededSignupLimit     — sliding-window IP signup quota check
//   recordSignupAttempt          — increment the counter
//   isIpBanned                   — admin block list
//   findUserByDedupeKey          — replacement for findUserByEmail that respects normalisation
//   countAccountsForFingerprint  — Sybil deterrent
//   recordFingerprintForUser     — index device → users
//   escapeHtml(str)              — for safely interpolating user input into emails
//   validateDisplayNameServer    — server-side username validation incl. reserved names

import crypto from 'crypto';
import { FieldValue } from 'firebase-admin/firestore';

// Emails whose alias variants (`+suffix`, dots in the local part) should be
// treated as DISTINCT accounts. Anything not on this list collapses to its
// canonical form so one Gmail mailbox can't easily back N accounts.
const ALIAS_WHITELIST = new Set([
  'sumitwkhan@gmail.com',
]);

const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'mailinator.net', 'mailinator2.com',
  '10minutemail.com', '10minutemail.net',
  'guerrillamail.com', 'guerrillamail.net', 'guerrillamail.org', 'guerrillamail.biz', 'guerrillamailblock.com', 'sharklasers.com',
  'temp-mail.org', 'tempmail.com', 'tempmail.net', 'tempmail.io',
  'throwawaymail.com', 'throwaway.email',
  'yopmail.com', 'yopmail.net', 'yopmail.fr',
  'getnada.com', 'nada.email', 'getairmail.com',
  'maildrop.cc', 'mailnesia.com', 'mintemail.com',
  'fakeinbox.com', 'fakemailgenerator.com',
  'trashmail.com', 'trashmail.net', 'trashmail.io',
  'dispostable.com', 'spamgourmet.com',
  'mohmal.com', 'tempmailo.com', 'emailondeck.com',
  'inboxbear.com', 'mytemp.email', 'tmail.io',
  'discard.email', 'discardmail.com', 'spam4.me',
  'mfsa.ru', 'mvrht.com', 'tempinbox.com',
  'tempr.email', 'mailtemp.info', 'temporarymail.com',
]);

const RESERVED_DISPLAY_NAMES = new Set([
  'admin', 'administrator', 'root', 'system', 'official',
  'goaloracle', 'goal-oracle', 'goal_oracle',
  'moderator', 'mod', 'staff', 'support', 'help',
  'superadmin', 'super-admin', 'super_admin',
  'fifa', 'fifa-official', 'anonymous',
]);

// ────────────────────────── EMAIL NORMALISATION ──────────────────────────

export function normalizeEmail(email) {
  if (typeof email !== 'string') return '';
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf('@');
  if (at < 0) return lower;
  const local = lower.slice(0, at);
  let domain = lower.slice(at + 1);

  // Treat googlemail.com as gmail.com.
  if (domain === 'googlemail.com') domain = 'gmail.com';

  // Compute canonical local part: strip +suffix everywhere, strip dots for Gmail.
  let canonicalLocal = local.split('+')[0];
  if (domain === 'gmail.com') canonicalLocal = canonicalLocal.replace(/\./g, '');
  const canonical = `${canonicalLocal}@${domain}`;

  // Whitelist exception — preserve aliases as distinct accounts.
  if (ALIAS_WHITELIST.has(canonical)) return lower;
  return canonical;
}

export function isDisposableEmailDomain(email) {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at < 0) return false;
  return DISPOSABLE_DOMAINS.has(email.slice(at + 1).toLowerCase());
}

// ────────────────────────── IP HANDLING ──────────────────────────

export function getClientIp(req) {
  // Vercel sets x-forwarded-for; first entry is the real client.
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) {
    return fwd.split(',')[0].trim();
  }
  if (Array.isArray(fwd) && fwd.length > 0) {
    return String(fwd[0]).split(',')[0].trim();
  }
  return req.headers['x-real-ip'] || req.socket?.remoteAddress || '';
}

export function ipHash(ip) {
  return crypto.createHash('sha256').update(String(ip || '')).digest('hex');
}

// ────────────────────────── BANNED IP CHECK ──────────────────────────

export async function isIpBanned(db, ip) {
  if (!ip) return false;
  const snap = await db.collection('bannedIps').doc(ipHash(ip)).get();
  return snap.exists;
}

// ────────────────────────── SIGNUP RATE LIMIT ──────────────────────────

const SIGNUP_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 h
const MAX_NEW_USERS_PER_IP = 3;

export async function checkAndRecordSignupForIp(db, ip) {
  if (!ip) return { allowed: true, count: 0 };
  const ref = db.collection('signupAttempts').doc(ipHash(ip));
  const now = Date.now();
  const snap = await ref.get();
  const history = snap.exists ? (snap.data().history || []) : [];
  const recent = history.filter(t => now - t < SIGNUP_WINDOW_MS);
  if (recent.length >= MAX_NEW_USERS_PER_IP) {
    return { allowed: false, count: recent.length };
  }
  await ref.set({
    history: [...recent, now],
    lastIp: ip,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { allowed: true, count: recent.length + 1 };
}

// Looser per-IP cap on code requests (separate from new-user signup cap).
const CODE_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const MAX_CODE_REQUESTS_PER_IP = 20;

export async function checkAndRecordCodeRequestForIp(db, ip) {
  if (!ip) return { allowed: true, count: 0 };
  const ref = db.collection('signupAttempts').doc(ipHash(ip));
  const now = Date.now();
  const snap = await ref.get();
  const history = snap.exists ? (snap.data().codeHistory || []) : [];
  const recent = history.filter(t => now - t < CODE_REQUEST_WINDOW_MS);
  if (recent.length >= MAX_CODE_REQUESTS_PER_IP) {
    return { allowed: false, count: recent.length };
  }
  await ref.set({
    codeHistory: [...recent, now],
    lastIp: ip,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
  return { allowed: true, count: recent.length + 1 };
}

// ────────────────────────── DEVICE FINGERPRINT ──────────────────────────

const MAX_ACCOUNTS_PER_FINGERPRINT = 2;

export function isValidVisitorId(v) {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(v);
}

export async function checkFingerprintAllowsNewAccount(db, visitorId) {
  if (!isValidVisitorId(visitorId)) return { allowed: true, count: 0, reason: 'no-fingerprint' };
  const ref = db.collection('deviceFingerprints').doc(visitorId);
  const snap = await ref.get();
  if (!snap.exists) return { allowed: true, count: 0 };
  const userIds = snap.data().userIds || [];
  if (userIds.length >= MAX_ACCOUNTS_PER_FINGERPRINT) {
    return { allowed: false, count: userIds.length, userIds };
  }
  return { allowed: true, count: userIds.length };
}

export async function recordFingerprintForUser(db, visitorId, userId, ip) {
  if (!isValidVisitorId(visitorId) || !userId) return;
  const ref = db.collection('deviceFingerprints').doc(visitorId);
  await ref.set({
    visitorId,
    userIds: FieldValue.arrayUnion(userId),
    lastIp: ip || null,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ────────────────────────── EMAIL DEDUPE LOOKUP ──────────────────────────

// Find an existing user doc by email. Prefers an exact match on the dedupe
// key (the normalised form); falls back to the legacy `email` field for
// users created before this column existed.
export async function findUserByDedupeKey(db, email) {
  const dedupe = normalizeEmail(email);
  const lower = email.toLowerCase().trim();

  // Primary: emailDedupeKey
  const byKey = await db.collection('users').where('emailDedupeKey', '==', dedupe).get();
  if (!byKey.empty) {
    const docs = byKey.docs;
    return pickPreferredUserDoc(docs);
  }

  // Fallback: legacy users still indexed only on `email` (lowercased).
  const byEmail = await db.collection('users').where('email', '==', lower).get();
  if (!byEmail.empty) return pickPreferredUserDoc(byEmail.docs);
  return null;
}

function pickPreferredUserDoc(docs) {
  if (docs.length === 1) return { id: docs[0].id, ...docs[0].data() };
  // Prefer legacy did:privy:* IDs so existing users keep their data.
  const privyDocs = docs.filter(d => d.id.startsWith('did:privy:'));
  if (privyDocs.length > 0) return { id: privyDocs[0].id, ...privyDocs[0].data() };
  return { id: docs[0].id, ...docs[0].data() };
}

// ────────────────────────── HTML ESCAPING ──────────────────────────

export function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ────────────────────────── DISPLAY NAME VALIDATION ──────────────────────────

// Mirror of src/utils/profanity.js but server-side authoritative. Light enough
// to inline without sharing code across the build boundary.
const PROFANITY = [
  'fuck','shit','ass','bitch','cunt','dick','cock','pussy','bastard',
  'damn','hell','whore','slut','fag','faggot','nigger','nigga','retard',
  'wank','twat','bollocks','piss','crap','douche','dildo','jizz',
  'tits','boob','anus','penis','vagina','scrotum','cum','semen',
  'homo','dyke','tranny','chink','spic','wetback','kike','gook',
  'pedo','rape','molest','nazi','hitler',
];

function profanityNormalize(str) {
  return str.toLowerCase()
    .replace(/@/g, 'a')
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/\$/g, 's')
    .replace(/5/g, 's')
    .replace(/[_\-.\s]/g, '');
}

export function validateDisplayNameServer(name) {
  if (!name || typeof name !== 'string') return 'Username is required';
  const trimmed = name.trim();
  if (trimmed.length < 3) return 'Must be at least 3 characters';
  if (trimmed.length > 20) return 'Must be 20 characters or less';
  if (!/^[a-zA-Z0-9_.\-]+$/.test(trimmed)) return 'Only letters, numbers, _ . - allowed';
  const norm = profanityNormalize(trimmed);
  if (PROFANITY.some(w => norm.includes(w))) return 'That username is not allowed';
  if (RESERVED_DISPLAY_NAMES.has(norm)) return 'That username is reserved';
  return null;
}

// Constant-time string compare for hex/digest values.
export function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}
