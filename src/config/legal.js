// Single source of truth for the GoalOracle Prize Contest legal +
// configuration constants. Anything bracketed (e.g. [LAUNCH_DATE]) is a
// placeholder waiting on a real value at launch — keep them as literal
// strings until then so the Official Rules page renders the placeholders
// visibly (better than rendering an empty span).
//
// RULES_VERSION is the on-disk record of which Official Rules a user
// agreed to. When the rules change materially, bump this value. The
// client compares user.contestConsent.rulesVersion to this constant on
// each load — mismatch surfaces the re-consent banner.

export const RULES_VERSION = '1.0.0';

// Sponsor identity. Both the legal name and the brand are different —
// Suraam, LLC is the entity; GoalOracle is the consumer-facing brand.
export const SPONSOR_NAME = 'Suraam, LLC';
export const SPONSOR_DBA = 'Suraam, LLC d/b/a GoalOracle';
// Replace with real Stripe Atlas Delaware address once registration
// completes. Bracketed string is intentional — it surfaces visibly on
// the Official Rules page so we don't accidentally ship blank.
export const SPONSOR_ADDRESS = '131 Continental Dr, Suite 305, Newark, DE 19713';
export const SPONSOR_FOOTER = '© 2026 Suraam, LLC';

// Prize structure. Three places, USDC default with USDG on request.
// Order matters — UI iterates and renders top-to-bottom.
export const PRIZES = [
  { place: 1, amount: 150, currency: 'USDC', medal: '🥇', label: '1st Place' },
  { place: 2, amount: 100, currency: 'USDC', medal: '🥈', label: '2nd Place' },
  { place: 3, amount: 50,  currency: 'USDC', medal: '🥉', label: '3rd Place' },
];
export const PRIZE_TOTAL_USD = PRIZES.reduce((s, p) => s + p.amount, 0); // 300
export const PRIZE_TOP_USD = PRIZES[0].amount;                            // 150
export const PRIZE_NETWORK = 'Polygon';
export const PRIZE_DEFAULT_CURRENCY = 'USDC';
export const PRIZE_ALT_CURRENCY = 'USDG';

// Excluded jurisdictions — written into Official Rules + the eligibility
// attestation copy. Add to this list as legal advice changes.
export const EXCLUDED_JURISDICTIONS = [
  'Washington State (USA)',
  'Quebec (Canada)',
  'Any country/region where free-to-enter prize promotions are restricted',
];

// Key dates. LAUNCH_DATE is the day these Rules become effective and
// the day the contest is publicly announced. GROUP_STAGE_LOCK_DATE is
// the entry cutoff — predictions submitted after this don't qualify.
// FINAL_DATE is when winners are determined.
//
// Time of day intentionally omitted from GROUP_STAGE_LOCK_DATE. The
// app's existing 5-minute-before-kickoff lock buffer
// (src/utils/points.js:isPredictionLocked) is the precise mechanism;
// the rules say "before the Group Stage opener kicks off" and that's
// enforced in code. Putting "at 2:55 PM ET" in legal copy reads
// engineering-y and risks confusion with the user's local timezone.
export const LAUNCH_DATE = 'May 12, 2026';
export const GROUP_STAGE_LOCK_DATE = 'June 11, 2026';
export const FINAL_DATE = 'July 19, 2026';

// Notification + payout windows (days). Constants so the Official Rules
// page stays in lock-step with whatever we put in the FAQ.
export const WINNER_NOTIFICATION_WINDOW_DAYS = 7;
export const WINNER_RESPONSE_WINDOW_DAYS = 7;
export const WINNER_FORFEIT_WINDOW_DAYS = 14;
export const PAYOUT_WINDOW_DAYS = 3;

// Minimum age. Drives the EligibilityCheckbox copy.
export const MIN_AGE = 18;

// The Global League ID where the contest runs. Hardcoded here so any
// future split (e.g. seasonal contests) can reuse this module.
export const CONTEST_LEAGUE_ID = 'global-simple';

// Returns true iff the supplied user record has on-file consent for the
// CURRENT rules version. Used by both client (banner gating) and any
// future server-side prize-eligibility check. Read-only — never mutates.
//
// A user with consent for an OLDER rules version is NOT eligible until
// they re-consent. That's the whole reason RULES_VERSION exists.
export function hasCurrentConsent(userDoc) {
  const c = userDoc?.contestConsent;
  if (!c || typeof c !== 'object') return false;
  if (c.rulesVersion !== RULES_VERSION) return false;
  if (c.ageAttested !== true) return false;
  if (c.jurisdictionAttested !== true) return false;
  if (!c.timestamp) return false;
  return true;
}

// Returns true iff the user has explicitly opted out (dismissed banner
// or declined re-consent). Such users keep their leaderboard spot but
// are not in the prize-winner pool.
export function isPrizeIneligible(userDoc) {
  return userDoc?.prizeIneligible === true;
}
