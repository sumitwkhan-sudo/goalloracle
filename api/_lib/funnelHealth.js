/**
 * Funnel health — lightweight monitoring for the no-login conversion path
 * (roadmap item C). Surfaces the two signals worth watching after launch:
 *   1. anon→real picks-migration outcomes (esp. `error`, and the
 *      `target_has_picks` case where a returning user's new anon picks
 *      weren't applied), and
 *   2. custom-token sign-in errors (the auth.customtoken.error breadcrumb).
 *
 * Vercel runtime logs aren't queryable from the app, so we persist small
 * daily-bucketed COUNTERS in Firestore (/funnelHealth/{YYYY-MM-DD}) via
 * FieldValue.increment. One doc per day keeps storage bounded even though
 * the auth-error write comes from an unauthenticated endpoint (an abuser can
 * only inflate a counter, not create unbounded docs).
 *
 * This module is intentionally Firebase-free so the date + status logic is
 * unit-testable; the endpoints do the actual increment/read with `dayId()`.
 */

export const MIGRATION_OUTCOMES = ['migrated', 'target_has_picks', 'no_anon_picks', 'same_uid', 'error'];

// Heuristic alert thresholds. Tuned to flag a genuine regression, not normal
// flaky-mobile noise (custom-token retries are expected at a low rate).
export const WATCH_THRESHOLDS = {
  authCustomTokenPerDay: 10, // TERMINAL sign-in failures in a day before we flag
};

// The custom-token sign-in retry loop in src/utils/auth.js retries up to this
// many times on auth/network-request-failed. Each failed ATTEMPT logs a
// breadcrumb, so a single failing sign-in emits up to 3 — we only want to
// COUNT the terminal one (the retries are exhausted / a non-retriable error),
// otherwise the metric triple-counts a single flaky session.
export const AUTH_MAX_ATTEMPTS = 3;

// Is this auth.customtoken.error breadcrumb the TERMINAL failure (the user
// actually couldn't sign in) vs a transient attempt that will be retried?
// New clients send `terminal` explicitly; for older deployed clients we
// derive it from the attempt/retriable fields they already send.
export function isTerminalAuthError(data) {
  if (typeof data?.terminal === 'boolean') return data.terminal;
  const retriable = data?.retriable === true;
  const attempt = Number(data?.attempt) || 0;
  return !retriable || attempt >= AUTH_MAX_ATTEMPTS;
}

// UTC day bucket id, e.g. '2026-06-07'. UTC (not ET) so the bucket boundary
// is stable regardless of where the serverless region runs.
export function dayId(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

// The last `days` UTC day-ids, newest first: [today, yesterday, ...].
export function recentDayIds(days = 7, now = new Date()) {
  const ids = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(now.getTime() - i * 86400000);
    ids.push(dayId(d));
  }
  return ids;
}

// A zeroed day record — the shape the admin UI renders even for empty days.
export function blankDay(date) {
  return {
    date,
    migration: { migrated: 0, target_has_picks: 0, no_anon_picks: 0, same_uid: 0, error: 0 },
    // total = TERMINAL sign-in failures (drives the alert). transient =
    // attempts that failed but recovered on retry (informational only).
    authCustomToken: { total: 0, transient: 0, byCode: {}, byStep: {} },
  };
}

// Derive a status banner from the day records (newest first). 'watch' means
// something worth an operator glance happened TODAY:
//   - any migration `error` (an exception mid-migration — a real bug), or
//   - custom-token sign-in errors at/over the daily threshold (auth regression).
// `target_has_picks` is an EXPECTED edge case (returning user signs into an
// account that already has a bracket) — surfaced as a metric but it does NOT
// raise the status, to avoid alarm fatigue.
export function computeHealthStatus(days) {
  const today = (Array.isArray(days) && days[0]) || blankDay(dayId());
  const mig = today.migration || {};
  const auth = today.authCustomToken || {};
  const reasons = [];

  const migErr = mig.error || 0;
  if (migErr > 0) {
    reasons.push(`${migErr} anon-picks migration error${migErr > 1 ? 's' : ''} today`);
  }
  const authTotal = auth.total || 0;
  if (authTotal >= WATCH_THRESHOLDS.authCustomTokenPerDay) {
    reasons.push(`${authTotal} sign-in failures today (after retries, ≥ ${WATCH_THRESHOLDS.authCustomTokenPerDay})`);
  }

  return { status: reasons.length ? 'watch' : 'ok', reasons };
}

// Custom-token sign-in failure codes we expect to see (from auth.js). The
// /api/client-log write is UNAUTHENTICATED, so we bucket any unrecognized
// code under 'other' to bound the byCode map keyspace — an abuser can't grow
// the daily doc with arbitrary sub-keys.
export const KNOWN_AUTH_CODES = new Set([
  'auth/network-request-failed',
  'auth/invalid-custom-token',
  'auth/custom-token-mismatch',
  'auth/internal-error',
  'auth/user-disabled',
  'auth/operation-not-allowed',
  'auth/too-many-requests',
  'auth/user-token-expired',
]);
export function normalizeAuthCode(code) {
  const c = String(code || '').slice(0, 60);
  return KNOWN_AUTH_CODES.has(c) ? c : 'other';
}
export function normalizeStep(step) {
  const s = String(step || '').toLowerCase().slice(0, 20);
  return (s === 'email' || s === 'google') ? s : 'other';
}

// Sum a counter map across all days (e.g. 7-day migration totals).
export function sumOutcomes(days) {
  const total = { migration: blankDay('').migration, authCustomToken: { total: 0 } };
  for (const d of days || []) {
    for (const k of MIGRATION_OUTCOMES) total.migration[k] += (d?.migration?.[k] || 0);
    total.authCustomToken.total += (d?.authCustomToken?.total || 0);
  }
  return total;
}
