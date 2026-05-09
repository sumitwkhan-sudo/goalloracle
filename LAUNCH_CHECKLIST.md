# GoalOracle — Pre-Launch Checklist

A plain-English guide to verifying the system is healthy before World Cup 26
kickoff (Jun 11, 2026 19:00 UTC). Follow top to bottom; each step is either
"click this in admin" or "look at this page in another tab".

You do NOT need a terminal for any of this. If a step asks you to do something
technical, ping me and I'll do it for you.

---

## Step 1 — Merge the security PR

Go to **https://github.com/sumitwkhan-sudo/goalloracle/pull/51** and click
**Merge pull request**. Vercel auto-deploys `main` to production within ~2
minutes. Wait for the deploy to finish (the green ✓ on the merge commit).

---

## Step 2 — Set up the daily cron (one-time)

Go to your Vercel project → **Settings → Environment Variables**. Add:

- `CRON_SECRET` = any long random string (e.g. mash your keyboard for 32+
  characters). Vercel uses this to authenticate the daily cleanup cron we
  built. Without it, the cron will still try to run but fall back to needing
  a superadmin token, which means it won't run automatically.

Save. No redeploy needed — Vercel picks up env changes for next invocation.

---

## Step 3 — Verify the admin dashboard works

Open https://goaloracle.io, sign in as yourself, click the **Admin** link in
your profile menu (you should already be a superadmin since you bootstrapped
the system).

Click around the tabs to confirm:

- **Matches** tab shows all 104 matches with "Edit Result" buttons.
- **Users** tab lists every user.
- **Leagues** tab lists every league. The pencil icon renames; the trash
  icon deletes.
- **Oracle** tab — read on for what to do here.

If any tab shows an error or is blank, screenshot it and tell me.

---

## Step 4 — Verify the result-feed APIs work (CRITICAL)

This is the most important pre-launch check. You're confirming the two
score-feed APIs we use can actually fetch a real match.

1. Open the admin dashboard → **Oracle** tab.
2. Click **Run Health Check** at the top. Wait. You should see two big green
   "connected" badges for football-data.org and api-sports.io. If either is
   red:
   - Red because of "no key" → go to Vercel env vars, confirm
     `FOOTBALL_DATA_API_KEY` and `APISPORTS_API_KEY` are both set.
   - Red because of "rate limited" → wait 1 minute, click again.
   - Red because of "401" or "403" → the key in Vercel is wrong. Go to the
     respective provider dashboard and copy a fresh key into Vercel.

3. Scroll down to **Live End-to-End Test**. You'll see three buttons:
   - **Test EPL** — fetches a recent Premier League match and runs the full
     pipeline. **Click this.** You should see ~6 green ✓ rows in 5–15
     seconds. The bottom row says "two sources agree" — that's the one that
     matters most.
   - **Test UCL** — same thing for Champions League.
   - **Test WC** — World Cup. Probably won't have a recent match this far
     before the tournament; expect "no FINISHED matches in last 7 days" —
     that's fine. Re-run after Jun 11.

If "two sources agree" is red after Test EPL or Test UCL, **don't launch the
prediction game for prizes until we figure out why**. Screenshot and ping me.

---

## Step 5 — Run the league passcode migration (one-time)

PR #51 added a fix to hide private-league passcodes (used to be readable by
anyone). Existing private leagues need a one-time migration.

This needs a tiny code change to the admin dashboard which I haven't wired
up yet — it's a single API call. **Tell me when you're ready and I'll either
wire a button or do it for you.**

---

## Step 6 — Stage-lock spot check

The new stage-lock model: users can edit their bracket up until each round's
first match. After that, that round is frozen. To verify it actually works
in production:

1. From admin dashboard, click into any non-global league with at least one
   user (could be yourself).
2. Open the Quick Picks page for that league.
3. Try to make any pick. Should work normally before Jun 11.
4. **After Jun 11 19:00 UTC** (gs01 kicks off): try to change a group
   ranking. Should be blocked.

I can't simulate "after Jun 11" for you in production. The unit tests I wrote
verify the logic, but you'll get real confidence on day-1 by being the first
to try changing your group picks at, say, Jun 11 18:50 (5 min before — should
work) and Jun 11 19:01 (after kickoff — should fail with "Some Quick Picks
sections have already locked").

Honestly, if you don't want to do this, I can write a one-shot test mode
toggle that artificially locks the group stage now so you can verify in dev.

---

## Step 7 — Set up the daily verification

Once a day during the tournament, you want to confirm:
- All matches that should have results, do.
- No matches are stuck in "disputed" or "partial" oracle state.

Two ways to run it:

**Option A (easiest, no terminal):** Just open the admin dashboard's Oracle
tab once a day and click "Run Health Check" + "Test EPL" (or Test WC once
the tournament starts). If anything's red, ping me.

**Option B (automated):** I built a Claude Code slash command. From within
Claude Code, type `/wc-check` once a day, or `/loop 24h /wc-check` to run
it automatically. This requires Claude Code installed and the repo cloned
locally. If you want to set this up I can walk you through it, or you can
just do Option A.

---

## Step 8 — On match day (during the tournament)

Once a match finishes, here's what should happen automatically:

1. Within ~5 minutes of full-time, both oracles independently confirm the
   match is `FINISHED`.
2. Our system compares the two scores. If they match, it's stored as
   `verified: true` in the database.
3. Leaderboards re-render with the new result baked in. (Quick Picks scoring
   runs on every page load, so it picks up the new result on the next page
   refresh — there's no separate "scoring run".)

If a match seems stuck (it's been 30+ min since FT and the leaderboard
hasn't updated):

1. Open admin → **Matches** tab. Find the match. Does it have a result
   stored? If yes, the issue is leaderboard caching — refresh the page.
2. If no result is stored: open admin → **Oracle** tab → "Run Health Check".
   See if either oracle is broken.
3. If both oracles are green but the match is stuck, the problem is likely
   that our system hasn't been told to fetch this match yet. Right now the
   oracle ONLY runs when an admin presses "Run Oracle" for a specific match.
   You need to wire up a scheduled poller to fetch finished matches
   automatically — **this is a known gap and probably the next priority
   after merging PR #51**. Tell me when you want it built.

---

## What's automated (you don't need to do this)

- Test suite runs automatically on every PR (188 unit tests). If anything
  breaks, the PR turns red.
- Daily cleanup cron prunes anti-Sybil bookkeeping data older than 24h.
- Stage locks fire automatically based on UTC kickoff times.
- Sybil deterrents (IP rate limit + device fingerprint + email normalization)
  run on every signup attempt.

---

## What's NOT automated (real gaps you should know about)

1. **Scheduled match-result polling.** Right now you have to manually push
   a "Run Oracle" button per match in admin. There's no cron that walks
   recently-finished matches and pulls scores automatically. This will be
   tedious during the WC (60+ matches in 4 weeks). **Recommend building
   this before Jun 11.**

2. **Auto-rescore on result update.** If you correct a match result after
   it's been first scored (rare — operator typo or retroactive
   disqualification), Quick Picks scores re-render on next page load
   because scoring is computed on render, but no re-notification or audit
   log entry. Lower priority; you'd notice the discrepancy from
   reconciliation.

3. **Reconciliation UI.** I built `/api/admin?action=reconcile` but didn't
   wire a button for it. Use it from a tool like Postman or tell me to add
   the button.

---

## TL;DR — What you should actually do this week

1. **Merge PR #51.**
2. **Set `CRON_SECRET` in Vercel env vars.**
3. **Open admin dashboard → Oracle tab → click "Run Health Check" then "Test EPL".**
4. **Tell me to: (a) build the scheduled match-result poller, (b) wire the
   reconciliation button, (c) run the passcode migration.**

Three of those are buttons. One is me coding.
