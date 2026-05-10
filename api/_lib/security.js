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
//   checkIpAllowsNewAccount      — 1-account-per-IP enforcement
//   recordIpForUser              — index ip → users
//   maskEmail(email)             — half-masked email for "you already have an account" UX
//   escapeHtml(str)              — for safely interpolating user input into emails
//   validateDisplayNameServer    — server-side username validation incl. reserved names

export const SUPPORT_EMAIL = 'support@goaloracle.io';

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

// ────────────────────────── ANTI-SYBIL BYPASS ──────────────────────────

// Comma-separated list of emails (or Gmail+ aliases) in
// ANTI_SYBIL_BYPASS_EMAILS env var skip the per-device + per-IP single-
// account checks. Used to allowlist the operator's own laptop / phone /
// test mailboxes during pre-launch QA without disabling the safeguards
// for everyone.
//
// Matching: lowercased, trimmed, with `+suffix` stripped from the local
// part (Gmail-style). So setting `sumitwkhan@gmail.com` in the env also
// allows `sumitwkhan+test1@gmail.com`, `Sumitwkhan+QA@gmail.com`, etc.
function _normalizeForBypass(email) {
  if (typeof email !== 'string') return null;
  const lower = email.toLowerCase().trim();
  const at = lower.indexOf('@');
  if (at < 1) return null;
  const local = lower.slice(0, at).split('+')[0];
  const domain = lower.slice(at + 1);
  if (!local || !domain) return null;
  return `${local}@${domain}`;
}

export function isAntiSybilBypassEmail(email) {
  const raw = process.env.ANTI_SYBIL_BYPASS_EMAILS || '';
  if (!raw) return false;
  const list = raw.split(',').map(_normalizeForBypass).filter(Boolean);
  if (list.length === 0) return false;
  const normalized = _normalizeForBypass(email);
  return !!normalized && list.includes(normalized);
}

// ────────────────────────── DEVICE FINGERPRINT ──────────────────────────

// One account per device fingerprint. Bumped from 2 → 1 to stop the same
// browser from creating multiple accounts. Users hitting the wall are shown
// the masked email of the existing account and pointed at SUPPORT_EMAIL.
const MAX_ACCOUNTS_PER_FINGERPRINT = 1;

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

// ────────────────────────── PER-IP UNIQUE ACCOUNT ──────────────────────────

// One account per IP. This is stricter than the 24-h sliding window above —
// it persists forever. Shared-NAT users (family, dorm, office) hitting this
// wall must email SUPPORT_EMAIL for an override.
const MAX_ACCOUNTS_PER_IP = 1;

export async function checkIpAllowsNewAccount(db, ip) {
  if (!ip) return { allowed: true, count: 0, reason: 'no-ip' };
  const ref = db.collection('signupIps').doc(ipHash(ip));
  const snap = await ref.get();
  if (!snap.exists) return { allowed: true, count: 0 };
  const userIds = snap.data().userIds || [];
  if (userIds.length >= MAX_ACCOUNTS_PER_IP) {
    return { allowed: false, count: userIds.length, userIds };
  }
  return { allowed: true, count: userIds.length };
}

export async function recordIpForUser(db, ip, userId) {
  if (!ip || !userId) return;
  const ref = db.collection('signupIps').doc(ipHash(ip));
  await ref.set({
    ipHash: ipHash(ip),
    userIds: FieldValue.arrayUnion(userId),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ────────────────────────── MASKED EMAIL LOOKUP ──────────────────────────

// Show ~half of the local-part so the user can recognise the account they
// already own, without leaking the full address to a stranger.
//   john.doe@gmail.com → john****@gmail.com
//   a@b.com            → a***@b.com
export function maskEmail(email) {
  if (typeof email !== 'string' || !email.includes('@')) return null;
  const [local, ...rest] = email.split('@');
  const domain = rest.join('@');
  if (!domain || !local) return null;
  const half = Math.max(1, Math.ceil(local.length / 2));
  const visible = local.slice(0, half);
  const hiddenCount = Math.max(3, Math.max(local.length - half, 3));
  return `${visible}${'*'.repeat(hiddenCount)}@${domain}`;
}

async function lookupMaskedEmailForUserIds(db, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return null;
  // Pick the most recently active one if available; fall back to first.
  const userId = userIds[0];
  const snap = await db.collection('users').doc(userId).get();
  const email = snap.exists ? snap.data().email : null;
  return maskEmail(email);
}

export async function getMaskedEmailForFingerprint(db, visitorId) {
  if (!isValidVisitorId(visitorId)) return null;
  const snap = await db.collection('deviceFingerprints').doc(visitorId).get();
  if (!snap.exists) return null;
  return lookupMaskedEmailForUserIds(db, snap.data().userIds || []);
}

export async function getMaskedEmailForIp(db, ip) {
  if (!ip) return null;
  const snap = await db.collection('signupIps').doc(ipHash(ip)).get();
  if (!snap.exists) return null;
  return lookupMaskedEmailForUserIds(db, snap.data().userIds || []);
}

// Full-email lookups, returned alongside the masked version on the block
// screen. The original masking left users in a loop ("you have an account
// at jo****@gmail.com" without revealing which Gmail account) — surfacing
// the full address lets them sign back in immediately. Trade-off: anyone
// who borrows the device and tries to sign up could read the address.
async function lookupFullEmailForUserIds(db, userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return null;
  const userId = userIds[0];
  const snap = await db.collection('users').doc(userId).get();
  return snap.exists ? (snap.data().email || null) : null;
}

export async function getFullEmailForFingerprint(db, visitorId) {
  if (!isValidVisitorId(visitorId)) return null;
  const snap = await db.collection('deviceFingerprints').doc(visitorId).get();
  if (!snap.exists) return null;
  return lookupFullEmailForUserIds(db, snap.data().userIds || []);
}

export async function getFullEmailForIp(db, ip) {
  if (!ip) return null;
  const snap = await db.collection('signupIps').doc(ipHash(ip)).get();
  if (!snap.exists) return null;
  return lookupFullEmailForUserIds(db, snap.data().userIds || []);
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

// Returns true if some OTHER user already has this display name (case-
// insensitive). The caller's own doc is excluded so users can re-save
// their own profile without tripping the check. Lookup uses the
// `displayNameLower` index field; existing users without that field are
// not counted (they predate the unique-name enforcement and would only
// collide on case-exact matches against the legacy `displayName` field,
// which we also check defensively).
export async function isDisplayNameTakenByOther(db, displayName, excludeUserId) {
  const lower = String(displayName || '').trim().toLowerCase();
  if (!lower) return false;

  const byLower = await db.collection('users')
    .where('displayNameLower', '==', lower)
    .limit(2)
    .get();
  for (const d of byLower.docs) {
    if (d.id !== excludeUserId) return true;
  }

  // Defensive secondary check against the legacy displayName field for
  // pre-migration users. Case-exact only (Firestore can't lowercase
  // server-side without a stored field).
  const byExact = await db.collection('users')
    .where('displayName', '==', displayName.trim())
    .limit(2)
    .get();
  for (const d of byExact.docs) {
    if (d.id !== excludeUserId) return true;
  }

  return false;
}

// Picks a non-colliding default display name for a freshly-created user.
// Tries the bare prefix first, then suffixed variants until one is free.
// Bounded to a few attempts so we never block signup on a hot prefix.
export async function pickDefaultDisplayName(db, base) {
  const cleaned = String(base || 'Player').trim().slice(0, 18);
  if (!cleaned) return 'Player';
  if (!(await isDisplayNameTakenByOther(db, cleaned, null))) return cleaned;
  for (let i = 0; i < 4; i++) {
    const suffix = Math.floor(Math.random() * 0x1000).toString(16).padStart(3, '0');
    const candidate = `${cleaned.slice(0, 16)}-${suffix}`;
    if (!(await isDisplayNameTakenByOther(db, candidate, null))) return candidate;
  }
  // Last resort: still unique with high probability after 4 hex chars.
  return `${cleaned.slice(0, 14)}-${Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0')}`;
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
