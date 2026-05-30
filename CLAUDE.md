# GoalOracle — Project Memory

FIFA World Cup 26 prediction game. Two modes: **Quick Picks** (rank groups + pick best-thirds + fill bracket) and **Classic Predictions** (score + result for every fixture).

## Stack
- **Frontend:** React 18 + Vite 5. Single-file app shell lives in `src/goaloracle.jsx` (~3800 lines). Quick Picks wizard lives in `src/pages/SimplePrediction.jsx` + `src/components/simple/*`.
- **Auth:** Privy → Firebase (custom token via `/api/auth`).
- **Data:** Firestore (client) + Firebase Admin SDK (serverless API routes in `/api`).
- **Icons:** `lucide-react`. **Drag-and-drop:** `@dnd-kit`.
- **Tests:** Vitest. Only the tournament engine has tests — `src/utils/*.test.js`. 58 passing.
- **Deploy:** Vercel; `main` = prod.

## Commands
- `npm test` — run the Vitest suite
- `npm run build` — production build (must pass before commit)
- `npm run dev` — local dev server (port 5173)

## Architecture gotchas

### Prediction modes — naming
- **Internal keys stay as `predictionMode: 'simple' | 'classic'`** and league IDs `'global'` / `'global-simple'` — do NOT rename these (Firestore docs + live users).
- **User-facing strings** are **"Quick Picks"** and **"Classic Predictions"** everywhere. Respect that split when adding copy.

### FIFA Annexe C (third-place routing)
- Canonical FIFA source of truth is `src/data/annexe-c.json` (495 rows). **Never** derive routing algorithmically — FIFA doesn't publish the algorithm; a guess will disagree in edge cases.
- Shared API is `src/utils/thirdPlaceAllocation.js`. Both Classic and Quick Pick converge on `allocateThirdsToBrackets(top8, allGroups)`.
- `src/utils/fifaThirdPlaceRules.js` is a legacy shim that loads from JSON + translates M-IDs (`M74`) to internal slot IDs (`r32_03`). Used by `src/utils/bracket.js` (classic bracket resolver) and `src/utils/bracketUtils.js` (simple-mode bracket).
- Unknown 8-group combos must throw, not fall back. Tests assert this.
- Cross-group 3rd-place tiebreaker (Art. 13): points → GD → goals → fair play → FIFA ranking. **Never** use head-to-head — they haven't played each other. Within-group tiebreaker is different (starts with H2H mini-league).
- Kickoff: 11 Jun 2026 15:00 ET (`Date.UTC(2026, 5, 11, 19, 0, 0)`).

### Firestore rules quirks
- `/predictions/*`: `allow write` with `request.resource.data.userId == auth.uid`. On **delete** `request.resource` is null, so client-side delete is blocked. Classic reset goes through `DELETE /api/predictions` (admin SDK bypasses rules).
- `/simplePredictions/*`: client can write directly. `resetSimplePrediction(userId, leagueId)` clears in-place.

### Time-lock
- `isPredictionLocked(matchDate, matchTime)` in `src/utils/points.js` treats match times as ET (UTC-4 during June/July). Lock fires 5 min before kickoff. Server enforces the same in `/api/predictions` via `isMatchLocked(matchId)`.

## Key files by concern

| Concern | Path |
|---|---|
| App shell, routing, Dashboard, Nav, Hero | `src/goaloracle.jsx` |
| Quick Picks wizard | `src/pages/SimplePrediction.jsx` |
| Quick Picks components | `src/components/simple/{GroupCard,GroupGrid,BestThirdSelector,BracketMobile,BracketDesktop,StepProgress}.jsx` |
| Bracket share modal | `src/components/BracketShareModal.jsx` |
| Admin panel (edit match results, roles, delete+rename leagues) | `src/components/AdminDashboard.jsx` |
| Classic bracket resolver + tiebreaker | `src/utils/bracket.js` |
| Quick Picks scoring | `src/utils/scoringSimple.js` |
| Classic scoring | `src/utils/points.js` |
| Shared third-place logic + tests | `src/utils/thirdPlaceAllocation.js` (+ `.test.js`) |
| 495-row FIFA data | `src/data/annexe-c.json` |
| Match fixtures (104 matches) | `src/data/matches.js` |
| Firestore + API client | `src/utils/db.js` |
| Serverless admin endpoint | `api/admin.js` |
| Serverless predictions CRUD (GET + POST + DELETE) | `api/predictions.js` |

## User-created leagues — Prize Leagues feature flag + House Rules (May 2026)

User-created leagues now have an **admin-toggleable Prize League gate**
plus an **optional House Rules** field on private leagues. This is
unrelated to the platform-wide Global League contest (see below).

### Prize Leagues flag

- Stored at `/settings/featureFlags` doc, key `enablePrizeLeagues`.
  Default `false` — user-created leagues are free-only and the Create
  League form hides the type picker entirely.
- Superadmin-only toggle in **Admin → Feature flags**. Toggling
  prize-leagues prompts for an optional reason that lands in
  `/adminLogs` (action `set_feature_flag`) for audit.
- Live propagation via the existing `subscribeToFeatureFlags` real-time
  subscription — clients pick up changes within ~60 seconds.
- Server enforcement: `api/leagues.js` reads the flag on every create.
  When off, requests carrying `type === 'paid'` or `entryFee > 0` are
  rejected with `403 Prize leagues are currently disabled.`
- Prize-league SCAFFOLDING (paid form fields, `entryFee`, `prizeDistribution`,
  `l.type === 'paid'` badges, `totalPrizePools` aggregate) stays in
  source — gated, not deleted. Re-enabling is a one-line flag flip.

### House Rules

- Optional free-text note from a private league's creator to its
  members. Stored on the league doc as
  `houseRules: { content, lastUpdatedAt, lastUpdatedBy } | null`.
- 500-char hard limit, enforced both client + server. Plain text
  only — `white-space: pre-wrap` preserves line breaks; no markdown,
  no link auto-linking in v1.
- Server actions in `api/leagues.js`:
  - `create` accepts `houseRules.content` (private leagues only)
  - `editHouseRules` — creator-only update
  - `acknowledgeHouseRules` — member opt-in stamp; idempotent
  - `reportContent` — generic UGC report (only `contentType: 'league_house_rules'` for v1)
- Acknowledgments live in `/leagueMemberAcks/{userId__leagueId}` so we
  know whether to expand or collapse the card on next view.
- localStorage cache (`goaloracle_hr_ack_${leagueId}_${userId}`) avoids
  a per-render fetch; server-side ack is best-effort.
- When the creator edits the rules, all per-member acks are reset and
  `houseRulesUpdatedSinceAck: true` is stamped so the card re-expands
  with an "Updated" badge on each member's next visit.
- Reports persist in `/contentReports` with `status: 'pending'`. No
  admin review tooling in v1 — operator queries Firestore manually.

### Components

| Component | Purpose |
|---|---|
| `HouseRulesInput` | Textarea + char counter; used in create + edit |
| `HouseRulesCard` | Collapsible card on league detail page |
| `HouseRulesJoinView` | Always-expanded display on join modal |
| `HouseRulesSection` | Self-contained wrapper: card + edit modal + report modal + localStorage ack |
| `ReportContentModal` | Generic UGC report form, reusable |

### ToS update

A new section 5 "User-generated league content" was added to `/terms`
clarifying that GoalOracle does not enforce or administer user-posted
content.

### Out-of-scope for v1

- Admin review tooling for `/contentReports` (operator queries Firestore directly)
- Voting / approval flows on rules changes (creator has unilateral edit)
- Markdown / link parsing in House Rules content (plain text only)
- Automatic notification when rules change (just the "Updated" badge on next view)

---

## Prize contest (as of May 2026)

GoalOracle launched a free-to-enter cash prize contest tied to the
Global Quick Picks League (`global-simple`). Top 3 finishers at end
of FIFA World Cup 2026 Final win **$150 / $100 / $50 in USDC**
(USDG on request) paid to winner-provided EVM wallets on Polygon.

### Where the legal+config lives

- **`src/config/legal.js`** — single source of truth for everything
  legal: `RULES_VERSION`, `PRIZES`, `SPONSOR_*`, `EXCLUDED_JURISDICTIONS`,
  `LAUNCH_DATE` / `GROUP_STAGE_LOCK_DATE` / `FINAL_DATE` (all bracketed
  placeholders until launch), notification + payout window constants.
- Don't hardcode prize amounts, dates, or sponsor info anywhere else.
- **`src/pages/OfficialRules.jsx`** renders the full rules from those
  constants. Bracketed placeholders show through visibly so we don't
  ship blanks.

### Sponsor

- **Suraam, LLC d/b/a GoalOracle** — Delaware LLC via Stripe Atlas.
- Footer copyright: `© 2026 Suraam, LLC`.
- `SPONSOR_ADDRESS` is currently `[STRIPE_ATLAS_DELAWARE_ADDRESS]` — replace once registration lands.

### Consent semantics

- New users: required eligibility checkbox at the bottom of `WelcomeFlow`. Submission blocked until checked. Captured at the earliest moment via `setContestConsent()` and stored on the user doc as `contestConsent: { rulesVersion, ageAttested, jurisdictionAttested, timestamp }`.
- Existing users (auto-joined to global-simple before this feature): `ContestConsentBanner` renders subtly above the home shell. Confirm → consent persisted. Dismiss → `prizeIneligible: true`. Banner self-hides via localStorage so it doesn't keep popping back.
- Helper functions: `hasCurrentConsent(user)` and `isPrizeIneligible(user)` in `src/config/legal.js`.
- **Bumping `RULES_VERSION` automatically re-prompts every user** — the banner re-appears because `hasCurrentConsent` returns false.

### Server-side

- `/api/user` accepts `consent: { rulesVersion, ageAttested, jurisdictionAttested }` + `prizeIneligible: bool` in the POST body. Validates shape (rejects malformed silently — doesn't block the request, since this endpoint also handles wallet/displayName updates). Persists `contestConsent.timestamp` as a server timestamp so we have a tamper-resistant audit trail.
- Auto-join to global-simple at signup is **unchanged** — consent is captured ASAP but doesn't gate league membership. Membership + contest eligibility are decoupled. A user can be in global-simple without being prize-eligible.

### Analytics events (GA4 + PostHog via track.js)

`track(event, params)` from `src/utils/track.js` dual-fires to **both** GA4 and PostHog on every call. Init lives in `src/main.jsx`:

- GA4 — via the `gtag` script tag in `index.html` + `window.gtag('event', ...)`.
- PostHog — `posthog.init()` runs at boot when `VITE_POSTHOG_KEY` env var is present. Hosted on US Cloud (`https://us.i.posthog.com`). Autocapture + page views + identified-only person profiles. Instance exposed as `window.posthog` for `track.js` to use without a circular import.

Local dev without `VITE_POSTHOG_KEY` set: PostHog init silently skips, everything else keeps working.

The 7 prize-contest funnel events: `prize_section_viewed`, `enter_free_cta_clicked`, `signup_started`, `signup_completed`, `eligibility_checkbox_checked`, `global_league_joined`, `first_prediction_submitted`.

### Out-of-scope for v1

- IP geo-blocking — disclosure in Official Rules is sufficient
- KYC / identity verification — prize values are below 1099 thresholds
- Automated payout — manual for World Cup 2026 (read leaderboard, email top 3, send USDC)
- Winner-notification email automation
- Tax form generation
- BIMI / verified mark certificate for support@ branded emails

## Recent work (as of April 2026)

**Quick Picks UX:**
- Renamed "Simple Mode" → "Quick Picks" and "Classic Mode" → "Classic Predictions" throughout user-facing strings.
- Per-group **Confirm ranking** button (so default alphabetical order can be locked without drag).
- Sticky progress bar + top-of-section Save & Continue on steps 1 and 2.
- Dashboard "Needs Your Prediction" section combines classic per-match cards with a consolidated Quick Picks card (league chips + progress + countdown to opener).

**Admin:**
- Inline league rename via pencil icon in Admin → Leagues. `api/admin.js` action `renameLeague` logs to `adminLogs`.

**User-facing:**
- **Reset my picks** buttons (both modes) with confirm dialog. Classic uses new `DELETE /api/predictions`; Quick Picks uses existing `resetSimplePrediction`.
- **Share my bracket** modal on Quick Picks detail page. Shows Champion / Runner-up / 3rd place with flags. X / Facebook / Instagram (copy caption) / Copy / native navigator.share. Screenshot-optimized for phones.
- **Browse leagues** is now a table, removed from nav (dashboard CTAs are the entry points).
- **WC countdown pill** (gold) floats over the hero stadium bg (dark-glass background for light-theme legibility).
- **FIFA compliance caption** under hero social-proof row: "GoalOracle's prediction engine is compliant with the official FIFA World Cup 26™ rulebook".
- **Leaderboard tabs** moved left, enlarged, renamed "Quick Picks Leaderboard" / "Classic Predictions Leaderboard".

## Recent work (as of May 2026 — auth, anti-sybil, admin, perf, onboarding)

Context for new/parallel sessions so this isn't re-discovered. Work happens on a short-lived feature branch (check `git branch` / recent `git log` for the current one), then fast-forwards to prod via `git push origin <branch>:main` after a `git merge-base --is-ancestor origin/main HEAD` guard — never force-push; `main` auto-deploys on Vercel (project `goalloracle`, team `sumitwkhan`). Confirm deploys with the Vercel MCP `list_deployments`. The user authorizes prod merges explicitly per request.

### Mobile sign-in (Safari) — `src/config/firebase.js`, `src/utils/auth.js`
- Auth uses `initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence, inMemoryPersistence], popupRedirectResolver })` — **not** `getAuth()`. Safari Private/ITP/Lockdown blocks IndexedDB, which broke `signInWithCustomToken`; the fallback chain degrades gracefully. Firestore already uses `memoryLocalCache()` for the same reason.
- `signInWithCustomTokenRetry()` in `auth.js` retries the token swap up to 3× **only** on `auth/network-request-failed` (a failed swap doesn't consume the token). Both email + Google paths use it. Failures post `/api/client-log` breadcrumbs (tag `auth.customtoken.error`, with UA).
- **Load-bearing — do NOT touch:** Google sign-in is GIS/FedCM (`src/utils/googleIdentity.js`, `use_fedcm_for_prompt`, `ux_mode:'popup'`); `authDomain` is hardcoded `auth.goaloracle.io` (PR #91/#93 history). These work on Chrome; changing them regresses mobile.

### Anti-sybil — `api/_lib/security.js`
- `MAX_ACCOUNTS_PER_FINGERPRINT` and `MAX_ACCOUNTS_PER_IP` are both **2** (block fires at `>=`). They were 1; raised to stop false positives.
- **Why false positives happen:** the client device id is open-source FingerprintJS, which **collides across same-model iPhones** (Safari normalizes signals) and drifts under ITP. A collision with any existing account previously hard-blocked a legit new user. So a "different device AND IP" block is almost always a fingerprint hash collision, not the IP check.
- Anti-sybil gates **only new-account creation** (`verify-code.js` / `google.js`); existing users are never blocked. Instant operator unblock: add the email to the **anti-sybil bypass list** (Admin Users tab UI, `/config/antiSybilBypass`, effective ≤60s) or use **Clear anti-sybil for user**.

### GeoIP location (no raw IP) — `getGeoFromRequest(req)` in `security.js`
- Reads Vercel edge headers `x-vercel-ip-country` / `-country-region` / `-city`. **Raw IP is never stored** (only the salted `signupIpHash`). Written to user docs as `geoCountry/geoRegion/geoCity/geoUpdatedAt` in **both** `api/user.js` login write paths. Forward-only (fills in on next login); **blank on localhost** (headers only exist on Vercel).

### Admin console — `src/components/AdminDashboard.jsx` + `api/admin.js`
- **Users tab is a sortable `<table>`** (was a card list): Name(+flag) / Email / Location / Leagues / QP-status pill / Joined / Role / Wallet / delete. Sort state `userSort={key,dir}`; helpers `_qpInfo`/`_locText`/`_userSortVal`/`toggleUserSort`. Prediction status (Quick Picks only) comes from `admin?type=usersQpStatus` (a `{userId→rollup}` map reusing the segments scan) → `fetchAdminUsersQpStatus()` in `db.js`.
- **"Global Submits" tab** (superadmin) views the `globalSubmitLog` audit (copy-to-Global) via `admin?type=globalSubmitLog` (resolves actor/user/league ids to names server-side).
- **My Leagues** (`LeaguesList` in `goaloracle.jsx`): superadmins get an **"All private leagues"** oversight section (every private league they're not in) via `fetchAdminLeaguesEnriched()`, read-only leaderboard link.
- **Nav** (`goaloracle.jsx`): single **"Join a league"** flat link → focuses the Browse passcode input (`browseFocusJoin` + `passInputRef`). (Supersedes the April note: "Browse leagues removed from nav.")

### Performance / edge-caching reads
- `api/simple-leaderboard.js` (backs the Global League hero ticker): reads run **concurrently** (`Promise.all` over the 30-id `in`-query batches) instead of sequential `for…await` — global-simple holds every user, so the old loop serialized into dozens of round-trips. Response is **edge-cached** `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`.
- **Pattern to reuse:** non-user-specific read endpoints edge-cache via `s-maxage` (`simple-consensus.js`, `spicy-stats.js`, `public.js`, `news.js`). Logged-in callers send an `Authorization` header and bypass the shared CDN cache, so freshness-sensitive users still get live data.

### Homepage + first-prediction landing (variant E)
- **First-time users** see the variant-E onboarding card in `FirstTimeBanner` (`src/components/Dashboard.jsx`): a single card with **Free Prizes** eyebrow, **"Win up to $150 in USDC"** headline, 3-tier podium ($150/$100/$50), live "Locks in Xd Xh Xm" countdown, **Steps to Enter** numbered list (3 actions, time estimates), single primary CTA. Uses real data: `PRIZES` from `src/config/legal.js` + `stageLockTimeUtc('groupStage')` from `src/utils/stageLock`. CTA reuses the existing `nav('detail', simpleL, { tab: 'predictions' })` wiring.
- **Zero-state `DashboardStrip` is intentionally hidden** for first-time users (`if (isFirstTime) return <FirstTimeBanner only/>`) — every metric was a discouraging zero/negative before the user had predicted anything. The strip returns automatically once `isFirstTime` is false.
- CSS lives under `.td-fp-*` in `src/styles.css` (right after `.td-onboard-cta`). Mobile @media tunes the whole card to ~400px on iPhone 16. Old `.td-onboard*` classes are still defined but no longer rendered.
- **Historical preview** at `/__first-pick-preview-q7m2x` (file `src/pages/FirstPickPreview.jsx`, route registered in `src/goaloracle.jsx`): 5 variants (A champion-first / B 3-step / C stakes / D minimal / E blend). E was the chosen design and is now live. Preview page kept for iteration; delete it + its route entries once the design is fully locked.
- **Homepage cleanup** (`src/goaloracle.jsx`): the old `lb-streaks-section` (Global Leaderboard preview + Streaks & Badges card, both rendered hardcoded mock data) was removed. Real in-league leaderboard (`SimpleDetail`) and `points.js` streak/badge logic untouched.

## Conventions

- **Commit style:** short imperative subject, 1–3 short paragraphs explaining why. Always include `https://claude.ai/code/session_...` trailer.
- **Never amend published commits.** Always create new ones.
- **Never push `--no-verify` or bypass hooks.**
- **Never commit `package-lock.json` churn** from local `npm install` unless package.json actually changed.
- **Don't add CLAUDE.md / README.md / docs unless asked.** (This file is the exception — the user requested it explicitly.)
- **Keep copy brief in user-facing strings.** No emojis unless user asks.
- **For React conditionals that depend on async state:** gate on a loaded sentinel (e.g., `quickPicks !== null`). Otherwise first-render flash becomes visible to users as a flicker.

## Roadmap (user-curated, May 2026)

Captured verbatim from operator — do NOT execute without explicit go-ahead; the operator said they'll come back to this. Treat as the canonical to-do list across sessions.

### 1. Richer admin Users data + sortability
Operator wants more than what shipped. **Already shipped in `4b7085a8a`**: sortable `<table>` with Name/Email/Location/Leagues/QP-status/Joined/Role columns; per-user `leagues` joined are visible. **Still wanted (verify with operator):** per-league prediction status (not just rollup), last activity per league, possibly per-league action affordances. If operator says "I can't see which league each user joined" after the deploy is live, first check they refreshed — that view exists. Then ask what additional dimensions they want.

### 2. Better email engagement + segmenting + deliverability
- Per-user / per-segment **pre-canned email templates** (extend the existing outreach templates in `api/_lib/outreachEmail.js`).
- **More granular segmentation** beyond today's A/B/C (Quick Picks funnel). Likely axes: country, time-since-signup, league count, prediction completeness per stage, days-until-stage-lock, last-login recency.
- **Automated segment-triggered emails** with urgency framing.
- **Inbox-placement work** (the "don't go to junk" ask). Pragmatic levers — confirm what's already set vs. add: SPF/DKIM/DMARC alignment, BIMI + VMC for the gold-checkmark in Gmail (`CLAUDE.md` already lists VMC as out-of-scope-for-v1 under the prize-contest section — revisit), low spam-trigger content (no `FREE!!`, no all-caps subjects, no shorteners), warmed sending IP/domain reputation, low complaint rates, Gmail Postmaster Tools monitoring, plain-text alternative for every multipart message, `List-Unsubscribe` header (one-click + mailto), consistent From address, dedicated subdomain (e.g. `mail.goaloracle.io`) separate from transactional. Operator specifically asked for "clever ways to make Google recognize it as important" — concrete tactics: schema.org `Promotion` markup in HTML, Gmail "high priority inbox" signals (engaged sending pattern), avoiding image-only emails.

### 3. Anonymous-prediction funnel with sign-up gates (HIGH-PRIORITY — operator flagged "very very important that this feature works")
- Let users **predict from the homepage without logging in** (group ranking + best thirds work as anonymous, persisted to localStorage).
- **Distinct sign-up prompts at key moments**, each tied to a specific value prop:
  - "to win free prizes" — when they hit the bracket / view the leaderboard
  - "to save your predictions" — when they leave a step or open another device
  - "to share your bracket" — when they tap any share affordance
- **Hard gate at the knockout bracket**: viewing the bracket screen is allowed, **completing it requires signup**. The Final-winner pick is what triggers the modal.
- After signup, **hydrate the user's saved local picks into Firestore** (no manual re-entry).
- Goal: top of the funnel. Critical that the flow doesn't lose picks across the signup boundary — that's the failure mode the operator was warning about.

### 4. FAQ / scoring page accuracy for Quick Picks (Classic is off)
- Update the FAQ + rules pages so Quick Picks rules are correctly reflected (Classic mode is currently feature-flagged off; rules copy probably still mixes both).
- **Copy note**: do **NOT** use "simple picks" — keep the user-facing name **"Quick Picks"** (per the long-standing CLAUDE.md convention).
- Add a subtle **"How does scoring work?"** tab or section on the Global League leaderboard page so a user can self-serve the answer without leaving the page.

## Open questions / deferred work

- **Fair-play points + FIFA ranking** cross-group tiebreakers are present as hooks in `thirdPlaceAllocation.js` but data model doesn't capture cards. For now `fairPlayPoints === 0` for everyone; tiebreaker effectively goes straight from "goals scored" to "FIFA ranking".
- **Within-group tiebreaker in `bracket.js#calcGroupStandings`** currently does pairwise H2H; the spec requires a mini-league among all still-tied teams. Acceptable because Classic users predict scores and real ties are rare, but flagged for a future pass.
- **`global` league rename** is allowed by the admin endpoint. If you want to lock it, add `if (leagueId === 'global') return res.status(400)...` to the `renameLeague` handler.
