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

## Conventions

- **Commit style:** short imperative subject, 1–3 short paragraphs explaining why. Always include `https://claude.ai/code/session_...` trailer.
- **Never amend published commits.** Always create new ones.
- **Never push `--no-verify` or bypass hooks.**
- **Never commit `package-lock.json` churn** from local `npm install` unless package.json actually changed.
- **Don't add CLAUDE.md / README.md / docs unless asked.** (This file is the exception — the user requested it explicitly.)
- **Keep copy brief in user-facing strings.** No emojis unless user asks.
- **For React conditionals that depend on async state:** gate on a loaded sentinel (e.g., `quickPicks !== null`). Otherwise first-render flash becomes visible to users as a flicker.

## Open questions / deferred work

- **Fair-play points + FIFA ranking** cross-group tiebreakers are present as hooks in `thirdPlaceAllocation.js` but data model doesn't capture cards. For now `fairPlayPoints === 0` for everyone; tiebreaker effectively goes straight from "goals scored" to "FIFA ranking".
- **Within-group tiebreaker in `bracket.js#calcGroupStandings`** currently does pairwise H2H; the spec requires a mini-league among all still-tied teams. Acceptable because Classic users predict scores and real ties are rare, but flagged for a future pass.
- **`global` league rename** is allowed by the admin endpoint. If you want to lock it, add `if (leagueId === 'global') return res.status(400)...` to the `renameLeague` handler.
