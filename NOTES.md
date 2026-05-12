# Notes

Running log of non-trivial changes, design intent, and gotchas. Append to
the top — newest entries first.

---

## 2026-05-12 — Prize-league feature flag + House Rules + simplified create flow

Three-phase change to user-created leagues. **The Global League prize
contest (PR #98) is completely untouched** — its files, components,
data model, and analytics all stay exactly as they are.

### Phase 0 — Admin-toggleable Prize League flag

The dead "Prize League — Coming soon" tile and all its supporting
scaffolding (entry fee, prize distribution, `type: 'paid'` branches,
`totalPrizePools` aggregate, paid badges) are now hidden behind a new
`enablePrizeLeagues` feature flag at `/settings/featureFlags`,
defaulting to `false`. Superadmin-only toggle in Admin → Feature flags
with optional reason that lands in `adminLogs`.

Reused existing infrastructure rather than building parallel
`system_settings` / `system_settings_audit_log` collections per the
original spec:

| Spec  | Existing equivalent |
|---|---|
| `system_settings` table | `/settings/featureFlags` doc (already exists) |
| Polling cache (30s TTL) | `subscribeToFeatureFlags()` real-time onSnapshot (better) |
| `GET /api/settings/public` | `GET /api/public?type=flags` (already exists) |
| `PATCH /api/admin/settings/:key` | `POST /api/admin { action: 'setFeatureFlag' }` (already exists; tightened to superadmin-only in this PR) |
| `system_settings_audit_log` | `/adminLogs` with `action: 'set_feature_flag'` (already writing; added `reason` field) |

Server-side enforcement in `api/leagues.js`: the `create` action reads
the flag on every request. When off, requests with `type === 'paid'` or
`entryFee > 0` are rejected `403 Prize leagues are currently disabled.`
Frontend reads the flag on mount via `subscribeToFeatureFlags`; clients
with a stale `true` still get blocked by the server.

`api/admin.js`'s `setFeatureFlag` action was tightened from
admin-or-superadmin → superadmin-only. Feature flags are platform-wide
config, which matches the policy for other superadmin actions
(setRole-to-superadmin, deleteUser, etc).

### Phase 1 — Simplified Create League flow

When `enablePrizeLeagues === false`, the form drops:
- the entire "League Type" picker (Free + the disabled Prize tile)
- the Entry Fee + Prize Distribution sections
- the "Free League" / "Prize League" labels

Users now go directly: name → public/private toggle → House Rules
(if private) → Create. No type concept visible.

Three render sites in `goaloracle.jsx` (Browse table, league header
badge, settings row "Type: Free") + AdminDashboard's paid stats also
gate on the same flag.

### Phase 2 — House Rules

Optional free-text field on private user-created leagues. 500 char
hard cap, plain text only (`white-space: pre-wrap` preserves line
breaks; no markdown, no link auto-linking).

**Data model:**
- `/leagues/{id}.houseRules: { content, lastUpdatedAt, lastUpdatedBy } | null`
- `/leagueMemberAcks/{userId__leagueId}` — per-member ack timestamp + `houseRulesUpdatedSinceAck` flag for the "Updated" badge after a creator edit
- `/contentReports/{auto}` — generic UGC report shape; v1 only persists `contentType: 'league_house_rules'`

**Server actions** (all in `api/leagues.js`):
- `create` — accepts `houseRules.content` (rejects on public leagues, rejects >500 chars)
- `join` — auto-stamps `houseRulesAcknowledgedAt` when the league has rules
- `editHouseRules` — creator-only update; resets all members' acks so the card re-expands with "Updated" badge
- `acknowledgeHouseRules` — idempotent member-side ack
- `reportContent` — generic, member-only, persists to `/contentReports` with `status: 'pending'`

**Components:**
- `HouseRulesInput` — textarea + live char counter
- `HouseRulesCard` — collapsible card on league detail page; three-dot menu (Edit for creator, Report for any member)
- `HouseRulesJoinView` — always-expanded display on the join screen
- `HouseRulesSection` — self-contained integration owning card + edit modal + report modal + localStorage ack cache
- `ReportContentModal` — generic UGC report form

Mounted on both the Classic detail page (`goaloracle.jsx`) and the
Quick Picks detail page (`src/pages/SimplePrediction.jsx`). Renders
null on global leagues, public leagues, and leagues with no rules.

### ToS update

New section 5 "User-generated league content" in `/terms` clarifying
that GoalOracle doesn't enforce or administer user-posted content.

### Gotchas for future-Claude

1. **Existing `classicEnabled` flag has an inconsistency** — public.js
   defaults it to `true` while client defaults to `false`. Pre-existing
   bug, NOT fixed here (out of scope). The new `enablePrizeLeagues`
   uses `=== true` consistently across all reads (defaults FALSE).
2. **localStorage ack cache vs server ack** — the card's
   defaultExpanded gating reads from localStorage to avoid a per-render
   fetch. The server-side ack still fires for audit. If a user clears
   storage, they'll see the card re-expand once and re-ack.
3. **Audit log query** — to avoid requiring a Firestore composite
   index, `getFeatureFlagAuditLog` over-fetches (5x cap) on `action ==
   set_feature_flag` ordered by timestamp, then filters by flag
   client-side. Cheap because flag changes are rare.
4. **The audit query previously needed `where(action) + where(flag) +
   orderBy(timestamp)` which IS a composite index. Removed that to keep
   index-free.**
5. **Prize-league scaffolding intentionally preserved** — `entryFee`,
   `prizeDistribution`, `l.type === 'paid'` branches all stay in
   source code, just gated. Re-enabling is one superadmin toggle.

---

## 2026-05-11 — Free-to-enter prize contest

Launched the first prize-bearing contest. Top 3 in `global-simple` at end
of WC 2026 Final win $150 / $100 / $50 in USDC (USDG on request) on
Polygon. Entry is free, skill-based, no purchase necessary. Sponsored by
Suraam, LLC d/b/a GoalOracle (Delaware via Stripe Atlas).

This change touches both legal/compliance surfaces (Official Rules,
eligibility consent, audit trail) AND conversion-critical surfaces
(homepage hero rebuild, OG image, FAQ, prize structure card on multiple
pages). They ship together because the prize is the lead value
proposition for cold ad traffic — half the work is "make this look
appealing within 3 seconds", half is "make this defensible in front of a
state attorney general".

### Architectural decisions

**1. Single source of truth: `src/config/legal.js`**

Every legal constant lives here — `RULES_VERSION`, `PRIZES`, sponsor
identity, excluded jurisdictions, key dates, notification + payout
windows. Any page that needs a prize amount, sponsor name, or rules
version imports from this module. The only acceptable hardcoding is the
$150 in social media copy where the OG image renders it as text.

Bracketed placeholder values (`[STRIPE_ATLAS_DELAWARE_ADDRESS]`,
`[LAUNCH_DATE]`, `[GROUP_STAGE_LOCK_DATE]`, `[FINAL_DATE]`) intentionally
ship as visible-in-product strings until they're filled in. Catching a
"[FOO]" in the live UI is easier than catching a silent empty span.

**2. Consent decoupled from membership**

Plan started by gating global-simple join on consent. User reversed:
"keep auto-join, just collect consent as early as possible". So:

- New users: required checkbox in WelcomeFlow. They can't finish onboarding
  without it. Captured at the earliest moment via `setContestConsent`.
- Existing users (joined Global before this feature shipped): subtle inline
  ContestConsentBanner above the home shell. Confirm → eligible. Dismiss →
  `prizeIneligible: true`. Banner self-hides via localStorage so it doesn't
  keep popping back as the user navigates.

The user keeps their leaderboard standing either way — only prize
eligibility hinges on consent. This means winner determination logic must
filter on `hasCurrentConsent(user) && !isPrizeIneligible(user)` at end of
tournament. (Manual for v1; helper functions live in `src/config/legal.js`.)

**3. RULES_VERSION reset**

Bumping `RULES_VERSION` in `legal.js` (when rules materially change)
automatically re-prompts every user — the banner gates on
`hasCurrentConsent` which checks the stored version against the current
constant. No additional code needed; just bump the string and ship.

### What's NEW

- `src/config/legal.js` — constants
- `src/components/PrizeStructureCard.jsx` — 3-place visualization, used on
  homepage and Global League page (intentional repetition per spec)
- `src/components/EligibilityCheckbox.jsx` — single-line consent control
- `src/components/ContestConsentBanner.jsx` — opt-in for existing users
- `src/pages/OfficialRules.jsx` — full Official Rules page at /official-rules

### What CHANGED

- `src/goaloracle.jsx` — anonymous hero rewrite (eyebrow + prize headline
  + Enter Free CTA + trust strip + Official Rules link), PrizeStructureCard
  inserted below hero, OfficialRules route added, footer gains Official
  Rules link + new copyright (`© 2026 Suraam, LLC`), FAQ section "Prize
  Leagues & Future Plans" replaced with "Prize Contest" containing the
  10 prize-related questions, ContestConsentBanner mounted on home shell
- `src/components/onboarding/WelcomeFlow.jsx` — EligibilityCheckbox added
  at bottom; submit gated until checked; `consent` payload threaded
  through `onSubmit`
- `src/utils/db.js` — new `setContestConsent` and `setPrizeIneligible`
  helpers; `saveSimplePrediction` fires `first_prediction_submitted`
  via the new `trackOnce` helper
- `src/utils/track.js` — new `trackOnce(event, params)` for fire-once
  funnel events; TODO(posthog) marker for the eventual SDK install
- `api/user.js` — accepts and persists `contestConsent` + `prizeIneligible`
  on POST. Validates consent shape; silently ignores malformed
- `api/og.jsx` — default OG image rebuilt with prize messaging
- `index.html` — title, description, OG, Twitter card, JSON-LD
  SoftwareApplication + FAQPage all updated for prize positioning
- `src/styles.css` — new sections for `.hero-eyebrow`, `.hero-trust-strip`,
  `.prize-structure*`, `.eligibility-checkbox*`, `.contest-consent-banner*`,
  `.legal-page` (Official Rules typography)

### What's INTENTIONALLY NOT in this PR

- IP geo-blocking — Official Rules disclosure is sufficient for v1
- KYC / identity verification — prize amounts below 1099 thresholds
- Automated payout pipeline — manual for WC 2026
- Winner-notification email automation — operator runs this manually from
  leaderboard data after the Final
- PostHog SDK install — `track.js` carries a TODO(posthog) marker; CLAUDE.md
  has the install recipe. User explicitly deferred
- Tax form generation
- BIMI / VMC for branded support@ emails (separate setup)

### Gotchas for future-Claude

1. **Don't add new prize amounts or sponsor info anywhere except `legal.js`.**
   The whole point of the constants module is single-source-of-truth.
2. **The consent banner uses localStorage to self-suppress.** If a user
   dismisses, then clears localStorage, they'll see the banner again. That
   re-prompt is the SECOND chance — the server-side `prizeIneligible: true`
   was already written on the first dismiss. They'd have to confirm to
   become eligible.
3. **`api/user.js` consent validation is intentionally lenient.** Malformed
   consent payloads are silently ignored, NOT rejected with 400, because
   this endpoint also handles unrelated updates (wallet, displayName).
   Strict rejection would block those.
4. **OfficialRules + FAQ + JSON-LD have parallel copy.** Three places
   declare the prize amounts. They all source from `legal.js` so updates
   propagate, BUT if you add a new prize FAQ, also add it to the JSON-LD
   in `index.html` so search engines pick it up.

---

## 2026-05-08 — Home page (logged-in) → calm dashboard rebuild

Second pass on the home page. The previous iteration (entry below) cleaned
up the layout but left structural problems flagged in review:

1. Three competing focal points (greeting, MyPicksCard, HeroLeaderboardPreview)
2. Two redundant countdowns (yellow WorldCupCountdown banner + the "Tournament
   starts in N days" line inside MyPicksCard)
3. Cards floated as opaque white blocks against a bright stadium photo
4. Mixed button styles — gradient primary CTA vs. outlined secondary chips
5. No coherent type scale across the page
6. The stadium photo was background noise rather than ambient mood

This pass is a structural rebuild of the authed branch only. Anonymous
landing is untouched.

### Card-style decision: frosted glass

One uniform card style across the entire authed home — semi-transparent
dark fill with `backdrop-filter: blur(18px) saturate(140%)`. No mixing.
Solid dark cards would be safer but feel inert; frosted reads as the
"modern, premium" reference (Apple, Airbnb hero cards) and lets the
stadium photo breathe through subtly without competing.

Tokens, defined at `:root`:

```
--home-card-bg: rgba(8, 10, 16, 0.6);
--home-card-border: rgba(255, 255, 255, 0.1);
--home-card-blur: 18px;
--home-card-radius: 16px;
--home-card-pad: 1.5rem 1.75rem;
--home-card-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
```

Light-theme variants override the same tokens with near-white fills.

### Stadium photo treatment

The asset itself is unchanged. The overlay was the problem — the
default `.hero-stadium-overlay` has a translucent top + radial color
washes meant to make the image *visible* for the marketing pitch.
Wrong on a dashboard; cards at the top fought the bright crowd.

New `.hero-stadium-overlay-authed` variant is uniform and dark:

```
radial-gradient(ellipse at 50% 35%, rgba(8,12,22,0.55), rgba(0,0,0,0.78)),
linear-gradient(180deg, rgba(0,0,0,0.55), rgba(0,0,0,0.7), var(--bg))
```

Ambient mood, not visual competition. Cards stay legible at any vertical
position in the hero column.

### New layout (single centered container, max-width 1100px)

Stacked vertically with consistent `--home-gap: 1.25rem`:

```
┌─────────────────────────────────────────────┐
│  HERO CARD  (combines countdown + greeting + │
│   inline picks + rank + ONE primary CTA)     │
└─────────────────────────────────────────────┘

[ Dashboard ] [ My Leagues ] [ Leaderboard ] [ Join ] [ Invite ]

┌─────────────────────────────────────────────┐
│  GLOBAL LEAGUE PREVIEW                       │
└─────────────────────────────────────────────┘

  216 predictions today · 82 countries · Free to play · FIFA-compliant
```

The hero card replaces three previous components: WorldCupCountdown,
the "Welcome back" greeting line, and MyPicksCard. The 5 quick-action
tiles replace the old 6-chip row + the disconnected primary pill above
it. The leaderboard preview is wrapped in a `home-card` so it inherits
the same frosted frame. The stats band collapses to a single muted line
at the very bottom.

### Type scale (4 sizes max)

Defined as tokens, used everywhere:

```
--home-fs-display: 1.75rem;   /* hero greeting */
--home-fs-large:   1.05rem;   /* primary CTA, section labels */
--home-fs-body:    0.9rem;    /* descriptions, list rows */
--home-fs-caption: 0.72rem;   /* uppercase mono — countdown, tile labels */
```

No font sizes outside this scale on the authed home.

### Buttons (one primary, one secondary, no gradients)

- **Primary**: `.home-hero-primary` — filled `var(--primary)` (cyan),
  used only on "Edit your bracket" inside the hero card. One per page.
- **Secondary**: `.home-tile` — frosted-glass tile, applied uniformly
  to all 5 quick-action surfaces. Same style for the leaderboard
  preview's "View full" link.

The previous gradient pill primary + gradient accent chip + outlined
neutral chips combo is gone.

### New components

- `src/components/HomeHeroCard.jsx` — countdown + greeting + picks +
  rank + CTA, all in one card. Uses the `quickPicks` state extended
  in the previous PR (`winner`/`runnerUp`); no new fetches.
- `src/components/QuickActionsTiles.jsx` — 5-tile grid. Mobile drops
  to 2 columns with the 5th tile spanning the bottom row so we don't
  leave an orphan.

### Files touched

- `src/goaloracle.jsx` — Landing branches authed vs anonymous via
  early return. Authed gets the new shell; anonymous keeps the
  marketing page exactly as it was.
- `src/components/HomeHeroCard.jsx` — new.
- `src/components/QuickActionsTiles.jsx` — new.
- `src/styles.css` — new `.hero-stadium-overlay-authed` variant,
  `--home-*` tokens, `.home-shell` / `.home-card` / `.home-hero` /
  `.home-tiles` / `.home-tile` / `.home-leaderboard` / `.home-footer-strip`
  rule blocks, light-theme overrides, mobile media queries.

### Untouched

- Anonymous landing, including the existing stadium-photo overlay,
  `.hero-split-inner`, all downstream marketing sections (HIW,
  features, etc.).
- Auth flow (Firebase Auth + email OTP + Google OAuth).
- Firebase data fetching for brackets and leaderboards.
- `HeroLeaderboardPreview` component logic — only its outer chrome
  is suppressed when wrapped inside `.home-leaderboard` so the
  parent card frame doesn't double up.
- Routing — all CTAs use existing `nav()` and the same
  `goLeaderboardLanding` / `startSimplePredicting` handlers.
- The stadium photo asset URL.
- `WorldCupCountdown` component definition — still used by anonymous
  visitors. Authed users see the countdown inside the hero card.

### Deprecated (still in source)

- `MyPicksCard` — still imported by Landing for backward compat but
  no longer rendered. Safe to delete in a follow-up; left in place
  this pass to keep the diff focused on the layout rebuild.
- `.hero-primary-cta` / `.hero-cta-chips` / `.hero-stats-band` /
  `.hero-title-compact` — still present in styles.css for the same
  reason. No JSX references them anymore.

---

## 2026-05-08 — Home page (logged-in) → personal dashboard

Landing page now reads as a personal dashboard for logged-in users
instead of a generic marketing pitch. Anonymous users are unchanged.

### Changes

- **Layout**
  - `.hero-split-inner` `align-items: center` → `align-items: start`
    so the left column (title + CTAs) and the right column
    (MyPicksCard + HeroLeaderboardPreview) share a top baseline.
  - Horizontal padding bumped from `2rem` → `3rem` so the title
    doesn't bleed against the viewport edge on standard desktop
    widths.
  - Authed users get `.hero-split-inner-authed` (5.5rem top padding)
    since the smaller "Welcome back" title doesn't need 8rem of
    breathing room above it.

- **Title**
  - Anonymous users: keep the full "Predict the World Cup." pitch
    (3.2rem) + tagline.
  - Authed users: `.hero-title-compact` (2.2rem) reading "Welcome
    back." — they don't need to be re-pitched.

- **Primary CTA hierarchy**
  - The previous design had Edit/Finish-bracket as just one of six
    chips. Now it's a `.hero-primary-cta` pill — larger (48px tall,
    0.98rem font, 12px radius), gradient bg, soft shadow. Sits in
    its own `.hero-primary-cta-row` above the secondary chip row.
  - Urgent variant (incomplete bracket) gets a soft amber pulse via
    `@keyframes hero-primary-pulse`.
  - Five secondary chips (Dashboard / My leagues / Global
    leaderboard / Join a league / Invite friends) stay in the
    smaller `.hero-cta-chips` row below the primary.

- **MyPicksCard** (new — `src/components/MyPicksCard.jsx`)
  - Right-column card stacked above HeroLeaderboardPreview.
  - Three render states:
    - `ready`: rank line + Champion / Runner-up podium rows.
    - `progress`: same as ready but also surfaces a yellow
      "Complete your bracket — N left" CTA.
    - `empty`: single CTA "Make your first picks" (no podium).
  - Pre-tournament (`Date.now() < kickoff`) replaces the rank with
    "Tournament starts in N days" — same logic as
    `BracketSurvivalCard`'s `daysUntilKickoff`.
  - Loading skeleton when `quickPicks === null` so the card fades
    in cleanly rather than popping.

- **Stats band**
  - Social-proof line + FIFA compliance line moved from the bottom
    of the left column into a new `.hero-stats-band` below both
    columns. Previously they made the left column taller than the
    right and broke the baseline; now they sit full-width as a
    subtle band, separated by a hairline border.

- **Data flow**
  - `quickPicks` state now also carries `winner` + `runnerUp`
    pulled from `knockoutPredictions.final[0]`. Same
    `getSimplePrediction` call that was already running — we just
    preserved fields the previous code threw away. No new fetches.
  - `MyPicksCard` reads `leagueRanks['global-simple']` for the
    rank — same source the dashboard's strip uses. No new
    leaderboard call.

### Files touched

- `src/goaloracle.jsx` — extend `quickPicks` state shape;
  restructure Landing JSX (compact authed title, primary CTA row,
  MyPicksCard slot, stats band).
- `src/components/MyPicksCard.jsx` — new.
- `src/styles.css` — column alignment, padding, primary CTA,
  MyPicksCard styles, stats band, mobile media-queries.

### Untouched (per the brief)

- Auth flow (Firebase Auth + email OTP + Google OAuth, post-Privy).
- Firebase data fetching for brackets and leaderboards.
- `HeroLeaderboardPreview` component (just repositioned under
  MyPicksCard).
- Pre-tournament empty state logic — MyPicksCard reuses the
  existing kickoff constant pattern.
- Routing — all CTAs use existing `nav()` and `goLeaderboardLanding`
  / `startSimplePredicting` handlers.

### Anonymous-user regression test

The two-button anonymous hero (Start Predicting / Create a League),
3.2rem title, and full subtitle all render unchanged when
`!authenticated`. The MyPicksCard, primary CTA row, and chip row
are gated on `authenticated` so anonymous visitors see no
dashboard surfaces.
