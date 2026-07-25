import { db, admin, applyCors, verifyAuth } from './_lib/firebase.js';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { recentDayIds, blankDay, computeHealthStatus, sumOutcomes } from './_lib/funnelHealth.js';
import { RANK_DIGEST_DEFAULTS, sanitizeConfigPatch } from './_lib/rankDigest.js';
import { calculateSimpleScore, scoreGroupStage } from '../src/utils/scoringSimple.js';
import { buildSimpleActuals, buildLiveGroupStandings } from './_lib/bracketResolver.js';
import { ipHash, normalizeBypassEmail, _invalidateBypassCache } from './_lib/security.js';
import { sendOperatorAlert } from './_lib/alerts.js';
import WORLD_CUP_MATCHES from '../src/data/matches.js';

async function getRole(userId) {
  const userSnap = await db.collection('users').doc(userId).get();
  if (!userSnap.exists) return null;
  return userSnap.data().role || null;
}

async function isAdmin(userId) {
  const role = await getRole(userId);
  return role === 'admin' || role === 'superadmin';
}

export default async function handler(req, res) {
  applyCors(req, res);
  if (req.method === 'OPTIONS') return res.status(200).json({});

  const claims = await verifyAuth(req);
  if (!claims) return res.status(401).json({ error: 'Unauthorized' });

  const userId = claims.userId;
  if (!(await isAdmin(userId))) return res.status(403).json({ error: 'Admin access required' });

  // GET: list match results or users
  if (req.method === 'GET') {
    const { type } = req.query;
    try {
      if (type === 'results') {
        const snap = await db.collection('matchResults').get();
        const results = {};
        snap.docs.forEach(d => { results[d.id] = d.data(); });
        return res.status(200).json({ results });
      } else if (type === 'users') {
        const snap = await db.collection('users').get();
        return res.status(200).json({ users: snap.docs.map(d => ({ id: d.id, ...d.data() })) });
      } else if (type === 'leaguesEnriched') {
        // Admin-only list: every league with creator display name + the
        // private-league passcode joined in server-side. Client can't
        // read the /leagues/{id}/private/auth subcollection where new-
        // format passcodes live (PR #121), so the join happens here.
        const leaguesSnap = await db.collection('leagues').get();
        const leagues = leaguesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Resolve creator displayName AND every member's displayName via
        // one batched user-doc fetch. Each league.createdBy + every entry
        // of league.members is a userId; many will repeat (a single user
        // is in multiple leagues, plus is themselves the creator). Build
        // the unique set first to keep the read count tight.
        const userIdSet = new Set();
        for (const l of leagues) {
          if (l.createdBy) userIdSet.add(l.createdBy);
          if (Array.isArray(l.members)) for (const m of l.members) if (m) userIdSet.add(m);
        }
        const userIds = Array.from(userIdSet);
        const creatorNames = {};
        const userNames = {};
        // db.getAll() accepts up to 1000 doc refs in a single round trip.
        // For larger admin populations chunk the calls so we don't trip
        // the limit. Round-trip count stays O(users / 1000).
        const CHUNK = 1000;
        for (let i = 0; i < userIds.length; i += CHUNK) {
          const slice = userIds.slice(i, i + CHUNK);
          const userRefs = slice.map(id => db.collection('users').doc(id));
          const userSnaps = await db.getAll(...userRefs);
          for (const snap of userSnaps) {
            if (snap.exists) {
              const d = snap.data();
              const name = d.displayName || d.username || null;
              if (name) {
                userNames[snap.id] = name;
                creatorNames[snap.id] = name;
              }
            }
          }
        }

        // Batch-fetch the private/auth subcollection doc for every
        // private league. Same pattern as lookupByPasscode in
        // api/leagues.js — one round trip via db.getAll on the per-
        // league auth refs.
        const privateLeagues = leagues.filter(l => l.visibility === 'private');
        const passcodes = {};
        if (privateLeagues.length > 0) {
          const authRefs = privateLeagues.map(l =>
            db.collection('leagues').doc(l.id).collection('private').doc('auth')
          );
          const authSnaps = await db.getAll(...authRefs);
          for (let i = 0; i < authSnaps.length; i++) {
            const snap = authSnaps[i];
            const leagueId = privateLeagues[i].id;
            if (snap.exists && snap.data()?.passcode) {
              passcodes[leagueId] = snap.data().passcode;
            }
          }
        }

        const enriched = leagues.map(l => ({
          ...l,
          creatorDisplayName: creatorNames[l.createdBy] || null,
          // Prefer subcollection (new format); fall back to legacy public
          // field for any league that pre-dates the subcollection refactor.
          passcode: passcodes[l.id] || l.passcode || null,
        }));

        // Return the userNames map alongside the leagues so the admin
        // dashboard can render member lists without making N more
        // requests. ~30 bytes per (userId, displayName) pair × thousands
        // of users = well under 200 KB, fine for an admin-only payload.
        return res.status(200).json({ leagues: enriched, userNames });
      } else if (type === 'automationRules') {
        // Operator-editable outreach automation rules (B2d). Plain read;
        // mutations go through the POST actions (superadmin-gated).
        const snap = await db.collection('automationRules').orderBy('createdAt', 'desc').get().catch(async () => {
          // createdAt may be missing on the very first rules; fall back to unordered.
          return await db.collection('automationRules').get();
        });
        const rules = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        return res.status(200).json({ rules });
      } else if (type === 'outreachScheduled') {
        // All scheduled outreach sends — pending up top, then recent
        // finished/cancelled for a short audit window. The drain cron
        // updates the status field, so this is just a read.
        const snap = await db.collection('outreachScheduled')
          .orderBy('scheduledFor', 'desc')
          .limit(50)
          .get();
        const items = snap.docs.map(d => {
          const data = d.data();
          const sf = data.scheduledFor;
          return {
            id: d.id,
            template: data.template,
            recipientCount: data.recipientCount || (data.userIds?.length || 0),
            scheduledForMs: sf?._seconds ? sf._seconds * 1000 : (sf?.toMillis?.() || data.scheduledForMs || null),
            status: data.status,
            scheduledBy: data.scheduledBy,
            attempted: data.attempted || 0,
            sent: data.sent || 0,
            skipped: data.skipped || 0,
            failed: data.failed || 0,
            cancelReason: data.cancelReason || null,
          };
        });
        // Pending first (soonest first), then everything else by
        // scheduledFor desc.
        items.sort((a, b) => {
          const aPend = a.status === 'pending' ? 0 : 1;
          const bPend = b.status === 'pending' ? 0 : 1;
          if (aPend !== bPend) return aPend - bPend;
          if (aPend === 0) return (a.scheduledForMs || 0) - (b.scheduledForMs || 0);
          return (b.scheduledForMs || 0) - (a.scheduledForMs || 0);
        });
        return res.status(200).json({ items });
      } else if (type === 'outreachRecentRuns') {
        // Last N runs from /outreachRuns plus aggregate per-template
        // delivery/open/click counts joined from /outreachSent. The
        // admin Outreach tab uses this to render the Recent runs panel.
        const limit = Math.min(Math.max(1, Number(req.query.limit) || 20), 100);
        const runsSnap = await db.collection('outreachRuns')
          .orderBy('triggeredAt', 'desc')
          .limit(limit)
          .get();
        const runs = runsSnap.docs.map(d => {
          const data = d.data();
          const ts = data.triggeredAt;
          return {
            id: d.id,
            template: data.template,
            triggeredBy: data.triggeredBy,
            triggeredAtMs: ts?._seconds ? ts._seconds * 1000 : (ts?.toMillis?.() || null),
            attempted: data.attempted || 0,
            sent: data.sent || 0,
            skipped: data.skipped || 0,
            failed: data.failed || 0,
            canary: !!data.canary,
          };
        });

        // Per-template aggregate stats across all /outreachSent docs.
        // Cheap — one query per template; the docs are small. Skip
        // gracefully if a template has zero history.
        const templateIds = Array.from(new Set(runs.map(r => r.template).filter(Boolean)));
        const templateStats = {};
        for (const tpl of templateIds) {
          const sentSnap = await db.collection('outreachSent')
            .where('template', '==', tpl)
            .get();
          let delivered = 0, opened = 0, clicked = 0, bounced = 0, complained = 0;
          let opens = 0, clicks = 0;
          for (const d of sentSnap.docs) {
            const data = d.data();
            if (data.deliveredAt) delivered++;
            if (data.firstOpenedAt) opened++;
            if (data.firstClickedAt) clicked++;
            if (data.bouncedAt) bounced++;
            if (data.complainedAt) complained++;
            opens += data.openCount || 0;
            clicks += data.clickCount || 0;
          }
          templateStats[tpl] = {
            totalSendRows: sentSnap.size,
            delivered, opened, clicked, bounced, complained,
            opens, clicks,
          };
        }

        return res.status(200).json({ runs, templateStats });
      } else if (type === 'winnerEligibility') {
        // One-click prize-eligibility screen for the top finishers (top 3 +
        // 2 alternates). Checks, per Official Rules v1.0.0:
        //  - contest consent on file for the CURRENT rules version
        //    (age + jurisdiction attested)
        //  - not explicitly opted out (prizeIneligible)
        //  - entry submitted before the group-stage lock (the Rules' entry
        //    cutoff — late knockout-only entrants don't qualify as written)
        //  - geo sanity vs excluded jurisdictions (WA/US, QC/CA) — the
        //    attestation is theirs, but a conflicting geo deserves review
        //  - payout wallet on file (informational, not an eligibility gate)
        const [{ readLeaderboardCache, rebuildLeaderboardCache }, legal, { stageLockTimeUtc }] = await Promise.all([
          import('./_lib/leaderboardCache.js'),
          import('../src/config/legal.js'),
          import('../src/utils/stageLock.js'),
        ]);
        let board = await readLeaderboardCache(db, 'global-simple', 60 * 60 * 1000);
        if (!board) board = await rebuildLeaderboardCache(db, admin, 'global-simple');
        const topRows = (board?.leaderboard || []).filter(r => r.hasSubmitted).slice(0, 5);
        if (topRows.length === 0) return res.status(200).json({ rows: [], rulesVersion: legal.RULES_VERSION });
        const cutoffMs = stageLockTimeUtc('groupStage');
        const snaps = await db.getAll(...topRows.map(r => db.collection('users').doc(r.userId)));
        const usersById = {};
        snaps.forEach(s => { if (s.exists) usersById[s.id] = s.data(); });
        const rows = topRows.map((r, i) => {
          const u = usersById[r.userId] || {};
          const consentOk = legal.hasCurrentConsent(u);
          const notOptedOut = !legal.isPrizeIneligible(u);
          const entryOk = typeof r.submittedAt === 'number' && r.submittedAt <= cutoffMs;
          const geoFlagged = (u.geoCountry === 'US' && u.geoRegion === 'WA') || (u.geoCountry === 'CA' && u.geoRegion === 'QC');
          return {
            place: i + 1,
            userId: r.userId,
            displayName: r.displayName || r.userId.slice(0, 8),
            email: u.email || null,
            points: r.totalScore || 0,
            submittedAtMs: typeof r.submittedAt === 'number' ? r.submittedAt : null,
            consentOk,
            consentVersion: u.contestConsent?.rulesVersion || null,
            notOptedOut,
            entryOk,
            geoOk: !geoFlagged,
            geo: [u.geoCountry, u.geoRegion].filter(Boolean).join('-') || null,
            wallet: u.walletAddress || null,
            eligible: consentOk && notOptedOut && entryOk && !geoFlagged,
          };
        });
        return res.status(200).json({ rows, rulesVersion: legal.RULES_VERSION, cutoffMs });
      } else if (type === 'surveyVotes') {
        // "What next?" survey results (votes recorded by /api/survey from the
        // Wrapped email's /next page). Vote docs are one-per-user (doc id
        // vote__{uid}) so counts are unique voters; comments listed newest
        // first for the operator to read.
        const snap3 = await db.collection('surveyVotes').get();
        const counts = { cl: 0, epl: 0, cricket: 0, wc2030: 0 };
        const comments = [];
        snap3.forEach((d) => {
          const v = d.data();
          if (v.type === 'vote' && counts[v.vote] !== undefined) counts[v.vote] += 1;
          if (v.type === 'comment' && v.comment) {
            const ts = v.createdAt;
            comments.push({
              comment: v.comment,
              vote: v.vote || null,
              uid: v.uid || null,
              createdAtMs: ts?._seconds ? ts._seconds * 1000 : (ts?.toMillis?.() || null),
            });
          }
        });
        comments.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
        return res.status(200).json({ counts, totalVotes: Object.values(counts).reduce((s, n) => s + n, 0), comments: comments.slice(0, 100) });
      } else if (type === 'koResolution') {
        // Knockout-resolution diagnostic. Answers "why is this knockout match
        // stuck on placeholders / not auto-verifying?" in one shot:
        //  - teams: { matchId: { home, away } } — resolved real matchups, for
        //    showing real names on the Match Results cards
        //  - blockers: matches whose stored result CANNOT decide a winner
        //    (e.g. penalties flagged with no shootout score on a level game),
        //    each with the downstream matches it is blocking. Fixing the
        //    blocker lets resolveActualBracket name the downstream games and
        //    the poll-results cron then auto-ingests + verifies them.
        const [{ resolvePerSideKnockouts }, { determineWinnerFromResult }, { getDownstreamMatchIds }] = await Promise.all([
          import('./_lib/bracketResolver.js'),
          import('./_lib/oracleParsers.js'),
          import('../src/utils/bracketUtils.js'),
        ]);
        const snap2 = await db.collection('matchResults').get();
        const results2 = {};
        snap2.forEach(d => { results2[d.id] = d.data(); });
        const { resolved, perSide } = resolvePerSideKnockouts(results2);

        const blockers = [];
        for (const [matchId, r] of Object.entries(results2)) {
          if (!matchId.startsWith('r32-') && !matchId.startsWith('r16-') && !matchId.startsWith('qf-') && !matchId.startsWith('sf-') && matchId !== '3rd' && matchId !== 'final') continue;
          if (r?.completed !== true) continue;
          if (determineWinnerFromResult(r) !== null) continue;
          const teams = resolved[matchId] || null;
          let reason;
          if (r.penalties === true && (typeof r.penHome !== 'number' || typeof r.penAway !== 'number')) {
            reason = 'penalties flagged but no shootout score stored — winner undecidable';
          } else if (typeof r.homeScore === 'number' && r.homeScore === r.awayScore) {
            reason = 'level score with no tiebreaker — knockout winner undecidable';
          } else {
            reason = 'result present but winner cannot be determined';
          }
          blockers.push({
            matchId,
            home: teams?.home || null,
            away: teams?.away || null,
            homeScore: r.homeScore ?? null,
            awayScore: r.awayScore ?? null,
            reason,
            blocking: getDownstreamMatchIds(matchId),
          });
        }
        // Per-side matchup names come from the shared resolver (same map the
        // public Standings tree consumes via /api/actual-bracket).
        return res.status(200).json({ teams: perSide, blockers });
      } else if (type === 'deletionLog') {
        // Account-deletion audit (rows written by the deleteUser admin action
        // and the self-serve DELETE /api/user flow). Deletions are rare, so
        // fetch by action filter (single-field index, no composite needed)
        // and sort newest-first in memory. Deleted users' docs are gone, so
        // the log row itself carries the name/email snapshot.
        const limit = Math.min(Math.max(1, Number(req.query.limit) || 100), 500);
        const snap = await db.collection('adminLogs')
          .where('action', 'in', ['self_delete_account', 'delete_user'])
          .limit(500)
          .get();
        const rows = snap.docs.map(d => {
          const data = d.data();
          const ts = data.timestamp;
          const rts = data.recoveredAt;
          return {
            id: d.id,
            action: data.action,
            targetUserId: data.targetUserId || null,
            targetEmail: data.targetEmail || null,
            targetDisplayName: data.targetDisplayName || null,
            adminId: data.adminId || null,
            reason: data.reason || null,
            deleted: data.deleted || null,
            timestampMs: ts?._seconds ? ts._seconds * 1000 : (ts?.toMillis?.() || null),
            recoveredAtMs: rts?._seconds ? rts._seconds * 1000 : (rts?.toMillis?.() || null),
          };
        }).sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0)).slice(0, limit);

        // Resolve the acting admin's name for admin-initiated deletions
        // (self-deletions have adminId === targetUserId, whose doc is gone —
        // the snapshot fields on the row cover those).
        const adminIdSet = new Set(rows.filter(r => r.action === 'delete_user' && r.adminId).map(r => r.adminId));
        const adminNames = {};
        if (adminIdSet.size > 0) {
          const snaps = await db.getAll(...Array.from(adminIdSet).map(id => db.collection('users').doc(id)));
          for (const s of snaps) {
            if (s.exists) adminNames[s.id] = s.data().displayName || s.data().email || null;
          }
        }
        for (const r of rows) {
          r.adminName = r.action === 'delete_user' ? (adminNames[r.adminId] || null) : null;
        }
        return res.status(200).json({ rows });
      } else if (type === 'globalSubmitLog') {
        // Copy-to-Global audit trail (rows written by writeAudit in
        // api/_lib/copyToGlobal.js). Resolves actor + target user IDs to
        // display names and league IDs to names server-side so the admin
        // table is human-readable. Newest first.
        const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), 200);
        const snap = await db.collection('globalSubmitLog')
          .orderBy('timestamp', 'desc')
          .limit(limit)
          .get();
        const rows = snap.docs.map(d => {
          const data = d.data();
          const ts = data.timestamp;
          return {
            id: d.id,
            actor: data.actor || null,
            userId: data.userId || null,
            sourceLeagueId: data.sourceLeagueId || null,
            targetLeagueId: data.targetLeagueId || null,
            mode: data.mode || null,
            outcome: data.outcome || null,
            reason: data.reason || null,
            lockedSections: data.lockedSections || null,
            timestampMs: ts?._seconds ? ts._seconds * 1000 : (ts?.toMillis?.() || null),
          };
        });

        // Resolve user display names for actor + target user. Skip the
        // literal system actor and unknowns. Capped at 200 rows -> <=400
        // refs, well under the getAll 1000 limit, so a single round trip.
        const userIdSet = new Set();
        for (const r of rows) {
          if (r.userId) userIdSet.add(r.userId);
          if (r.actor && r.actor !== 'system:auto-submit' && r.actor !== 'unknown') userIdSet.add(r.actor);
        }
        const userNames = {};
        const userIds = Array.from(userIdSet);
        if (userIds.length > 0) {
          const userSnaps = await db.getAll(...userIds.map(id => db.collection('users').doc(id)));
          for (const s of userSnaps) {
            if (s.exists) {
              const u = s.data();
              userNames[s.id] = u.displayName || u.username || u.email || null;
            }
          }
        }

        // Resolve league names (source + target).
        const leagueIdSet = new Set();
        for (const r of rows) {
          if (r.sourceLeagueId) leagueIdSet.add(r.sourceLeagueId);
          if (r.targetLeagueId) leagueIdSet.add(r.targetLeagueId);
        }
        const leagueNames = {};
        const leagueIds = Array.from(leagueIdSet);
        if (leagueIds.length > 0) {
          const leagueSnaps = await db.getAll(...leagueIds.map(id => db.collection('leagues').doc(id)));
          for (const s of leagueSnaps) {
            if (s.exists) leagueNames[s.id] = s.data().name || null;
          }
        }

        const enriched = rows.map(r => ({
          ...r,
          actorName: r.actor === 'system:auto-submit' ? null : (userNames[r.actor] || null),
          userName: userNames[r.userId] || null,
          sourceLeagueName: leagueNames[r.sourceLeagueId] || null,
          targetLeagueName: leagueNames[r.targetLeagueId] || null,
        }));

        return res.status(200).json({ rows: enriched });
      } else if (type === 'funnelHealth') {
        // No-login funnel monitoring (roadmap item C). Reads the daily
        // /funnelHealth counter docs (written by api/migrate-anon-picks.js
        // + api/client-log.js) and returns the last N days newest-first plus
        // a derived status banner. Vercel logs aren't queryable from the app,
        // so this is the operator's window into migration + custom-token
        // health without trawling runtime logs.
        const days = Math.min(Math.max(1, Number(req.query.days) || 7), 30);
        const ids = recentDayIds(days);
        const snaps = await db.getAll(...ids.map(id => db.collection('funnelHealth').doc(id)));
        const records = snaps.map((s, i) => {
          const base = blankDay(ids[i]);
          if (!s.exists) return base;
          const d = s.data();
          return {
            date: ids[i],
            migration: { ...base.migration, ...(d.migration || {}) },
            authCustomToken: {
              total: d.authCustomToken?.total || 0,
              transient: d.authCustomToken?.transient || 0,
              byCode: d.authCustomToken?.byCode || {},
              byStep: d.authCustomToken?.byStep || {},
            },
          };
        });
        return res.status(200).json({
          days: records,
          totals: sumOutcomes(records),
          ...computeHealthStatus(records),
        });
      } else if (type === 'rankDigestConfig') {
        // Daily leaderboard-movement email config (+ last run / pending
        // preview). Defaults merged so the UI always has a full shape.
        const snap = await db.collection('config').doc('rankDigest').get();
        const data = snap.exists ? snap.data() : {};
        const tsMs = (t) => (t?.toMillis ? t.toMillis() : (t?._seconds ? t._seconds * 1000 : null));
        const config = { ...RANK_DIGEST_DEFAULTS, ...data };
        // Serialize timestamps the client can render.
        if (config.lastSendAt) config.lastSendAtMs = tsMs(config.lastSendAt);
        delete config.lastSendAt;
        if (config.pendingPreview?.computedAt) {
          config.pendingPreview = { ...config.pendingPreview, computedAtMs: config.pendingPreview.computedAtMs || tsMs(config.pendingPreview.computedAt) };
          delete config.pendingPreview.computedAt;
        }
        return res.status(200).json({ config });
      } else if (type === 'usersQpStatus') {
        // Per-user Quick Picks prediction-status rollup for the admin Users
        // table. Same simplePredictions scan as type=segments; returned as a
        // { userId -> status } map so the client overlays it on the existing
        // user list (leagues + geo already ride on the raw user doc). Lazy-
        // loaded on tab open. Full-collection scan — fine at current scale.
        const [qpPredsSnap, qpLeaguesSnap] = await Promise.all([
          db.collection('simplePredictions').get(),
          db.collection('leagues').get(),
        ]);
        const qpTsMs = (t) => (t?._seconds ? t._seconds * 1000 : (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null)));
        const qpLeagueVis = {};
        qpLeaguesSnap.docs.forEach(d => { qpLeagueVis[d.id] = d.data()?.visibility || 'public'; });
        const qpHasAnyPicks = (d) => {
          const g = d.groupPredictions || {};
          if (Object.values(g).some(v => Array.isArray(v?.ranking) && v.ranking.filter(Boolean).length > 0)) return true;
          if (Array.isArray(d.bestThirdPicks) && d.bestThirdPicks.length > 0) return true;
          const ko = d.knockoutPredictions || {};
          if (Object.values(ko).some(a => Array.isArray(a) && a.length > 0)) return true;
          return false;
        };
        const status = {};
        const ensureQp = (uid) => (status[uid] || (status[uid] = {
          startedAny: false, completeAny: false, globalHasPicks: false,
          globalComplete: false, privateCompleteCount: 0, lastActivityMs: null,
          gGroups: 0, gThirds: 0, gBracket: 0,
        }));
        qpPredsSnap.docs.forEach(doc => {
          const id = doc.id;
          const data = doc.data();
          let userId, leagueId;
          const sepIdx = id.indexOf('__');
          if (sepIdx >= 0) { userId = id.slice(0, sepIdx); leagueId = id.slice(sepIdx + 2); }
          else { userId = id; leagueId = 'global-simple'; }
          userId = data.userId || userId;
          leagueId = data.leagueId || leagueId;
          const a = ensureQp(userId);
          const picks = qpHasAnyPicks(data);
          const complete = data.isComplete === true;
          if (picks) a.startedAny = true;
          if (complete) a.completeAny = true;
          const actMs = qpTsMs(data.updatedAt) || qpTsMs(data.submittedAt);
          if (actMs && (!a.lastActivityMs || actMs > a.lastActivityMs)) a.lastActivityMs = actMs;
          if (leagueId === 'global-simple') {
            if (picks) a.globalHasPicks = true;
            if (complete) a.globalComplete = true;
            // Per-section progress on the Global bracket → granular status
            // label in the admin Users table (Groups picked / Best thirds in /
            // Filling bracket), mirroring the leaderboard. Keep the max across
            // any legacy + composite global docs.
            const gd = Object.values(data.groupPredictions || {}).filter(v => Array.isArray(v?.ranking) && v.ranking.length === 4 && v.ranking.every(Boolean)).length;
            const td = Math.min(8, Array.isArray(data.bestThirdPicks) ? data.bestThirdPicks.filter(Boolean).length : 0);
            const ko = data.knockoutPredictions || {};
            let bd = 0;
            for (const k of ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final']) bd += (ko[k] || []).filter(p => p && p.winnerId).length;
            a.gGroups = Math.max(a.gGroups, gd);
            a.gThirds = Math.max(a.gThirds, td);
            a.gBracket = Math.max(a.gBracket, bd);
          } else if (leagueId !== 'global') {
            if (complete && qpLeagueVis[leagueId] === 'private') a.privateCompleteCount += 1;
          }
        });
        return res.status(200).json({ status });
      } else if (type === 'emailHistory') {
        // Per-user email-history rollup for the admin Users table + the
        // outreach recent-contact guardrail (item B1). Aggregates the
        // /outreachSent audit docs (keyed `${userId}__${template}`, written
        // on every send + stamped with delivery/open/click by the Resend
        // webhook) into { userId -> { lastTemplate, lastSentAtMs, totalSent,
        // lastOpenedAtMs } }. Lazy-loaded on Users-tab open, same pattern as
        // usersQpStatus. Full-collection scan — fine at current scale.
        const sentSnap = await db.collection('outreachSent').get();
        const emailTsMs = (t) => (t?._seconds ? t._seconds * 1000 : (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null)));
        const history = {};
        sentSnap.docs.forEach(doc => {
          const d = doc.data();
          const uid = d.userId;
          if (!uid) return;
          // Only count actually-sent emails toward contact history; a row
          // with sent:false is a failed attempt, not a contact.
          if (d.sent === false) return;
          const sentMs = emailTsMs(d.sentAt);
          const h = history[uid] || (history[uid] = {
            lastTemplate: null, lastSentAtMs: null, totalSent: 0, lastOpenedAtMs: null,
          });
          h.totalSent += 1;
          if (sentMs && (!h.lastSentAtMs || sentMs > h.lastSentAtMs)) {
            h.lastSentAtMs = sentMs;
            h.lastTemplate = d.template || null;
          }
          const openMs = emailTsMs(d.lastOpenedAt);
          if (openMs && (!h.lastOpenedAtMs || openMs > h.lastOpenedAtMs)) h.lastOpenedAtMs = openMs;
        });
        return res.status(200).json({ history });
      } else if (type === 'segments') {
        // ── User segmentation (read-only, Quick Picks only) ──────────
        // Scans users + every simplePredictions doc and buckets users:
        //   A) no QP bracket started in any league
        //   B) started somewhere but no bracket is isComplete
        //   C) completed a PRIVATE QP league but global-simple isn't
        //      complete (the auto-/manual-submit-to-global candidates)
        // Full-collection scan — fine at current scale (hundreds of
        // docs); revisit with pagination if simplePredictions grows large.
        const [segUsersSnap, predsSnap, segLeaguesSnap] = await Promise.all([
          db.collection('users').get(),
          db.collection('simplePredictions').get(),
          db.collection('leagues').get(),
        ]);
        const tsMs = (t) => (t?._seconds ? t._seconds * 1000 : (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null)));
        const leagueMeta = {};
        segLeaguesSnap.docs.forEach(d => {
          const x = d.data();
          leagueMeta[d.id] = { name: x.name || d.id, visibility: x.visibility || 'public' };
        });
        const hasAnyPicks = (d) => {
          const g = d.groupPredictions || {};
          if (Object.values(g).some(v => Array.isArray(v?.ranking) && v.ranking.filter(Boolean).length > 0)) return true;
          if (Array.isArray(d.bestThirdPicks) && d.bestThirdPicks.length > 0) return true;
          const ko = d.knockoutPredictions || {};
          if (Object.values(ko).some(a => Array.isArray(a) && a.length > 0)) return true;
          return false;
        };
        // Per-user rollup keyed by userId.
        const agg = {};
        const ensure = (uid) => (agg[uid] || (agg[uid] = {
          startedAny: false, completeAny: false,
          globalHasPicks: false, globalComplete: false,
          privateCompleteNames: new Set(), lastActivityMs: null,
        }));
        predsSnap.docs.forEach(doc => {
          const id = doc.id;
          const data = doc.data();
          // docId is `${userId}__${leagueId}` (composite) or legacy `${userId}`
          // (= global-simple). Prefer explicit fields, fall back to the id.
          let userId, leagueId;
          const sepIdx = id.indexOf('__');
          if (sepIdx >= 0) { userId = id.slice(0, sepIdx); leagueId = id.slice(sepIdx + 2); }
          else { userId = id; leagueId = 'global-simple'; }
          userId = data.userId || userId;
          leagueId = data.leagueId || leagueId;
          const a = ensure(userId);
          const picks = hasAnyPicks(data);
          const complete = data.isComplete === true;
          if (picks) a.startedAny = true;
          if (complete) a.completeAny = true;
          const actMs = tsMs(data.updatedAt) || tsMs(data.submittedAt);
          if (actMs && (!a.lastActivityMs || actMs > a.lastActivityMs)) a.lastActivityMs = actMs;
          if (leagueId === 'global-simple') {
            if (picks) a.globalHasPicks = true;
            if (complete) a.globalComplete = true;
          } else if (leagueId !== 'global') {
            const meta = leagueMeta[leagueId];
            if (complete && meta && meta.visibility === 'private') a.privateCompleteNames.add(meta.name);
          }
        });
        const baseRow = (u) => ({
          userId: u.id,
          email: u.email || null,
          displayName: u.displayName || u.username || null,
          country: u.country || null,
          lastLoginMs: tsMs(u.lastLoginAt),
          lastActivityMs: agg[u.id]?.lastActivityMs ?? null,
        });
        const A = [], B = [], C = [];
        segUsersSnap.docs.forEach(d => {
          const u = { id: d.id, ...d.data() };
          const a = agg[u.id];
          const started = a?.startedAny === true;
          const complete = a?.completeAny === true;
          if (!started) { A.push(baseRow(u)); return; }
          if (!complete) { B.push(baseRow(u)); return; }
          const privNames = a ? Array.from(a.privateCompleteNames) : [];
          if (privNames.length > 0 && !a.globalComplete) {
            C.push({ ...baseRow(u), privateLeagues: privNames, hasGlobalEntry: !!a.globalHasPicks, globalComplete: !!a.globalComplete });
          }
        });
        const byActivity = (x, y) => (y.lastActivityMs || 0) - (x.lastActivityMs || 0);
        A.sort(byActivity); B.sort(byActivity); C.sort(byActivity);
        return res.status(200).json({
          generatedAt: Date.now(),
          segments: {
            A: { count: A.length, users: A },
            B: { count: B.length, users: B },
            C: { count: C.length, users: C },
          },
        });
      } else if (type === 'qpUnsubmitted') {
        // ── Bracket health: full brackets stuck "not submitted" ──────────
        // Lists every /simplePredictions doc whose bracket is effectively
        // COMPLETE (a Final winner is picked — the same rule the leaderboard
        // uses) but whose stored isComplete flag is NOT true. That mismatch
        // is the class of users who finished a bracket yet show as
        // unsubmitted (it drove the copy-from-Global bug). Read-only scan;
        // the repairQpComplete POST action fixes rows in place.
        const [qpPredsSnap, qpLeaguesSnap] = await Promise.all([
          db.collection('simplePredictions').get(),
          db.collection('leagues').get(),
        ]);
        const qpTsMs = (t) => (t?._seconds ? t._seconds * 1000 : (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null)));
        const qpLeagueName = {};
        qpLeaguesSnap.docs.forEach(d => { qpLeagueName[d.id] = d.data().name || d.id; });
        const QP_BR = [['roundOf32', 16], ['roundOf16', 8], ['quarterFinals', 4], ['semiFinals', 2], ['thirdPlace', 1], ['final', 1]];
        const QP_TOTAL = 12 + 8 + 32;
        const qpUserIds = new Set();
        const qpRows = [];
        qpPredsSnap.docs.forEach(doc => {
          const id = doc.id;
          const data = doc.data();
          let uId, lId;
          const sep = id.indexOf('__');
          if (sep >= 0) { uId = id.slice(0, sep); lId = id.slice(sep + 2); }
          else { uId = id; lId = 'global-simple'; }
          uId = data.userId || uId;
          lId = data.leagueId || lId;
          const ko = data.knockoutPredictions || {};
          const hasFinalWinner = !!(ko?.final?.[0]?.winnerId);
          if (!hasFinalWinner) return;        // not yet "complete" by the canonical rule
          if (data.isComplete === true) return; // already correctly flagged — healthy
          const groups = data.groupPredictions || {};
          const groupsDone = Object.values(groups).filter(g => Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)).length;
          const thirds = Array.isArray(data.bestThirdPicks) ? data.bestThirdPicks : [];
          let bracketDone = 0;
          for (const [k] of QP_BR) bracketDone += (ko[k] || []).filter(p => p && p.winnerId).length;
          const picksLeft = Math.max(0, QP_TOTAL - (groupsDone + Math.min(thirds.filter(Boolean).length, 8) + bracketDone));
          qpUserIds.add(uId);
          qpRows.push({
            docId: id, userId: uId, leagueId: lId,
            leagueName: qpLeagueName[lId] || lId,
            picksLeft,
            updatedAtMs: qpTsMs(data.updatedAt),
            submittedAtMs: qpTsMs(data.submittedAt),
          });
        });
        // Resolve display names in batches of 30 (Firestore 'in' cap).
        const qpNameById = {};
        const qpIdArr = Array.from(qpUserIds);
        for (let i = 0; i < qpIdArr.length; i += 30) {
          const batch = qpIdArr.slice(i, i + 30);
          const us = await db.collection('users').where('id', 'in', batch).get();
          us.docs.forEach(d => { const u = d.data(); qpNameById[d.id] = u.displayName || u.email?.split('@')[0] || d.id.slice(0, 8); });
        }
        qpRows.forEach(r => { r.displayName = qpNameById[r.userId] || r.userId.slice(0, 8); });
        qpRows.sort((a, b) => (b.updatedAtMs || 0) - (a.updatedAtMs || 0));
        const qpByLeague = {};
        qpRows.forEach(r => {
          (qpByLeague[r.leagueId] || (qpByLeague[r.leagueId] = { leagueId: r.leagueId, leagueName: r.leagueName, count: 0 })).count++;
        });
        return res.status(200).json({
          generatedAt: Date.now(),
          total: qpRows.length,
          byLeague: Object.values(qpByLeague).sort((a, b) => b.count - a.count),
          rows: qpRows,
        });
      } else if (type === 'userInsights') {
        // ── User & prediction insights (read-only aggregates) ───────────
        // Demographics from the users collection + the "wisdom of the crowd"
        // from each user's GLOBAL Quick Picks bracket (the league everyone is
        // in). Returns raw names/codes + counts; the client maps flags/names.
        // Full-collection scan — same pattern as the segments scan.
        const [insUsersSnap, insPredsSnap, insLeaguesSnap] = await Promise.all([
          db.collection('users').get(),
          db.collection('simplePredictions').get(),
          db.collection('leagues').get(),
        ]);
        // leagueId -> visibility ('private' | 'public' | ...), for splitting
        // identical-bracket counts by league type.
        const leagueVisibility = {};
        insLeaguesSnap.docs.forEach(d => { leagueVisibility[d.id] = d.data().visibility || 'public'; });
        const insTsMs = (t) => (t?._seconds ? t._seconds * 1000 : (typeof t?.toMillis === 'function' ? t.toMillis() : (typeof t === 'number' ? t : null)));
        const NOW = Date.now();
        const DAY = 86400000;

        // Demographics.
        const totalUsers = insUsersSnap.size;
        const countryCounts = {};
        let withWallet = 0;
        let newLast7 = 0;
        let newLast30 = 0;
        // Set of signed-up user ids. A global-simple prediction doc whose uid
        // is NOT in here is an anonymous (un-converted) visitor — no /users
        // doc was ever created for them. Used for the "anon starters" insight.
        const usersIdSet = new Set();
        insUsersSnap.docs.forEach(d => {
          usersIdSet.add(d.id);
          const u = d.data();
          const code = u.country || u.geoCountry;
          if (code) countryCounts[code] = (countryCounts[code] || 0) + 1;
          if (u.walletAddress) withWallet += 1;
          const created = insTsMs(u.createdAt) || insTsMs(u.joinedAt);
          if (created && created >= NOW - 7 * DAY) newLast7 += 1;
          if (created && created >= NOW - 30 * DAY) newLast30 += 1;
        });

        // Predictions: pick each user's global-simple bracket (prefer the
        // composite doc over the legacy single-doc) and tally the crowd.
        const globalByUser = {};
        const nonGlobalByUser = {}; // uid -> [{ leagueId, data }] for non-global QP leagues
        const startedUserIds = new Set();
        const insHasPicks = (data) => {
          const g = data.groupPredictions || {};
          if (Object.values(g).some(v => Array.isArray(v?.ranking) && v.ranking.filter(Boolean).length > 0)) return true;
          if (Array.isArray(data.bestThirdPicks) && data.bestThirdPicks.length > 0) return true;
          const ko = data.knockoutPredictions || {};
          return Object.values(ko).some(a => Array.isArray(a) && a.length > 0);
        };
        insPredsSnap.docs.forEach(d => {
          const id = d.id;
          const data = d.data();
          let uId, lId;
          const sep = id.indexOf('__');
          if (sep >= 0) { uId = id.slice(0, sep); lId = id.slice(sep + 2); }
          else { uId = id; lId = 'global-simple'; }
          uId = data.userId || uId;
          lId = data.leagueId || lId;
          if (insHasPicks(data)) startedUserIds.add(uId);
          if (lId === 'global-simple') {
            // Composite doc (has '__') wins over the legacy single-id doc.
            if (!globalByUser[uId] || sep >= 0) globalByUser[uId] = data;
          } else if (lId && lId !== 'global') {
            // A user's bracket in a non-global Quick Picks league.
            (nonGlobalByUser[uId] = nonGlobalByUser[uId] || []).push({ leagueId: lId, data });
          }
        });

        // ── Identical brackets: how many users have the SAME Quick Picks in a
        // non-global league as in the Global League (i.e. copied their Global
        // bracket and left it unchanged). Compares a canonical signature of
        // the three pick sections so incidental field-order / extra-flag
        // differences don't count as a mismatch; only non-empty brackets are
        // compared. Split by league visibility (private vs public).
        const KO_ROUNDS = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
        const GROUP_KEYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
        const bracketSig = (d) => {
          const g = d.groupPredictions || {};
          const groups = GROUP_KEYS.map(L => `${L}:${(g[L]?.ranking || []).map(x => x || '').join('>')}`).join('|');
          const thirds = (Array.isArray(d.bestThirdPicks) ? d.bestThirdPicks : []).slice().sort().join(',');
          const ko = d.knockoutPredictions || {};
          const koSig = KO_ROUNDS.map(r =>
            `${r}:${(ko[r] || []).map(p => `${p?.matchId || ''}=${p?.winnerId || ''}`).sort().join(',')}`).join('|');
          return `${groups}#${thirds}#${koSig}`;
        };
        let identicalUsers = 0;          // users with >=1 non-global league identical to Global
        let identicalPairs = 0;          // (user, league) identical pairs
        let identicalPrivatePairs = 0;
        let identicalPublicPairs = 0;
        let usersWithNonGlobal = 0;      // denominator: users with >=1 non-global QP bracket
        for (const [uid, leagues] of Object.entries(nonGlobalByUser)) {
          const gdoc = globalByUser[uid];
          const withPicks = leagues.filter(l => insHasPicks(l.data));
          if (withPicks.length > 0) usersWithNonGlobal += 1;
          if (!gdoc || !insHasPicks(gdoc)) continue;
          const gsig = bracketSig(gdoc);
          let userHasIdentical = false;
          for (const l of withPicks) {
            if (bracketSig(l.data) === gsig) {
              identicalPairs += 1;
              userHasIdentical = true;
              if (leagueVisibility[l.leagueId] === 'private') identicalPrivatePairs += 1;
              else identicalPublicPairs += 1;
            }
          }
          if (userHasIdentical) identicalUsers += 1;
        }

        // ── Cross-user duplicate brackets in the GLOBAL League: different
        // users whose Global bracket is byte-for-byte identical. These users
        // are GUARANTEED the same final score regardless of results — the
        // deterministic answer to "will anyone tie on points". (Non-identical
        // brackets can also tie depending on outcomes, but that's results-
        // dependent and can't be known up front.) Group by canonical signature.
        const sigToUsers = {};
        for (const [uid, gdoc] of Object.entries(globalByUser)) {
          if (!insHasPicks(gdoc)) continue;
          const sig = bracketSig(gdoc);
          (sigToUsers[sig] = sigToUsers[sig] || []).push(uid);
        }
        const hasFinalWinner = (d) => !!d?.knockoutPredictions?.final?.[0]?.winnerId;
        let dupUsers = 0;            // users sharing their exact bracket with >=1 other
        let dupClusters = 0;        // distinct brackets shared by >=2 users
        let dupUsersComplete = 0;   // of those, brackets with a Final winner
        let largestCluster = 0;
        const clusterSizes = [];
        for (const uids of Object.values(sigToUsers)) {
          if (uids.length < 2) continue;
          dupClusters += 1;
          dupUsers += uids.length;
          largestCluster = Math.max(largestCluster, uids.length);
          clusterSizes.push(uids.length);
          for (const u of uids) if (hasFinalWinner(globalByUser[u])) dupUsersComplete += 1;
        }
        clusterSizes.sort((a, b) => b - a);
        const globalWithPicks = Object.values(globalByUser).filter(insHasPicks).length;

        const championCounts = {};
        const runnerUpCounts = {};
        const bestThirdCounts = {};
        let championPicks = 0;
        let runnerUpPicks = 0;
        let bestThirdPicks = 0;
        let completedGlobal = 0;
        Object.values(globalByUser).forEach(doc => {
          const ko = doc.knockoutPredictions || {};
          const groups = doc.groupPredictions || {};
          const finalPick = ko.final?.[0];
          const champ = finalPick?.winnerId;
          const runner = finalPick?.loserId;
          if (champ) { championCounts[champ] = (championCounts[champ] || 0) + 1; championPicks += 1; completedGlobal += 1; }
          if (runner) { runnerUpCounts[runner] = (runnerUpCounts[runner] || 0) + 1; runnerUpPicks += 1; }
          const thirds = Array.isArray(doc.bestThirdPicks) ? doc.bestThirdPicks : [];
          thirds.forEach(letter => {
            const team = groups[letter]?.ranking?.[2]; // 3rd in the user's ranking
            if (team) { bestThirdCounts[team] = (bestThirdCounts[team] || 0) + 1; bestThirdPicks += 1; }
          });
        });

        // ── Anonymous starters (item C): visitors who made picks but never
        // signed up. A global-simple bracket whose uid has no /users doc.
        // globalByUser is already deduped (composite doc wins), so iterating
        // it counts each anon visitor once. Country comes from the geo we
        // stamp on anon saves (api/simple-predictions.js); 'unknown' until a
        // save lands with edge headers (blank on localhost / pre-feature).
        const anonCountryCounts = {};
        let anonStarted = 0;
        let anonCompleted = 0;     // reached a Final winner
        let anonGroupsOnly = 0;    // has picks but no Final winner yet
        Object.entries(globalByUser).forEach(([uId, doc]) => {
          if (usersIdSet.has(uId)) return;     // signed-up — not anonymous
          if (!insHasPicks(doc)) return;       // no picks — not a starter
          anonStarted += 1;
          const code = doc.geoCountry || 'unknown';
          anonCountryCounts[code] = (anonCountryCounts[code] || 0) + 1;
          if (doc.knockoutPredictions?.final?.[0]?.winnerId) anonCompleted += 1;
          else anonGroupsOnly += 1;
        });
        const anonCountriesTop = Object.entries(anonCountryCounts)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 12)
          .map(([code, count]) => ({ code, count }));

        const topN = (obj, n) => Object.entries(obj)
          .sort((a, b) => b[1] - a[1])
          .slice(0, n)
          .map(([name, count]) => ({ name, count }));

        return res.status(200).json({
          generatedAt: NOW,
          totals: {
            totalUsers,
            started: startedUserIds.size,
            completedGlobal,
            withWallet,
            newLast7,
            newLast30,
            countries: Object.keys(countryCounts).length,
          },
          champions: { total: championPicks, top: topN(championCounts, 12) },
          runnersUp: { total: runnerUpPicks, top: topN(runnerUpCounts, 10) },
          bestThirds: { total: bestThirdPicks, top: topN(bestThirdCounts, 10) },
          countries: {
            total: Object.values(countryCounts).reduce((s, n) => s + n, 0),
            top: Object.entries(countryCounts).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([code, count]) => ({ code, count })),
          },
          anonStarters: {
            total: anonStarted,
            completed: anonCompleted,
            groupsOnly: anonGroupsOnly,
            withCountry: anonStarted - (anonCountryCounts.unknown || 0),
            countries: { total: anonStarted, top: anonCountriesTop },
          },
          identicalBrackets: {
            users: identicalUsers,            // people whose Global == a non-global league
            pairs: identicalPairs,            // identical (user, league) pairs
            privatePairs: identicalPrivatePairs,
            publicPairs: identicalPublicPairs,
            usersWithNonGlobal,               // denominator: users in any non-global QP league
          },
          globalDuplicates: {
            dupUsers,                 // users sharing an identical Global bracket with someone else
            dupClusters,              // distinct brackets shared by >=2 users
            dupUsersComplete,         // of dupUsers, those with a full bracket (Final winner)
            largestCluster,           // biggest group of identical brackets
            globalWithPicks,          // denominator: users with any Global picks
            topClusters: clusterSizes.slice(0, 8),
          },
        });
      }
      return res.status(400).json({ error: 'Invalid type' });
    } catch (e) {
      return res.status(500).json({ error: e.message });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body;

  try {
    if (action === 'updateResult') {
      const { matchId, homeScore, awayScore, extraTime, penalties, penHome, penAway } = req.body;
      if (!matchId || homeScore === undefined || awayScore === undefined) {
        return res.status(400).json({ error: 'Missing match data' });
      }

      // Penalty shootouts MUST carry the shootout score — it is the only
      // signal the bracket resolver + scoring have for who advanced (a level
      // score with just a penalties flag is undecidable, which left the
      // bracket unpopulated and the match unscored for everyone).
      let newPenH = null;
      let newPenA = null;
      if (penalties) {
        newPenH = parseInt(penHome);
        newPenA = parseInt(penAway);
        if (Number.isNaN(newPenH) || Number.isNaN(newPenA) || newPenH < 0 || newPenA < 0) {
          return res.status(400).json({ error: 'Penalty shootout score required (penHome/penAway) when penalties is set.' });
        }
        if (newPenH === newPenA) {
          return res.status(400).json({ error: 'Shootout score cannot be level — one side wins the shootout.' });
        }
      }

      // Detect re-score: if a verified result already exists with different
      // numbers, this is a correction (operator typo or retroactive
      // disciplinary action). Quick Picks scoring re-renders on every page
      // load so user leaderboards self-correct, but the operator should
      // know this happened — alert email plus extended audit log entry.
      const prevSnap = await db.collection('matchResults').doc(matchId).get();
      const prev = prevSnap.exists ? prevSnap.data() : null;
      const newH = parseInt(homeScore);
      const newA = parseInt(awayScore);
      const isCorrection = prev?.completed === true && (
        prev.homeScore !== newH ||
        prev.awayScore !== newA ||
        !!prev.extraTime !== !!extraTime ||
        !!prev.penalties !== !!penalties ||
        (penalties && ((prev.penHome ?? null) !== newPenH || (prev.penAway ?? null) !== newPenA))
      );

      await db.collection('matchResults').doc(matchId).set({
        matchId,
        homeScore: newH,
        awayScore: newA,
        extraTime: extraTime || false,
        penalties: penalties || false,
        ...(penalties ? { penHome: newPenH, penAway: newPenA } : { penHome: FieldValue.delete(), penAway: FieldValue.delete() }),
        completed: true,
        updatedBy: userId,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      if (isCorrection) {
        await sendOperatorAlert(
          `Match result corrected: ${matchId}`,
          {
            what: `An admin (${userId}) just changed a previously-verified match result. Quick Picks scores are recomputed automatically right after this change (and again on every poll), so the leaderboard will reflect the new numbers within moments. No manual rescore needed — but you should know this happened in case it was unintended.`,
            why: [
              'Operator typo on the original result entry',
              'VAR overturn / retroactive disciplinary action that the oracle hadn\'t picked up',
              'Manual override of an oracle-verified score',
            ],
            resolution: [
              'If this was you and intentional: ignore this email.',
              'If this was unexpected: check adminLogs for `update_match_result` entries on this match to see who changed it and when.',
              `Match: ${matchId}. Previous: ${prev.homeScore}-${prev.awayScore} (ET=${!!prev.extraTime}, PEN=${!!prev.penalties}). New: ${newH}-${newA} (ET=${!!extraTime}, PEN=${!!penalties}).`,
            ],
            context: {
              matchId,
              previous: `${prev.homeScore}-${prev.awayScore} ET=${!!prev.extraTime} PEN=${!!prev.penalties}`,
              new: `${newH}-${newA} ET=${!!extraTime} PEN=${!!penalties}`,
              changedBy: userId,
            },
          },
        );
      }

      // Log admin action
      await db.collection('adminLogs').add({
        action: 'update_match_result',
        matchId,
        result: { homeScore, awayScore, extraTime, penalties },
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      // Recompute Quick Picks scores immediately so a manual result entry
      // or correction reflects on the leaderboard right away, rather than
      // waiting for the next poll-results cron tick. Best-effort: a scoring
      // failure must not fail the result save (the result is already
      // persisted; the next poll/edit will recompute). Same engine the cron
      // uses, so the numbers match.
      try {
        const [{ buildSimpleActuals }, { recomputeSimpleScores }] = await Promise.all([
          import('./_lib/bracketResolver.js'),
          import('./_lib/computeSimpleScores.js'),
        ]);
        const freshSnap = await db.collection('matchResults').get();
        const fresh = {};
        freshSnap.docs.forEach((d) => { fresh[d.id] = d.data(); });
        await recomputeSimpleScores(db, buildSimpleActuals(fresh));
        // Fresh scores → rebuild the materialized global leaderboard so the
        // cached board shows the corrected points right away.
        const { rebuildLeaderboardCache } = await import('./_lib/leaderboardCache.js');
        await rebuildLeaderboardCache(db, admin, 'global-simple');
      } catch (e) {
        console.error('[admin updateResult] score recompute failed (non-fatal):', e?.message || e);
      }

      return res.status(200).json({ success: true });

    } else if (action === 'setRole') {
      const { targetUserId, newRole } = req.body;
      if (!targetUserId || !newRole) return res.status(400).json({ error: 'Missing user/role' });
      if (!['user', 'admin', 'superadmin'].includes(newRole)) return res.status(400).json({ error: 'Invalid role' });

      // Only superadmins can grant or revoke superadmin. Plain admins can
      // only flip between 'user' and 'admin'.
      const callerRole = await getRole(userId);
      if (newRole === 'superadmin' && callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can assign the superadmin role' });
      }
      const targetCurrentRole = await getRole(targetUserId);
      if (targetCurrentRole === 'superadmin' && callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can change a superadmin' });
      }

      await db.collection('users').doc(targetUserId).update({ role: newRole });
      await db.collection('adminLogs').add({
        action: 'set_user_role',
        targetUserId,
        newRole,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true });

    } else if (action === 'deleteUser') {
      // Permanently delete a user account. Wipes:
      //  - /users/{id}
      //  - /predictions where userId == id (classic mode)
      //  - /simplePredictions where userId == id (Quick Picks, every league)
      //  - membership in every league.members array they appear in
      //  - their entry in deviceFingerprints + signupIps
      //  - their Firebase Auth account (so their Google login can't recreate
      //    the same UID and silently re-attach to a stale doc)
      //
      // Superadmin-only. Cannot delete yourself or another superadmin.
      const { targetUserId } = req.body;
      if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });
      if (targetUserId === userId) return res.status(400).json({ error: "Can't delete yourself" });

      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can delete a user' });
      }

      const targetSnap = await db.collection('users').doc(targetUserId).get();
      if (!targetSnap.exists) return res.status(404).json({ error: 'User not found' });
      const target = targetSnap.data();
      if (target.role === 'superadmin') {
        return res.status(403).json({ error: "Can't delete a superadmin. Demote first." });
      }

      // Shared with the self-serve "Delete my account" flow (DELETE /api/user)
      // — one wipe routine, two authorization wrappers.
      const { deleteUserAccount } = await import('./_lib/deleteUserAccount.js');
      const deleted = await deleteUserAccount(db, admin, targetUserId);

      await db.collection('adminLogs').add({
        action: 'delete_user',
        targetUserId,
        targetEmail: target.email || null,
        targetDisplayName: target.displayName || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        deleted,
      });

      return res.status(200).json({ success: true, deleted });

    } else if (action === 'recoverDeletedUser') {
      // Undo an account deletion using Firestore Point-in-Time Recovery: read
      // the user's docs as they existed just BEFORE the deletion (read-only
      // transaction at a pre-deletion readTime) and write them back. Requires
      // PITR enabled on the database (7-day window); without PITR, Firestore
      // still serves reads up to 1 hour back. The login flow re-attaches
      // automatically: findUserByDedupeKey resolves the restored doc → same
      // UID → custom-token sign-in recreates the Firebase Auth record.
      //
      // Superadmin-only. `deletedAtMs` comes from the Deletions-tab log row;
      // we read at a whole-minute timestamp ≥2 min before it (PITR reads
      // older than 1h must be minute-aligned). `logId` (optional) is the
      // adminLogs row to stamp recoveredAt on, so the tab shows it and the
      // button disappears.
      const { targetUserId, deletedAtMs, logId } = req.body;
      if (!targetUserId || !deletedAtMs) return res.status(400).json({ error: 'Missing targetUserId or deletedAtMs' });

      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can recover a user' });
      }

      // Never clobber a live account (e.g. they already re-signed-up — in
      // that case delete the fresh stub first, then recover).
      const curSnap = await db.collection('users').doc(targetUserId).get();
      if (curSnap.exists) {
        return res.status(409).json({ error: 'A user doc with this ID already exists — recovery would overwrite it. If they re-signed-up, delete the new stub account first.' });
      }

      const readMs = Math.floor((Number(deletedAtMs) - 2 * 60 * 1000) / 60000) * 60000;
      if (Date.now() - readMs > 6.5 * 24 * 60 * 60 * 1000) {
        return res.status(400).json({ error: 'Deletion is older than the 7-day PITR window — not recoverable.' });
      }
      if (readMs >= Date.now()) {
        return res.status(400).json({ error: 'deletedAtMs is in the future — check the timestamp.' });
      }

      // Snapshot everything at the pre-deletion instant.
      let userDoc = null;
      let simpleDocs = [];
      let classicDocs = [];
      let memberDocs = [];
      let scoreDocs = [];
      await db.runTransaction(async (t) => {
        const u = await t.get(db.collection('users').doc(targetUserId));
        if (!u.exists) throw new Error('No user doc at the recovery timestamp — the deletion time may be off, or this ID never existed.');
        userDoc = u.data();
        const sp = await t.get(db.collection('simplePredictions').where('userId', '==', targetUserId));
        simpleDocs = sp.docs.map(d => ({ id: d.id, data: d.data() }));
        const cp = await t.get(db.collection('predictions').where('userId', '==', targetUserId));
        classicDocs = cp.docs.map(d => ({ id: d.id, data: d.data() }));
        const leagues = Array.isArray(userDoc.leagues) ? userDoc.leagues : [];
        for (const lid of leagues) {
          const m = await t.get(db.collection('leagues').doc(lid).collection('members').doc(targetUserId));
          if (m.exists) memberDocs.push({ leagueId: lid, data: m.data() });
          const sc = await t.get(db.collection('simplePredictions').doc(targetUserId).collection('scores').doc(lid));
          if (sc.exists) scoreDocs.push({ leagueId: lid, data: sc.data() });
        }
      }, { readOnly: true, readTime: Timestamp.fromMillis(readMs) });

      // Write everything back. set() (not merge) — the docs don't exist.
      const batch = db.batch();
      batch.set(db.collection('users').doc(targetUserId), userDoc);
      for (const d of simpleDocs) batch.set(db.collection('simplePredictions').doc(d.id), d.data);
      for (const d of classicDocs) batch.set(db.collection('predictions').doc(d.id), d.data);
      for (const m of memberDocs) batch.set(db.collection('leagues').doc(m.leagueId).collection('members').doc(targetUserId), m.data);
      for (const s of scoreDocs) batch.set(db.collection('simplePredictions').doc(targetUserId).collection('scores').doc(s.leagueId), s.data);
      await batch.commit();

      // Re-add league membership (members array + memberCount) — idempotent.
      const leagues = Array.isArray(userDoc.leagues) ? userDoc.leagues : [];
      for (const lid of leagues) {
        const lSnap = await db.collection('leagues').doc(lid).get();
        if (!lSnap.exists) continue;
        const members = lSnap.data().members || [];
        if (!members.includes(targetUserId)) {
          await db.collection('leagues').doc(lid).update({
            members: FieldValue.arrayUnion(targetUserId),
            memberCount: FieldValue.increment(1),
          }).catch(e => console.warn(`[recoverUser] failed to re-add to ${lid}:`, e.message));
        }
      }

      // Mark the original deletion-log row so the tab shows "Recovered".
      if (logId) {
        await db.collection('adminLogs').doc(logId).update({
          recoveredAt: FieldValue.serverTimestamp(),
          recoveredBy: userId,
        }).catch(() => {});
      }
      await db.collection('adminLogs').add({
        action: 'recover_user',
        targetUserId,
        targetEmail: userDoc.email || null,
        targetDisplayName: userDoc.displayName || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        recovered: {
          simplePredictions: simpleDocs.length,
          predictions: classicDocs.length,
          leagues: leagues.length,
          scores: scoreDocs.length,
        },
      });

      return res.status(200).json({
        success: true,
        recovered: {
          displayName: userDoc.displayName || null,
          email: userDoc.email || null,
          simplePredictions: simpleDocs.length,
          predictions: classicDocs.length,
          leagues: leagues.length,
          scores: scoreDocs.length,
        },
      });

    } else if (action === 'deleteLeague') {
      const { leagueId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });
      if (leagueId === 'global') return res.status(400).json({ error: 'Cannot delete the global league' });

      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });

      const league = leagueSnap.data();
      await db.collection('leagues').doc(leagueId).delete();

      await db.collection('adminLogs').add({
        action: 'delete_league',
        leagueId,
        leagueName: league.name,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      // Cleanup: remove league from member docs + delete predictions
      const memberIds = league.members || [];
      const cleanupPromises = memberIds.map(mid =>
        db.collection('users').doc(mid).update({ leagues: FieldValue.arrayRemove(leagueId) }).catch(() => {})
      );

      const predSnap = await db.collection('predictions').where('leagueId', '==', leagueId).get();
      const docs = predSnap.docs;
      for (let i = 0; i < docs.length; i += 500) {
        const batch = db.batch();
        docs.slice(i, i + 500).forEach(d => batch.delete(d.ref));
        cleanupPromises.push(batch.commit());
      }

      await Promise.all(cleanupPromises);

      return res.status(200).json({ success: true, deleted: leagueId });
    }

    if (action === 'renameLeague') {
      const { leagueId, name } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });
      const trimmed = (name || '').trim();
      if (!trimmed) return res.status(400).json({ error: 'Name is required' });
      if (trimmed.length > 60) return res.status(400).json({ error: 'Name too long (max 60 chars)' });

      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const prevName = leagueSnap.data().name || null;
      if (prevName === trimmed) return res.status(200).json({ success: true, name: trimmed, unchanged: true });

      await db.collection('leagues').doc(leagueId).update({ name: trimmed });
      await db.collection('adminLogs').add({
        action: 'rename_league',
        leagueId,
        previousName: prevName,
        newName: trimmed,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });

      return res.status(200).json({ success: true, name: trimmed });
    }

    // ─── ADD A USER TO A LEAGUE (item H) ───────────────────────
    // Superadmin can put any user into any league — incl. PRIVATE,
    // bypassing the passcode gate. Mirrors the membership writes the
    // normal join (api/leagues.js) performs: league.members array +
    // user.leagues array. Idempotent (already-a-member is a no-op).
    if (action === 'addUserToLeague') {
      if ((await getRole(userId)) !== 'superadmin') {
        return res.status(403).json({ error: 'Superadmin only' });
      }
      const { leagueId, targetUserId } = req.body;
      if (!leagueId || !targetUserId) return res.status(400).json({ error: 'leagueId and targetUserId required' });

      const [leagueSnap, userSnap] = await Promise.all([
        db.collection('leagues').doc(leagueId).get(),
        db.collection('users').doc(targetUserId).get(),
      ]);
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });

      const league = leagueSnap.data();
      if (Array.isArray(league.members) && league.members.includes(targetUserId)) {
        return res.status(200).json({ success: true, alreadyMember: true });
      }

      // Same two writes the join path makes, kept in sync.
      const writes = [
        db.collection('leagues').doc(leagueId).update({
          members: FieldValue.arrayUnion(targetUserId),
          memberCount: FieldValue.increment(1),
        }),
        db.collection('users').doc(targetUserId).update({
          leagues: FieldValue.arrayUnion(leagueId),
        }),
      ];
      // global-simple ranking also reads a members subcollection — keep it
      // consistent if we're adding to that league specifically.
      if (leagueId === 'global-simple') {
        writes.push(
          db.collection('leagues').doc('global-simple').collection('members').doc(targetUserId)
            .set({ userId: targetUserId, addedBy: userId, addedAt: FieldValue.serverTimestamp() }, { merge: true })
        );
      }
      await Promise.all(writes);

      await db.collection('adminLogs').add({
        action: 'add_user_to_league',
        leagueId,
        leagueName: league.name || null,
        targetUserId,
        visibility: league.visibility || 'public',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {});

      return res.status(200).json({ success: true });
    }

    // ─── APPLY GLOBAL PICKS TO A LEAGUE ────────────────────────
    // Superadmin: copy a user's Global (global-simple) Quick Picks bracket
    // into another QP league — but ONLY when the user has no picks in that
    // league yet (we never overwrite their own work). If the user has no
    // global picks to copy, it's skipped + flagged. Reuses the same
    // evaluateCopy decision logic as the copy-to-global path (stage locks
    // respected), just with source = global, target = the chosen league.
    if (action === 'applyGlobalPicksToLeague') {
      if ((await getRole(userId)) !== 'superadmin') {
        return res.status(403).json({ error: 'Superadmin only' });
      }
      const { targetUserId, leagueId } = req.body;
      if (!targetUserId || !leagueId) return res.status(400).json({ error: 'targetUserId and leagueId required' });
      if (leagueId === 'global-simple' || leagueId === 'global') {
        return res.status(400).json({ error: 'Target cannot be the global league' });
      }

      const { evaluateCopy } = await import('./_lib/copyToGlobalLogic.js');
      const SEP = '__';

      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const league = leagueSnap.data();
      if (league.predictionMode === 'classic') {
        return res.status(400).json({ error: 'Target is a Classic league — global Quick Picks can\'t be applied' });
      }
      if (!Array.isArray(league.members) || !league.members.includes(targetUserId)) {
        return res.status(400).json({ error: 'User is not a member of this league' });
      }

      // Source = the user's global-simple bracket (composite key, with the
      // legacy single-doc path as a fallback). Target = this league's doc.
      const srcRef = db.collection('simplePredictions').doc(`${targetUserId}${SEP}global-simple`);
      const tgtRef = db.collection('simplePredictions').doc(`${targetUserId}${SEP}${leagueId}`);
      const [srcSnap, tgtSnap] = await Promise.all([srcRef.get(), tgtRef.get()]);
      let sourceDoc = srcSnap.exists ? srcSnap.data() : null;
      if (!sourceDoc) {
        const legacy = await db.collection('simplePredictions').doc(targetUserId).get();
        if (legacy.exists) sourceDoc = legacy.data();
      }
      const targetDoc = tgtSnap.exists ? tgtSnap.data() : null;

      // mode 'skip' => never overwrite an existing entry (the "only users
      // with no prediction" rule).
      const decision = evaluateCopy({
        sourceDoc,
        sourceLeague: { predictionMode: 'simple' }, // global-simple is always QP
        targetDoc,
        mode: 'skip',
      });

      if (decision.action !== 'create') {
        // Map the decision to a user-facing skip reason (skip + flag).
        const reasonMap = {
          no_source_picks: 'no_global_picks',
          existing_global_entry: 'already_has_picks',
          stage_locked: 'stage_locked',
          incompatible_format: 'incompatible_format',
        };
        return res.status(200).json({
          applied: false,
          skipped: true,
          reason: reasonMap[decision.reason] || decision.reason || 'skipped',
          lockedSections: decision.lockedSections || null,
        });
      }

      const writePayload = {
        userId: targetUserId,
        leagueId,
        groupPredictions: sourceDoc.groupPredictions || {},
        bestThirdPicks: sourceDoc.bestThirdPicks || [],
        knockoutPredictions: sourceDoc.knockoutPredictions || {},
        // Derive from the bracket (Final winner) not the stored flag, which
        // can be a stale false on a finished bracket. Mirrors the leaderboard.
        isComplete: !!(sourceDoc.isComplete || sourceDoc.knockoutPredictions?.final?.[0]?.winnerId),
        updatedAt: FieldValue.serverTimestamp(),
      };
      if (!targetDoc?.submittedAt) writePayload.submittedAt = FieldValue.serverTimestamp();
      await tgtRef.set(writePayload, { merge: true });

      await db.collection('adminLogs').add({
        action: 'apply_global_picks_to_league',
        targetUserId,
        leagueId,
        leagueName: league.name || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {});

      return res.status(200).json({ applied: true });
    }

    if (action === 'repairQpComplete') {
      // Repair Quick Picks docs stuck in the "finished bracket but stored
      // isComplete:false" state (see GET type=qpUnsubmitted). Sets
      // isComplete:true (and submittedAt if missing) ONLY on docs that are
      // genuinely complete by the canonical rule (a Final winner is picked),
      // so it can never mark an in-progress bracket complete. Idempotent.
      // Superadmin only; audit-logged. The server-authoritative isComplete
      // in api/simple-predictions.js prevents NEW occurrences — this clears
      // the existing backlog.
      if ((await getRole(userId)) !== 'superadmin') {
        return res.status(403).json({ error: 'Superadmin only' });
      }
      const { docId, all } = req.body || {};
      const needsRepair = (data) => !!(data?.knockoutPredictions?.final?.[0]?.winnerId) && data?.isComplete !== true;

      const targets = []; // { ref, needSubmitted }
      if (all === true) {
        const snap = await db.collection('simplePredictions').get();
        snap.docs.forEach(d => {
          const data = d.data();
          if (needsRepair(data)) targets.push({ ref: d.ref, needSubmitted: !data.submittedAt });
        });
      } else if (docId) {
        const ref = db.collection('simplePredictions').doc(docId);
        const d = await ref.get();
        if (!d.exists) return res.status(404).json({ error: 'Doc not found' });
        const data = d.data();
        if (!needsRepair(data)) {
          return res.status(200).json({ repaired: 0, skipped: true, reason: 'not_in_bad_state' });
        }
        targets.push({ ref, needSubmitted: !data.submittedAt });
      } else {
        return res.status(400).json({ error: 'docId or all required' });
      }

      let repaired = 0;
      for (let i = 0; i < targets.length; i += 400) {
        const slice = targets.slice(i, i + 400);
        const batch = db.batch();
        slice.forEach(({ ref, needSubmitted }) => {
          const upd = { isComplete: true, updatedAt: FieldValue.serverTimestamp() };
          if (needSubmitted) upd.submittedAt = FieldValue.serverTimestamp();
          batch.set(ref, upd, { merge: true });
        });
        await batch.commit();
        repaired += slice.length;
      }

      await db.collection('adminLogs').add({
        action: 'repair_qp_complete',
        adminId: userId,
        scope: all === true ? 'all' : docId,
        repaired,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {});

      return res.status(200).json({ repaired });
    }

    if (action === 'sweepGlobalPicksToLeagues') {
      // One-time sweep: copy each member's GLOBAL bracket into the Quick
      // Picks leagues they belong to, but only where they have a Global
      // bracket AND no picks in that league yet (evaluateCopy 'skip' mode).
      // Fixes members who joined a private/public league but never copied
      // their Global picks in, so they show '—' on that league's board.
      // dryRun (default true) reports counts without writing. Idempotent,
      // superadmin-only, audit-logged. Optional leagueId scopes to one league.
      if ((await getRole(userId)) !== 'superadmin') {
        return res.status(403).json({ error: 'Superadmin only' });
      }
      const dryRun = req.body?.dryRun !== false; // default true
      const onlyLeague = req.body?.leagueId || null;
      const { evaluateCopy } = await import('./_lib/copyToGlobalLogic.js');
      const SEP = '__';

      const leaguesSnap = await db.collection('leagues').get();
      const targetLeagues = [];
      leaguesSnap.docs.forEach((d) => {
        const lg = d.data();
        const id = d.id;
        if (id === 'global' || id === 'global-simple') return;
        if (lg.predictionMode === 'classic') return; // Quick Picks only
        if (onlyLeague && id !== onlyLeague) return;
        if (!Array.isArray(lg.members) || lg.members.length === 0) return;
        targetLeagues.push({ id, name: lg.name || id, members: lg.members.slice(0, 5000), totalMembers: lg.members.length });
      });
      // Surface any league whose member list was capped at 5000, so a large
      // run can't silently skip members with no operator signal.
      const truncatedLeagues = targetLeagues
        .filter((l) => l.totalMembers > 5000)
        .map((l) => ({ id: l.id, name: l.name, total: l.totalMembers, capped: 5000 }));

      const copied = [];
      const skip = { hasPicks: 0, noGlobalPicks: 0, stageLocked: 0, other: 0, errors: 0 };

      for (const lg of targetLeagues) {
        const uids = lg.members;
        const srcData = {};
        const tgtData = {};
        // Batch-read each member's global + this-league prediction docs.
        for (let i = 0; i < uids.length; i += 150) {
          const batch = uids.slice(i, i + 150);
          const srcRefs = batch.map((uid) => db.collection('simplePredictions').doc(`${uid}${SEP}global-simple`));
          const tgtRefs = batch.map((uid) => db.collection('simplePredictions').doc(`${uid}${SEP}${lg.id}`));
          const [sSnaps, tSnaps] = await Promise.all([db.getAll(...srcRefs), db.getAll(...tgtRefs)]);
          sSnaps.forEach((s, idx) => { if (s.exists) srcData[batch[idx]] = s.data(); });
          tSnaps.forEach((s, idx) => { if (s.exists) tgtData[batch[idx]] = s.data(); });
        }
        // Legacy single-doc global fallback for members without a composite doc.
        const missing = uids.filter((uid) => !srcData[uid]);
        for (let i = 0; i < missing.length; i += 150) {
          const batch = missing.slice(i, i + 150);
          const snaps = await db.getAll(...batch.map((uid) => db.collection('simplePredictions').doc(uid)));
          snaps.forEach((s, idx) => { if (s.exists) srcData[batch[idx]] = s.data(); });
        }

        const toWrite = [];
        for (const uid of uids) {
          try {
            const sourceDoc = srcData[uid] || null;
            const targetDoc = tgtData[uid] || null;
            const decision = evaluateCopy({ sourceDoc, sourceLeague: { predictionMode: 'simple' }, targetDoc, mode: 'skip' });
            if (decision.action !== 'create') {
              if (decision.reason === 'existing_global_entry') skip.hasPicks++;
              else if (decision.reason === 'no_source_picks') skip.noGlobalPicks++;
              else if (decision.reason === 'stage_locked') skip.stageLocked++;
              else skip.other++;
              continue;
            }
            toWrite.push({ uid, sourceDoc, targetDoc });
            copied.push({ leagueId: lg.id, leagueName: lg.name, userId: uid });
          } catch (e) { skip.errors++; }
        }

        if (!dryRun && toWrite.length > 0) {
          for (let i = 0; i < toWrite.length; i += 400) {
            const batch = db.batch();
            toWrite.slice(i, i + 400).forEach(({ uid, sourceDoc, targetDoc }) => {
              const ref = db.collection('simplePredictions').doc(`${uid}${SEP}${lg.id}`);
              const payload = {
                userId: uid,
                leagueId: lg.id,
                groupPredictions: sourceDoc.groupPredictions || {},
                bestThirdPicks: sourceDoc.bestThirdPicks || [],
                knockoutPredictions: sourceDoc.knockoutPredictions || {},
                isComplete: !!(sourceDoc.isComplete || sourceDoc.knockoutPredictions?.final?.[0]?.winnerId),
                updatedAt: FieldValue.serverTimestamp(),
              };
              if (!targetDoc?.submittedAt) payload.submittedAt = FieldValue.serverTimestamp();
              batch.set(ref, payload, { merge: true });
            });
            await batch.commit();
          }
        }
      }

      if (!dryRun) {
        await db.collection('adminLogs').add({
          action: 'sweep_global_picks_to_leagues',
          adminId: userId,
          scope: onlyLeague || 'all',
          copiedCount: copied.length,
          timestamp: FieldValue.serverTimestamp(),
        }).catch(() => {});
      }

      return res.status(200).json({
        dryRun,
        leaguesProcessed: targetLeagues.length,
        copiedCount: copied.length,
        // copied is capped at 1000 for response size; copiedCount is the true
        // total (copied.length may be < copiedCount on very large sweeps).
        copied: copied.slice(0, 1000),
        skipped: skip,
        truncatedLeagues,
      });
    }

    if (action === 'backfillCountries') {
      // One-shot: walk every user and assign a country if they don't have
      // one. Product-directed override map wins; everyone else defaults to
      // US (we can't geolocate server-side per-user after the fact).
      const OVERRIDES = { 'lebida2352': 'PK', 'Sumit': 'BD' };
      const usersSnap = await db.collection('users').get();
      let updated = 0;
      let skipped = 0;
      const overrideHits = [];
      const docs = usersSnap.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = db.batch();
        let batchCount = 0;
        docs.slice(i, i + 400).forEach(d => {
          const u = d.data();
          if (u.country) { skipped++; return; }
          const override = OVERRIDES[u.displayName];
          const country = override || 'US';
          if (override) overrideHits.push({ displayName: u.displayName, country });
          batch.update(d.ref, { country });
          batchCount++;
        });
        if (batchCount > 0) {
          await batch.commit();
          updated += batchCount;
        }
      }
      await db.collection('adminLogs').add({
        action: 'backfill_countries',
        adminId: userId,
        updated,
        skipped,
        overrides: overrideHits,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, updated, skipped, overrides: overrideHits });
    }

    if (action === 'assignWallet') {
      const { targetUserId, walletAddress } = req.body;
      if (!targetUserId) return res.status(400).json({ error: 'Missing targetUserId' });
      const trimmed = (walletAddress || '').trim();
      // Empty string clears the field; otherwise must be a valid EVM address.
      if (trimmed && !/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
        return res.status(400).json({ error: 'Invalid EVM wallet address' });
      }
      const userSnap = await db.collection('users').doc(targetUserId).get();
      if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
      const previous = userSnap.data().walletAddress || null;
      await db.collection('users').doc(targetUserId).update({
        walletAddress: trimmed || null,
        walletAssignedBy: trimmed ? userId : null,
        walletAssignedAt: trimmed ? FieldValue.serverTimestamp() : null,
      });
      await db.collection('adminLogs').add({
        action: 'assign_wallet',
        targetUserId,
        previousWallet: previous,
        newWallet: trimmed || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, walletAddress: trimmed || null });
    }

    if (action === 'setFeatureFlag') {
      // Platform-wide feature flags. Stored at /settings/featureFlags
      // and read by every client on mount via /api/public?type=flags.
      // Allowed flags are whitelisted so a typo can't write arbitrary
      // keys onto the doc.
      //
      // Superadmin-only — feature flags are platform-wide config and
      // tightening here matches the security model for the other
      // platform-level superadmin actions (setRole-to-superadmin,
      // deleteUser, etc). The previous admin-or-superadmin gate was
      // legacy; this is the right policy going forward.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can change feature flags' });
      }
      const ALLOWED = new Set(['quickPicksEnabled', 'classicEnabled', 'enablePrizeLeagues', 'knockoutRealReseed']);
      const { flag, value, reason } = req.body;
      if (!ALLOWED.has(flag)) return res.status(400).json({ error: `Unknown flag: ${flag}` });
      if (typeof value !== 'boolean') return res.status(400).json({ error: 'value must be boolean' });
      // Reason is optional free text for the audit trail. Cap at 280
      // chars (tweet-length) so the audit log doc stays small.
      const trimmedReason = typeof reason === 'string' ? reason.trim().slice(0, 280) : null;
      const ref = db.collection('settings').doc('featureFlags');
      const snap = await ref.get();
      const prev = snap.exists ? (snap.data() || {}) : {};
      await ref.set({ ...prev, [flag]: value, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('adminLogs').add({
        action: 'set_feature_flag',
        flag, value,
        previousValue: prev[flag] ?? null,
        reason: trimmedReason || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, flag, value });
    }

    if (action === 'setRankDigestConfig') {
      // Daily leaderboard-movement email config (/settings/rankDigest).
      // Superadmin-only, same as feature flags (platform-wide + sends email).
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can change the rank-digest config' });
      }
      const patch = sanitizeConfigPatch(req.body?.config || {});
      const ref = db.collection('config').doc('rankDigest');
      await ref.set({ ...patch, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
      await db.collection('adminLogs').add({
        action: 'set_rank_digest_config',
        patch,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {});
      const snap = await ref.get();
      return res.status(200).json({ success: true, config: { ...RANK_DIGEST_DEFAULTS, ...(snap.data() || {}) } });
    }

    if (action === 'rankDigestPreviewNow') {
      // On-demand: run the digest's PREVIEW phase right now (emails the
      // operator the real email + counts, stashes pendingPreview). Triggers
      // the cron with force=preview via the shared CRON_SECRET.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can run a preview' });
      }
      const secret = process.env.CRON_SECRET;
      if (!secret) return res.status(500).json({ error: 'CRON_SECRET not configured' });
      try {
        const r = await fetch('https://goaloracle.io/api/cron/rank-digest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
          body: JSON.stringify({ force: 'preview' }),
        });
        const out = await r.json().catch(() => ({}));
        return res.status(200).json({ success: true, ...out });
      } catch (e) {
        return res.status(500).json({ error: e?.message || 'preview trigger failed' });
      }
    }

    if (action === 'seedRankBaseline') {
      // One-time: seed the day-over-day baseline (/leaderboardSnapshots) from
      // a RECONSTRUCTED earlier leaderboard, so the first digest captures the
      // latest batch's movement instead of waiting a cycle. By default it
      // excludes the latest match-day's results (ET date), i.e. "yesterday's
      // standings". Ranked with the EXACT same scoring + sort as
      // /api/simple-leaderboard so movement isn't polluted by method drift.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can seed the baseline' });
      }
      const LEAGUE = 'global-simple';
      const excludeLatestDay = req.body?.excludeLatestDay !== false; // default true

      // All match results + each match's ET date (matches.js `date`).
      const resultsSnap = await db.collection('matchResults').get();
      const allResults = {};
      resultsSnap.forEach(d => { allResults[d.id] = d.data(); });
      const dateById = {};
      WORLD_CUP_MATCHES.forEach(m => { dateById[m.id] = m.date; });
      const completedDates = Object.keys(allResults)
        .filter(id => allResults[id]?.completed === true && dateById[id])
        .map(id => dateById[id]);
      const latestDate = completedDates.length ? completedDates.sort().slice(-1)[0] : null;

      // Filtered results = exclude the latest ET match-day (the batch the
      // first digest should report on).
      const filtered = {};
      let excluded = 0;
      for (const [id, r] of Object.entries(allResults)) {
        if (excludeLatestDay && latestDate && dateById[id] === latestDate) { excluded++; continue; }
        filtered[id] = r;
      }

      // Members + their Global brackets (mirror simple-leaderboard's read).
      const leagueSnap = await db.collection('leagues').doc(LEAGUE).get();
      const members = leagueSnap.exists ? (leagueSnap.data().members || []) : [];
      const predsSnap = await db.collection('simplePredictions').get();
      const preds = {};
      const usersForName = {};
      predsSnap.forEach(d => {
        const id = d.id; const data = d.data();
        const sep = id.indexOf('__');
        const uid = sep >= 0 ? id.slice(0, sep) : (data.userId || id);
        const lid = sep >= 0 ? id.slice(sep + 2) : (data.leagueId || LEAGUE);
        if (lid !== LEAGUE) return;
        if (!preds[uid] || sep >= 0) preds[uid] = data;
      });
      // Display names for the sort tiebreak.
      const usersSnap = await db.collection('users').get();
      usersSnap.forEach(d => { usersForName[d.id] = d.data().displayName || d.id.slice(0, 8); });

      const tsMs = (t) => (t?.toMillis ? t.toMillis() : (t?._seconds ? t._seconds * 1000 : (typeof t === 'number' ? t : null)));
      const actuals = buildSimpleActuals(filtered);
      const liveStandings = buildLiveGroupStandings(filtered).standings;

      const entries = members.map(uid => {
        const pred = preds[uid];
        const totalScore = pred ? (calculateSimpleScore(pred, actuals).totalScore || 0) : 0;
        const liveGroupScore = pred?.groupPredictions ? scoreGroupStage(pred.groupPredictions, liveStandings) : 0;
        return {
          uid,
          totalScore,
          liveGroupScore,
          hasSubmitted: !!pred,
          submittedAt: tsMs(pred?.submittedAt || pred?.updatedAt),
          displayName: usersForName[uid] || uid.slice(0, 8),
        };
      });
      // EXACT same sort as api/simple-leaderboard.js.
      entries.sort((a, b) => {
        if (b.totalScore !== a.totalScore) return b.totalScore - a.totalScore;
        if ((b.liveGroupScore || 0) !== (a.liveGroupScore || 0)) return (b.liveGroupScore || 0) - (a.liveGroupScore || 0);
        if (a.hasSubmitted !== b.hasSubmitted) return b.hasSubmitted ? 1 : -1;
        if (a.submittedAt && b.submittedAt && a.submittedAt !== b.submittedAt) return a.submittedAt - b.submittedAt;
        if (a.submittedAt && !b.submittedAt) return -1;
        if (b.submittedAt && !a.submittedAt) return 1;
        return a.displayName.localeCompare(b.displayName);
      });

      const ranks = {};
      entries.forEach((e, i) => { ranks[e.uid] = i + 1; });

      // Log a summary so the operator (and I) can verify the seed from the
      // runtime logs — top of the reconstructed board + counts + which day's
      // games the first digest will report on.
      console.log('[admin/seedRankBaseline]', JSON.stringify({
        members: members.length,
        ranked: entries.length,
        withPicks: entries.filter(e => e.hasSubmitted).length,
        latestDate,
        excludedDate: excludeLatestDay ? latestDate : null,
        excludedMatches: excluded,
        top5: entries.slice(0, 5).map((e, i) => `#${i + 1} ${e.displayName} (pts ${e.totalScore}, live ${e.liveGroupScore})`),
      }));

      // takenAt = now so the cron's loadPreviousSnapshot (max takenAt) uses
      // this as the baseline; dated as "before the latest match-day".
      const baselineDate = latestDate || new Date().toISOString().slice(0, 10);
      await db.collection('leaderboardSnapshots').doc(`${LEAGUE}__seed-${baselineDate}`).set({
        league: LEAGUE,
        date: baselineDate,
        seeded: true,
        excludedDate: excludeLatestDay ? latestDate : null,
        takenAt: FieldValue.serverTimestamp(),
        takenAtMs: Date.now(),
        total: entries.length,
        ranks,
      });

      await db.collection('adminLogs').add({
        action: 'seed_rank_baseline',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        summary: { members: members.length, ranked: entries.length, excludedDate: excludeLatestDay ? latestDate : null, excludedMatches: excluded },
      }).catch(() => {});

      return res.status(200).json({
        success: true,
        ranked: entries.length,
        excludedDate: excludeLatestDay ? latestDate : null,
        excludedMatches: excluded,
        note: excludeLatestDay && latestDate
          ? `Baseline = standings before ${latestDate}'s games. The next digest will report movement from ${latestDate}'s batch.`
          : `Baseline = current standings. The next digest will report movement from here on.`,
      });
    }

    if (action === 'getFeatureFlagAuditLog') {
      // Recent feature-flag changes for display in the admin console.
      // Superadmin-only, same as setFeatureFlag. Filters by `flag` if
      // supplied; otherwise returns the most recent changes across all
      // flags. Capped at 50 entries to bound the read cost.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can read the audit log' });
      }
      const { flag, limit } = req.body || {};
      const cap = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
      // Fetch set_feature_flag entries by action only (single-field
      // auto-index) and sort by timestamp DESC in memory. Combining
      // `action ==` with `orderBy('timestamp')` would need an (action,
      // timestamp) composite index that isn't provisioned — its absence
      // 500'd this endpoint. set_feature_flag rows are few, so this is cheap.
      const overFetch = flag ? cap * 5 : cap;
      const tsMs = (t) => (t?.toMillis ? t.toMillis() : (t?._seconds ? t._seconds * 1000 : 0));
      const snap = await db.collection('adminLogs')
        .where('action', '==', 'set_feature_flag')
        .get();
      const sortedDocs = snap.docs
        .sort((a, b) => tsMs(b.data().timestamp) - tsMs(a.data().timestamp))
        .slice(0, overFetch);
      // Resolve adminId → displayName so the UI doesn't show raw UIDs.
      const filtered = (flag && typeof flag === 'string')
        ? sortedDocs.filter((d) => d.data().flag === flag)
        : sortedDocs;
      const limited = filtered.slice(0, cap);
      const entries = await Promise.all(limited.map(async (d) => {
        const data = d.data();
        let actorName = data.adminId;
        try {
          const u = await db.collection('users').doc(data.adminId).get();
          if (u.exists) actorName = u.data().displayName || data.adminId;
        } catch {}
        return {
          id: d.id,
          flag: data.flag,
          value: data.value,
          previousValue: data.previousValue ?? null,
          reason: data.reason || null,
          actorId: data.adminId,
          actorName,
          timestamp: data.timestamp?.toDate?.()?.toISOString?.() || null,
        };
      }));
      return res.status(200).json({ entries });
    }

    if (action === 'banIp') {
      // Add an IP (or its raw hash) to the blocklist. Either pass `ip` (the
      // raw v4/v6 address) or `ipHash` (the sha256 hex) — useful for banning
      // an IP you only have the hashed form of from the user doc.
      const { ip, ipHash: rawHash, reason } = req.body;
      const hash = rawHash || (ip ? ipHash(ip) : null);
      if (!hash) return res.status(400).json({ error: 'Missing ip or ipHash' });
      await db.collection('bannedIps').doc(hash).set({
        bannedBy: userId,
        bannedAt: FieldValue.serverTimestamp(),
        reason: (reason || '').toString().slice(0, 200) || null,
        ipPreview: ip ? `${String(ip).slice(0, 8)}…` : null,
      });
      await db.collection('adminLogs').add({
        action: 'ban_ip',
        ipHash: hash,
        adminId: userId,
        reason: reason || null,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, ipHash: hash });
    }

    if (action === 'unbanIp') {
      const { ip, ipHash: rawHash } = req.body;
      const hash = rawHash || (ip ? ipHash(ip) : null);
      if (!hash) return res.status(400).json({ error: 'Missing ip or ipHash' });
      await db.collection('bannedIps').doc(hash).delete().catch(() => {});
      await db.collection('adminLogs').add({
        action: 'unban_ip',
        ipHash: hash,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true });
    }

    if (action === 'listBannedIps') {
      const snap = await db.collection('bannedIps').get();
      return res.status(200).json({
        bans: snap.docs.map(d => ({ ipHash: d.id, ...d.data() })),
      });
    }

    if (action === 'migrateLeaguePasscodes') {
      // One-shot: walk every league with a non-null `passcode` field on
      // its public doc, copy that passcode into /leagues/{id}/private/auth
      // (admin-SDK-only readable per Firestore rules), and clear the field
      // on the public doc. Idempotent — leagues already migrated have
      // passcode == null and are skipped.
      const snap = await db.collection('leagues').get();
      let migrated = 0;
      let skipped = 0;
      const errors = [];
      for (const d of snap.docs) {
        const data = d.data();
        if (!data.passcode) { skipped++; continue; }
        try {
          await d.ref.collection('private').doc('auth').set({
            passcode: String(data.passcode),
            migratedAt: FieldValue.serverTimestamp(),
            migratedBy: userId,
          }, { merge: true });
          await d.ref.update({ passcode: null });
          migrated++;
        } catch (e) {
          errors.push({ leagueId: d.id, error: e.message });
        }
      }
      await db.collection('adminLogs').add({
        action: 'migrate_league_passcodes',
        adminId: userId,
        migrated,
        skipped,
        errorCount: errors.length,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ success: true, migrated, skipped, errors });
    }

    if (action === 'oracleSmokeTest') {
      // Server-side smoke test of the oracle pipeline against a real
      // recent match in a chosen competition. Single source: football-
      // data.org. (We dropped api-sports.io because their free tier
      // doesn't include current World Cup data; results can be contested
      // by users via support@goaloracle.io and superadmins can override
      // a wrong score via /api/admin → updateResult.)
      const { parseFootballDataResponse } = await import('./_lib/oracleParsers.js');
      const COMPETITION_MAP = {
        PL: { fdCode: 'PL', label: 'English Premier League' },
        CL: { fdCode: 'CL', label: 'UEFA Champions League' },
        BL1: { fdCode: 'BL1', label: 'Bundesliga' },
        PD: { fdCode: 'PD', label: 'La Liga' },
        SA: { fdCode: 'SA', label: 'Serie A' },
        WC: { fdCode: 'WC', label: 'FIFA World Cup' },
      };
      const comp = COMPETITION_MAP[(req.body.competition || 'PL').toUpperCase()] || COMPETITION_MAP.PL;
      const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;
      const checks = [];
      const note = (name, ok, detail = '') => checks.push({ name, ok, detail });

      // 1) Pick a recent FINISHED match in this competition
      let fdMatch = null, fdParsed = null;
      if (!FD_KEY) note('football-data.org key', false, 'FOOTBALL_DATA_API_KEY not set in Vercel env');
      else {
        try {
          const today = new Date().toISOString().slice(0, 10);
          const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
          const r = await fetch(
            `https://api.football-data.org/v4/competitions/${comp.fdCode}/matches?dateFrom=${sevenDaysAgo}&dateTo=${today}`,
            { headers: { 'X-Auth-Token': FD_KEY } },
          );
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          const finished = (data.matches || []).filter(m => m.status === 'FINISHED');
          if (finished.length === 0) note('list recent matches', false, 'no FINISHED matches in last 7 days');
          else {
            finished.sort((a, b) => new Date(b.utcDate) - new Date(a.utcDate));
            fdMatch = finished[0];
            note('list recent matches', true, `picked ${fdMatch.homeTeam?.name} vs ${fdMatch.awayTeam?.name}`);
            const detail = await fetch(`https://api.football-data.org/v4/matches/${fdMatch.id}`, { headers: { 'X-Auth-Token': FD_KEY } }).then(r => r.json());
            fdParsed = parseFootballDataResponse(detail);
            note('parse match detail', true, `${fdParsed.homeScore}-${fdParsed.awayScore} (ET=${fdParsed.extraTime}, PEN=${fdParsed.penalties})`);
          }
        } catch (e) {
          note('football-data.org', false, e.message);
        }
      }

      // 2) Standings probe — confirms we can also pull live group/league
      // tables from the same provider.
      if (FD_KEY) {
        try {
          const r = await fetch(`https://api.football-data.org/v4/competitions/${comp.fdCode}/standings`, { headers: { 'X-Auth-Token': FD_KEY } });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          const data = await r.json();
          const table = data.standings?.find(s => s.type === 'TOTAL')?.table || [];
          if (table.length === 0) throw new Error('empty TOTAL table');
          note('standings probe', true, `${table.length} teams; #1 ${table[0].team?.name} (${table[0].points} pts)`);
        } catch (e) {
          note('standings probe', false, e.message);
        }
      }

      const failed = checks.filter(c => !c.ok).length;
      await db.collection('adminLogs').add({
        action: 'oracle_smoke_test',
        adminId: userId,
        competition: comp.label,
        passed: checks.length - failed,
        failed,
        timestamp: FieldValue.serverTimestamp(),
      });
      return res.status(200).json({
        competition: comp.label,
        runAt: new Date().toISOString(),
        passed: checks.length - failed,
        failed,
        checks,
      });
    }

    // ─── OUTREACH: SEND PREVIEW ─────────────────────────────────
    // Renders an outreach template using the admin's own user record as
    // the recipient stand-in and sends to a specified preview address
    // (defaults to the admin's account email). Used by the outreach tab
    // so the operator can see exactly what users will receive before
    // hitting the batch button.
    if (action === 'outreachSendPreview') {
      const { template = 'noPicksReminder', toEmail } = req.body;
      const { buildEmail, sendOutreachEmail, TEMPLATES } = await import('./_lib/outreachEmail.js');
      if (!TEMPLATES[template]) return res.status(400).json({ error: `Unknown template: ${template}` });

      const adminSnap = await db.collection('users').doc(userId).get();
      const admin = adminSnap.exists ? { id: adminSnap.id, ...adminSnap.data() } : { id: userId };
      const recipient = (toEmail || admin.email || '').trim();
      if (!recipient) return res.status(400).json({ error: 'No preview address — pass toEmail or set an email on your admin account.' });

      const { subject, html, text } = buildEmail(template, { user: admin, ctx: {} });
      const sendResult = await sendOutreachEmail({
        to: recipient,
        subject: `[PREVIEW] ${subject}`,
        html,
        text,
      });
      return res.status(200).json({
        sent: sendResult.sent,
        error: sendResult.error || null,
        to: recipient,
        subject,
      });
    }

    // ─── OUTREACH: LIST ELIGIBLE USERS ──────────────────────────
    // (Strictly speaking this is a GET-shaped read, but it's a POST
    //  because the body carries the template id + filter knobs and we
    //  want CSRF protection via the existing admin auth.)
    if (action === 'outreachListEligibleUsers') {
      // cooldownDays defaults to 0 — operator preference is to see
      // every eligible user every time and decide manually, rather
      // than have the server hide anyone who was sent something
      // recently. Passing a non-zero value still works for templates
      // that want it (e.g. an automated welcome cron later).
      const { template = 'noPicksReminder', cooldownDays = 0 } = req.body;
      const { TEMPLATES } = await import('./_lib/outreachEmail.js');
      if (!TEMPLATES[template]) return res.status(400).json({ error: `Unknown template: ${template}` });

      // 1) Decide the candidate user-set per template.
      //    - noPicksReminder + kickoffTomorrow: members of global-simple
      //    - welcome:                          ALL signed-up users
      //                                        (so we can welcome users
      //                                        who haven't joined a
      //                                        league yet, though most
      //                                        get auto-joined)
      let candidateIds = [];
      let leagueMembers = 0;
      if (template === 'welcome') {
        // All users — small enough at current scale to iterate.
        const usersSnap = await db.collection('users').get();
        candidateIds = usersSnap.docs.map(d => d.id);
      } else {
        const leagueSnap = await db.collection('leagues').doc('global-simple').get();
        const members = leagueSnap.exists ? (leagueSnap.data().members || []) : [];
        leagueMembers = members.length;
        candidateIds = members;
      }
      if (candidateIds.length === 0) return res.status(200).json({ users: [], total: 0, leagueMembers });

      // 2) Resolve the user docs (with email).
      const userIds = Array.from(new Set(candidateIds));
      const userDocs = {};
      const CHUNK = 1000;
      for (let i = 0; i < userIds.length; i += CHUNK) {
        const slice = userIds.slice(i, i + CHUNK);
        const refs = slice.map(id => db.collection('users').doc(id));
        const snaps = await db.getAll(...refs);
        for (const snap of snaps) {
          if (snap.exists) userDocs[snap.id] = { id: snap.id, ...snap.data() };
        }
      }

      // 3) Only fetch simple-prediction docs when the template's filter
      //    actually needs them — noPicksReminder + midTournamentNudge
      //    both gate on groupsDone (no picks vs has picks); welcome +
      //    kickoffTomorrow don't care.
      const preds = {};
      if (template === 'noPicksReminder' || template === 'midTournamentNudge' || template === 'knockoutRepick') {
        const compositeIds = userIds.map(uid => `${uid}__global-simple`);
        for (let i = 0; i < compositeIds.length; i += 30) {
          const slice = compositeIds.slice(i, i + 30);
          const snap = await db.collection('simplePredictions')
            .where(admin.firestore.FieldPath.documentId(), 'in', slice)
            .get();
          for (const d of snap.docs) {
            const data = d.data();
            if (data?.userId) preds[data.userId] = data;
          }
        }
      }

      // 4) Cooldown — when cooldownDays > 0, exclude users sent this
      //    template recently. Skipped entirely when cooldownDays === 0.
      let recentlySent = new Set();
      if (cooldownDays > 0) {
        const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
        const cutoff = Date.now() - cooldownMs;
        // Query by template only (single-field auto-index) and apply the
        // sentAt window in memory — `template ==` + `sentAt >=` range would
        // need a composite index that isn't provisioned (its absence 500'd
        // the outreach-eligible listing in the admin Outreach tab).
        const sentSnap = await db.collection('outreachSent')
          .where('template', '==', template)
          .get();
        recentlySent = new Set(
          sentSnap.docs
            .filter((d) => {
              const ts = d.data().sentAt;
              const ms = ts?.toMillis ? ts.toMillis() : (ts?._seconds ? ts._seconds * 1000 : 0);
              return ms >= cutoff;
            })
            .map((d) => d.data().userId)
        );
      }

      // 5) Per-template eligibility predicate. Returns
      //    { eligible: bool, extra?: {} } where `extra` is merged
      //    into the row for UI display.
      const NOW = Date.now();
      const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
      function templateFilter(user) {
        if (template === 'noPicksReminder') {
          const groups = preds[user.id]?.groupPredictions || {};
          const groupsDone = Object.values(groups).filter(g =>
            Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)
          ).length;
          if (groupsDone > 0) return { eligible: false };
          return { eligible: true, extra: { groupsDone } };
        }
        if (template === 'welcome') {
          // Signed up in the last 14 days. createdAt is a Firestore
          // Timestamp; handle the two shapes (server timestamp vs
          // already-resolved millis).
          const created = user.createdAt?._seconds
            ? user.createdAt._seconds * 1000
            : (user.createdAt?.toMillis?.() ?? null);
          if (!created) return { eligible: false };
          if (NOW - created > FOURTEEN_DAYS_MS) return { eligible: false };
          return { eligible: true };
        }
        if (template === 'kickoffTomorrow' || template === 'knockoutReminder') {
          // No additional filter beyond email + opt-out — every Global
          // Quick Picks member should get the heads-up that knockout picks
          // are about to lock, whether their bracket is done or not.
          return { eligible: true };
        }
        if (template === 'knockoutRepick') {
          // Only users who have NOT re-locked their knockout bracket since
          // the real R32 teams were seeded. A save at/after the reseed
          // cutoff means they already updated — skip them so the blast
          // doesn't pester people who've acted. Mirrors the
          // global_ko_not_resubmitted segment (outreachSegments.js).
          const KNOCKOUT_REPICK_CUTOFF_MS = Date.UTC(2026, 5, 26, 0, 0, 0);
          const p = preds[user.id];
          const upd = p
            ? (p.updatedAt?.toMillis?.() ?? (p.updatedAt?._seconds ? p.updatedAt._seconds * 1000 : null)
               ?? p.submittedAt?.toMillis?.() ?? (p.submittedAt?._seconds ? p.submittedAt._seconds * 1000 : null))
            : null;
          if (upd != null && upd >= KNOCKOUT_REPICK_CUTOFF_MS) return { eligible: false };
          return { eligible: true };
        }
        if (template === 'midTournamentNudge') {
          // Reverse of noPicksReminder — only nudge users who already
          // have at least one group done. Sending this to someone with
          // zero picks would read as a tone-deaf "you're scoring!"
          // when they haven't started yet.
          const groups = preds[user.id]?.groupPredictions || {};
          const groupsDone = Object.values(groups).filter(g =>
            Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)
          ).length;
          if (groupsDone === 0) return { eligible: false };
          return { eligible: true, extra: { groupsDone } };
        }
        return { eligible: false };
      }

      // 6) Build the eligible list.
      const eligible = [];
      for (const uid of userIds) {
        const user = userDocs[uid];
        if (!user) continue;
        if (!user.email) continue;
        if (user.emailOptOut === true) continue;
        if (recentlySent.has(uid)) continue;

        const result = templateFilter(user);
        if (!result.eligible) continue;

        eligible.push({
          userId: uid,
          displayName: user.displayName || user.username || null,
          email: user.email,
          createdAt: user.createdAt?._seconds
            ? user.createdAt._seconds * 1000
            : (user.createdAt?.toMillis?.() ?? null),
          country: user.country || null,
          ...(result.extra || {}),
        });
      }

      // Newest signups first — most likely to remember the brand.
      eligible.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

      return res.status(200).json({
        template,
        cooldownDays,
        users: eligible,
        total: eligible.length,
        leagueMembers,
      });
    }

    // ─── OUTREACH: RENDER PREVIEW ───────────────────────────────
    // Returns the rendered email (subject + html + text) without
    // sending it anywhere. The admin tab uses this to populate an
    // in-page <iframe srcdoc={html}> so the operator can preview
    // without leaving the dashboard. Send-to-email preview is still
    // available via outreachSendPreview.
    if (action === 'outreachRenderPreview') {
      const { template = 'noPicksReminder' } = req.body;
      const { buildEmail, TEMPLATES } = await import('./_lib/outreachEmail.js');
      if (!TEMPLATES[template]) return res.status(400).json({ error: `Unknown template: ${template}` });

      const adminSnap = await db.collection('users').doc(userId).get();
      const adminUser = adminSnap.exists ? { id: adminSnap.id, ...adminSnap.data() } : { id: userId };

      const { subject, html, text } = buildEmail(template, { user: adminUser, ctx: {} });
      return res.status(200).json({ subject, html, text });
    }

    // ─── OUTREACH: SEND BATCH ───────────────────────────────────
    // Sends the chosen template to every userId in the request body.
    // Caller is expected to have pre-filtered via outreachListEligibleUsers
    // and to have sent a preview to their own inbox at least once.
    // We re-check eligibility per-user inside the loop as a safety net.
    if (action === 'outreachSendBatch') {
      const { template = 'noPicksReminder', userIds: requested } = req.body;
      if (!Array.isArray(requested) || requested.length === 0) {
        return res.status(400).json({ error: 'userIds required (non-empty array)' });
      }
      if (requested.length > 1000) {
        return res.status(400).json({ error: 'Batch too large (max 1000 per call)' });
      }
      const { buildEmail, sendOutreachBatch, RESEND_BATCH_SIZE, TEMPLATES, firstNameOf } = await import('./_lib/outreachEmail.js');
      if (!TEMPLATES[template]) return res.status(400).json({ error: `Unknown template: ${template}` });

      // ── Per-batch shared template context (B2c) — computed once and
      // reused for every recipient, so variables don't add a per-user read.
      //   daysToLock: days until the group stage locks (shared deadline).
      //   rankByUser: live global-simple rank from stored scores.
      const batchCtx = {};
      try {
        const { stageLockTimeUtc } = await import('../src/utils/stageLock.js');
        const ms = stageLockTimeUtc('groupStage') - Date.now();
        if (ms > 0) batchCtx.daysToLock = Math.ceil(ms / 86400000);
      } catch { /* unknown stage — omit */ }

      const rankByUser = {};
      try {
        // Rank = position in the global league ordered by total points desc,
        // then earliest submission — the same order the leaderboard uses.
        const scoresSnap = await db.collectionGroup('scores')
          .where('leagueId', '==', 'global-simple').get();
        const rows = scoresSnap.docs.map(d => d.data())
          .filter(r => r && r.userId)
          .sort((a, b) => (b.totalScore || 0) - (a.totalScore || 0));
        rows.forEach((r, i) => { if (rankByUser[r.userId] === undefined) rankByUser[r.userId] = i + 1; });
      } catch (e) {
        // collectionGroup needs a composite index; if it's missing, rank is
        // simply omitted and templates fall back to their generic copy.
        console.warn('[outreach] rank lookup failed (templates fall back):', e?.message || e);
      }

      const results = { sent: 0, skipped: 0, failed: 0, errors: [] };
      const noteError = (uid, error) => { results.failed++; if (results.errors.length < 25) results.errors.push({ uid, error }); };

      // 1) Batch-fetch every candidate user doc (getAll in chunks) — one read
      //    round-trip per ~300 users instead of 900 sequential gets.
      const uniqueIds = Array.from(new Set(requested));
      const userDocs = {};
      for (let i = 0; i < uniqueIds.length; i += 300) {
        const refs = uniqueIds.slice(i, i + 300).map((id) => db.collection('users').doc(id));
        const snaps = await db.getAll(...refs);
        for (const s of snaps) if (s.exists) userDocs[s.id] = { id: s.id, ...s.data() };
      }

      // 2) Build a personalized email per eligible recipient (skip no-email /
      //    opted-out). CPU-only — fast.
      const toSend = []; // { uid, to, subject, html, text }
      for (const uid of uniqueIds) {
        const user = userDocs[uid];
        if (!user || !user.email || user.emailOptOut === true) { results.skipped++; continue; }
        try {
          const ctx = { ...batchCtx, firstName: firstNameOf(user), rank: rankByUser[uid] };
          const { subject, html, text } = buildEmail(template, { user, ctx });
          toSend.push({ uid, to: user.email, subject, html, text });
        } catch (e) {
          noteError(uid, e?.message || 'build-failed');
        }
      }

      // 3) Send via Resend's BATCH endpoint (100/call) — a 900-recipient blast
      //    is ~9 API calls instead of 900 sequential sends, so the whole thing
      //    finishes well inside the serverless time limit.
      const sentStatus = {}; // uid -> { sent, error }
      for (let i = 0; i < toSend.length; i += RESEND_BATCH_SIZE) {
        const chunk = toSend.slice(i, i + RESEND_BATCH_SIZE);
        const r = await sendOutreachBatch(chunk.map((e) => ({
          to: e.to, subject: e.subject, html: e.html, text: e.text,
          // Tags echo back in Resend webhooks so /api/webhooks/resend can stamp
          // open/click/bounce. sendOutreachBatch drops them + retries if the
          // batch endpoint rejects tags, so the send always goes out.
          tags: [{ name: 'userId', value: e.uid }, { name: 'template', value: template }],
        })));
        chunk.forEach((e, j) => { sentStatus[e.uid] = r.results[j] || { sent: false, error: r.error || 'unknown' }; });
      }

      // 4) Write per-user audit rows in Firestore batches (≤500/commit) so the
      //    email history + recent-contact guardrail (B1) stay accurate without
      //    900 sequential writes.
      let writeBatch = db.batch();
      let pending = 0;
      for (const e of toSend) {
        const st = sentStatus[e.uid] || { sent: false, error: 'unknown' };
        writeBatch.set(db.collection('outreachSent').doc(`${e.uid}__${template}`), {
          userId: e.uid, template, sentAt: FieldValue.serverTimestamp(),
          sent: st.sent, error: st.error || null, sentBy: userId,
        }, { merge: true });
        if (st.sent) results.sent++;
        else noteError(e.uid, st.error || 'unknown');
        if (++pending >= 450) { await writeBatch.commit(); writeBatch = db.batch(); pending = 0; }
      }
      if (pending > 0) await writeBatch.commit();

      // Operator audit-trail entry — separate from per-user log so the
      // operator can see "I sent the no-picks reminder to 47 users at
      // 14:23 today" without scanning per-user docs.
      await db.collection('outreachRuns').add({
        template,
        triggeredBy: userId,
        triggeredAt: FieldValue.serverTimestamp(),
        attempted: requested.length,
        sent: results.sent,
        skipped: results.skipped,
        failed: results.failed,
      });

      return res.status(200).json(results);
    }

    // ─── OUTREACH: CUSTOM ONE-OFF SEND (B2b) ───────────────────
    // Send an operator-authored custom email (subject + plain-text body)
    // to a SINGLE user, wrapped in the branded shell + sign-off. Logged to
    // /outreachSent like template sends so it shows in the user's email
    // history (B1) and the recent-contact guardrail. Respects opt-out.
    if (action === 'outreachSendCustom') {
      const { targetUserId, subject, body } = req.body;
      if (!targetUserId) return res.status(400).json({ error: 'targetUserId required' });
      if (!subject || !String(subject).trim()) return res.status(400).json({ error: 'subject required' });
      if (!body || !String(body).trim()) return res.status(400).json({ error: 'body required' });
      if (String(body).length > 5000) return res.status(400).json({ error: 'body too long (max 5000 chars)' });

      const userSnap = await db.collection('users').doc(targetUserId).get();
      if (!userSnap.exists) return res.status(404).json({ error: 'User not found' });
      const user = { id: userSnap.id, ...userSnap.data() };
      if (!user.email) return res.status(400).json({ error: 'User has no email on file' });
      if (user.emailOptOut === true) return res.status(400).json({ error: 'User has opted out of email' });

      const { buildCustomEmail, sendOutreachEmail } = await import('./_lib/outreachEmail.js');
      const { subject: subj, html, text } = buildCustomEmail({ user, subject, body });
      const r = await sendOutreachEmail({
        to: user.email,
        subject: subj, html, text,
        // 1:1 operator messages send from the replyable support address (not
        // the marketing hello@) so a user can just hit reply and reach us.
        from: 'GoalOracle Support <support@goaloracle.io>',
        replyTo: 'support@goaloracle.io',
        tags: [
          { name: 'userId', value: targetUserId },
          { name: 'template', value: 'custom' },
        ],
      });

      // Per-user history row. Custom sends are keyed by timestamp so each is
      // a distinct entry (unlike templates, which are one row per type).
      const sentId = `${targetUserId}__custom__${Date.now()}`;
      await db.collection('outreachSent').doc(sentId).set({
        userId: targetUserId,
        template: 'custom',
        subject: subj,
        sentAt: FieldValue.serverTimestamp(),
        sent: r.sent,
        error: r.error || null,
        sentBy: userId,
      }, { merge: true });

      await db.collection('outreachRuns').add({
        template: 'custom',
        subject: subj,
        triggeredBy: userId,
        triggeredAt: FieldValue.serverTimestamp(),
        attempted: 1,
        sent: r.sent ? 1 : 0,
        skipped: 0,
        failed: r.sent ? 0 : 1,
      });

      if (!r.sent) return res.status(502).json({ error: r.error || 'Send failed', sent: false });
      return res.status(200).json({ sent: true });
    }

    // ─── OUTREACH: CANARY SEND ─────────────────────────────────
    // Pick N userIds from the supplied list at random (default 3),
    // send the template only to them, and return both the standard
    // send results AND the userIds we sent to. Client uses the
    // returned IDs to mark them as "already sent this session" so a
    // subsequent full-batch click excludes them automatically.
    //
    // Identical to outreachSendBatch under the hood — same Resend tags,
    // same audit log, same throttling — just a different entry-point
    // semantically so the recent-runs panel can mark canary runs with
    // a canary: true flag for visual distinction.
    if (action === 'standingsDigestRun') {
      // "Where you stand" digest — dedicated two-phase runner.
      //   phase 'preview': compute real data, email a canary (with the
      //     CALLER's own standing) to the caller, return eligibleCount +
      //     the auto-drafted recap for the admin textarea.
      //   phase 'send': chunk personalized payloads into outreachScheduled
      //     docs (the 5-min drain sends one chunk per tick), so a 5k-user
      //     send never runs inside a single 60s invocation.
      const { phase = 'preview', recapText = '' } = req.body;
      const recap = String(recapText || '').trim().slice(0, 800);

      const { buildStandingsDigestData } = await import('./_lib/standingsDigest.js');
      const data = await buildStandingsDigestData(db);
      const effectiveRecap = recap || data.autoRecap;

      if (phase === 'preview') {
        const adminSnap = await db.collection('users').doc(userId).get();
        const adminUser = adminSnap.exists ? { id: adminSnap.id, ...adminSnap.data() } : { id: userId };
        if (!adminUser.email) return res.status(400).json({ error: 'Your admin account has no email to preview to.' });
        // Preview with the caller's own real standing; fall back to the first
        // eligible user's numbers if the caller has no global entry.
        const ctx = data.ctxFor(userId, effectiveRecap)
          || (data.eligible[0] ? data.ctxFor(data.eligible[0].id, effectiveRecap) : { recap: effectiveRecap, pointsRemaining: data.pointsRemaining });
        const { buildEmail, sendOutreachEmail } = await import('./_lib/outreachEmail.js');
        const { subject, html, text } = buildEmail('standingsDigest', { user: adminUser, ctx });
        const r = await sendOutreachEmail({ to: adminUser.email, subject: `[PREVIEW] ${subject}`, html, text });
        return res.status(200).json({
          phase: 'preview',
          sent: r.sent,
          error: r.error || null,
          to: adminUser.email,
          eligibleCount: data.eligible.length,
          autoRecap: data.autoRecap,
          pointsRemaining: data.pointsRemaining,
        });
      }

      if (phase === 'send') {
        const CHUNK = 800;
        let queued = 0;
        let chunks = 0;
        for (let i = 0; i < data.eligible.length; i += CHUNK) {
          const slice = data.eligible.slice(i, i + CHUNK);
          const userIds = slice.map((u) => u.id);
          const userPayloads = {};
          for (const u of slice) {
            const ctx = data.ctxFor(u.id, effectiveRecap);
            if (ctx) userPayloads[u.id] = ctx;
          }
          await db.collection('outreachScheduled').add({
            template: 'standingsDigest',
            userIds,
            userPayloads,
            recipientCount: userIds.length,
            scheduledFor: FieldValue.serverTimestamp(),
            scheduledAt: FieldValue.serverTimestamp(),
            scheduledBy: userId,
            status: 'pending',
          });
          queued += userIds.length;
          chunks += 1;
        }
        await db.collection('adminLogs').add({
          action: 'standings_digest_send',
          adminId: userId,
          timestamp: FieldValue.serverTimestamp(),
          summary: { queued, chunks, recapUsed: effectiveRecap.slice(0, 200) },
        }).catch(() => {});
        return res.status(200).json({ phase: 'send', queued, chunks, drainEveryMin: 5 });
      }

      return res.status(400).json({ error: `Unknown phase: ${phase}` });
    }

    if (action === 'finalWeekEmailRun') {
      // Final-week sends: 'top10' (pre-Final contender alert) and 'wrapped'
      // (post-Final recap). Same two-phase shape as standingsDigestRun:
      // preview = canary to the caller + counts; send = chunked scheduled
      // payloads through the 5-min drain. The Wrapped send is HARD-GATED on
      // the Final having a verified, decided result so it can never fire
      // with stale ranks.
      const { email, phase = 'preview' } = req.body;
      if (email !== 'top10' && email !== 'wrapped' && email !== 'finalHype' && email !== 'winners') {
        return res.status(400).json({ error: "email must be 'top10', 'wrapped', 'finalHype' or 'winners'" });
      }
      const { buildTop10ContenderData, buildWrappedData, buildFinalHypeData, buildWinnerData } = await import('./_lib/finalWeekEmails.js');
      const { buildEmail, sendOutreachEmail } = await import('./_lib/outreachEmail.js');

      const adminSnap = await db.collection('users').doc(userId).get();
      const adminUser = adminSnap.exists ? { id: adminSnap.id, ...adminSnap.data() } : { id: userId };

      // Users contacted in the last 24h (any template) — the Final Hype send
      // excludes them per operator instruction, so nobody gets two emails in
      // a day. outreachSent doc ids are {uid}__{template}; sentAt is the last
      // send of that template to that user.
      const recentlyEmailedUids = async () => {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const snap = await db.collection('outreachSent').where('sentAt', '>=', since).get();
        const uids = new Set();
        snap.forEach((d) => { const u = d.data().userId; if (u) uids.add(u); });
        return uids;
      };

      if (email === 'winners') {
        // Formal winner notifications (top 3) per Official Rules §8.
        // Direct sends (n=3) with reply-to support@ — winners must be able
        // to reply with wallet details. Send blocked until the Final result
        // is verified. Each send is audit-logged (the notification date
        // starts the response/forfeit clocks).
        const data = await buildWinnerData(db, admin);
        const top3 = data.winners.slice(0, 3);
        if (phase === 'preview') {
          if (!adminUser.email) return res.status(400).json({ error: 'Your admin account has no email to preview to.' });
          const w = top3[0];
          const ctx = w ? { place: 1, total: data.total, walletLast6: w.walletLast6 } : { place: 1, total: data.total, walletLast6: null };
          const { subject, html, text } = buildEmail('winnerNotification', { user: adminUser, ctx });
          const r = await sendOutreachEmail({ to: adminUser.email, subject: `[PREVIEW] ${subject}`, html, text, replyTo: 'support@goaloracle.io' });
          return res.status(200).json({
            phase, sent: r.sent, error: r.error || null, to: adminUser.email,
            finalDecided: data.finalDecided,
            winners: top3.map((x) => ({ place: x.place, displayName: x.displayName, email: x.email, points: x.points, walletLast6: x.walletLast6, emailOptOut: x.emailOptOut })),
          });
        }
        if (!data.finalDecided) return res.status(400).json({ error: 'Final result not verified yet — verify it in Match Results first.' });
        const missing = top3.filter((w) => !w.email);
        if (top3.length < 3 || missing.length) {
          return res.status(400).json({ error: `Cannot send: ${top3.length < 3 ? 'fewer than 3 finishers resolved' : `no email on file for ${missing.map((m) => m.displayName).join(', ')}`}` });
        }
        const results = [];
        for (const w of top3) {
          const ctx = { place: w.place, total: data.total, walletLast6: w.walletLast6 };
          const { subject, html, text } = buildEmail('winnerNotification', { user: { id: w.userId, displayName: w.displayName, email: w.email }, ctx });
          const r = await sendOutreachEmail({
            to: w.email, subject, html, text,
            replyTo: 'support@goaloracle.io',
            tags: [{ name: 'userId', value: w.userId }, { name: 'template', value: 'winnerNotification' }],
          });
          await db.collection('outreachSent').doc(`${w.userId}__winnerNotification`).set({
            userId: w.userId, template: 'winnerNotification', sentAt: FieldValue.serverTimestamp(),
            sent: r.sent, error: r.error || null, sentBy: userId,
          }, { merge: true });
          results.push({ place: w.place, displayName: w.displayName, email: w.email, sent: r.sent, error: r.error || null });
        }
        await db.collection('adminLogs').add({
          action: 'winner_notification_send',
          adminId: userId,
          timestamp: FieldValue.serverTimestamp(),
          summary: { winners: results },
        }).catch(() => {});
        return res.status(200).json({ phase, results });
      }

      if (email === 'finalHype') {
        const data = await buildFinalHypeData(db);
        const recent = await recentlyEmailedUids();
        const sendable = data.eligible.filter((u) => !recent.has(u.id));
        if (phase === 'preview') {
          if (!adminUser.email) return res.status(400).json({ error: 'Your admin account has no email to preview to.' });
          const ctx = data.ctxFor(userId) || (sendable[0] ? data.ctxFor(sendable[0].id) : (data.eligible[0] ? data.ctxFor(data.eligible[0].id) : {}));
          const { subject, html, text } = buildEmail('finalHype', { user: adminUser, ctx: ctx || {} });
          const r = await sendOutreachEmail({ to: adminUser.email, subject: `[PREVIEW] ${subject}`, html, text });
          return res.status(200).json({
            phase, sent: r.sent, error: r.error || null, to: adminUser.email,
            eligibleCount: sendable.length,
            excluded24h: data.eligible.length - sendable.length,
            finalists: data.finalists,
            pointsRemaining: data.pointsRemaining,
          });
        }
        if (data.finalists.length !== 2) {
          return res.status(400).json({ error: 'Both semifinals must be verified first — the finalists are not resolved yet.' });
        }
        const CHUNK = 800;
        let queued = 0;
        let chunks = 0;
        for (let i = 0; i < sendable.length; i += CHUNK) {
          const slice = sendable.slice(i, i + CHUNK);
          const userPayloads = {};
          for (const u of slice) {
            const ctx = data.ctxFor(u.id);
            if (ctx) userPayloads[u.id] = ctx;
          }
          await db.collection('outreachScheduled').add({
            template: 'finalHype',
            userIds: slice.map((u) => u.id),
            userPayloads,
            recipientCount: slice.length,
            scheduledFor: FieldValue.serverTimestamp(),
            scheduledAt: FieldValue.serverTimestamp(),
            scheduledBy: userId,
            status: 'pending',
          });
          queued += slice.length;
          chunks += 1;
        }
        await db.collection('adminLogs').add({
          action: 'final_hype_send',
          adminId: userId,
          timestamp: FieldValue.serverTimestamp(),
          summary: { queued, chunks, excluded24h: data.eligible.length - sendable.length, finalists: data.finalists },
        }).catch(() => {});
        return res.status(200).json({ phase, queued, chunks, excluded24h: data.eligible.length - sendable.length, drainEveryMin: 5 });
      }

      if (email === 'top10') {
        const data = await buildTop10ContenderData(db, admin);
        if (phase === 'preview') {
          if (!adminUser.email) return res.status(400).json({ error: 'Your admin account has no email to preview to.' });
          // Caller's own ctx if they're a contender, else the first eligible's.
          const ctx = data.ctxFor(userId) || (data.eligible[0] ? data.ctxFor(data.eligible[0].id) : { rank: 14, total: data.total, gap: 6, pointsRemaining: data.remaining, isTop10: false, points: 0, tenthPoints: 0 });
          const { subject, html, text } = buildEmail('top10Contender', { user: adminUser, ctx });
          const r = await sendOutreachEmail({ to: adminUser.email, subject: `[PREVIEW] ${subject}`, html, text });
          return res.status(200).json({ phase, sent: r.sent, error: r.error || null, to: adminUser.email, eligibleCount: data.eligible.length, chasers: data.chasers, defenders: data.defenders, pointsRemaining: data.remaining });
        }
        // send — small audience, one scheduled doc.
        if (data.eligible.length === 0) return res.status(400).json({ error: 'No contenders right now (check points remaining / board freshness).' });
        const userPayloads = {};
        for (const u of data.eligible) {
          const ctx = data.ctxFor(u.id);
          if (ctx) userPayloads[u.id] = ctx;
        }
        await db.collection('outreachScheduled').add({
          template: 'top10Contender',
          userIds: data.eligible.map((u) => u.id),
          userPayloads,
          recipientCount: data.eligible.length,
          scheduledFor: FieldValue.serverTimestamp(),
          scheduledAt: FieldValue.serverTimestamp(),
          scheduledBy: userId,
          status: 'pending',
        });
        await db.collection('adminLogs').add({
          action: 'top10_contender_send',
          adminId: userId,
          timestamp: FieldValue.serverTimestamp(),
          summary: { queued: data.eligible.length, chasers: data.chasers, defenders: data.defenders },
        }).catch(() => {});
        return res.status(200).json({ phase, queued: data.eligible.length, chasers: data.chasers, defenders: data.defenders });
      }

      // email === 'wrapped'
      const data = await buildWrappedData(db);
      if (phase === 'preview') {
        if (!adminUser.email) return res.status(400).json({ error: 'Your admin account has no email to preview to.' });
        const ctx = data.ctxFor(userId) || (data.eligible[0] ? data.ctxFor(data.eligible[0].id) : null);
        const { subject, html, text } = buildEmail('wcWrapped', { user: adminUser, ctx: ctx || {} });
        const r = await sendOutreachEmail({ to: adminUser.email, subject: `[PREVIEW] ${subject}`, html, text });
        return res.status(200).json({ phase, sent: r.sent, error: r.error || null, to: adminUser.email, eligibleCount: data.eligible.length, finalDecided: data.finalDecided, finalWinner: data.finalWinner });
      }
      if (!data.finalDecided) {
        return res.status(400).json({ error: 'The Final result is not verified yet — Wrapped would send with stale ranks. Verify the Final in Match Results first.' });
      }
      const CHUNK = 800;
      let queued = 0;
      let chunks = 0;
      for (let i = 0; i < data.eligible.length; i += CHUNK) {
        const slice = data.eligible.slice(i, i + CHUNK);
        const userPayloads = {};
        for (const u of slice) {
          const ctx = data.ctxFor(u.id);
          if (ctx) userPayloads[u.id] = ctx;
        }
        await db.collection('outreachScheduled').add({
          template: 'wcWrapped',
          userIds: slice.map((u) => u.id),
          userPayloads,
          recipientCount: slice.length,
          scheduledFor: FieldValue.serverTimestamp(),
          scheduledAt: FieldValue.serverTimestamp(),
          scheduledBy: userId,
          status: 'pending',
        });
        queued += slice.length;
        chunks += 1;
      }
      await db.collection('adminLogs').add({
        action: 'wc_wrapped_send',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        summary: { queued, chunks, finalWinner: data.finalWinner },
      }).catch(() => {});
      return res.status(200).json({ phase, queued, chunks, drainEveryMin: 5 });
    }

    if (action === 'winnerReceiptRun') {
      // Post-payout receipt to a winner: the on-chain tx hash + explorer
      // link as proof of payment. Operator enters place/network/txHash in
      // the Winner payouts panel; phase 'preview' sends to the operator,
      // phase 'send' emails the winner and logs the payout record (the
      // audit row with the hash IS the §8 proof-of-performance trail).
      const { place, txHash, network, currency = 'USDC', method = 'crypto', stripeReceiptUrl, phase = 'preview' } = req.body;
      const p = Number(place);
      if (!Number.isInteger(p) || p < 1 || p > 3) return res.status(400).json({ error: 'place must be 1, 2 or 3' });
      if (method !== 'crypto' && method !== 'stripe') return res.status(400).json({ error: "method must be 'crypto' or 'stripe'" });

      const { RECEIPT_EXPLORERS, buildWinnerData } = await import('./_lib/finalWeekEmails.js');
      let ctx;
      let proofSummary;
      if (method === 'stripe') {
        // Stripe receipt link: must be an https Stripe-hosted URL — this goes
        // into an email as the payment proof, so never accept arbitrary hosts.
        const url = typeof stripeReceiptUrl === 'string' ? stripeReceiptUrl.trim() : '';
        let host = '';
        try { host = new URL(url).hostname; } catch { /* invalid */ }
        if (!url.startsWith('https://') || !(host === 'stripe.com' || host.endsWith('.stripe.com'))) {
          return res.status(400).json({ error: 'stripeReceiptUrl must be an https://…stripe.com receipt link' });
        }
        ctx = { place: p, method: 'stripe', stripeReceiptUrl: url };
        proofSummary = { method: 'stripe', stripeReceiptUrl: url, currency: 'USD' };
      } else {
        if (typeof txHash !== 'string' || !/^0x[a-fA-F0-9]{64}$/.test(txHash.trim())) {
          return res.status(400).json({ error: 'txHash must be a 66-char 0x… transaction hash' });
        }
        const net = RECEIPT_EXPLORERS[String(network || '').toLowerCase()];
        if (!net) return res.status(400).json({ error: "network must be 'polygon', 'base' or 'ethereum'" });
        if (currency !== 'USDC' && currency !== 'USDG') return res.status(400).json({ error: 'currency must be USDC or USDG' });
        const hash = txHash.trim();
        ctx = { place: p, method: 'crypto', txHash: hash, network: net.label, explorerUrl: net.txUrl(hash), currency };
        proofSummary = { method: 'crypto', txHash: hash, network: net.label, currency, explorerUrl: net.txUrl(hash) };
      }

      const adminSnap2 = await db.collection('users').doc(userId).get();
      const adminUser2 = adminSnap2.exists ? { id: adminSnap2.id, ...adminSnap2.data() } : { id: userId };
      const data = await buildWinnerData(db, admin);
      const winner = data.winners.find((w) => w.place === p);
      if (!winner) return res.status(400).json({ error: 'Could not resolve that winner from the leaderboard' });
      const { buildEmail, sendOutreachEmail } = await import('./_lib/outreachEmail.js');

      if (phase === 'preview') {
        if (!adminUser2.email) return res.status(400).json({ error: 'Your admin account has no email to preview to.' });
        const { subject, html, text } = buildEmail('winnerReceipt', { user: adminUser2, ctx });
        const r = await sendOutreachEmail({ to: adminUser2.email, subject: `[PREVIEW] ${subject}`, html, text, replyTo: 'support@goaloracle.io' });
        return res.status(200).json({ phase, sent: r.sent, error: r.error || null, to: adminUser2.email, winner: { place: p, displayName: winner.displayName, email: winner.email } });
      }

      if (!winner.email) return res.status(400).json({ error: `No email on file for ${winner.displayName}` });
      const { subject, html, text } = buildEmail('winnerReceipt', { user: { id: winner.userId, displayName: winner.displayName, email: winner.email }, ctx });
      const r = await sendOutreachEmail({
        to: winner.email, subject, html, text,
        replyTo: 'support@goaloracle.io',
        tags: [{ name: 'userId', value: winner.userId }, { name: 'template', value: 'winnerReceipt' }],
      });
      await db.collection('outreachSent').doc(`${winner.userId}__winnerReceipt`).set({
        userId: winner.userId, template: 'winnerReceipt', sentAt: FieldValue.serverTimestamp(),
        sent: r.sent, error: r.error || null, sentBy: userId,
      }, { merge: true });
      await db.collection('adminLogs').add({
        action: 'winner_paid',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        targetUserId: winner.userId,
        targetDisplayName: winner.displayName,
        targetEmail: winner.email,
        summary: { place: p, ...proofSummary, receiptSent: r.sent },
      }).catch(() => {});
      // If the public winners page is already published, sync this payment's
      // proof link into it directly — no manual re-publish needed for proofs
      // that land after publishing.
      try {
        const wRef = db.collection('siteContent').doc('winners');
        const wSnap = await wRef.get();
        if (wSnap.exists) {
          const proofUrl = proofSummary.explorerUrl || proofSummary.stripeReceiptUrl || null;
          const winnersArr = (wSnap.data().winners || []).map((w) =>
            w.place === p ? { ...w, proofUrl } : w);
          await wRef.update({ winners: winnersArr, updatedAt: FieldValue.serverTimestamp() });
        }
      } catch (e) {
        console.warn('[winnerReceipt] winners-page proof sync failed (non-fatal):', e?.message);
      }
      return res.status(200).json({ phase, sent: r.sent, error: r.error || null, winner: { place: p, displayName: winner.displayName, email: winner.email }, proofUrl: proofSummary.explorerUrl || proofSummary.stripeReceiptUrl });
    }

    if (action === 'tournamentFinalize') {
      // Close-out step 1: freeze every player's World Cup 2026 record into
      // /profiles/{uid} (rank, percentile, league positions, badge ids) in
      // one full scan + one batched write pass. Profile pages then serve a
      // single edge-cached read forever — nothing per-view, nothing
      // recomputed. Idempotent: re-running overwrites with fresh data.
      const callerRole2 = await getRole(userId);
      if (callerRole2 !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
      const { buildProfilesData } = await import('./_lib/finalWeekEmails.js');
      const data = await buildProfilesData(db);
      if (!data.finalDecided) return res.status(400).json({ error: 'Final result not verified yet — finalize after the Final is verified.' });
      let batch = db.batch();
      let ops = 0;
      const commits = [];
      for (const p of data.profiles) {
        batch.set(db.collection('profiles').doc(p.userId), {
          ...p,
          updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        if (++ops >= 450) { commits.push(batch.commit()); batch = db.batch(); ops = 0; }
      }
      if (ops > 0) commits.push(batch.commit());
      await Promise.all(commits);
      await db.collection('siteContent').doc('tournament2026').set({
        totalPlayers: data.totalPlayers,
        finalWinner: data.finalWinner,
        finalizedAt: FieldValue.serverTimestamp(),
        finalizedBy: userId,
      }, { merge: true });
      await db.collection('adminLogs').add({
        action: 'tournament_finalize',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        summary: { profiles: data.profiles.length, totalPlayers: data.totalPlayers, finalWinner: data.finalWinner },
      }).catch(() => {});
      return res.status(200).json({ profiles: data.profiles.length, totalPlayers: data.totalPlayers, finalWinner: data.finalWinner });
    }

    if (action === 'publishWinners') {
      // Close-out step 2: write the public /winners page content to ONE doc
      // (/siteContent/winners) served via the edge-cached public API. Prize
      // proof links come from the winner_paid audit rows written by the
      // receipt flow. excludePlaces honors publicity opt-outs (Rules §10).
      const callerRole3 = await getRole(userId);
      if (callerRole3 !== 'superadmin') return res.status(403).json({ error: 'Superadmin only' });
      const excludePlaces = Array.isArray(req.body.excludePlaces) ? req.body.excludePlaces.map(Number) : [];
      const { buildWinnerData } = await import('./_lib/finalWeekEmails.js');
      const { PRIZES } = await import('../src/config/legal.js');
      const data = await buildWinnerData(db, admin);
      if (!data.finalDecided) return res.status(400).json({ error: 'Final result not verified yet.' });
      // Latest payout proof per place from the winner_paid audit rows.
      const paidSnap = await db.collection('adminLogs').where('action', '==', 'winner_paid').get();
      const proofByPlace = {};
      paidSnap.forEach((d) => {
        const s = d.data().summary || {};
        const ts = d.data().timestamp;
        const ms = ts?._seconds ? ts._seconds * 1000 : 0;
        if (!proofByPlace[s.place] || ms > proofByPlace[s.place].ms) {
          proofByPlace[s.place] = { ms, url: s.explorerUrl || s.stripeReceiptUrl || null };
        }
      });
      // Country flags for the podium.
      const top3 = data.winners.slice(0, 3);
      const userSnaps = top3.length ? await db.getAll(...top3.map((w) => db.collection('users').doc(w.userId))) : [];
      const countries = {};
      userSnaps.forEach((s) => { if (s.exists) countries[s.id] = s.data().country || s.data().geoCountry || null; });
      const winners = top3
        .filter((w) => !excludePlaces.includes(w.place))
        .map((w) => ({
          place: w.place,
          displayName: w.displayName,
          userId: w.userId,
          country: countries[w.userId] || null,
          points: w.points,
          amount: PRIZES[w.place - 1]?.amount || 0,
          currency: PRIZES[w.place - 1]?.currency || 'USDC',
          proofUrl: proofByPlace[w.place]?.url || null,
        }));
      await db.collection('siteContent').doc('winners').set({
        winners,
        totalPlayers: data.total,
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: userId,
      });
      await db.collection('adminLogs').add({
        action: 'winners_published',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        summary: { places: winners.map((w) => w.place), excludePlaces },
      }).catch(() => {});
      return res.status(200).json({ published: winners.length, winners });
    }

    if (action === 'outreachSendCanary') {
      const { template = 'noPicksReminder', userIds: pool, count = 3 } = req.body;
      if (!Array.isArray(pool) || pool.length === 0) {
        return res.status(400).json({ error: 'userIds required (non-empty array)' });
      }
      const n = Math.max(1, Math.min(50, Number(count) || 3));
      // Fisher-Yates sample n distinct userIds from the pool.
      const shuffled = [...pool];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      const picked = shuffled.slice(0, Math.min(n, shuffled.length));

      const { buildEmail, sendOutreachEmail, TEMPLATES, sleep, BATCH_DELAY_MS } = await import('./_lib/outreachEmail.js');
      if (!TEMPLATES[template]) return res.status(400).json({ error: `Unknown template: ${template}` });

      const results = { sent: 0, skipped: 0, failed: 0, errors: [], canaryIds: picked };
      for (const uid of picked) {
        try {
          const userSnap = await db.collection('users').doc(uid).get();
          if (!userSnap.exists) { results.skipped++; continue; }
          const user = { id: userSnap.id, ...userSnap.data() };
          if (!user.email || user.emailOptOut === true) { results.skipped++; continue; }

          const { subject, html, text } = buildEmail(template, { user, ctx: {} });
          const r = await sendOutreachEmail({
            to: user.email,
            subject, html, text,
            tags: [
              { name: 'userId', value: uid },
              { name: 'template', value: template },
              { name: 'canary', value: '1' },
            ],
          });

          await db.collection('outreachSent').doc(`${uid}__${template}`).set({
            userId: uid,
            template,
            sentAt: FieldValue.serverTimestamp(),
            sent: r.sent,
            error: r.error || null,
            sentBy: userId,
            lastSendWasCanary: true,
          }, { merge: true });

          if (r.sent) results.sent++;
          else { results.failed++; results.errors.push({ uid, error: r.error || 'unknown' }); }

          await sleep(BATCH_DELAY_MS);
        } catch (e) {
          results.failed++;
          results.errors.push({ uid, error: e?.message || 'crash' });
        }
      }

      await db.collection('outreachRuns').add({
        template,
        triggeredBy: userId,
        triggeredAt: FieldValue.serverTimestamp(),
        attempted: picked.length,
        sent: results.sent,
        skipped: results.skipped,
        failed: results.failed,
        canary: true,
      });

      return res.status(200).json(results);
    }

    // ─── OUTREACH: SCHEDULE A SEND ─────────────────────────────
    // Stash the (template, userIds, scheduledFor) in /outreachScheduled.
    // The outreach-drain cron picks pending docs up every 5 minutes,
    // transitions them through sending -> done, and runs the standard
    // batch loop. Same per-user audit rows + final /outreachRuns
    // summary as the immediate send.
    if (action === 'outreachSchedule') {
      const { template = 'noPicksReminder', userIds: requested, scheduledFor } = req.body;
      if (!Array.isArray(requested) || requested.length === 0) {
        return res.status(400).json({ error: 'userIds required (non-empty array)' });
      }
      if (requested.length > 1000) {
        return res.status(400).json({ error: 'Scheduled batch too large (max 1000 per send)' });
      }
      if (!scheduledFor) return res.status(400).json({ error: 'scheduledFor required (ISO timestamp)' });
      const when = new Date(scheduledFor);
      if (isNaN(when.getTime())) return res.status(400).json({ error: 'scheduledFor must be a parseable date' });
      if (when.getTime() < Date.now() - 60 * 1000) {
        return res.status(400).json({ error: 'scheduledFor must be in the future (max 60s clock skew allowed)' });
      }
      const { TEMPLATES } = await import('./_lib/outreachEmail.js');
      if (!TEMPLATES[template]) return res.status(400).json({ error: `Unknown template: ${template}` });

      const docRef = await db.collection('outreachScheduled').add({
        template,
        userIds: requested,
        recipientCount: requested.length,
        scheduledFor: when,
        scheduledForMs: when.getTime(),
        scheduledAt: FieldValue.serverTimestamp(),
        scheduledBy: userId,
        status: 'pending',
      });
      return res.status(200).json({ id: docRef.id, status: 'pending', scheduledFor: when.toISOString() });
    }

    // ─── OUTREACH: CANCEL A SCHEDULED SEND ─────────────────────
    // Pending only. Once the drain cron flips status to 'sending' the
    // send is in flight and we don't try to interrupt it.
    if (action === 'outreachCancelScheduled') {
      const { id, reason } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const ref = db.collection('outreachScheduled').doc(id);
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: 'not found' });
      const cur = snap.data();
      if (cur.status !== 'pending') {
        return res.status(400).json({ error: `Cannot cancel — status is "${cur.status}"` });
      }
      await ref.update({
        status: 'cancelled',
        cancelledAt: FieldValue.serverTimestamp(),
        cancelledBy: userId,
        cancelReason: reason || null,
      });
      return res.status(200).json({ ok: true });
    }

    // ─── OUTREACH AUTOMATION RULES (B2d) ───────────────────────
    // Operator-editable rules that the automation cron evaluates. A rule
    // is { enabled, segment, template, hoursBeforeLock, cooldownDays,
    // maxPerRun }. Rules are DISABLED BY DEFAULT and superadmin-only to
    // mutate, since an enabled rule auto-sends real email.
    if (action === 'automationRuleSave') {
      if ((await getRole(userId)) !== 'superadmin') {
        return res.status(403).json({ error: 'Superadmin only' });
      }
      const { id, rule } = req.body;
      if (!rule || typeof rule !== 'object') return res.status(400).json({ error: 'rule object required' });

      const { SEGMENTS } = await import('./_lib/outreachSegments.js');
      const { TEMPLATES } = await import('./_lib/outreachEmail.js');
      if (!SEGMENTS[rule.segment]) return res.status(400).json({ error: `Unknown segment: ${rule.segment}` });
      if (!TEMPLATES[rule.template]) return res.status(400).json({ error: `Unknown template: ${rule.template}` });

      // Clamp the safety knobs to sane ranges so a typo can't, e.g., set a
      // 100000-recipient cap or a negative cooldown.
      // Which stage's lock the timing window counts down to. Whitelisted so a
      // typo can't point the cron at a nonexistent stage (it would then never
      // fire). Defaults to groupStage for back-compat with pre-stage rules.
      const VALID_STAGES = new Set(['groupStage', 'roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final']);
      const stage = VALID_STAGES.has(rule.stage) ? rule.stage : 'groupStage';
      // Optional gate: only fire once the named stage's games have all finished.
      const requireStageComplete = VALID_STAGES.has(rule.requireStageComplete) ? rule.requireStageComplete : null;
      // Optional recurrence: re-send every N hours (clamped >= 6 so a typo
      // can't blast hourly; null = one-shot per user).
      const repeatEveryHours = rule.repeatEveryHours == null || rule.repeatEveryHours === ''
        ? null : Math.max(6, Math.min(720, Number(rule.repeatEveryHours) || 0));

      const clean = {
        name: String(rule.name || '').slice(0, 80) || `${rule.segment} → ${rule.template}`,
        enabled: rule.enabled === true, // explicit opt-in only
        segment: rule.segment,
        template: rule.template,
        stage,
        requireStageComplete,
        repeatEveryHours,
        // Fire when within this many hours before the chosen stage's lock
        // (null = no timing gate, evaluate every run).
        hoursBeforeLock: rule.hoursBeforeLock == null ? null
          : Math.max(0, Math.min(2160, Number(rule.hoursBeforeLock) || 0)),
        cooldownDays: Math.max(1, Math.min(60, Number(rule.cooldownDays) || 3)),
        maxPerRun: Math.max(1, Math.min(1000, Number(rule.maxPerRun) || 200)),
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: userId,
      };

      let ruleId = id;
      if (ruleId) {
        await db.collection('automationRules').doc(ruleId).set(clean, { merge: true });
      } else {
        clean.createdAt = FieldValue.serverTimestamp();
        clean.createdBy = userId;
        const ref = await db.collection('automationRules').add(clean);
        ruleId = ref.id;
      }
      await db.collection('adminLogs').add({
        action: 'automation_rule_save', ruleId, enabled: clean.enabled,
        segment: clean.segment, template: clean.template,
        by: userId, timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {});
      return res.status(200).json({ id: ruleId, rule: clean });
    }

    if (action === 'automationRuleDelete') {
      if ((await getRole(userId)) !== 'superadmin') {
        return res.status(403).json({ error: 'Superadmin only' });
      }
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'id required' });
      await db.collection('automationRules').doc(id).delete();
      await db.collection('adminLogs').add({
        action: 'automation_rule_delete', ruleId: id, by: userId,
        timestamp: FieldValue.serverTimestamp(),
      }).catch(() => {});
      return res.status(200).json({ ok: true });
    }

    // ─── OUTREACH AUTOMATION: DRY-RUN PREVIEW (B2d-1) ──────────
    // Resolve a segment + apply the recent-contact guardrail, WITHOUT
    // sending. Lets the operator see exactly who a rule would email before
    // enabling it. The cron will use the identical resolver + guardrail.
    if (action === 'automationRulePreview') {
      const { segment, cooldownDays = 3, maxPerRun = 200 } = req.body;
      const { resolveSegment, SEGMENTS } = await import('./_lib/outreachSegments.js');
      if (!SEGMENTS[segment]) return res.status(400).json({ error: `Unknown segment: ${segment}` });

      const { userIds } = await resolveSegment(db, segment);

      // Apply the recent-contact guardrail: exclude anyone emailed within
      // cooldownDays (any template). Read /outreachSent once.
      const cooldownMs = Math.max(1, Number(cooldownDays) || 3) * 86400000;
      const cutoff = Date.now() - cooldownMs;
      const sentSnap = await db.collection('outreachSent').get();
      const lastSentByUser = {};
      sentSnap.docs.forEach((d) => {
        const x = d.data();
        if (!x.userId || x.sent === false) return;
        const ms = x.sentAt?._seconds ? x.sentAt._seconds * 1000
          : (typeof x.sentAt?.toMillis === 'function' ? x.sentAt.toMillis() : null);
        if (ms && (!lastSentByUser[x.userId] || ms > lastSentByUser[x.userId])) lastSentByUser[x.userId] = ms;
      });

      const eligible = userIds.filter((uid) => !(lastSentByUser[uid] && lastSentByUser[uid] >= cutoff));
      const excludedByGuardrail = userIds.length - eligible.length;
      const capped = eligible.slice(0, Math.max(1, Math.min(1000, Number(maxPerRun) || 200)));

      // Resolve a small sample of names for the operator to eyeball.
      const sample = [];
      for (const uid of capped.slice(0, 8)) {
        const u = await db.collection('users').doc(uid).get();
        if (u.exists) sample.push({ id: uid, displayName: u.data().displayName || null, email: u.data().email || null });
      }

      return res.status(200).json({
        segment,
        segmentSize: userIds.length,
        excludedByGuardrail,
        eligible: eligible.length,
        wouldSend: capped.length,
        cappedBy: capped.length < eligible.length ? maxPerRun : null,
        sample,
      });
    }

    if (action === 'reconcile') {
      // Audit a Quick Picks league. Returns:
      //   - prediction submission stats (total users / submitted / complete)
      //   - matchResult ingestion check (every kicked-off match has a result)
      //   - per-match pick distribution if matchId is provided
      //   - any users whose picks throw on score computation
      //
      // Design note: Quick Picks scoring is currently client-side, so there
      // is no stored "final score" to reconcile against. This endpoint
      // surfaces enough data to spot drift manually + flags structurally
      // bad picks before they cause leaderboard glitches.
      const { leagueId, matchId } = req.body;
      if (!leagueId) return res.status(400).json({ error: 'Missing leagueId' });

      // 1) League roster
      const leagueSnap = await db.collection('leagues').doc(leagueId).get();
      if (!leagueSnap.exists) return res.status(404).json({ error: 'League not found' });
      const memberIds = leagueSnap.data().members || [];

      // 2) Predictions for those members in this league. Composite doc IDs
      //    are `${userId}__${leagueId}`; fall back to legacy `userId` doc
      //    for global-simple, mirroring /api/simple-leaderboard.
      const compositeIds = memberIds.map(uid => `${uid}__${leagueId}`);
      const preds = {};
      for (let i = 0; i < compositeIds.length; i += 30) {
        const batch = compositeIds.slice(i, i + 30);
        const snap = await db.collection('simplePredictions')
          .where(admin.firestore.FieldPath.documentId(), 'in', batch)
          .get();
        snap.docs.forEach(d => { const data = d.data(); if (data?.userId) preds[data.userId] = data; });
      }
      if (leagueId === 'global-simple') {
        const missing = memberIds.filter(uid => !preds[uid]);
        for (let i = 0; i < missing.length; i += 30) {
          const batch = missing.slice(i, i + 30);
          const snap = await db.collection('simplePredictions')
            .where(admin.firestore.FieldPath.documentId(), 'in', batch)
            .get();
          snap.docs.forEach(d => { if (!preds[d.id]) preds[d.id] = d.data(); });
        }
      }

      const predUsers = Object.keys(preds);
      const submitted = predUsers.length;
      const complete = predUsers.filter(uid => {
        const finalPick = preds[uid]?.knockoutPredictions?.final?.[0];
        return !!(preds[uid]?.isComplete || finalPick?.winnerId);
      }).length;

      // 3) Match results coverage. Walk WORLD_CUP_MATCHES and check which
      //    have already kicked off; flag any without a stored matchResult.
      const now = Date.now();
      const completedMatches = WORLD_CUP_MATCHES.filter(m => {
        const [hh, mm] = m.time.split(':').map(Number);
        const d = new Date(`${m.date}T00:00:00Z`);
        d.setUTCHours(hh + 4, mm, 0, 0);
        return d.getTime() < now - 3 * 60 * 60 * 1000; // FT'd > 3h ago
      });
      const resultsSnap = await db.collection('matchResults').get();
      const resultsByMatchId = {};
      resultsSnap.docs.forEach(d => { resultsByMatchId[d.id] = d.data(); });
      const missingResults = completedMatches
        .filter(m => !resultsByMatchId[m.id] || resultsByMatchId[m.id].completed !== true)
        .map(m => m.id);

      // 4) Per-match pick distribution for the optional matchId param.
      let pickDistribution = null;
      if (matchId) {
        const counts = {};
        let predictedCount = 0;
        for (const uid of predUsers) {
          const ko = preds[uid]?.knockoutPredictions || {};
          const allRounds = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];
          for (const round of allRounds) {
            const arr = ko[round] || [];
            const slot = arr.find(s => s?.matchId === matchId);
            if (slot?.winnerId) {
              counts[slot.winnerId] = (counts[slot.winnerId] || 0) + 1;
              predictedCount++;
              break;
            }
          }
        }
        pickDistribution = { matchId, totalPredicted: predictedCount, byTeam: counts };
      }

      // 5) Surface users whose payload is structurally malformed enough that
      //    the leaderboard would fail to render them. Cheap defensive check.
      const malformed = [];
      for (const uid of predUsers) {
        const p = preds[uid];
        try {
          if (p.groupPredictions && typeof p.groupPredictions !== 'object') throw new Error('groupPredictions not object');
          if (p.bestThirdPicks && !Array.isArray(p.bestThirdPicks)) throw new Error('bestThirdPicks not array');
          if (p.knockoutPredictions && typeof p.knockoutPredictions !== 'object') throw new Error('knockoutPredictions not object');
        } catch (e) {
          malformed.push({ userId: uid, error: e.message });
        }
      }

      await db.collection('adminLogs').add({
        action: 'reconcile',
        leagueId, matchId: matchId || null,
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        summary: { totalMembers: memberIds.length, submitted, complete, missingResultCount: missingResults.length },
      });

      return res.status(200).json({
        leagueId,
        runAt: new Date().toISOString(),
        members: { total: memberIds.length, submitted, complete },
        results: {
          completedMatchesExpected: completedMatches.length,
          completedMatchesIngested: completedMatches.length - missingResults.length,
          missingResults,
        },
        pickDistribution,
        malformed,
      });
    }

    if (action === 'inspectFingerprint') {
      // Look up which user IDs share a given device fingerprint. Useful for
      // investigating Sybil reports.
      const { visitorId } = req.body;
      if (!visitorId) return res.status(400).json({ error: 'Missing visitorId' });
      const snap = await db.collection('deviceFingerprints').doc(visitorId).get();
      if (!snap.exists) return res.status(200).json({ visitorId, userIds: [] });
      return res.status(200).json({ visitorId, ...snap.data() });
    }

    if (action === 'clearAntiSybilForUser') {
      // Wipes a user from all deviceFingerprints docs + signupIps docs they
      // appear in. Lets the operator bring an account "back to brand-new"
      // for QA — also a manual unblock when someone gets stuck behind the
      // device-per-email wall on a deploy without ANTI_SYBIL_BYPASS_EMAILS
      // configured. Admin-only; logged.
      const { userId } = req.body;
      if (!userId) return res.status(400).json({ error: 'Missing userId' });

      const fpSnap = await db.collection('deviceFingerprints').where('userIds', 'array-contains', userId).get();
      const ipSnap = await db.collection('signupIps').where('userIds', 'array-contains', userId).get();
      const { FieldValue } = await import('firebase-admin/firestore');
      const batch = db.batch();
      fpSnap.docs.forEach(d => batch.update(d.ref, { userIds: FieldValue.arrayRemove(userId) }));
      ipSnap.docs.forEach(d => batch.update(d.ref, { userIds: FieldValue.arrayRemove(userId) }));
      await batch.commit();

      await db.collection('adminLogs').add({
        action: 'clearAntiSybilForUser',
        targetUserId: userId,
        actor: claims.userId,
        timestamp: new Date(),
        cleared: { fingerprints: fpSnap.size, ips: ipSnap.size },
      }).catch(() => {});

      return res.status(200).json({
        ok: true,
        cleared: { fingerprints: fpSnap.size, ips: ipSnap.size },
      });
    }

    if (action === 'getAntiSybilBypassList') {
      // Returns the current Firestore-managed bypass list. Env-var
      // entries (ANTI_SYBIL_BYPASS_EMAILS) are NOT included — those are
      // bootstrap-only and not editable from the UI.
      const snap = await db.collection('config').doc('antiSybilBypass').get();
      const emails = snap.exists ? (snap.data()?.emails || []) : [];
      const envEmails = (process.env.ANTI_SYBIL_BYPASS_EMAILS || '').split(',').map(s => s.trim()).filter(Boolean);
      return res.status(200).json({ emails, envEmails });
    }

    if (action === 'setAntiSybilBypassList') {
      // Replace the full list. UI sends the desired final state — we
      // don't do incremental add/remove because the list is small and
      // last-writer-wins is fine for a single-operator panel.
      const { emails } = req.body;
      if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails must be an array' });
      // Cap at 200 to keep the doc small; way past any realistic need.
      if (emails.length > 200) return res.status(400).json({ error: 'Max 200 entries' });
      const cleaned = Array.from(new Set(
        emails.map(e => typeof e === 'string' ? e.trim() : '').filter(Boolean)
      ));
      // Validate each entry parses to a normalized email.
      const invalid = cleaned.filter(e => !normalizeBypassEmail(e));
      if (invalid.length > 0) {
        return res.status(400).json({ error: `Invalid email(s): ${invalid.slice(0, 3).join(', ')}` });
      }
      await db.collection('config').doc('antiSybilBypass').set({
        emails: cleaned,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: claims.userId,
      }, { merge: true });
      _invalidateBypassCache(); // best-effort; only invalidates this lambda instance
      await db.collection('adminLogs').add({
        action: 'setAntiSybilBypassList',
        actor: claims.userId,
        timestamp: FieldValue.serverTimestamp(),
        count: cleaned.length,
      }).catch(() => {});
      return res.status(200).json({ ok: true, count: cleaned.length, emails: cleaned });
    }

    if (action === 'backfillEmails') {
      // Backfills user.email + user.emailDedupeKey for any user doc where
      // email is missing/null. The legacy custom-token sign-in path used
      // to overwrite a real email with null because fbUser.email is null
      // after signInWithCustomToken; this action recovers the address from
      // Firebase Auth's user record (when it has one) for already-affected
      // accounts.
      //
      // Scope: scans every users doc, filters the ones missing email,
      // looks each up via admin.auth().getUser(uid). Skips users where
      // even Firebase Auth has no email — those need a fresh sign-in to
      // populate, which the new auth-flow upsert (api/auth/{google,verify-code})
      // takes care of automatically the next time they log in.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can run backfill' });
      }
      const dryRun = req.body?.dryRun === true;

      const snap = await db.collection('users').get();
      const targets = [];
      snap.docs.forEach((d) => {
        const data = d.data();
        if (!data.email) targets.push(d.id);
      });

      const results = { scanned: snap.size, missing: targets.length, fixed: 0, stillMissing: 0, errors: [] };

      if (dryRun) {
        return res.status(200).json({ ...results, dryRun: true, sample: targets.slice(0, 10) });
      }

      // Process in chunks of 50 to keep Firestore writes manageable.
      for (let i = 0; i < targets.length; i += 50) {
        const chunk = targets.slice(i, i + 50);
        await Promise.all(chunk.map(async (uid) => {
          try {
            // admin.auth().getUser throws auth/user-not-found if the UID
            // never had a Firebase Auth record. Catch and skip.
            const fbUser = await admin.auth().getUser(uid).catch(() => null);
            const email = fbUser?.email
              || fbUser?.providerData?.find(p => p.email)?.email
              || null;
            if (!email) {
              results.stillMissing++;
              return;
            }
            const { normalizeEmail } = await import('./_lib/security.js');
            await db.collection('users').doc(uid).set({
              email,
              emailDedupeKey: normalizeEmail(email),
              emailBackfilledAt: FieldValue.serverTimestamp(),
            }, { merge: true });
            results.fixed++;
          } catch (e) {
            results.errors.push({ uid, error: e.message });
          }
        }));
      }

      await db.collection('adminLogs').add({
        action: 'backfill_emails',
        adminId: userId,
        timestamp: FieldValue.serverTimestamp(),
        ...results,
      }).catch(() => {});

      return res.status(200).json(results);
    }

    if (action === 'inspectUser') {
      // Diagnostic for sign-in regressions. Returns the canonical Firestore
      // state for a given email so we can see whether duplicate /users/* docs
      // (one did:privy:* + one auth_*, or two auth_* with the same dedupe
      // key) are stranding the client's getDoc lookup. Read-only.
      //
      // Triggered from the Admin panel; not surfaced to regular users.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can inspect users' });
      }
      const rawEmail = (req.body?.email || '').toString().trim().toLowerCase();
      if (!rawEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(rawEmail)) {
        return res.status(400).json({ error: 'Valid email required' });
      }
      const { normalizeEmail } = await import('./_lib/security.js');
      const dedupeKey = normalizeEmail(rawEmail);

      const collectDoc = (d) => {
        const data = d.data() || {};
        return {
          id: d.id,
          email: data.email ?? null,
          emailDedupeKey: data.emailDedupeKey ?? null,
          displayName: data.displayName ?? null,
          displayNameLower: data.displayNameLower ?? null,
          role: data.role ?? null,
          country: data.country ?? null,
          usernameSet: data.usernameSet,
          onboardingComplete: data.onboardingComplete,
          banned: data.banned ?? false,
          bannedReason: data.bannedReason ?? null,
          deviceFingerprint: data.deviceFingerprint ?? null,
          signupIpHash: data.signupIpHash ?? null,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? null,
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? null,
          emailBackfilledAt: data.emailBackfilledAt?.toDate?.()?.toISOString?.() ?? null,
          emailUpdatedAt: data.emailUpdatedAt?.toDate?.()?.toISOString?.() ?? null,
          leagues: Array.isArray(data.leagues) ? data.leagues : [],
        };
      };

      const [byKey, byEmail] = await Promise.all([
        db.collection('users').where('emailDedupeKey', '==', dedupeKey).get(),
        db.collection('users').where('email', '==', rawEmail).get(),
      ]);
      const byKeyDocs = byKey.docs.map(collectDoc);
      const byEmailDocs = byEmail.docs.map(collectDoc);

      // Also pull the Firebase Auth record (if any). Useful for diagnosing
      // cases where the client got a custom token bound to a UID that
      // doesn't have a Firestore doc.
      let firebaseAuthRecord = null;
      try {
        const u = await admin.auth().getUserByEmail(rawEmail);
        firebaseAuthRecord = {
          uid: u.uid,
          email: u.email || null,
          emailVerified: !!u.emailVerified,
          providers: (u.providerData || []).map((p) => p.providerId),
          disabled: !!u.disabled,
        };
      } catch {
        firebaseAuthRecord = null;
      }

      // De-dup IDs and report whether the pickPreferredUserDoc tiebreaker
      // would resolve to the same UID we'd return from /api/auth/google.
      const seen = new Map();
      [...byKeyDocs, ...byEmailDocs].forEach((d) => seen.set(d.id, d));
      const allDocs = Array.from(seen.values());
      const privyMatches = allDocs.filter((d) => d.id.startsWith('did:privy:'));
      const wouldResolveTo = privyMatches[0]?.id || allDocs[0]?.id || null;

      // Quick Picks state per league — the question that actually matters for
      // "why don't my submissions show?". For every UID this email maps to,
      // and every league that UID belongs to, read the prediction doc and
      // summarize it: does it exist, is the Final winner picked, how many
      // picks are left. Surfaces the difference between "submitted but hidden"
      // (doc with a winner exists) and "never actually submitted here".
      const QP_BR = [['roundOf32', 16], ['roundOf16', 8], ['quarterFinals', 4], ['semiFinals', 2], ['thirdPlace', 1], ['final', 1]];
      const QP_TOTAL = 12 + 8 + 32;
      const candidateIds = new Set();
      allDocs.forEach((u) => {
        candidateIds.add(u.id); // legacy single-doc (global-simple)
        (Array.isArray(u.leagues) ? u.leagues : []).forEach((lid) => candidateIds.add(`${u.id}__${lid}`));
      });
      const idList = Array.from(candidateIds);
      const quickPicks = [];
      try {
        const refs = idList.map((id) => db.collection('simplePredictions').doc(id));
        for (let i = 0; i < refs.length; i += 200) {
          const snaps = await db.getAll(...refs.slice(i, i + 200));
          snaps.forEach((s) => {
            if (!s.exists) return;
            const d = s.data() || {};
            const sep = s.id.indexOf('__');
            const lid = sep >= 0 ? s.id.slice(sep + 2) : (d.leagueId || 'global-simple');
            const ko = d.knockoutPredictions || {};
            const groups = d.groupPredictions || {};
            const groupsDone = Object.values(groups).filter((g) => Array.isArray(g?.ranking) && g.ranking.length === 4 && g.ranking.every(Boolean)).length;
            const thirds = Array.isArray(d.bestThirdPicks) ? d.bestThirdPicks : [];
            let bracketDone = 0;
            for (const [k] of QP_BR) bracketDone += (ko[k] || []).filter((p) => p && p.winnerId).length;
            quickPicks.push({
              docId: s.id,
              leagueId: lid,
              hasFinalWinner: !!(ko?.final?.[0]?.winnerId),
              champion: ko?.final?.[0]?.winnerId || null,
              picksLeft: Math.max(0, QP_TOTAL - (groupsDone + Math.min(thirds.filter(Boolean).length, 8) + bracketDone)),
              isComplete: !!(d.isComplete || ko?.final?.[0]?.winnerId),
              hasUserIdField: !!d.userId,
              updatedAt: d.updatedAt?.toDate?.()?.toISOString?.() ?? null,
            });
          });
        }
      } catch (e) {
        quickPicks.push({ error: e.message });
      }

      return res.status(200).json({
        queriedEmail: rawEmail,
        normalizedDedupeKey: dedupeKey,
        byEmailDedupeKey: byKeyDocs,
        byEmail: byEmailDocs,
        firebaseAuthRecord,
        duplicateCount: allDocs.length,
        wouldResolveTo,
        quickPicks,
      });
    } else if (action === 'copyUsersToGlobal') {
      // Superadmin-only: copy each user's completed private Quick Picks
      // bracket into the Global League. The client sends only userIds;
      // we resolve each user's source league server-side (their most
      // recently updated COMPLETE private QP bracket) and run it through
      // the shared copyUserPicksToGlobalLeague utility so audit logging
      // + eligibility are identical to the auto-submit path.
      const callerRole = await getRole(userId);
      if (callerRole !== 'superadmin') {
        return res.status(403).json({ error: 'Only a superadmin can copy picks to the Global League' });
      }
      const { userIds, mode = 'skip' } = req.body;
      if (!Array.isArray(userIds) || userIds.length === 0) {
        return res.status(400).json({ error: 'userIds required (non-empty array)' });
      }
      if (userIds.length > 200) {
        return res.status(400).json({ error: 'Too many users (max 200 per call)' });
      }
      if (mode !== 'skip' && mode !== 'overwrite') {
        return res.status(400).json({ error: 'mode must be skip or overwrite' });
      }

      const { copyUserPicksToGlobalLeague, GLOBAL_SIMPLE_LEAGUE_ID } = await import('./_lib/copyToGlobal.js');
      const { sourceHasPicks } = await import('./_lib/copyToGlobalLogic.js');

      // Resolve a user's best source league: the most-recently-updated
      // COMPLETE bracket in a private QP league (never a global league).
      const tsMs = (t) => (t?._seconds ? t._seconds * 1000 : (typeof t?.toMillis === 'function' ? t.toMillis() : 0));
      const leaguesSnap = await db.collection('leagues').get();
      const leagueVis = {};
      leaguesSnap.docs.forEach(d => { leagueVis[d.id] = d.data().visibility || 'public'; });
      const resolveSource = async (uid) => {
        const snap = await db.collection('simplePredictions').where('userId', '==', uid).get();
        let best = null;
        snap.docs.forEach(doc => {
          const data = doc.data();
          const lid = data.leagueId || (doc.id.includes('__') ? doc.id.slice(doc.id.indexOf('__') + 2) : 'global-simple');
          if (lid === GLOBAL_SIMPLE_LEAGUE_ID || lid === 'global') return;
          if (data.isComplete !== true || !sourceHasPicks(data)) return;
          if (leagueVis[lid] !== 'private') return;
          const upd = tsMs(data.updatedAt) || tsMs(data.submittedAt);
          if (!best || upd > best.upd) best = { lid, upd };
        });
        return best?.lid || null;
      };

      const results = [];
      let copied = 0, skipped = 0, ineligible = 0, failed = 0;
      for (const uid of userIds) {
        try {
          const sourceLeagueId = await resolveSource(uid);
          if (!sourceLeagueId) {
            ineligible++;
            results.push({ userId: uid, ok: false, outcome: 'ineligible', reason: 'no_complete_private_bracket' });
            continue;
          }
          const r = await copyUserPicksToGlobalLeague(uid, sourceLeagueId, { actor: userId, mode });
          if (r.outcome === 'created' || r.outcome === 'overwritten') copied++;
          else if (r.outcome === 'skipped_existing') skipped++;
          else if (r.outcome === 'ineligible') ineligible++;
          else failed++;
          results.push({ userId: uid, sourceLeagueId, ...r });
        } catch (e) {
          failed++;
          results.push({ userId: uid, ok: false, outcome: 'error', reason: e?.message || 'crash' });
        }
      }

      return res.status(200).json({ summary: { attempted: userIds.length, copied, skipped, ineligible, failed }, results });

    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    console.error('Admin error:', e);
    return res.status(500).json({ error: e.message });
  }
}
