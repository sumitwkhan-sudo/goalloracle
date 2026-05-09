---
description: Daily WC pipeline verification — tests + result-ingestion sanity checks
---

Run the daily World Cup verification routine and produce a status report.

Steps:

1. Run `node scripts/verify-results.mjs` (local checks only). Capture the exit code and full output.
2. If the user has `ADMIN_TOKEN` and `API_BASE` env vars set, also run with `--live` to exercise the deployed admin API. Otherwise note that live checks were skipped and tell the user how to enable them.
3. If any check failed, surface a `## What to investigate` section listing the specific failures and likely root causes:
   - **Test suite failed**: run `npm test` and inspect; usually a code change broke a unit test.
   - **Schedule integrity failed**: someone edited `src/data/matches.js` and broke a count or duplicated an ID.
   - **Annexe C failed**: `src/data/annexe-c.json` is corrupt — restore from git.
   - **Live result missing**: an oracle pull silently failed for a completed match. Check `/api/health` and oracle.js logs.
   - **Live result `disputed`**: the two oracle sources disagree on the match. Manual review needed; admin can resolve via `/api/admin?action=updateResult`.
   - **Live result `partial`**: only one source returned data. Wait for the second to come back, or override manually if it's been long enough.
4. End with a one-line summary: `All N checks passed` OR `K of N checks failed — see above`.

Run all checks even if early ones fail — the user wants the full picture, not the first failure.

To loop this daily during the tournament, the user can run `/loop 24h /wc-check`.
