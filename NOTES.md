# Notes

Running log of non-trivial changes, design intent, and gotchas. Append to
the top — newest entries first.

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
