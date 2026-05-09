# Notes

Running log of non-trivial changes, design intent, and gotchas. Append to
the top — newest entries first.

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
