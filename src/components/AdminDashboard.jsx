import React, { useState, useEffect, useMemo } from 'react';
import { Shield, Users, Trophy, Coins, RefreshCw, ChevronRight, Search, Trash2, AlertTriangle, CheckCircle, ExternalLink, Eye, EyeOff, Wifi, WifiOff, Clock, Zap, Pencil, Check, X, Wallet, Copy, Mail, Send, UserPlus } from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import { koSlotLabel } from '../utils/bracketUtils';
import { updateMatchResult, getAllUsers, adminGetUserSegments, adminCopyUsersToGlobal, setUserRole, adminDeleteUser, adminDeleteLeague, adminRenameLeague, adminBackfillCountries, adminBackfillEmails, adminAssignWallet, adminSetFeatureFlag, adminGetFeatureFlagAuditLog, checkOracleHealth, adminRunOracleSmokeTest, adminRunAutoPoll, adminRunDailyReport, adminRunReminderCron, adminClearAntiSybil, adminGetAntiSybilBypassList, adminSetAntiSybilBypassList, adminInspectUser, fetchAdminLeaguesEnriched, adminListOutreachEligible, adminSendOutreachPreview, adminSendOutreachBatch, adminRenderOutreachPreview, adminSendOutreachCanary, fetchAdminOutreachRecentRuns, adminScheduleOutreach, adminCancelScheduledOutreach, fetchAdminOutreachScheduled, fetchAdminGlobalSubmitLog, fetchAdminDeletionLog, adminRecoverDeletedUser, adminStandingsDigestRun, adminFinalWeekEmailRun, fetchAdminKoResolution, fetchAdminSurveyVotes, fetchAdminUsersQpStatus, fetchAdminUsersEmailHistory, adminSendOutreachCustom, fetchAdminAutomationRules, adminSaveAutomationRule, adminDeleteAutomationRule, adminPreviewAutomationRule, adminAddUserToLeague, adminApplyGlobalPicksToLeague, fetchAdminQpUnsubmitted, adminRepairQpComplete, fetchAdminUserInsights, adminSweepGlobalPicksToLeagues, fetchAdminFunnelHealth, fetchAdminRankDigestConfig, adminSetRankDigestConfig, adminRankDigestPreviewNow, adminSeedRankBaseline, DEFAULT_FEATURE_FLAGS } from '../utils/db';
import TEAM_COLORS from '../data/teamColors';
import COUNTRIES from '../utils/countries';

// Outreach automation segments (mirror of api/_lib/outreachSegments.js
// SEGMENTS — kept here as display labels for the rule editor).
const AUTOMATION_SEGMENTS = [
  { id: 'no_picks', label: 'No picks yet' },
  { id: 'started_incomplete', label: 'Started but incomplete' },
  { id: 'global_incomplete', label: 'Global bracket incomplete' },
  { id: 'completed_global', label: 'Completed Global bracket' },
  { id: 'global_all', label: 'Everyone in the Global league' },
  { id: 'inactive_since_groups', label: 'Lapsed since group stage' },
  { id: 'global_ko_not_resubmitted', label: 'Global — not re-locked knockout bracket' },
];

// Which stage's lock the "hours before lock" window is measured against.
// Group stage is the back-compat default; later stages let a rule fire
// relative to a knockout lock (e.g. the Round of 32 deadline).
const AUTOMATION_STAGES = [
  { id: 'groupStage', label: 'Group stage' },
  { id: 'roundOf32', label: 'Round of 32' },
  { id: 'roundOf16', label: 'Round of 16' },
  { id: 'quarterFinals', label: 'Quarter-finals' },
  { id: 'semiFinals', label: 'Semi-finals' },
  { id: 'final', label: 'Final' },
];

function _countryFlagFromCode(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const A = 0x1F1E6;
  const base = 'A'.charCodeAt(0);
  const cc = code.toUpperCase();
  return String.fromCodePoint(A + (cc.charCodeAt(0) - base), A + (cc.charCodeAt(1) - base));
}

// Outreach email templates the operator can pick from in the Outreach
// tab. Mirrors api/_lib/outreachEmail.js TEMPLATES — keep these in sync.
const OUTREACH_TEMPLATES = {
  noPicksReminder: {
    label: 'No Picks Reminder',
    description: 'For users who signed up for the Global Quick Picks League but have not started their group-stage picks. Eligibility filter: signed up, has email, not opted out, zero group rankings completed.',
  },
  welcome: {
    label: 'Welcome (recent signups)',
    description: 'Soft welcome + brand intro for users who signed up recently. Eligibility filter: signed up in the last 14 days, has email, not opted out.',
  },
  kickoffTomorrow: {
    label: 'Kickoff Tomorrow (last call)',
    description: 'Urgent last-call alert sent the day before the tournament opener. Eligibility filter: in the Global Quick Picks League, has email, not opted out — regardless of pick status.',
  },
  midTournamentNudge: {
    label: 'Mid-Tournament Nudge',
    description: "Sent during the group stage to bring users back to check their standings. Eligibility filter: in the Global Quick Picks League, has email, not opted out, has at least one completed group ranking (we don't nag users who haven't started — No Picks Reminder is the right tool for that).",
  },
  knockoutReminder: {
    label: 'Knockout Lock Reminder',
    description: 'Nudges users to finalize their knockout picks before the Round of 32 locks (and pitches starting a private knockout league). Reassures anyone happy with their bracket that they need not change anything. Pair with stage "Round of 32". Eligibility: in the Global Quick Picks League, has email, not opted out — regardless of pick status.',
  },
  knockoutRepick: {
    label: 'Knockout Re-pick (Round of 32 set)',
    description: "Re-engagement blast once the group stage is done and the real Round of 32 is set. Two paths — re-pick for users who played the group stage (bracket refreshed with the real teams) AND newcomers who skipped it (jump straight into the knockout bracket, same prize/leaderboard). Deep-links to the Global Quick Picks wizard. Eligibility: in the Global Quick Picks League, has email, not opted out, AND has NOT re-locked their knockout bracket since the real R32 teams were set. Copy is now generic (no specific team-result claims) — safe to send without per-result verification.",
  },
};

const AdminDashboard = ({ userData, platformStats, matchResults, allLeagues, notify, featureFlags = DEFAULT_FEATURE_FLAGS, onViewAsUser }) => {
  const [tab, setTab] = useState('results');
  const [users, setUsers] = useState([]);
  // User segmentation panel (read-only, lazy-loaded on demand).
  const [segments, setSegments] = useState(null);
  const [segmentsLoading, setSegmentsLoading] = useState(false);
  const [segmentsOpen, setSegmentsOpen] = useState(false);
  const [copiedSegmentKey, setCopiedSegmentKey] = useState(null);
  // Segment C "copy to Global" flow (superadmin only).
  const [segCSelected, setSegCSelected] = useState(() => new Set());
  const [copyModal, setCopyModal] = useState(null); // { userIds, mode } | null
  const [copyBusy, setCopyBusy] = useState(false);
  const [copyResult, setCopyResult] = useState(null); // { summary, results } | null
  // Enriched leagues — same data as `allLeagues` plus creatorDisplayName
  // and passcode joined from the admin endpoint. Fetched when the
  // Leagues tab first activates; the parent's allLeagues prop is used
  // as a fallback so the table renders immediately even before the
  // enrichment lands.
  const [enrichedLeagues, setEnrichedLeagues] = useState(null);
  // userNames map { userId: displayName } returned alongside the enriched
  // leagues so the per-league members list can render real names.
  const [memberNames, setMemberNames] = useState({});
  // ─── Outreach tab state ────────────────────────────────────────
  // Template id the operator is composing/sending. Single-template
  // today (noPicksReminder) but the picker is in place so adding new
  // templates later just means appending to OUTREACH_TEMPLATES.
  const [outreachTemplate, setOutreachTemplate] = useState('noPicksReminder');
  const [outreachUsers, setOutreachUsers] = useState(null); // null = not yet fetched
  const [outreachLoading, setOutreachLoading] = useState(false);
  const [outreachPreviewSent, setOutreachPreviewSent] = useState(false);
  // Standings Digest ("where you stand") panel state.
  const [digestRecap, setDigestRecap] = useState('');
  const [digestBusy, setDigestBusy] = useState(false);
  const [digestInfo, setDigestInfo] = useState(null); // { eligibleCount, autoRecap, pointsRemaining } after preview
  const [digestQueued, setDigestQueued] = useState(null); // { queued, chunks } after send
  // "What next?" survey results (Wrapped email votes + comments).
  const [surveyRes, setSurveyRes] = useState(null);
  const [surveyBusy, setSurveyBusy] = useState(false);
  const loadSurveyResults = async () => {
    setSurveyBusy(true);
    try {
      setSurveyRes(await fetchAdminSurveyVotes());
    } catch (e) {
      notify(e?.message || 'Could not load survey results', 'error');
    } finally {
      setSurveyBusy(false);
    }
  };
  // Final-week emails (top-10 contender + Wrapped) panel state, keyed by email.
  const [fwBusy, setFwBusy] = useState(null); // 'top10' | 'wrapped' | null
  const [fwInfo, setFwInfo] = useState({}); // { top10: previewResp, wrapped: previewResp }
  const [fwQueued, setFwQueued] = useState({}); // { top10: sendResp, wrapped: sendResp }
  const runFinalWeekEmail = async (email, phase) => {
    if (phase === 'send') {
      const n = fwInfo[email]?.eligibleCount ?? '?';
      const label = email === 'top10' ? 'Top-10 contender alert' : 'World Cup Wrapped';
      if (!window.confirm(`Queue the ${label} to ${n} players?`)) return;
    }
    setFwBusy(email);
    try {
      const r = await adminFinalWeekEmailRun(email, phase);
      if (phase === 'preview') {
        setFwInfo((s) => ({ ...s, [email]: r }));
        notify(r.sent ? `Preview sent to ${r.to}` : `Preview failed: ${r.error || 'unknown'}`, r.sent ? 'success' : 'error');
      } else {
        setFwQueued((s) => ({ ...s, [email]: r }));
        notify(`Queued ${r.queued} email${r.queued === 1 ? '' : 's'}${r.chunks ? ` in ${r.chunks} chunk${r.chunks === 1 ? '' : 's'}` : ''}.`);
      }
    } catch (e) {
      notify(e?.message || 'Failed', 'error');
    } finally {
      setFwBusy(null);
    }
  };
  const [outreachPreviewBusy, setOutreachPreviewBusy] = useState(false);
  const [outreachPreviewEmail, setOutreachPreviewEmail] = useState('');
  const [outreachBatchBusy, setOutreachBatchBusy] = useState(false);
  const [outreachBatchResult, setOutreachBatchResult] = useState(null);
  // Track which user IDs the operator wants to include in the batch.
  // Default = everyone in `outreachUsers`. Operator can uncheck.
  const [outreachSelectedIds, setOutreachSelectedIds] = useState(new Set());
  // Follow-up guardrail: operator-set window for the "recently emailed"
  // filter in the recipient list. Deselect/select recipients contacted
  // within this many days. Template-agnostic — reads B1 email history.
  const [outreachRecentDays, setOutreachRecentDays] = useState(7);
  // Rendered email preview from the server. Stashed once per template
  // change so the iframe doesn't re-fetch on every render.
  const [outreachPreviewHtml, setOutreachPreviewHtml] = useState(null);
  const [outreachPreviewSubject, setOutreachPreviewSubject] = useState('');
  // userIds we've already sent to in this session (canary OR batch).
  // Excluded from subsequent send-batch clicks so canary recipients
  // don't double-receive.
  const [outreachSentThisSession, setOutreachSentThisSession] = useState(new Set());
  const [outreachCanaryCount, setOutreachCanaryCount] = useState(3);
  const [outreachCanaryBusy, setOutreachCanaryBusy] = useState(false);
  // Recent runs panel — last 20 runs + per-template aggregate stats
  // from the Resend webhook data.
  const [outreachRecentRuns, setOutreachRecentRuns] = useState(null);
  const [outreachTemplateStats, setOutreachTemplateStats] = useState({});
  // Scheduled-sends list (pending first, then finished/cancelled). The
  // outreach-drain cron runs every 5 min and updates statuses.
  const [outreachScheduled, setOutreachScheduled] = useState(null);
  // datetime-local value string for the schedule picker. Empty = use
  // the "Send now" path; non-empty = schedule for that time.
  const [outreachScheduleAt, setOutreachScheduleAt] = useState('');
  const [outreachScheduleBusy, setOutreachScheduleBusy] = useState(false);
  // ── Outreach automation rules (B2d) ──
  const [automationRules, setAutomationRules] = useState(null);
  const [ruleDraft, setRuleDraft] = useState(null); // open editor when non-null
  const [rulePreview, setRulePreview] = useState(null); // dry-run result
  const [ruleBusy, setRuleBusy] = useState(false);
  // Copy-to-Global audit log (superadmin tab). null = not yet fetched.
  const [globalLog, setGlobalLog] = useState(null);
  // Account-deletion audit log (superadmin tab). null = not yet fetched.
  const [deletionLog, setDeletionLog] = useState(null);
  // Bracket-health tab (superadmin): finished brackets stuck "not submitted".
  const [bracketHealth, setBracketHealth] = useState(null); // null = not fetched
  const [bracketHealthBusy, setBracketHealthBusy] = useState(false);
  const [repairingDoc, setRepairingDoc] = useState(null); // docId currently repairing, or 'all'
  // User & prediction insights tab. null = not fetched.
  const [insights, setInsights] = useState(null);
  const [insightsBusy, setInsightsBusy] = useState(false);
  const [funnelHealth, setFunnelHealth] = useState(null);
  const [funnelHealthBusy, setFunnelHealthBusy] = useState(false);
  // Sweep: copy members' Global brackets into their leagues.
  const [sweepBusy, setSweepBusy] = useState(false);
  const [sweepResult, setSweepResult] = useState(null);
  const [selMatch, setSelMatch] = useState(null);
  const [form, setForm] = useState({ homeScore: '', awayScore: '', extraTime: false, penalties: false, penHome: '', penAway: '' });
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  // Quick Picks status map (userId -> rollup) + column sort for the Users table.
  const [qpStatusById, setQpStatusById] = useState({});
  // Per-user email history (item B1) — { userId -> { lastTemplate,
  // lastSentAtMs, totalSent, lastOpenedAtMs } }. Drives the "Last emailed"
  // column + the outreach recent-contact guardrail.
  const [emailHistById, setEmailHistById] = useState({});
  const [userSort, setUserSort] = useState({ key: 'joined', dir: 'desc' });
  const [matchFilter, setMatchFilter] = useState('pending'); // pending | verified | all
  // Knockout-resolution diagnostic: real matchups per KO matchId + blocker
  // results whose winner is undecidable. Loaded with the Results tab.
  const [koRes, setKoRes] = useState(null); // { teams, blockers } | null
  const [deleting, setDeleting] = useState(null);
  const [editingLeagueId, setEditingLeagueId] = useState(null);
  const [editingLeagueName, setEditingLeagueName] = useState('');
  const [savingLeagueId, setSavingLeagueId] = useState(null);
  const [backfillingCountries, setBackfillingCountries] = useState(false);
  // Inline payout-wallet editor (mirrors the league-rename pencil pattern)
  const [editingWalletUserId, setEditingWalletUserId] = useState(null);
  const [editingWalletValue, setEditingWalletValue] = useState('');
  const [savingWalletUserId, setSavingWalletUserId] = useState(null);

  const startWalletEdit = (u) => {
    setEditingWalletUserId(u.id);
    setEditingWalletValue(u.walletAddress || '');
  };
  const cancelWalletEdit = () => {
    setEditingWalletUserId(null);
    setEditingWalletValue('');
  };
  const saveWalletAssignment = async (u) => {
    const trimmed = editingWalletValue.trim();
    if (trimmed && !/^0x[a-fA-F0-9]{40}$/.test(trimmed)) {
      notify('Invalid EVM address (expected 0x + 40 hex chars)', 'error');
      return;
    }
    setSavingWalletUserId(u.id);
    try {
      const res = await adminAssignWallet(u.id, trimmed);
      // Mutate the in-memory list for snappy UX
      u.walletAddress = res.walletAddress || null;
      setUsers((curr) => curr.map((x) => (x.id === u.id ? { ...x, walletAddress: res.walletAddress || null } : x)));
      notify(trimmed ? 'Payout wallet assigned' : 'Payout wallet cleared');
      cancelWalletEdit();
    } catch (e) {
      notify(e.message || 'Failed to assign wallet', 'error');
    } finally {
      setSavingWalletUserId(null);
    }
  };

  // Feature flag toggle — pessimistic: tell the user immediately on
   // failure rather than letting the UI drift out of sync with the
   // server. Live subscription in App will update featureFlags after
   // a successful write. Defaults to false unless explicitly set to
   // true for the new opt-in flags (enablePrizeLeagues); existing
   // flags keep their original `!== false` shape for back-compat.
  const [flagBusy, setFlagBusy] = useState(null);
  const flagLabels = {
    quickPicksEnabled: 'Bracket',
    classicEnabled: 'Classic Predictions',
    enablePrizeLeagues: 'Prize Leagues',
    knockoutRealReseed: 'Knockout real-team reseed',
  };
  const OPT_IN_FLAGS = new Set(['enablePrizeLeagues', 'knockoutRealReseed']);
  const isFlagOn = (flag) => (
    OPT_IN_FLAGS.has(flag)
      ? featureFlags[flag] === true       // opt-in: defaults OFF
      : featureFlags[flag] !== false       // legacy: defaults ON
  );
  const toggleFeatureFlag = async (flag) => {
    setFlagBusy(flag);
    try {
      const next = !isFlagOn(flag);
      // Sensitive flags ask for a reason that lands in the audit log.
      // Other flags toggle silently.
      let reason = null;
      if (flag === 'enablePrizeLeagues') {
        const promptMsg = next
          ? 'Enable user-created Prize Leagues. Reason (optional, saved to audit log):'
          : 'Disable user-created Prize Leagues. Reason (optional, saved to audit log):';
        const raw = window.prompt(promptMsg, '');
        if (raw === null) { setFlagBusy(null); return; } // user cancelled
        reason = raw.trim().slice(0, 280) || null;
      } else if (flag === 'knockoutRealReseed') {
        const promptMsg = next
          ? 'Turn ON the knockout real-team reseed for the LIVE contest? Everyone\'s bracket will reflect real advancing teams (per group as they finish); users advance only teams they correctly predicted. Reason (saved to audit log):'
          : 'Turn OFF the knockout real-team reseed? (Keep it ON once enabled mid-tournament — turning off mid-stream can orphan re-picks.) Reason:';
        const raw = window.prompt(promptMsg, '');
        if (raw === null) { setFlagBusy(null); return; }
        reason = raw.trim().slice(0, 280) || null;
      }
      await adminSetFeatureFlag(flag, next, reason);
      notify(`${flagLabels[flag] || flag} ${next ? 'enabled' : 'disabled'}`);
      // Refresh the audit log so the new entry shows up.
      loadFlagAuditLog();
    } catch (e) {
      notify('Toggle failed: ' + e.message, 'error');
    } finally {
      setFlagBusy(null);
    }
  };

  // Recent feature-flag audit log — last 10 changes across all flags.
  // Fetched once on mount + after every successful toggle. Superadmin-
  // gated server-side; non-superadmins see a friendly empty state.
  const [flagAuditLog, setFlagAuditLog] = useState([]);
  const [flagAuditError, setFlagAuditError] = useState(null);
  const loadFlagAuditLog = async () => {
    try {
      const data = await adminGetFeatureFlagAuditLog(null, 10);
      setFlagAuditLog(data.entries || []);
      setFlagAuditError(null);
    } catch (e) {
      setFlagAuditError(e?.message || 'Could not load audit log');
    }
  };
  useEffect(() => { loadFlagAuditLog(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Daily leaderboard-movement email config.
  const [rankCfg, setRankCfg] = useState(null);
  const [rankCfgBusy, setRankCfgBusy] = useState(false);
  const [rankPreviewMsg, setRankPreviewMsg] = useState(null);
  const loadRankCfg = async () => {
    try { setRankCfg(await fetchAdminRankDigestConfig()); }
    catch (e) { console.warn('[admin] rankDigestConfig fetch failed:', e?.message || e); }
  };
  useEffect(() => { if (tab === 'settings') loadRankCfg(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [tab]);
  const setRankField = (k, v) => setRankCfg((c) => ({ ...(c || {}), [k]: v }));
  const saveRankCfg = async () => {
    if (!rankCfg) return;
    setRankCfgBusy(true);
    try {
      const { lastSendAtMs, lastSendDate, lastSendCounts, pendingPreview, updatedAt, ...patch } = rankCfg;
      const fresh = await adminSetRankDigestConfig(patch);
      setRankCfg((c) => ({ ...c, ...fresh }));
      setRankPreviewMsg({ ok: true, text: 'Saved.' });
    } catch (e) {
      setRankPreviewMsg({ ok: false, text: e?.message || 'Save failed' });
    } finally { setRankCfgBusy(false); }
  };
  const sendRankPreview = async () => {
    setRankCfgBusy(true);
    setRankPreviewMsg(null);
    try {
      const r = await adminRankDigestPreviewNow();
      const n = r?.total ?? 0;
      setRankPreviewMsg({ ok: true, text: `Preview emailed to you — ${n} recipient${n === 1 ? '' : 's'} (${r?.upCount ?? 0} up, ${r?.downCount ?? 0} down).` });
      loadRankCfg();
    } catch (e) {
      setRankPreviewMsg({ ok: false, text: e?.message || 'Preview failed' });
    } finally { setRankCfgBusy(false); }
  };
  const seedBaseline = async () => {
    if (!window.confirm('Seed the baseline from yesterday\'s standings? The next digest will report movement from the most recent batch of games.')) return;
    setRankCfgBusy(true);
    setRankPreviewMsg(null);
    try {
      const r = await adminSeedRankBaseline(true);
      setRankPreviewMsg({ ok: true, text: r?.note || `Baseline seeded (${r?.ranked ?? 0} players).` });
    } catch (e) {
      setRankPreviewMsg({ ok: false, text: e?.message || 'Seed failed' });
    } finally { setRankCfgBusy(false); }
  };

  // Fetch leagues with creator displayName + private-league passcode
  // joined when the Leagues tab activates. Cheap (admin SDK batches the
  // user + subcollection lookups into 3 round trips total) and cached
  // in component state so tab switches are instant after the first fetch.
  // Re-fetch after a rename or delete so the table reflects the change.
  const reloadEnrichedLeagues = async () => {
    try {
      const { leagues, userNames } = await fetchAdminLeaguesEnriched();
      setEnrichedLeagues(leagues);
      setMemberNames(userNames);
    } catch (e) {
      // Don't toast — fallback render uses the parent's allLeagues prop.
      console.warn('[admin] enrichedLeagues fetch failed:', e?.message || e);
    }
  };
  useEffect(() => {
    if (tab !== 'leagues') return;
    reloadEnrichedLeagues();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  // ─── Outreach handlers ────────────────────────────────────────
  // Cooldown set to 0 — operator preference is to see every eligible
  // recipient every time and decide manually who to include via the
  // checkbox list, rather than have the server hide anyone who was
  // sent something recently.
  const reloadOutreachEligible = async () => {
    setOutreachLoading(true);
    try {
      const data = await adminListOutreachEligible(outreachTemplate, 0);
      const users = data?.users || [];
      setOutreachUsers(users);
      // Default selection: all eligible users.
      setOutreachSelectedIds(new Set(users.map((u) => u.userId)));
      // Reset state that depends on the user list.
      setOutreachPreviewSent(false);
      setOutreachBatchResult(null);
    } catch (e) {
      notify('Could not load outreach list: ' + (e?.message || e), 'error');
    } finally {
      setOutreachLoading(false);
    }
  };

  // Fetch the rendered HTML for the iframe preview. Same admin-as-
  // stand-in pattern as the send-to-email preview; calling this is
  // free aside from the network hop.
  const reloadOutreachRenderPreview = async () => {
    try {
      const r = await adminRenderOutreachPreview(outreachTemplate);
      setOutreachPreviewHtml(r?.html || '');
      setOutreachPreviewSubject(r?.subject || '');
    } catch (e) {
      console.warn('[outreach] render preview failed:', e?.message || e);
      setOutreachPreviewHtml('');
      setOutreachPreviewSubject('');
    }
  };

  // Fetch all scheduled sends (pending first). Refreshed on tab open
  // and after any schedule/cancel action.
  const reloadOutreachScheduled = async () => {
    try {
      const items = await fetchAdminOutreachScheduled();
      setOutreachScheduled(items);
    } catch (e) {
      console.warn('[outreach] scheduled fetch failed:', e?.message || e);
      setOutreachScheduled([]);
    }
  };

  // ── Outreach automation rule handlers (B2d) ──
  const reloadAutomationRules = async () => {
    try { setAutomationRules(await fetchAdminAutomationRules()); }
    catch (e) { console.warn('[automation] rules fetch failed:', e?.message || e); setAutomationRules([]); }
  };
  const newRuleDraft = () => setRuleDraft({
    name: '', segment: 'no_picks', template: 'noPicksReminder', stage: 'groupStage',
    requireStageComplete: '', repeatEveryHours: '',
    hoursBeforeLock: '', cooldownDays: 3, maxPerRun: 200, enabled: false,
  });
  const editRuleDraft = (r) => setRuleDraft({ ...r, hoursBeforeLock: r.hoursBeforeLock ?? '' });
  const closeRuleDraft = () => { if (!ruleBusy) { setRuleDraft(null); setRulePreview(null); } };
  const previewRule = async () => {
    if (!ruleDraft) return;
    setRuleBusy(true); setRulePreview(null);
    try {
      const p = await adminPreviewAutomationRule({
        segment: ruleDraft.segment,
        cooldownDays: Number(ruleDraft.cooldownDays) || 3,
        maxPerRun: Number(ruleDraft.maxPerRun) || 200,
      });
      setRulePreview(p);
    } catch (e) { notify('Preview failed: ' + (e?.message || e), 'error'); }
    finally { setRuleBusy(false); }
  };
  const saveRule = async () => {
    if (!ruleDraft) return;
    // Enabling a rule means it will auto-send. Make the operator confirm.
    if (ruleDraft.enabled && !window.confirm('Enable this rule? It will AUTOMATICALLY send real emails to matching users on each automation run (respecting the cooldown + per-run cap). Continue?')) return;
    setRuleBusy(true);
    try {
      const rule = {
        name: ruleDraft.name,
        segment: ruleDraft.segment,
        template: ruleDraft.template,
        stage: ruleDraft.stage || 'groupStage',
        requireStageComplete: ruleDraft.requireStageComplete || null,
        repeatEveryHours: ruleDraft.repeatEveryHours === '' ? null : Number(ruleDraft.repeatEveryHours),
        hoursBeforeLock: ruleDraft.hoursBeforeLock === '' ? null : Number(ruleDraft.hoursBeforeLock),
        cooldownDays: Number(ruleDraft.cooldownDays) || 3,
        maxPerRun: Number(ruleDraft.maxPerRun) || 200,
        enabled: ruleDraft.enabled === true,
      };
      await adminSaveAutomationRule(rule, ruleDraft.id || null);
      notify('Rule saved');
      setRuleDraft(null); setRulePreview(null);
      reloadAutomationRules();
    } catch (e) { notify('Save failed: ' + (e?.message || e), 'error'); }
    finally { setRuleBusy(false); }
  };
  const deleteRule = async (r) => {
    if (!window.confirm(`Delete the rule "${r.name || r.id}"?`)) return;
    try { await adminDeleteAutomationRule(r.id); notify('Rule deleted'); reloadAutomationRules(); }
    catch (e) { notify('Delete failed: ' + (e?.message || e), 'error'); }
  };
  const toggleRuleEnabled = async (r) => {
    if (!r.enabled && !window.confirm(`Enable "${r.name || r.id}"? It will AUTOMATICALLY send real emails to matching users on each run. Continue?`)) return;
    try {
      await adminSaveAutomationRule({
        name: r.name, segment: r.segment, template: r.template, stage: r.stage || 'groupStage',
        requireStageComplete: r.requireStageComplete ?? null, repeatEveryHours: r.repeatEveryHours ?? null,
        hoursBeforeLock: r.hoursBeforeLock ?? null, cooldownDays: r.cooldownDays, maxPerRun: r.maxPerRun,
        enabled: !r.enabled,
      }, r.id);
      reloadAutomationRules();
    } catch (e) { notify('Toggle failed: ' + (e?.message || e), 'error'); }
  };

  // Schedule the current selection for a future send. Same exclusion
  // rules as the immediate batch (already-sent-this-session users).
  const handleScheduleOutreach = async () => {
    const ids = Array.from(outreachSelectedIds).filter(uid => !outreachSentThisSession.has(uid));
    if (ids.length === 0) { notify('No users to schedule (selection is empty or all already sent).', 'error'); return; }
    if (!outreachScheduleAt) { notify('Pick a date and time to schedule for.', 'error'); return; }
    const when = new Date(outreachScheduleAt);
    if (isNaN(when.getTime())) { notify('Invalid date/time.', 'error'); return; }
    if (when.getTime() < Date.now()) { notify('Schedule time must be in the future.', 'error'); return; }

    const confirmed = window.confirm(
      `Schedule the "${OUTREACH_TEMPLATES[outreachTemplate]?.label || outreachTemplate}" email to ${ids.length} user${ids.length === 1 ? '' : 's'} for ${when.toLocaleString()}?`
    );
    if (!confirmed) return;
    setOutreachScheduleBusy(true);
    try {
      const r = await adminScheduleOutreach({
        template: outreachTemplate,
        userIds: ids,
        scheduledFor: when.toISOString(),
      });
      notify(`Scheduled — drain cron will send within 5 min of ${when.toLocaleString()}.`);
      setOutreachScheduleAt('');
      reloadOutreachScheduled();
    } catch (e) {
      notify('Schedule failed: ' + (e?.message || e), 'error');
    } finally {
      setOutreachScheduleBusy(false);
    }
  };

  const handleCancelScheduled = async (id) => {
    const confirmed = window.confirm('Cancel this scheduled send? It will not be drained.');
    if (!confirmed) return;
    try {
      await adminCancelScheduledOutreach(id);
      notify('Scheduled send cancelled.');
      reloadOutreachScheduled();
    } catch (e) {
      notify('Cancel failed: ' + (e?.message || e), 'error');
    }
  };

  // Fetch the recent-runs panel data. Cheap — single query + a small
  // per-template fanout. Refreshed on tab open + after each send.
  const reloadOutreachRecentRuns = async () => {
    try {
      const { runs, templateStats } = await fetchAdminOutreachRecentRuns(20);
      setOutreachRecentRuns(runs);
      setOutreachTemplateStats(templateStats);
    } catch (e) {
      console.warn('[outreach] recent-runs fetch failed:', e?.message || e);
      setOutreachRecentRuns([]);
      setOutreachTemplateStats({});
    }
  };

  useEffect(() => {
    if (tab !== 'outreach') return;
    reloadOutreachEligible();
    reloadOutreachRenderPreview();
    reloadOutreachRecentRuns();
    reloadOutreachScheduled();
    reloadAutomationRules();
    // Email history powers the recent-contact guardrail in the send flow.
    fetchAdminUsersEmailHistory().then(setEmailHistById).catch(e => { console.warn('[admin] email history load failed:', e?.message || e); });
    // Pre-fill the preview-email field with the admin's own account email.
    setOutreachPreviewEmail(userData?.email || '');
    // Reset session-sent set when template changes — different templates
    // are independent send queues.
    setOutreachSentThisSession(new Set());
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab, outreachTemplate]);

  // Copy-to-Global audit log — loaded on tab open + manual refresh.
  const reloadGlobalSubmitLog = async () => {
    try {
      const { rows } = await fetchAdminGlobalSubmitLog(50);
      setGlobalLog(rows);
    } catch (e) {
      console.warn('[admin] globalSubmitLog fetch failed:', e?.message || e);
      setGlobalLog([]);
    }
  };
  useEffect(() => {
    if (tab !== 'globalLog') return;
    reloadGlobalSubmitLog();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  // PITR recovery of a deleted account — superadmin, per Deletions-tab row.
  const [recoveringId, setRecoveringId] = useState(null);
  const handleRecoverUser = async (row) => {
    const who = row.targetDisplayName || row.targetEmail || row.targetUserId;
    if (!window.confirm(`Recover ${who}'s account and all their picks as they were just before deletion?`)) return;
    setRecoveringId(row.id);
    try {
      const { recovered } = await adminRecoverDeletedUser(row.targetUserId, row.timestampMs, row.id);
      notify(`Recovered ${recovered?.displayName || who} — ${recovered?.simplePredictions ?? 0} prediction doc${(recovered?.simplePredictions ?? 0) === 1 ? '' : 's'}, ${recovered?.leagues ?? 0} league${(recovered?.leagues ?? 0) === 1 ? '' : 's'}.`);
      await reloadDeletionLog();
    } catch (e) {
      notify(e?.message || 'Recovery failed', 'error');
    } finally {
      setRecoveringId(null);
    }
  };

  // Knockout-resolution diagnostic — loaded with the Results tab and after
  // each result save (so fixing a blocker clears the banner immediately).
  const reloadKoResolution = async () => {
    try {
      setKoRes(await fetchAdminKoResolution());
    } catch (e) {
      console.warn('[admin] koResolution fetch failed:', e?.message || e);
    }
  };
  useEffect(() => {
    if (tab !== 'results') return;
    reloadKoResolution();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  // Account-deletion audit log — loaded on tab open + manual refresh.
  const reloadDeletionLog = async () => {
    try {
      const { rows } = await fetchAdminDeletionLog(100);
      setDeletionLog(rows);
    } catch (e) {
      console.warn('[admin] deletionLog fetch failed:', e?.message || e);
      setDeletionLog([]);
    }
  };
  useEffect(() => {
    if (tab !== 'deletions') return;
    reloadDeletionLog();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  // Bracket health — finished brackets stuck "not submitted" (superadmin).
  const reloadBracketHealth = async () => {
    setBracketHealthBusy(true);
    try {
      const data = await fetchAdminQpUnsubmitted();
      setBracketHealth(data || { total: 0, rows: [], byLeague: [] });
    } catch (e) {
      console.warn('[admin] qpUnsubmitted fetch failed:', e?.message || e);
      setBracketHealth({ total: 0, rows: [], byLeague: [], error: e?.message || 'Failed to load' });
    } finally {
      setBracketHealthBusy(false);
    }
  };
  useEffect(() => {
    if (tab !== 'bracketHealth') return;
    reloadBracketHealth();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  // User & prediction insights — loaded on tab open + manual refresh.
  const reloadInsights = async () => {
    setInsightsBusy(true);
    try {
      setInsights(await fetchAdminUserInsights());
    } catch (e) {
      console.warn('[admin] userInsights fetch failed:', e?.message || e);
      setInsights({ error: e?.message || 'Failed to load' });
    } finally {
      setInsightsBusy(false);
    }
  };
  useEffect(() => {
    if (tab !== 'insights') return;
    reloadInsights();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  // No-login funnel health — loaded on tab open + manual refresh.
  const reloadFunnelHealth = async () => {
    setFunnelHealthBusy(true);
    try {
      setFunnelHealth(await fetchAdminFunnelHealth(7));
    } catch (e) {
      console.warn('[admin] funnelHealth fetch failed:', e?.message || e);
      setFunnelHealth({ error: e?.message || 'Failed to load' });
    } finally {
      setFunnelHealthBusy(false);
    }
  };
  useEffect(() => {
    if (tab !== 'funnelHealth') return;
    reloadFunnelHealth();
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [tab]);

  const handleRepairBracket = async ({ docId = null, all = false } = {}) => {
    const label = all ? 'all flagged brackets' : 'this bracket';
    if (!window.confirm(`Mark ${label} as submitted (isComplete: true)? This only affects brackets that already have a Final winner picked.`)) return;
    setRepairingDoc(all ? 'all' : docId);
    try {
      const r = await adminRepairQpComplete({ docId, all });
      notify(`Repaired ${r?.repaired ?? 0} bracket${(r?.repaired ?? 0) === 1 ? '' : 's'}.`);
      await reloadBracketHealth();
    } catch (e) {
      notify(`Repair failed: ${e?.message || 'try again'}`, 'error');
    } finally {
      setRepairingDoc(null);
    }
  };

  const runSweep = async (dryRun) => {
    if (!dryRun && !window.confirm('Copy every member’s Global bracket into the leagues they’re in (only where they have a Global bracket and no league picks yet)? This writes prediction docs.')) return;
    setSweepBusy(true);
    try {
      const r = await adminSweepGlobalPicksToLeagues({ dryRun });
      setSweepResult(r);
      if (!dryRun) notify(`Copied ${r?.copiedCount ?? 0} member bracket(s) into their leagues.`);
    } catch (e) {
      notify(`Sweep failed: ${e?.message || 'try again'}`, 'error');
    } finally {
      setSweepBusy(false);
    }
  };

  const handleSendPreview = async () => {
    const to = (outreachPreviewEmail || '').trim();
    if (!to || !/^[^@]+@[^@]+\.[^@]+$/.test(to)) {
      notify('Enter a valid email address for the preview.', 'error');
      return;
    }
    setOutreachPreviewBusy(true);
    try {
      const r = await adminSendOutreachPreview(outreachTemplate, to);
      if (r?.sent) {
        notify(`Preview sent to ${r.to}. Check your inbox before sending the batch.`);
        setOutreachPreviewSent(true);
      } else {
        notify('Preview failed: ' + (r?.error || 'unknown error'), 'error');
      }
    } catch (e) {
      notify('Preview failed: ' + (e?.message || e), 'error');
    } finally {
      setOutreachPreviewBusy(false);
    }
  };

  const handleSendBatch = async () => {
    // Exclude users we've already sent to this session (canary or a
    // previous batch click). Server isn't strict about this since
    // cooldown is 0; the client tracks it to keep the operator from
    // accidentally double-emailing.
    const ids = Array.from(outreachSelectedIds).filter(uid => !outreachSentThisSession.has(uid));
    if (ids.length === 0) { notify('No users to send to (all selected users were already sent this session).', 'error'); return; }
    // Recent-contact guardrail (item B1): warn — don't silently drop — if any
    // recipients were emailed within RECENT_CONTACT_DAYS. The operator can
    // proceed anyway or cancel and narrow the selection; nobody is removed
    // from the send without an explicit choice.
    const recent = ids.filter(uid => _emailedWithinDays(uid));
    if (recent.length > 0) {
      const proceed = window.confirm(
        `Heads up: ${recent.length} of ${ids.length} selected user${recent.length === 1 ? ' was' : 's were'} already emailed in the last ${RECENT_CONTACT_DAYS} days.\n\n` +
        `Sending again risks over-messaging them. Send to all ${ids.length} anyway?\n\n` +
        `(Cancel to go back and narrow your selection — sort the Users table by "Last emailed" to see who.)`
      );
      if (!proceed) return;
    }
    const confirmed = window.confirm(
      `Send the "${OUTREACH_TEMPLATES[outreachTemplate]?.label || outreachTemplate}" email to ${ids.length} user${ids.length === 1 ? '' : 's'}?\n\nThis cannot be undone.`
    );
    if (!confirmed) return;
    setOutreachBatchBusy(true);
    setOutreachBatchResult(null);
    try {
      const r = await adminSendOutreachBatch(outreachTemplate, ids);
      setOutreachBatchResult(r);
      notify(`Batch complete: ${r.sent} sent, ${r.skipped} skipped, ${r.failed} failed.`);
      setOutreachSentThisSession(prev => {
        const next = new Set(prev);
        for (const uid of ids) next.add(uid);
        return next;
      });
      reloadOutreachRecentRuns();
    } catch (e) {
      notify('Batch failed: ' + (e?.message || e), 'error');
    } finally {
      setOutreachBatchBusy(false);
    }
  };

  // Canary send — pick N random users from the current selection, send
  // to them, then mark them as already-sent so the subsequent full batch
  // excludes them. Server picks the random subset so the client just
  // forwards the pool + count.
  const handleSendCanary = async () => {
    const pool = Array.from(outreachSelectedIds).filter(uid => !outreachSentThisSession.has(uid));
    if (pool.length === 0) { notify('No eligible users for the canary.', 'error'); return; }
    const n = Math.max(1, Math.min(pool.length, Number(outreachCanaryCount) || 3));
    const confirmed = window.confirm(
      `Send a canary of the "${OUTREACH_TEMPLATES[outreachTemplate]?.label || outreachTemplate}" email to ${n} randomly-picked user${n === 1 ? '' : 's'} from your selection?`
    );
    if (!confirmed) return;
    setOutreachCanaryBusy(true);
    try {
      const r = await adminSendOutreachCanary(outreachTemplate, pool, n);
      const picked = r?.canaryIds || [];
      notify(`Canary complete: ${r?.sent || 0} sent to ${picked.length} user${picked.length === 1 ? '' : 's'}.`);
      setOutreachSentThisSession(prev => {
        const next = new Set(prev);
        for (const uid of picked) next.add(uid);
        return next;
      });
      // Treat a successful canary as enabling the batch button — the
      // operator did test-send + saw it work.
      setOutreachPreviewSent(true);
      reloadOutreachRecentRuns();
    } catch (e) {
      notify('Canary failed: ' + (e?.message || e), 'error');
    } finally {
      setOutreachCanaryBusy(false);
    }
  };

  const toggleOutreachUser = (uid) => {
    setOutreachSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };
  const selectAllOutreach = () => {
    if (!outreachUsers) return;
    setOutreachSelectedIds(new Set(outreachUsers.map((u) => u.userId)));
  };
  const selectNoneOutreach = () => setOutreachSelectedIds(new Set());

  // Follow-up guardrails (item B1). Operate on the CURRENT eligible list +
  // selection using the user's chosen N-day window, so they work for every
  // template. "Deselect recent" is the safety lever — drop anyone already
  // contacted within N days so a follow-up doesn't over-message them.
  // "Select recent" is the inverse, for deliberately targeting that group.
  const _recentDaysWindow = () => Math.max(0, Number(outreachRecentDays) || 0);
  const outreachRecentCount = () => {
    if (!outreachUsers) return 0;
    const n = _recentDaysWindow();
    return outreachUsers.reduce((acc, u) => acc + (_emailedWithinDays(u.userId, n) ? 1 : 0), 0);
  };
  const deselectRecentlyEmailed = () => {
    if (!outreachUsers) return;
    const n = _recentDaysWindow();
    setOutreachSelectedIds((prev) => {
      const next = new Set(prev);
      outreachUsers.forEach((u) => { if (_emailedWithinDays(u.userId, n)) next.delete(u.userId); });
      return next;
    });
  };
  const selectRecentlyEmailed = () => {
    if (!outreachUsers) return;
    const n = _recentDaysWindow();
    setOutreachSelectedIds((prev) => {
      const next = new Set(prev);
      outreachUsers.forEach((u) => { if (_emailedWithinDays(u.userId, n)) next.add(u.userId); });
      return next;
    });
  };

  const runBackfillCountries = async () => {
    if (!window.confirm('Backfill country for every user that does not already have one? Sumit → BD, lebida2352 → PK, everyone else → US.')) return;
    setBackfillingCountries(true);
    try {
      const res = await adminBackfillCountries();
      notify(`Country backfill: updated ${res.updated}, skipped ${res.skipped}`);
      // Refresh the user list so the new country codes show up.
      const fresh = await getAllUsers();
      setUsers(fresh);
    } catch (e) {
      notify('Backfill failed: ' + e.message, 'error');
    } finally {
      setBackfillingCountries(false);
    }
  };

  const [backfillingEmails, setBackfillingEmails] = useState(false);
  const runBackfillEmails = async (dryRun) => {
    setBackfillingEmails(true);
    try {
      const res = await adminBackfillEmails(dryRun);
      if (dryRun) {
        notify(`Email backfill (dry): ${res.missing} of ${res.scanned} users have no email. Sample: ${(res.sample || []).slice(0, 3).join(', ') || 'none'}`);
      } else {
        notify(`Email backfill: ${res.fixed} fixed, ${res.stillMissing} still missing (need fresh sign-in), ${res.errors?.length || 0} errors of ${res.missing} candidates.`,
          (res.errors?.length || 0) > 0 ? 'error' : 'success');
        const fresh = await getAllUsers();
        setUsers(fresh);
      }
    } catch (e) {
      notify('Email backfill failed: ' + e.message, 'error');
    } finally {
      setBackfillingEmails(false);
    }
  };

  const startRename = (league) => {
    setEditingLeagueId(league.id);
    setEditingLeagueName(league.name || '');
  };
  const cancelRename = () => {
    setEditingLeagueId(null);
    setEditingLeagueName('');
  };
  const saveRename = async (league) => {
    const trimmed = editingLeagueName.trim();
    if (!trimmed) { notify('Name is required', 'error'); return; }
    if (trimmed === (league.name || '')) { cancelRename(); return; }
    if (trimmed.length > 60) { notify('Name too long (max 60 chars)', 'error'); return; }
    setSavingLeagueId(league.id);
    try {
      await adminRenameLeague(league.id, trimmed);
      // Update the in-memory list so the new name shows immediately.
      // allLeagues is a prop; the parent will refetch on next mount, but for
      // this session we mutate the prop entry for a snappy UX.
      league.name = trimmed;
      // Also refresh the enriched cache so the creatorDisplayName / passcode
      // columns stay correct.
      reloadEnrichedLeagues();
      notify(`Renamed to "${trimmed}"`);
      cancelRename();
    } catch (e) {
      notify(e.message || 'Rename failed', 'error');
    } finally {
      setSavingLeagueId(null);
    }
  };
  const [health, setHealth] = useState(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [healthError, setHealthError] = useState(null);

  const [smokeTest, setSmokeTest] = useState(null);
  const [smokeTestLoading, setSmokeTestLoading] = useState(false);
  const [smokeTestError, setSmokeTestError] = useState(null);

  const runHealthCheck = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const data = await checkOracleHealth();
      setHealth(data);
      notify('Health check complete');
    } catch (e) {
      setHealthError(e.message || 'Health check failed');
      notify('Health check failed: ' + e.message, 'error');
    } finally { setHealthLoading(false); }
  };

  const runSmokeTest = async (competition = 'PL') => {
    setSmokeTestLoading(true);
    setSmokeTestError(null);
    try {
      const data = await adminRunOracleSmokeTest(competition);
      setSmokeTest(data);
      notify(data.failed === 0 ? `Smoke test passed (${data.passed} checks)` : `Smoke test: ${data.failed} of ${data.passed + data.failed} failed`, data.failed === 0 ? 'success' : 'error');
    } catch (e) {
      setSmokeTestError(e.message || 'Smoke test failed');
      notify('Smoke test failed: ' + e.message, 'error');
    } finally { setSmokeTestLoading(false); }
  };

  const [cronStatus, setCronStatus] = useState(null);
  const [cronLoading, setCronLoading] = useState(null);
  const runAutoPollNow = async () => {
    setCronLoading('poll');
    try {
      const data = await adminRunAutoPoll();
      setCronStatus({ kind: 'poll', data });
      notify(`Auto-poll done: ${data.ingested} ingested, ${data.disputed} disputed, ${data.partial} partial, ${data.candidates} candidate(s)`);
    } catch (e) {
      setCronStatus({ kind: 'poll', error: e.message });
      notify('Auto-poll failed: ' + e.message, 'error');
    } finally { setCronLoading(null); }
  };
  const runDailyReportNow = async () => {
    setCronLoading('report');
    try {
      const data = await adminRunDailyReport();
      setCronStatus({ kind: 'report', data });
      notify(data.emailed ? 'Daily report sent to your inbox' : `Report ran but email FAILED: ${data.emailError || 'unknown'}`, data.emailed ? 'success' : 'error');
    } catch (e) {
      setCronStatus({ kind: 'report', error: e.message });
      notify('Daily report failed: ' + e.message, 'error');
    } finally { setCronLoading(null); }
  };
  const runReminderCron = async (kind, dryRun = false) => {
    setCronLoading(`reminder-${kind}${dryRun ? '-dry' : ''}`);
    try {
      const data = await adminRunReminderCron(kind, dryRun);
      setCronStatus({ kind: 'reminder', data });
      if (data.skipped) {
        notify(`Reminder cron skipped — outside ${kind} window (${data.hoursToKickoff}h to kickoff). Pass kind to force.`, 'info');
      } else if (dryRun) {
        notify(`Dry run: ${data.targetsCount} ${kind} reminder(s) would be sent.`);
      } else {
        notify(`${kind} reminder cron: sent ${data.sent}, failed ${data.failed} of ${data.targets} target(s).`, data.failed > 0 ? 'error' : 'success');
      }
    } catch (e) {
      setCronStatus({ kind: 'reminder', error: e.message });
      notify('Reminder cron failed: ' + e.message, 'error');
    } finally { setCronLoading(null); }
  };

  const clearMyAntiSybil = async () => {
    setCronLoading('clear-asyb');
    try {
      const data = await adminClearAntiSybil(userData.id);
      notify(`Cleared anti-Sybil state for you: ${data.cleared.fingerprints} fingerprint(s), ${data.cleared.ips} IP record(s).`);
    } catch (e) {
      notify('Clear anti-Sybil failed: ' + e.message, 'error');
    } finally { setCronLoading(null); }
  };

  // Diagnostic for sign-in regressions: look up the canonical Firestore
  // state for a given email (e.g. sumitwkhan@gmail.com) and surface
  // duplicate /users/* docs so we can see whether the swap is resolving
  // to the right UID. Read-only.
  const [inspectEmail, setInspectEmail] = useState('');
  const [inspectResult, setInspectResult] = useState(null);
  const [inspectLoading, setInspectLoading] = useState(false);
  const inspectUser = async () => {
    const email = (inspectEmail || '').trim().toLowerCase();
    if (!email) return;
    setInspectLoading(true);
    setInspectResult(null);
    try {
      const data = await adminInspectUser(email);
      setInspectResult(data);
      const dupCount = data.duplicateCount || 0;
      notify(
        dupCount === 0 ? `No /users docs found for ${email}` :
        dupCount === 1 ? `Found 1 doc for ${email} (id: ${data.wouldResolveTo})` :
        `Found ${dupCount} duplicate /users docs for ${email} — would resolve to ${data.wouldResolveTo}`,
        dupCount > 1 ? 'error' : 'success'
      );
    } catch (e) {
      notify('Inspect failed: ' + e.message, 'error');
    } finally { setInspectLoading(false); }
  };

  // Anti-Sybil bypass allowlist (Firestore-managed). Loaded lazily on
  // mount; persisted via the admin endpoint. Up to 200 entries.
  const [bypassList, setBypassList] = useState(null); // null = not loaded
  const [bypassEnvList, setBypassEnvList] = useState([]);
  const [bypassDraft, setBypassDraft] = useState('');
  const [bypassBusy, setBypassBusy] = useState(false);
  const loadBypassList = async () => {
    try {
      const data = await adminGetAntiSybilBypassList();
      setBypassList(data.emails || []);
      setBypassEnvList(data.envEmails || []);
      setBypassDraft((data.emails || []).join('\n'));
    } catch (e) {
      notify('Failed to load bypass list: ' + e.message, 'error');
    }
  };
  const saveBypassList = async () => {
    setBypassBusy(true);
    try {
      const emails = bypassDraft.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
      const data = await adminSetAntiSybilBypassList(emails);
      setBypassList(data.emails);
      setBypassDraft(data.emails.join('\n'));
      notify(`Saved bypass list — ${data.count} entries. Effective within 60s.`);
    } catch (e) {
      notify('Save failed: ' + e.message, 'error');
    } finally {
      setBypassBusy(false);
    }
  };
  const addMyEmailToBypass = () => {
    const me = userData?.email;
    if (!me) return;
    const lines = bypassDraft.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.some(l => l.toLowerCase() === me.toLowerCase())) {
      const next = lines.concat(me).join('\n');
      setBypassDraft(next);
    }
  };

  useEffect(() => {
    if (tab === 'users') {
      getAllUsers().then(setUsers).catch(e => { console.error(e); notify('Failed to load users', 'error'); });
      fetchAdminUsersQpStatus().then(setQpStatusById).catch(e => { console.warn('[admin] QP status load failed:', e?.message || e); });
      fetchAdminUsersEmailHistory().then(setEmailHistById).catch(e => { console.warn('[admin] email history load failed:', e?.message || e); });
    }
    if (tab === 'oracle' && !health && !healthLoading) runHealthCheck();
  }, [tab]);

  // Open the result form on an already-VERIFIED match, prefilled with the
  // stored result, so the operator can correct it (e.g. add the missing
  // penalty-shootout score that decides a 0–0 knockout). The server treats a
  // changed verified result as a correction: users are re-scored and the
  // leaderboard cache rebuilds automatically on save.
  const openCorrectForm = (m) => {
    const r = matchResults[m.id] || {};
    setMatchFilter('all'); // ensure the row (and its inline form) is rendered
    setSelMatch(m);
    setForm({
      homeScore: r.homeScore != null ? String(r.homeScore) : '',
      awayScore: r.awayScore != null ? String(r.awayScore) : '',
      extraTime: !!r.extraTime,
      penalties: !!r.penalties,
      penHome: r.penHome != null ? String(r.penHome) : '',
      penAway: r.penAway != null ? String(r.penAway) : '',
    });
    requestAnimationFrame(() => {
      document.querySelector('.admin-result-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const handleSaveResult = async () => {
    if (!selMatch || form.homeScore === '' || form.awayScore === '') return;
    // A knockout game that goes to penalties NEEDS the shootout score — it's
    // the only way the bracket resolver + scoring can know who advanced (a
    // drawn score with just a "penalties" flag is undecidable).
    if (form.penalties) {
      const ph = parseInt(form.penHome);
      const pa = parseInt(form.penAway);
      if (Number.isNaN(ph) || Number.isNaN(pa)) {
        notify('Enter the penalty shootout score (both sides) — it decides the winner.', 'error');
        return;
      }
      if (ph === pa) {
        notify('Shootout score can’t be level — one side wins the shootout.', 'error');
        return;
      }
    }
    setSaving(true);
    try {
      await updateMatchResult(selMatch.id, {
        homeScore: parseInt(form.homeScore),
        awayScore: parseInt(form.awayScore),
        extraTime: form.extraTime,
        penalties: form.penalties,
        ...(form.penalties ? { penHome: parseInt(form.penHome), penAway: parseInt(form.penAway) } : {}),
      }, userData.id);
      notify(`Result saved: ${selMatch.home} ${form.homeScore}–${form.awayScore} ${selMatch.away}${form.penalties ? ` (${form.penHome}–${form.penAway} pens)` : ''}`);
      setSelMatch(null);
      setForm({ homeScore: '', awayScore: '', extraTime: false, penalties: false, penHome: '', penAway: '' });
      reloadKoResolution();
    } catch (e) { notify('Failed to save: ' + e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDeleteLeague = async (leagueId, name) => {
    if (leagueId === 'global') { notify('Cannot delete the global league', 'error'); return; }
    setDeleting(leagueId);
    try {
      await adminDeleteLeague(leagueId);
      notify(`Deleted league: ${name}`);
      reloadEnrichedLeagues();
    } catch (e) { notify('Delete failed: ' + e.message, 'error'); }
    finally { setDeleting(null); }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      await setUserRole(userId, newRole, userData.id);
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, role: newRole } : u));
      notify(`Role updated to ${newRole}`);
    } catch (e) { notify('Failed: ' + e.message, 'error'); }
  };

  // ── User segments (read-only) ───────────────────────────────────
  const reloadSegments = async () => {
    setSegmentsLoading(true);
    try {
      const data = await adminGetUserSegments();
      setSegments(data.segments || null);
      setSegmentsOpen(true);
    } catch (e) {
      notify('Failed to load segments: ' + e.message, 'error');
    } finally {
      setSegmentsLoading(false);
    }
  };
  const copySegmentEmails = async (key, rows) => {
    const emails = rows.map(r => r.email).filter(Boolean);
    if (emails.length === 0) { notify('No emails in this segment', 'error'); return; }
    try {
      await navigator.clipboard.writeText(emails.join(', '));
      setCopiedSegmentKey(key);
      setTimeout(() => setCopiedSegmentKey(null), 1800);
      notify(`Copied ${emails.length} email${emails.length === 1 ? '' : 's'}`);
    } catch { notify('Could not copy', 'error'); }
  };
  const exportSegmentCsv = (key, rows) => {
    const fmt = (ms) => (ms ? new Date(ms).toISOString() : '');
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const header = ['email', 'displayName', 'country', 'lastActivity', 'lastLogin', 'privateLeagues', 'userId'];
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push([
        esc(r.email), esc(r.displayName), esc(r.country),
        esc(fmt(r.lastActivityMs)), esc(fmt(r.lastLoginMs)),
        esc((r.privateLeagues || []).join('; ')), esc(r.userId),
      ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `goaloracle-segment-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  // ── Segment C: copy selected/one user's private bracket → Global ──
  const toggleSegC = (uid) => setSegCSelected(prev => {
    const next = new Set(prev);
    if (next.has(uid)) next.delete(uid); else next.add(uid);
    return next;
  });
  const isSuperadmin = userData?.role === 'superadmin';
  const openCopyModal = (userIds) => {
    if (!userIds || userIds.length === 0) { notify('No users selected', 'error'); return; }
    setCopyResult(null);
    setCopyModal({ userIds, mode: 'skip' });
  };
  const runCopyToGlobal = async () => {
    if (!copyModal || copyBusy) return;
    setCopyBusy(true);
    try {
      const r = await adminCopyUsersToGlobal(copyModal.userIds, copyModal.mode);
      setCopyResult(r);
      const s = r.summary || {};
      notify(`Done — ${s.copied || 0} copied, ${s.skipped || 0} skipped, ${s.ineligible || 0} ineligible`);
      // Refresh segments so the panel reflects the new global entries.
      reloadSegments();
      setSegCSelected(new Set());
    } catch (e) {
      notify('Copy failed: ' + e.message, 'error');
    } finally {
      setCopyBusy(false);
    }
  };

  // Permanent delete. Two-stage confirm because there's no undo.
  const [deletingUserId, setDeletingUserId] = useState(null);

  // Custom one-off email (B2b) — modal target user + form state.
  const [customEmailUser, setCustomEmailUser] = useState(null);
  const [customSubject, setCustomSubject] = useState('');
  const [customBody, setCustomBody] = useState('');
  const [customSending, setCustomSending] = useState(false);
  const openCustomEmail = (u) => { setCustomEmailUser(u); setCustomSubject(''); setCustomBody(''); };
  const closeCustomEmail = () => { if (!customSending) setCustomEmailUser(null); };
  const sendCustomEmail = async () => {
    if (!customEmailUser || !customSubject.trim() || !customBody.trim()) return;
    // Reuse the B1 recent-contact guardrail: warn if this user was emailed
    // within the window before sending a one-off.
    if (_emailedWithinDays(customEmailUser.id)) {
      const info = _emailInfo(customEmailUser.id);
      if (!window.confirm(`This user was emailed recently (${info?.label || 'within ' + RECENT_CONTACT_DAYS + ' days'}).\n\nSend anyway?`)) return;
    }
    setCustomSending(true);
    try {
      await adminSendOutreachCustom(customEmailUser.id, customSubject.trim(), customBody.trim());
      notify(`Email sent to ${customEmailUser.displayName || customEmailUser.email}`);
      setCustomEmailUser(null);
      // Refresh email history so the "Last emailed" column updates.
      fetchAdminUsersEmailHistory().then(setEmailHistById).catch(() => {});
    } catch (e) {
      notify('Send failed: ' + (e?.message || e), 'error');
    } finally {
      setCustomSending(false);
    }
  };

  // Add-user-to-league (item H) — modal target user + selected league.
  const [addLeagueUser, setAddLeagueUser] = useState(null);
  const [addLeagueId, setAddLeagueId] = useState('');
  const [addLeagueBusy, setAddLeagueBusy] = useState(false);
  const openAddLeague = (u) => { setAddLeagueUser(u); setAddLeagueId(''); };
  const closeAddLeague = () => { if (!addLeagueBusy) setAddLeagueUser(null); };
  const submitAddLeague = async () => {
    if (!addLeagueUser || !addLeagueId) return;
    setAddLeagueBusy(true);
    try {
      const res = await adminAddUserToLeague(addLeagueId, addLeagueUser.id);
      const lname = (allLeagues || []).find(l => l.id === addLeagueId)?.name || addLeagueId;
      notify(res?.alreadyMember ? `Already in ${lname}` : `Added to ${lname}`);
      setAddLeagueUser(null);
      // Refresh users so the Leagues column reflects the new membership.
      getAllUsers().then(setUsers).catch(() => {});
    } catch (e) {
      notify('Add failed: ' + (e?.message || e), 'error');
    } finally {
      setAddLeagueBusy(false);
    }
  };

  // Apply-global-picks-to-league — modal target user + selected league.
  const [applyPicksUser, setApplyPicksUser] = useState(null);
  const [applyPicksLeagueId, setApplyPicksLeagueId] = useState('');
  const [applyPicksBusy, setApplyPicksBusy] = useState(false);
  // Leagues this user is in that can receive global picks: QP (not classic),
  // not the global league itself.
  const applyPicksLeagues = (applyPicksUser?.leagues || [])
    .map((lid) => (allLeagues || []).find((l) => l.id === lid))
    .filter((l) => l && l.id !== 'global-simple' && l.id !== 'global' && l.predictionMode !== 'classic');
  const openApplyPicks = (u) => { setApplyPicksUser(u); setApplyPicksLeagueId(''); };
  const closeApplyPicks = () => { if (!applyPicksBusy) setApplyPicksUser(null); };
  const submitApplyPicks = async () => {
    if (!applyPicksUser || !applyPicksLeagueId) return;
    setApplyPicksBusy(true);
    try {
      const res = await adminApplyGlobalPicksToLeague(applyPicksUser.id, applyPicksLeagueId);
      const lname = applyPicksLeagues.find((l) => l.id === applyPicksLeagueId)?.name || applyPicksLeagueId;
      if (res?.applied) {
        notify(`Applied global picks to ${lname}`);
        setApplyPicksUser(null);
      } else {
        // Skip + flag — explain why nothing was copied.
        const reasonText = {
          no_global_picks: 'this user has no global picks to copy',
          already_has_picks: 'this user already has picks in that league',
          stage_locked: 'those stages are already locked',
          incompatible_format: 'the league format is incompatible',
        }[res?.reason] || res?.reason || 'skipped';
        notify(`Skipped — ${reasonText}`, 'error');
      }
    } catch (e) {
      notify('Apply failed: ' + (e?.message || e), 'error');
    } finally {
      setApplyPicksBusy(false);
    }
  };

  const handleDeleteUser = async (u) => {
    const label = u.displayName || u.email || u.id.slice(0, 8);
    const confirm1 = window.confirm(`Permanently delete user "${label}"?\n\nThis wipes:\n  • their account\n  • all predictions (classic + Quick Picks)\n  • league memberships\n  • device-fingerprint + IP records\n\nThere is no undo.`);
    if (!confirm1) return;
    // Second confirm — type-to-confirm. Accept "DELETE" case-insensitively
    // so a quick "delete" or "Delete" doesn't bounce the operator back to
    // the first dialog. Also accept the user's literal name as a fallback
    // ("delete-confirm" pattern most ops tools use). Empty / Cancel still
    // bails.
    const typed = window.prompt(`Type DELETE (or the username) to confirm deleting "${label}".`);
    if (typed === null) { return; }                    // user hit Cancel
    const matchesDelete = typed.trim().toUpperCase() === 'DELETE';
    const matchesName   = !!label && typed.trim().toLowerCase() === label.toLowerCase();
    if (!matchesDelete && !matchesName) {
      notify('Delete cancelled — confirmation didn\'t match.', 'info');
      return;
    }
    setDeletingUserId(u.id);
    try {
      const res = await adminDeleteUser(u.id);
      setUsers(prev => prev.filter(x => x.id !== u.id));
      const c = res.deleted || {};
      notify(`Deleted "${label}" — ${c.predictions || 0} classic preds, ${c.simplePredictions || 0} simple preds, ${c.leagueMemberships || 0} memberships.`);
    } catch (e) {
      notify('Delete failed: ' + e.message, 'error');
    } finally { setDeletingUserId(null); }
  };

  // Stats
  const verifiedCount = Object.values(matchResults).filter(r => r.completed).length;
  const totalMatches = WORLD_CUP_MATCHES.length;
  // Paid-league stats only render when the prize-leagues feature is
  // enabled platform-wide. Otherwise show a simple total — "PAID · X"
  // would be misleading when the create flow can't produce paid leagues.
  const prizeLeaguesEnabled = featureFlags?.enablePrizeLeagues === true;
  const paidLeagues = prizeLeaguesEnabled
    ? (allLeagues || []).filter(l => l.type === 'paid').length
    : 0;
  const freeLeagues = (allLeagues || []).length - paidLeagues;

  // Referral attribution: count how many other users each user brought
  // in via the ?ref= share link. We piggy-back on the already-loaded
  // users array — no extra API call. The userById lookup lets us show
  // "Joined via {name}" on the referee's row.
  const referralCountById = useMemo(() => {
    const m = {};
    for (const u of users) {
      if (u.referredBy) m[u.referredBy] = (m[u.referredBy] || 0) + 1;
    }
    return m;
  }, [users]);
  const userById = useMemo(() => {
    const m = {};
    for (const u of users) m[u.id] = u;
    return m;
  }, [users]);
  const topReferrers = useMemo(() => (
    Object.entries(referralCountById)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ id, count, user: userById[id] }))
      .filter(r => r.user)
  ), [referralCountById, userById]);

  // Filtered matches
  const filteredMatches = WORLD_CUP_MATCHES.filter(m => {
    if (matchFilter === 'pending') return !matchResults[m.id]?.completed;
    if (matchFilter === 'verified') return matchResults[m.id]?.completed;
    return true;
  });

  // Filtered users — newest sign-ups first so the most recent joins are
  // at the top. createdAt comes off the Firestore doc as either a
  // serialized admin Timestamp ({_seconds}) or a millis number depending
  // on path, so normalize before comparing.
  const _joinMillis = (u) => {
    const c = u?.createdAt;
    if (!c) return 0;
    if (typeof c === 'number') return c;
    if (c._seconds) return c._seconds * 1000;
    if (typeof c.toMillis === 'function') return c.toMillis();
    const t = Date.parse(c);
    return Number.isNaN(t) ? 0 : t;
  };
  const _joinLabel = (u) => {
    const ms = _joinMillis(u);
    if (!ms) return '—';
    return new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  // league id → public metadata, for resolving the league names a user
  // has joined. Globals get friendly labels; everything else falls back
  // to the league name (or a truncated id if the league isn't loaded).
  const leaguesById = useMemo(() => {
    const m = {};
    for (const l of (allLeagues || [])) m[l.id] = l;
    return m;
  }, [allLeagues]);
  const _leagueLabel = (id) => {
    if (id === 'global-simple') return 'Global';
    if (id === 'global') return 'Global (Classic)';
    return leaguesById[id]?.name || `${String(id).slice(0, 10)}…`;
  };

  const filteredUsers = users.filter(u => {
    if (!userSearch) return true;
    const s = userSearch.toLowerCase();
    return (u.displayName || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s) || u.id.toLowerCase().includes(s);
  });

  // Quick Picks status rollup → label/tone/rank for a user (from qpStatusById).
  const _qpInfo = (uid) => {
    const q = qpStatusById[uid];
    if (!q) return { label: 'None', tone: 'none', rank: 0 };
    if (q.globalComplete) return { label: q.privateCompleteCount > 0 ? `Global ✓ · ${q.privateCompleteCount} priv` : 'Global ✓', tone: 'ok', rank: 4 };
    if (q.completeAny) return { label: q.privateCompleteCount > 0 ? `${q.privateCompleteCount} priv ✓` : 'Complete', tone: 'ok', rank: 3 };
    if (q.startedAny || q.globalHasPicks) {
      // Granular Global-bracket progress, matching the leaderboard status.
      const g = q.gGroups || 0, t = q.gThirds || 0, b = q.gBracket || 0;
      let label = 'In progress';
      if (g >= 12 && t >= 8 && b > 0) label = 'Filling bracket';
      else if (g >= 12 && t >= 8) label = 'Best thirds in';
      else if (g >= 12) label = 'Groups picked';
      return { label, tone: 'warn', rank: 2 };
    }
    return { label: 'No picks yet', tone: 'none', rank: 0 };
  };
  // Coarse, IP-derived location captured at login (geo* fields); falls back to
  // the legacy manually-backfilled country. Blank until the user next logs in.
  const _locText = (u) => [u.geoCity, u.geoRegion, u.geoCountry || u.country].filter(Boolean).join(', ');

  // Email history (item B1) — days since last contact + a short label for the
  // "Last emailed" column. Returns { days, label, totalSent } or null when
  // the user has never been emailed.
  const _emailInfo = (uid) => {
    const h = emailHistById[uid];
    if (!h || !h.lastSentAtMs) return null;
    const days = Math.floor((Date.now() - h.lastSentAtMs) / 86400000);
    const tmplLabel = OUTREACH_TEMPLATES[h.lastTemplate]?.label || h.lastTemplate || 'email';
    const ago = days <= 0 ? 'today' : days === 1 ? '1d ago' : `${days}d ago`;
    return { days, totalSent: h.totalSent || 0, label: `${tmplLabel} · ${ago}` };
  };
  // Recent-contact guardrail window (item B1). Recipients emailed within this
  // many days are flagged before a send. 3 days per founder direction.
  const RECENT_CONTACT_DAYS = 3;
  const _emailedWithinDays = (uid, days = RECENT_CONTACT_DAYS) => {
    const h = emailHistById[uid];
    if (!h || !h.lastSentAtMs) return false;
    return (Date.now() - h.lastSentAtMs) < days * 86400000;
  };

  // Column sort over the filtered users.
  const _userSortVal = (u, key) => {
    switch (key) {
      case 'name': return (u.displayName || u.id || '').toLowerCase();
      case 'email': return (u.email || '').toLowerCase();
      case 'location': return (u.geoCountry || u.country || '').toLowerCase();
      case 'leagues': return Array.isArray(u.leagues) ? u.leagues.length : 0;
      case 'status': return _qpInfo(u.id).rank;
      // Last-emailed sorts by recency (most-recent first under desc). Never
      // emailed sorts as -Infinity so those users cluster at the bottom.
      case 'emailed': return emailHistById[u.id]?.lastSentAtMs || -Infinity;
      case 'role': return u.role || 'user';
      // Wallet sorts has-wallet-first (by address), then the rest. Empty
      // string sorts after any real 0x… address under localeCompare desc/asc.
      case 'wallet': return (u.walletAddress || '').toLowerCase();
      case 'joined':
      default: return _joinMillis(u);
    }
  };
  const sortedUsers = [...filteredUsers].sort((a, b) => {
    const va = _userSortVal(a, userSort.key), vb = _userSortVal(b, userSort.key);
    const cmp = (typeof va === 'number' && typeof vb === 'number') ? va - vb : String(va).localeCompare(String(vb));
    return userSort.dir === 'asc' ? cmp : -cmp;
  });
  const toggleUserSort = (key) => setUserSort(s => s.key === key
    ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
    : { key, dir: key === 'joined' ? 'desc' : 'asc' });

  const tabs = [
    { id: 'results', icon: '⚽', label: 'Match Results', count: `${verifiedCount}/${totalMatches}` },
    { id: 'users', icon: '👥', label: 'Users', count: String(platformStats.totalPlayers || 0) },
    { id: 'leagues', icon: '🏆', label: 'Leagues', count: String(platformStats.activeLeagues || 0) },
    { id: 'insights', icon: '📊', label: 'Insights' },
    { id: 'outreach', icon: '✉️', label: 'Outreach' },
    { id: 'oracle', icon: '🔮', label: 'Oracle Status' },
    { id: 'contract', icon: '📜', label: 'Smart Contract' },
    ...(isSuperadmin ? [{ id: 'globalLog', icon: '🔁', label: 'Global Submits' }] : []),
    ...(isSuperadmin ? [{ id: 'deletions', icon: '🗑️', label: 'Deletions' }] : []),
    ...(isSuperadmin ? [{ id: 'bracketHealth', icon: '🩺', label: 'Bracket Health' }] : []),
    ...(isSuperadmin ? [{ id: 'funnelHealth', icon: '🚦', label: 'Funnel Health' }] : []),
    { id: 'settings', icon: '⚙️', label: 'Settings' },
  ];

  const getCode = (name) => (name || '').slice(0, 3).toUpperCase();
  const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  return (
    <div className="admin-page">
      {/* Header */}
      <div className="admin-header">
        <h1 className="admin-title"><Shield size={22} /> Admin Dashboard <span className="admin-badge-sa">SUPERADMIN</span></h1>
        <span className="admin-user-badge">{userData?.email || userData?.displayName || 'Admin'}</span>
      </div>

      {/* Stats */}
      <div className="admin-stats-grid">
        <div className="admin-stat-card">
          <span className="admin-stat-lbl">Total Users</span>
          <span className="admin-stat-num" style={{color: 'var(--cyan)'}}>{platformStats.totalPlayers || 0}</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-lbl">Active Leagues</span>
          <span className="admin-stat-num" style={{color: 'var(--amber)'}}>{platformStats.activeLeagues || 0}</span>
          <span className="admin-stat-sub">{prizeLeaguesEnabled ? `${paidLeagues} paid · ${freeLeagues} free` : `${freeLeagues} leagues`}</span>
        </div>
        {prizeLeaguesEnabled && (
          <div className="admin-stat-card">
            <span className="admin-stat-lbl">Prize Pools</span>
            <span className="admin-stat-num" style={{color: 'var(--lime)'}}>${(platformStats.totalPrizePools || 0).toLocaleString()}</span>
            <span className="admin-stat-sub">USDC on Polygon</span>
          </div>
        )}
        <div className="admin-stat-card">
          <span className="admin-stat-lbl">Results Verified</span>
          <span className="admin-stat-num" style={{color: 'var(--magenta)'}}>{verifiedCount}/{totalMatches}</span>
          <span className="admin-stat-sub">{verifiedCount === 0 ? 'Awaiting tournament' : `${totalMatches - verifiedCount} remaining`}</span>
        </div>
      </div>

      {/* Tab pills */}
      <div className="admin-tabs-bar">
        {tabs.map(t => (
          <button key={t.id} type="button" className={`admin-tab-pill ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            <span>{t.icon}</span> {t.label} {t.count && <span className="admin-tab-count">{t.count}</span>}
          </button>
        ))}
      </div>

      {/* ═══════ TAB: MATCH RESULTS ═══════ */}
      {tab === 'results' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Match Results</h2>
              <p className="admin-panel-desc">Submit & verify scores. Both oracle sources must agree before points are awarded.</p>
            </div>
            <div className="admin-panel-actions">
              <div className="admin-filter-pills">
                {['pending','verified','all'].map(f => (
                  <button key={f} type="button" className={`admin-filter ${matchFilter === f ? 'active' : ''}`} onClick={() => setMatchFilter(f)}>
                    {f === 'pending' ? 'Pending' : f === 'verified' ? 'Verified' : 'All'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Blocker banner: a verified knockout result whose winner is
              undecidable freezes every downstream matchup (placeholders, no
              auto-ingest). Name the exact match + fix so the operator can
              act in one step; downstream games then auto-verify via the
              2-min poll cron. */}
          {koRes?.blockers?.length > 0 && (
            <div className="admin-ko-blocker" role="alert">
              <AlertTriangle size={16} aria-hidden="true" />
              <div>
                {koRes.blockers.map((b) => (
                  <div key={b.matchId} style={{ marginBottom: 6, display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>
                      <strong>{b.home && b.away ? `${b.home} vs ${b.away}` : b.matchId}</strong>
                      {b.homeScore != null ? ` (${b.homeScore}–${b.awayScore})` : ''}: {b.reason}.
                      {b.blocking?.length > 0 && <> Blocking: <strong>{b.blocking.join(', ')}</strong>.</>}
                    </span>
                    <button
                      type="button"
                      className="btn btn-sm btn-primary"
                      onClick={() => {
                        const m = WORLD_CUP_MATCHES.find((x) => x.id === b.matchId);
                        if (m) openCorrectForm(m);
                      }}
                    >
                      Fix now
                    </button>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-sec)' }}>
                      Check Penalties, enter the shootout score (who won on pens) — blocked games then auto-verify within ~2 minutes.
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="admin-card-list admin-scroll">
            {filteredMatches.length === 0 && <div className="admin-empty">No matches found for this filter.</div>}
            {filteredMatches.map(m => {
              const r = matchResults[m.id];
              const isSelected = selMatch?.id === m.id;
              // Real matchup overlay for knockout fixtures: show the actual
              // countries (with flags) wherever a side has resolved — even
              // when the OTHER side hasn't ("Argentina vs Winner of M96") —
              // instead of "W R16-07 vs W R16-08".
              const rt = m.isKnockout ? koRes?.teams?.[m.id] : null;
              const slotLbl = m.isKnockout && (!rt?.home || !rt?.away) ? koSlotLabel(m.id) : null;
              const homeName = rt?.home || slotLbl?.home || m.home;
              const awayName = rt?.away || slotLbl?.away || m.away;
              const homeFlag = rt?.home ? (TEAM_COLORS[rt.home]?.flag || m.homeFlag) : m.homeFlag;
              const awayFlag = rt?.away ? (TEAM_COLORS[rt.away]?.flag || m.awayFlag) : m.awayFlag;
              return (
                <div key={m.id}>
                  <div className={`admin-list-card ${r?.completed ? 'verified' : ''} ${isSelected ? 'selected' : ''}`} onClick={() => {
                    if (r?.completed) return;
                    setSelMatch(isSelected ? null : m);
                    setForm({ homeScore: '', awayScore: '', extraTime: false, penalties: false, penHome: '', penAway: '' });
                  }}>
                    <div className="admin-list-left">
                      <span className="admin-match-flags">{homeFlag} {awayFlag}</span>
                      <div>
                        <div className="admin-match-teams">{homeName} vs {awayName}</div>
                        <div className="admin-match-meta">{m.stage} · {fmtDate(m.date)} · {m.city}</div>
                      </div>
                    </div>
                    <div className="admin-list-right">
                      {r?.completed ? (
                        <>
                          <span className="admin-score-verified">{r.homeScore} — {r.awayScore}{r.penalties && r.penHome != null ? ` (${r.penHome}–${r.penAway} p)` : ''}{r.extraTime ? ' AET' : ''}{r.penalties ? ' PEN' : ''}</span>
                          <span className="admin-verified-tag"><CheckCircle size={11} /> VERIFIED</span>
                          <button
                            type="button"
                            className="btn btn-sm admin-enter-btn"
                            title="Correct this verified result (users are re-scored automatically)"
                            onClick={e => { e.stopPropagation(); if (isSelected) setSelMatch(null); else openCorrectForm(m); }}
                          >
                            {isSelected ? 'Close' : <><Pencil size={12} /> Correct</>}
                          </button>
                        </>
                      ) : (
                        <>
                          <span className="admin-pending-tag">PENDING</span>
                          <button type="button" className="btn btn-sm admin-enter-btn" onClick={e => { e.stopPropagation(); setSelMatch(isSelected ? null : m); setForm({ homeScore: '', awayScore: '', extraTime: false, penalties: false, penHome: '', penAway: '' }); }}>
                            {isSelected ? 'Close' : 'Enter Result'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Expanded inline form (also opens on VERIFIED matches via
                      the Correct button — the save is treated server-side as
                      a correction: re-score + leaderboard rebuild + alert). */}
                  {isSelected && (
                    <div className="admin-result-form">
                      <h3>{homeFlag} {homeName} vs {awayName} {awayFlag} <span className="admin-form-meta">{m.stage} · {fmtDate(m.date)}</span></h3>
                      {r?.completed && (
                        <p className="form-hint" style={{ marginTop: 0 }}>
                          Correcting a verified result. On save, every user is re-scored and the leaderboard updates automatically.
                          {m.isKnockout ? ' For a shootout: check Penalties and enter the shootout score — that decides who advances.' : ''}
                        </p>
                      )}
                      <div className="admin-score-row">
                        <div className="admin-score-col">
                          <label>{getCode(homeName)}</label>
                          <input type="number" min="0" max="20" className="admin-score-input" value={form.homeScore} onChange={e => setForm({...form, homeScore: e.target.value})} autoFocus />
                        </div>
                        <span className="admin-score-dash">—</span>
                        <div className="admin-score-col">
                          <label>{getCode(awayName)}</label>
                          <input type="number" min="0" max="20" className="admin-score-input" value={form.awayScore} onChange={e => setForm({...form, awayScore: e.target.value})} />
                        </div>
                      </div>
                      {m.isKnockout && (
                        <div className="admin-ko-row">
                          <label className="admin-ko-check"><input type="checkbox" checked={form.extraTime} onChange={e => setForm({...form, extraTime: e.target.checked})} /><span>Extra Time</span></label>
                          <label className="admin-ko-check"><input type="checkbox" checked={form.penalties} onChange={e => setForm({...form, penalties: e.target.checked})} /><span>Penalties</span></label>
                        </div>
                      )}
                      {m.isKnockout && form.penalties && (
                        <div className="admin-score-row">
                          <div className="admin-score-col">
                            <label>{getCode(homeName)} pens</label>
                            <input type="number" min="0" max="30" className="admin-score-input" value={form.penHome ?? ''} onChange={e => setForm({...form, penHome: e.target.value})} />
                          </div>
                          <span className="admin-score-dash">—</span>
                          <div className="admin-score-col">
                            <label>{getCode(awayName)} pens</label>
                            <input type="number" min="0" max="30" className="admin-score-input" value={form.penAway ?? ''} onChange={e => setForm({...form, penAway: e.target.value})} />
                          </div>
                        </div>
                      )}
                      <div className="admin-form-btns">
                        <button type="button" className="btn btn-primary" onClick={handleSaveResult} disabled={saving || form.homeScore === '' || form.awayScore === ''}>
                          {saving ? <><RefreshCw size={14} className="spin" /> Saving...</> : <><CheckCircle size={14} /> {r?.completed ? 'Save Correction' : 'Save & Verify Result'}</>}
                        </button>
                        <button type="button" className="btn" onClick={() => setSelMatch(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════ TAB: USERS ═══════ */}
      {tab === 'users' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Users ({users.length})</h2>
              <p className="admin-panel-desc">Manage user roles and accounts</p>
            </div>
            <div className="admin-search-wrap">
              <Search size={14} />
              <input type="text" placeholder="Search users..." value={userSearch} onChange={e => setUserSearch(e.target.value)} className="admin-search" />
              <button type="button" className="btn btn-secondary btn-sm" onClick={runBackfillCountries} disabled={backfillingCountries} title="Assign country to every user missing one (Sumit→BD, lebida2352→PK, everyone else→US)">
                {backfillingCountries ? <><RefreshCw size={12} className="spin" /> Backfilling…</> : <>Backfill countries</>}
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => runBackfillEmails(true)} disabled={backfillingEmails} title="Count how many users have no email (no DB writes)">
                {backfillingEmails ? <><RefreshCw size={12} className="spin" /> …</> : <>Email backfill (dry)</>}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => runBackfillEmails(false)} disabled={backfillingEmails} title="Recover user.email from Firebase Auth for every user missing it">
                {backfillingEmails ? <><RefreshCw size={12} className="spin" /> Backfilling…</> : <>Backfill emails</>}
              </button>
            </div>
          </div>

          {/* Referrals — always visible so admins know it exists. Empty
              state explains the mechanism when no shares have landed
              new users yet; populated state shows the top 5 referrers. */}
          <div className="admin-referrals-strip" role="region" aria-label="Referrals">
            <div className="admin-referrals-strip-head">
              Referrals — top inviters via the share link
              {topReferrers.length > 0 && (
                <span className="admin-referrals-total">
                  · {Object.values(referralCountById).reduce((s, n) => s + n, 0)} attributed sign-up{Object.values(referralCountById).reduce((s, n) => s + n, 0) === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {topReferrers.length === 0 ? (
              <div className="admin-referrals-empty">
                Nobody's brought in a sign-up yet. Every share button on the site
                appends <code>?ref=&lt;userId&gt;</code> — when a new user signs up via
                that link, <code>referredBy</code> is written on their user doc and
                their referrer shows up here.
              </div>
            ) : (
              <ol className="admin-referrals-strip-list">
                {topReferrers.map((r, i) => (
                  <li key={r.id} className="admin-referrals-strip-item">
                    <span className="admin-referrals-strip-rank">#{i + 1}</span>
                    <span className="admin-referrals-strip-name">
                      {r.user.country && <span className="admin-user-flag" title={r.user.country}>{_countryFlagFromCode(r.user.country)}</span>}
                      {r.user.displayName || r.id.slice(0, 8)}
                    </span>
                    <span className="admin-referrals-strip-count"><strong>{r.count}</strong> invited</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          {/* ── User Segments (read-only) ────────────────────────────
              Lazy-loaded: the endpoint scans every simplePredictions
              doc, so it only runs when the operator asks. */}
          <div className="admin-segments" role="region" aria-label="User segments">
            <div className="admin-segments-head">
              <span className="admin-segments-title">User Segments <span className="admin-segments-sub">Quick Picks funnel</span></span>
              <button type="button" className="btn btn-secondary btn-sm" onClick={reloadSegments} disabled={segmentsLoading}>
                {segmentsLoading ? <><RefreshCw size={12} className="spin" /> Computing…</> : segments ? <>Refresh</> : <>Compute segments</>}
              </button>
            </div>
            {segments && segmentsOpen && (
              <div className="admin-segments-body">
                {[
                  { key: 'A', label: 'Logged in, no Quick Picks bracket started', seg: segments.A },
                  { key: 'B', label: 'Started a bracket, none submitted/complete', seg: segments.B },
                  { key: 'C', label: 'Completed a private league, not yet in Global', seg: segments.C },
                ].map(({ key, label, seg }) => {
                  const rows = seg?.users || [];
                  const fmtDateMs = (ms) => ms ? new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
                  return (
                    <div key={key} className="admin-segment-card">
                      <div className="admin-segment-card-head">
                        <span className="admin-segment-name"><span className="admin-segment-badge">{key}</span> {label}</span>
                        <span className="admin-segment-count">{seg?.count || 0}</span>
                      </div>
                      <div className="admin-segment-actions">
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => copySegmentEmails(key, rows)} disabled={rows.length === 0}>
                          {copiedSegmentKey === key ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy emails</>}
                        </button>
                        <button type="button" className="btn btn-ghost btn-xs" onClick={() => exportSegmentCsv(key, rows)} disabled={rows.length === 0}>
                          <ExternalLink size={11} /> Export CSV
                        </button>
                        {key === 'C' && isSuperadmin && (
                          <button type="button" className="btn btn-primary btn-xs" disabled={segCSelected.size === 0} onClick={() => openCopyModal([...segCSelected])}>
                            <Trophy size={11} /> Copy selected to Global ({segCSelected.size})
                          </button>
                        )}
                      </div>
                      {rows.length === 0 ? (
                        <div className="admin-segment-empty">No users in this segment.</div>
                      ) : (
                        <div className="admin-segment-table-wrap admin-scroll">
                          <table className="admin-segment-table">
                            <thead>
                              <tr>
                                {key === 'C' && isSuperadmin && (
                                  <th className="admin-segment-check">
                                    <input
                                      type="checkbox"
                                      aria-label="Select all"
                                      checked={rows.length > 0 && rows.every(r => segCSelected.has(r.userId))}
                                      onChange={(e) => setSegCSelected(e.target.checked ? new Set(rows.map(r => r.userId)) : new Set())}
                                    />
                                  </th>
                                )}
                                <th>Email</th><th>Name</th><th>Last activity</th><th>Last login</th>
                                {key === 'C' && <th>Private league(s)</th>}
                                {key === 'C' && isSuperadmin && <th></th>}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((r) => (
                                <tr key={r.userId}>
                                  {key === 'C' && isSuperadmin && (
                                    <td className="admin-segment-check">
                                      <input type="checkbox" aria-label={`Select ${r.email || r.userId}`} checked={segCSelected.has(r.userId)} onChange={() => toggleSegC(r.userId)} />
                                    </td>
                                  )}
                                  <td className="admin-segment-email">{r.email || <span className="admin-wallet-empty">no email</span>}</td>
                                  <td>{r.displayName || r.userId.slice(0, 8)}</td>
                                  <td>{fmtDateMs(r.lastActivityMs)}</td>
                                  <td>{fmtDateMs(r.lastLoginMs)}</td>
                                  {key === 'C' && (
                                    <td title={(r.privateLeagues || []).join(', ')}>
                                      {(r.privateLeagues || []).join(', ')}
                                      {r.hasGlobalEntry && <span className="admin-segment-flag" title="Already has a Global entry — copy will skip in 'skip' mode">has global</span>}
                                    </td>
                                  )}
                                  {key === 'C' && isSuperadmin && (
                                    <td>
                                      <button type="button" className="btn btn-ghost btn-xs" title="Copy this user's private bracket to the Global League" onClick={() => openCopyModal([r.userId])}>
                                        <Trophy size={11} /> Global
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Copy-to-Global confirmation + result modal (superadmin) */}
          {copyModal && (
            <div className="modal-overlay" onClick={() => !copyBusy && setCopyModal(null)}>
              <div className="fund-modal" onClick={(e) => e.stopPropagation()}>
                <div className="fund-modal-header">
                  <h3><Trophy size={20} /> Copy to Global League</h3>
                  <button className="modal-close" onClick={() => !copyBusy && setCopyModal(null)} aria-label="Close"><X size={18} /></button>
                </div>
                {!copyResult ? (
                  <>
                    <p className="fund-desc">
                      Copy <strong>{copyModal.userIds.length}</strong> user{copyModal.userIds.length === 1 ? '' : 's'}&apos; completed private Quick Picks bracket into the Global League. The most recently updated completed private bracket is used as the source.
                    </p>
                    <div className="admin-copy-mode">
                      <label className={copyModal.mode === 'skip' ? 'is-active' : ''}>
                        <input type="radio" name="copymode" checked={copyModal.mode === 'skip'} onChange={() => setCopyModal(m => ({ ...m, mode: 'skip' }))} />
                        <span><strong>Skip</strong> if they already have a Global entry <em>(recommended)</em></span>
                      </label>
                      <label className={copyModal.mode === 'overwrite' ? 'is-active' : ''}>
                        <input type="radio" name="copymode" checked={copyModal.mode === 'overwrite'} onChange={() => setCopyModal(m => ({ ...m, mode: 'overwrite' }))} />
                        <span><strong>Overwrite</strong> their existing Global picks</span>
                      </label>
                    </div>
                    <p className="form-hint">Stage-locked brackets (after a stage kicks off) are skipped as ineligible. Every action is logged to <code>globalSubmitLog</code>.</p>
                    <div className="form-actions">
                      <button type="button" className="btn btn-secondary" onClick={() => setCopyModal(null)} disabled={copyBusy}>Cancel</button>
                      <button type="button" className="btn btn-primary" onClick={runCopyToGlobal} disabled={copyBusy}>
                        {copyBusy ? <><RefreshCw size={14} className="spin" /> Copying…</> : <><Trophy size={14} /> Copy {copyModal.userIds.length}</>}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="admin-copy-summary">
                      <span className="admin-copy-stat ok"><strong>{copyResult.summary?.copied || 0}</strong> copied</span>
                      <span className="admin-copy-stat"><strong>{copyResult.summary?.skipped || 0}</strong> skipped</span>
                      <span className="admin-copy-stat warn"><strong>{copyResult.summary?.ineligible || 0}</strong> ineligible</span>
                      {(copyResult.summary?.failed || 0) > 0 && <span className="admin-copy-stat err"><strong>{copyResult.summary.failed}</strong> failed</span>}
                    </div>
                    {Array.isArray(copyResult.results) && copyResult.results.some(r => r.outcome === 'ineligible' || r.outcome === 'error') && (
                      <ul className="admin-copy-reasons">
                        {copyResult.results.filter(r => r.outcome === 'ineligible' || r.outcome === 'error').slice(0, 12).map((r, i) => (
                          <li key={i}><code>{(r.userId || '').slice(0, 8)}</code> — {r.reason || r.outcome}</li>
                        ))}
                      </ul>
                    )}
                    <div className="form-actions">
                      <button type="button" className="btn btn-primary" onClick={() => { setCopyModal(null); setCopyResult(null); }}>Done</button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="admin-user-table-wrap admin-scroll">
            {sortedUsers.length === 0 ? (
              <div className="admin-empty">{users.length === 0 ? 'Loading users...' : 'No users match your search.'}</div>
            ) : (
            <table className="admin-segment-table admin-user-table">
              <thead>
                <tr>
                  {[['name', 'User'], ['email', 'Email'], ['location', 'Location'], ['leagues', 'Leagues'], ['status', 'QP status'], ['emailed', 'Last emailed'], ['joined', 'Joined'], ['role', 'Role']].map(([key, label]) => (
                    <th
                      key={key}
                      className="admin-sortable"
                      aria-sort={userSort.key === key ? (userSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      onClick={() => toggleUserSort(key)}
                    >
                      {label}{userSort.key === key ? (userSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                    </th>
                  ))}
                  <th
                    className="admin-sortable"
                    aria-sort={userSort.key === 'wallet' ? (userSort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    onClick={() => toggleUserSort('wallet')}
                  >
                    Wallet{userSort.key === 'wallet' ? (userSort.dir === 'asc' ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th aria-label="Actions"></th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map(u => {
                  const referrals = referralCountById[u.id] || 0;
                  const referrer = u.referredBy ? userById[u.referredBy] : null;
                  const joined = Array.isArray(u.leagues) ? u.leagues : [];
                  const leagueNames = joined.map(_leagueLabel);
                  const qp = _qpInfo(u.id);
                  const email = _emailInfo(u.id);
                  const loc = _locText(u);
                  const flagCode = u.geoCountry || u.country;
                  return (
                    <tr key={u.id}>
                      <td>
                        <span className="admin-user-cell-name">
                          {flagCode && <span className="admin-user-flag" title={flagCode}>{_countryFlagFromCode(flagCode)}</span>}
                          {onViewAsUser
                            ? <button type="button" className="admin-user-row-handle admin-user-viewas" title="View the site as this user (read-only)" onClick={() => onViewAsUser(u)}>{u.displayName || u.id.slice(0, 12)}</button>
                            : <span className="admin-user-row-handle">{u.displayName || u.id.slice(0, 12)}</span>}
                          {referrals > 0 && <span className="admin-user-ref-pill" title={`${referrals} sign-up${referrals === 1 ? '' : 's'} attributed`}><strong>{referrals}</strong> inv</span>}
                        </span>
                        {u.referredBy && <span className="admin-user-via" title={`referredBy: ${u.referredBy}`}>via {referrer?.displayName || `${u.referredBy.slice(0, 8)}…`}</span>}
                      </td>
                      <td className="admin-segment-email">{u.email || <span className="admin-wallet-empty">no email</span>}</td>
                      <td title={loc || 'No location yet (fills in on next login)'}>{loc || <span className="admin-wallet-empty">—</span>}</td>
                      <td title={leagueNames.length ? leagueNames.join(', ') : 'No leagues joined'}>
                        {joined.length === 0
                          ? <span className="admin-wallet-empty">none</span>
                          : <span className="admin-user-leagues-cell"><strong>{joined.length}</strong> <span className="admin-user-leagues-names">{leagueNames.join(', ')}</span></span>}
                      </td>
                      <td><span className={`admin-qp-pill admin-qp-${qp.tone}`}>{qp.label}</span></td>
                      <td className="admin-user-emailed-cell" title={email ? `${email.totalSent} email${email.totalSent === 1 ? '' : 's'} sent total${email.days <= RECENT_CONTACT_DAYS ? ` — contacted within ${RECENT_CONTACT_DAYS}d` : ''}` : 'Never emailed'}>
                        {email
                          ? <span className={email.days <= RECENT_CONTACT_DAYS ? 'admin-user-emailed-recent' : undefined}>{email.label}</span>
                          : <span className="admin-wallet-empty">never</span>}
                      </td>
                      <td className="admin-user-joined-cell" title="Join date">{_joinLabel(u)}</td>
                      <td>
                        <select className="admin-select admin-select-xs" value={u.role || 'user'} onChange={e => handleRoleChange(u.id, e.target.value)}>
                          <option value="user">user</option>
                          <option value="admin">admin</option>
                          <option value="superadmin">superadmin</option>
                        </select>
                      </td>
                      <td>
                        {editingWalletUserId === u.id ? (
                          <span className="admin-wallet-edit-row">
                            <input
                              type="text"
                              className="input-field admin-wallet-input"
                              value={editingWalletValue}
                              onChange={(e) => setEditingWalletValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === 'Enter') saveWalletAssignment(u); else if (e.key === 'Escape') cancelWalletEdit(); }}
                              placeholder="0x... (blank to clear)"
                              maxLength={42}
                              autoFocus
                              disabled={savingWalletUserId === u.id}
                              spellCheck={false}
                            />
                            <button type="button" className="btn btn-primary btn-sm" onClick={() => saveWalletAssignment(u)} disabled={savingWalletUserId === u.id} title="Save">
                              {savingWalletUserId === u.id ? <RefreshCw size={12} className="spin" /> : <Check size={14} />}
                            </button>
                            <button type="button" className="btn btn-ghost btn-sm" onClick={cancelWalletEdit} disabled={savingWalletUserId === u.id} title="Cancel">
                              <X size={14} />
                            </button>
                          </span>
                        ) : (
                          <span className="admin-user-meta-item">
                            <Wallet size={11} style={{ opacity: 0.6 }} />
                            {u.walletAddress
                              ? <code className="admin-wallet-addr">{u.walletAddress.slice(0, 6)}…{u.walletAddress.slice(-4)}</code>
                              : <span className="admin-wallet-empty">none</span>}
                            <button type="button" className="admin-wallet-edit-btn" onClick={() => startWalletEdit(u)} title="Assign payout wallet">
                              <Pencil size={10} />
                            </button>
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="admin-user-actions">
                          {isSuperadmin && (
                            <button type="button" className="admin-user-email-btn" title="Add this user to a league (incl. private)" onClick={() => openAddLeague(u)}>
                              <UserPlus size={12} />
                            </button>
                          )}
                          {isSuperadmin && (
                            <button type="button" className="admin-user-email-btn" title="Apply this user's global picks to a league they're in (only if they have no picks there)" onClick={() => openApplyPicks(u)}>
                              <Copy size={12} />
                            </button>
                          )}
                          {u.email && u.emailOptOut !== true && (
                            <button type="button" className="admin-user-email-btn" title="Send a custom email to this user" onClick={() => openCustomEmail(u)}>
                              <Mail size={12} />
                            </button>
                          )}
                          {u.id !== userData.id && (u.role || 'user') !== 'superadmin' && (
                            <button type="button" className="admin-user-del" title="Permanently delete this user (no undo)" onClick={() => handleDeleteUser(u)} disabled={deletingUserId === u.id}>
                              {deletingUserId === u.id ? <RefreshCw size={12} className="spin" /> : <Trash2 size={12} />}
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            )}
          </div>

          {/* Custom one-off email modal (B2b) */}
          {customEmailUser && (
            <div className="admin-modal-overlay" onClick={closeCustomEmail}>
              <div className="admin-modal admin-custom-email" onClick={e => e.stopPropagation()}>
                <div className="admin-modal-head">
                  <h3><Mail size={16} /> Email {customEmailUser.displayName || customEmailUser.email}</h3>
                  <button type="button" className="admin-modal-close" onClick={closeCustomEmail} disabled={customSending}><X size={16} /></button>
                </div>
                <p className="admin-custom-email-to">To: <strong>{customEmailUser.email}</strong></p>
                <label className="admin-custom-email-label">Subject</label>
                <input
                  type="text"
                  className="input-field"
                  value={customSubject}
                  onChange={e => setCustomSubject(e.target.value)}
                  placeholder="Subject line"
                  maxLength={200}
                  disabled={customSending}
                />
                <label className="admin-custom-email-label">Message</label>
                <textarea
                  className="input-field admin-custom-email-body"
                  value={customBody}
                  onChange={e => setCustomBody(e.target.value)}
                  placeholder={"Write your message — plain text.\n\nBlank lines start new paragraphs. The GoalOracle logo header and your sign-off are added automatically."}
                  rows={8}
                  maxLength={5000}
                  disabled={customSending}
                />
                <p className="admin-custom-email-note">Sends in the branded GoalOracle shell, signed off as Sumit. Logged to this user's email history.</p>
                <div className="admin-modal-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeCustomEmail} disabled={customSending}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={sendCustomEmail} disabled={customSending || !customSubject.trim() || !customBody.trim()}>
                    {customSending ? <><RefreshCw size={14} className="spin" /> Sending…</> : <><Send size={14} /> Send email</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Add-user-to-league modal (item H) */}
          {addLeagueUser && (
            <div className="admin-modal-overlay" onClick={closeAddLeague}>
              <div className="admin-modal admin-add-league" onClick={e => e.stopPropagation()}>
                <div className="admin-modal-head">
                  <h3><UserPlus size={16} /> Add {addLeagueUser.displayName || addLeagueUser.email || addLeagueUser.id.slice(0, 8)} to a league</h3>
                  <button type="button" className="admin-modal-close" onClick={closeAddLeague} disabled={addLeagueBusy}><X size={16} /></button>
                </div>
                <label className="admin-custom-email-label">League</label>
                <select className="input-field" value={addLeagueId} onChange={e => setAddLeagueId(e.target.value)} disabled={addLeagueBusy}>
                  <option value="">Select a league…</option>
                  {(allLeagues || []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name || l.id}{l.visibility === 'private' ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
                <p className="admin-custom-email-note">Adds membership directly, bypassing the passcode for private leagues. Idempotent and logged.</p>
                <div className="admin-modal-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeAddLeague} disabled={addLeagueBusy}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={submitAddLeague} disabled={addLeagueBusy || !addLeagueId}>
                    {addLeagueBusy ? <><RefreshCw size={14} className="spin" /> Adding…</> : <><UserPlus size={14} /> Add to league</>}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Apply-global-picks-to-league modal */}
          {applyPicksUser && (
            <div className="admin-modal-overlay" onClick={closeApplyPicks}>
              <div className="admin-modal admin-add-league" onClick={e => e.stopPropagation()}>
                <div className="admin-modal-head">
                  <h3><Copy size={16} /> Apply {applyPicksUser.displayName || applyPicksUser.email || applyPicksUser.id.slice(0, 8)}'s global picks</h3>
                  <button type="button" className="admin-modal-close" onClick={closeApplyPicks} disabled={applyPicksBusy}><X size={16} /></button>
                </div>
                <label className="admin-custom-email-label">Target league</label>
                <select className="input-field" value={applyPicksLeagueId} onChange={e => setApplyPicksLeagueId(e.target.value)} disabled={applyPicksBusy}>
                  <option value="">Select a league…</option>
                  {applyPicksLeagues.slice().sort((a, b) => (a.name || '').localeCompare(b.name || '')).map(l => (
                    <option key={l.id} value={l.id}>
                      {l.name || l.id}{l.visibility === 'private' ? ' (private)' : ''}
                    </option>
                  ))}
                </select>
                {applyPicksLeagues.length === 0 && (
                  <p className="admin-custom-email-note">This user isn't in any Quick Picks league that can receive global picks.</p>
                )}
                <p className="admin-custom-email-note">Copies the user's Global bracket into the league <strong>only if they have no picks there yet</strong> — never overwrites. If they have no global picks, it's skipped. Logged.</p>
                <div className="admin-modal-actions">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={closeApplyPicks} disabled={applyPicksBusy}>Cancel</button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={submitApplyPicks} disabled={applyPicksBusy || !applyPicksLeagueId}>
                    {applyPicksBusy ? <><RefreshCw size={14} className="spin" /> Applying…</> : <><Copy size={14} /> Apply picks</>}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: LEAGUES ═══════ */}
      {tab === 'leagues' && (() => {
        // Use enriched leagues (creator displayName + passcode joined
        // server-side) when available; fall back to the parent-supplied
        // allLeagues prop so the table renders something even before the
        // enrichment fetch finishes.
        const leaguesToRender = enrichedLeagues || allLeagues || [];
        return (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Leagues ({leaguesToRender.length})</h2>
              <p className="admin-panel-desc">View and manage all leagues on the platform</p>
            </div>
          </div>

          <div className="admin-card-list admin-scroll">
            {leaguesToRender.length === 0 && <div className="admin-empty">No leagues found.</div>}
            {leaguesToRender.map(l => {
              const isEditing = editingLeagueId === l.id;
              const isSaving = savingLeagueId === l.id;
              return (
                <div key={l.id} className="admin-list-card">
                  <div className="admin-list-left">
                    <div style={{minWidth:0, flex:1}}>
                      {isEditing ? (
                        <div className="admin-league-edit-row">
                          <input
                            type="text"
                            className="input-field admin-league-name-input"
                            value={editingLeagueName}
                            onChange={(e) => setEditingLeagueName(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveRename(l);
                              else if (e.key === 'Escape') cancelRename();
                            }}
                            maxLength={60}
                            autoFocus
                            disabled={isSaving}
                          />
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => saveRename(l)} disabled={isSaving} title="Save">
                            {isSaving ? <RefreshCw size={12} className="spin" /> : <Check size={14} />}
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelRename} disabled={isSaving} title="Cancel">
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="admin-user-name">
                          {l.visibility === 'private' ? '🔒 ' : ''}{l.name || l.id}
                          <button
                            type="button"
                            className="admin-league-rename-btn"
                            onClick={() => startRename(l)}
                            title="Rename league"
                            aria-label={`Rename ${l.name || l.id}`}
                          >
                            <Pencil size={12} />
                          </button>
                        </div>
                      )}
                      <div className="admin-user-email">
                        Created by{' '}
                        {l.creatorDisplayName
                          ? <strong>{l.creatorDisplayName}</strong>
                          : (l.createdBy ? <code style={{ fontSize: '0.85em' }}>{l.createdBy.slice(0, 10)}</code> : 'system')}
                        {' · '}{l.visibility || 'public'}
                        {l.visibility === 'private' && l.passcode && (
                          <>
                            {' · '}Passcode <code style={{ background: 'rgba(255,193,7,0.15)', padding: '0.05rem 0.4rem', borderRadius: '4px', fontWeight: 700 }}>{l.passcode}</code>
                          </>
                        )}
                      </div>
                      {Array.isArray(l.members) && l.members.length > 0 && (
                        <details className="admin-league-members-details">
                          <summary className="admin-league-members-summary">
                            Members ({l.members.length})
                          </summary>
                          <div className="admin-league-members-list">
                            {(() => {
                              const CAP = 100;
                              const shown = l.members.slice(0, CAP);
                              const overflow = l.members.length - shown.length;
                              return (
                                <>
                                  {shown.map((uid, i) => {
                                    const name = memberNames[uid];
                                    const isCreator = uid === l.createdBy;
                                    return (
                                      <span key={uid} className="admin-league-member-chip">
                                        {name
                                          ? <strong>{name}</strong>
                                          : <code style={{ fontSize: '0.85em' }}>{uid.slice(0, 10)}</code>}
                                        {isCreator && <em style={{ marginLeft: 4, fontSize: '0.7rem', color: 'var(--text-sec)' }}>(creator)</em>}
                                        {i < shown.length - 1 && ', '}
                                      </span>
                                    );
                                  })}
                                  {overflow > 0 && (
                                    <span style={{ color: 'var(--text-sec)', marginLeft: 6 }}>
                                      … and {overflow} more
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        </details>
                      )}
                      {l.houseRules?.content && (
                        <details className="admin-league-hr-details">
                          <summary className="admin-league-hr-summary">
                            House Rules
                          </summary>
                          <div className="admin-league-hr-body">
                            <p className="admin-league-hr-content">{l.houseRules.content}</p>
                            {(() => {
                              const ts = l.houseRules.lastUpdatedAt;
                              const updatedAtMs = ts?._seconds ? ts._seconds * 1000
                                : (typeof ts === 'number' ? ts : null);
                              const by = l.houseRules.lastUpdatedBy;
                              const byName = by ? (memberNames[by] || `${by.slice(0, 10)}…`) : null;
                              if (!updatedAtMs && !byName) return null;
                              return (
                                <p className="admin-league-hr-meta">
                                  {byName && <>Set by <strong>{byName}</strong></>}
                                  {byName && updatedAtMs && ' · '}
                                  {updatedAtMs && new Date(updatedAtMs).toLocaleString()}
                                </p>
                              );
                            })()}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                  <div className="admin-list-right">
                    <span className={`admin-league-type ${prizeLeaguesEnabled && l.type === 'paid' ? 'paid' : 'free'}`}>
                      {prizeLeaguesEnabled && l.type === 'paid' ? `PAID · ${l.entryFee} ${l.currency || 'USDC'}` : 'FREE'}
                    </span>
                    <span className="admin-league-members">{l.memberCount || l.members?.length || 0} members</span>
                    {l.id !== 'global' && !isEditing && (
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDeleteLeague(l.id, l.name)} disabled={deleting === l.id}>
                        {deleting === l.id ? <RefreshCw size={12} className="spin" /> : <Trash2 size={12} />} Delete
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        );
      })()}

      {/* ═══════ TAB: OUTREACH ═══════ */}
      {tab === 'outreach' && (() => {
        const tpl = OUTREACH_TEMPLATES[outreachTemplate];
        const users = outreachUsers || [];
        const selectedCount = outreachSelectedIds.size;
        const canSendBatch = outreachPreviewSent && selectedCount > 0 && !outreachBatchBusy;
        return (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Outreach</h2>
              <p className="admin-panel-desc">Send a templated email to users who match a defined filter. Preview to your own inbox before sending the batch.</p>
            </div>
          </div>

          {/* ── Standings Digest — dedicated runner (personalized payloads +
                 chunked scheduled send; bypasses the generic batch path) ── */}
          <div className="admin-outreach-runs" style={{ marginBottom: '1.2rem' }}>
            <div className="admin-outreach-runs-head">
              <h3>📨 Standings Digest — "where you stand"</h3>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Personalized to every player with Global picks: their Global + biggest-league rank, points still
              winnable on unlocked games, champion-alive branch, and an update-your-picks CTA. Preview emails
              YOUR standing to your inbox and loads an auto-drafted recap below — edit the recap (add the drama),
              then queue the send. Big sends go out in chunks of 800, one every ~5 minutes.
            </p>
            <label className="admin-outreach-label" htmlFor="digest-recap">Results recap paragraph (editable — facts auto-drafted from real results)</label>
            <textarea
              id="digest-recap"
              className="input-field"
              rows={3}
              style={{ width: '100%', boxSizing: 'border-box', marginBottom: '0.6rem' }}
              placeholder="Leave empty to auto-generate — or click Preview to load the auto-draft here, then edit."
              value={digestRecap}
              onChange={(e) => setDigestRecap(e.target.value)}
              maxLength={800}
            />
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={digestBusy}
                onClick={async () => {
                  setDigestBusy(true);
                  try {
                    const r = await adminStandingsDigestRun('preview', digestRecap);
                    setDigestInfo(r);
                    if (!digestRecap.trim() && r.autoRecap) setDigestRecap(r.autoRecap);
                    notify(r.sent ? `Preview sent to ${r.to}` : `Preview failed: ${r.error || 'unknown'}`, r.sent ? 'success' : 'error');
                  } catch (e) {
                    notify(e?.message || 'Preview failed', 'error');
                  } finally {
                    setDigestBusy(false);
                  }
                }}
              >
                {digestBusy ? 'Working…' : 'Send me a preview'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={digestBusy || !digestInfo}
                title={!digestInfo ? 'Send yourself a preview first' : ''}
                onClick={async () => {
                  const n = digestInfo?.eligibleCount ?? '?';
                  if (!window.confirm(`Queue the Standings Digest to all ${n} eligible players? Chunks of 800 drain every ~5 minutes.`)) return;
                  setDigestBusy(true);
                  try {
                    const r = await adminStandingsDigestRun('send', digestRecap);
                    setDigestQueued(r);
                    notify(`Queued ${r.queued} emails in ${r.chunks} chunk${r.chunks === 1 ? '' : 's'} — draining one chunk every ~5 min.`);
                  } catch (e) {
                    notify(e?.message || 'Queue failed', 'error');
                  } finally {
                    setDigestBusy(false);
                  }
                }}
              >
                {digestQueued ? `Queued ${digestQueued.queued} ✓` : `Queue send${digestInfo ? ` to ${digestInfo.eligibleCount} players` : ''}`}
              </button>
              {digestInfo && (
                <span className="form-hint" style={{ margin: 0 }}>
                  {digestInfo.eligibleCount} eligible · up to {digestInfo.pointsRemaining} pts still winnable
                </span>
              )}
            </div>
          </div>

          {/* ── Final-week emails: top-10 contender alert + Wrapped ── */}
          <div className="admin-outreach-runs" style={{ marginBottom: '1.2rem' }}>
            <div className="admin-outreach-runs-head">
              <h3>🏁 Final week</h3>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              <strong>Top-10 alert</strong> (send after the semifinals): everyone who can still mathematically reach
              the global top 10, plus the current top 10 ("defend it"). <strong>Wrapped</strong> (send the morning
              after the Final): per-player recap — global rank + percentile, their position in each of their leagues,
              best call vs the crowd, champion verdict; winners + top-10 get special variants. Wrapped is blocked
              until the Final result is verified.
            </p>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.6rem' }}>
              <strong style={{ fontSize: '0.85rem' }}>🎯 Top-10 contender alert</strong>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!fwBusy} onClick={() => runFinalWeekEmail('top10', 'preview')}>
                {fwBusy === 'top10' ? 'Working…' : 'Send me a preview'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" disabled={!!fwBusy || !fwInfo.top10} title={!fwInfo.top10 ? 'Preview first' : ''} onClick={() => runFinalWeekEmail('top10', 'send')}>
                {fwQueued.top10 ? `Queued ${fwQueued.top10.queued} ✓` : `Queue send${fwInfo.top10 ? ` to ${fwInfo.top10.eligibleCount}` : ''}`}
              </button>
              {fwInfo.top10 && (
                <span className="form-hint" style={{ margin: 0 }}>
                  {fwInfo.top10.chasers} chasing · {fwInfo.top10.defenders} defending · {fwInfo.top10.pointsRemaining} pts left
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
              <strong style={{ fontSize: '0.85rem' }}>🏆 World Cup Wrapped</strong>
              <button type="button" className="btn btn-secondary btn-sm" disabled={!!fwBusy} onClick={() => runFinalWeekEmail('wrapped', 'preview')}>
                {fwBusy === 'wrapped' ? 'Working…' : 'Send me a preview'}
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={!!fwBusy || !fwInfo.wrapped || fwInfo.wrapped.finalDecided === false}
                title={!fwInfo.wrapped ? 'Preview first' : fwInfo.wrapped.finalDecided === false ? 'Blocked until the Final result is verified' : ''}
                onClick={() => runFinalWeekEmail('wrapped', 'send')}
              >
                {fwQueued.wrapped ? `Queued ${fwQueued.wrapped.queued} ✓` : `Queue send${fwInfo.wrapped ? ` to ${fwInfo.wrapped.eligibleCount}` : ''}`}
              </button>
              {fwInfo.wrapped && (
                <span className="form-hint" style={{ margin: 0 }}>
                  {fwInfo.wrapped.finalDecided
                    ? `Final verified ✓ (${fwInfo.wrapped.finalWinner}) — ready`
                    : 'Final not verified yet — send is locked'}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '0.6rem' }}>
              <strong style={{ fontSize: '0.85rem' }}>🗳️ Survey results</strong>
              <button type="button" className="btn btn-ghost btn-sm" disabled={surveyBusy} onClick={loadSurveyResults}>
                {surveyBusy ? 'Loading…' : surveyRes ? 'Refresh' : 'Load results'}
              </button>
              {surveyRes && (
                <span className="form-hint" style={{ margin: 0 }}>
                  {surveyRes.totalVotes} vote{surveyRes.totalVotes === 1 ? '' : 's'} — CL {surveyRes.counts.cl} · EPL {surveyRes.counts.epl} · Cricket {surveyRes.counts.cricket} · WC2030 {surveyRes.counts.wc2030} · {surveyRes.comments.length} comment{surveyRes.comments.length === 1 ? '' : 's'}
                </span>
              )}
            </div>
            {surveyRes && surveyRes.comments.length > 0 && (
              <div style={{ marginTop: '0.5rem', maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '0.5rem 0.7rem' }}>
                {surveyRes.comments.map((cm, i) => (
                  <p key={i} style={{ margin: '0 0 0.5rem', fontSize: '0.8rem', lineHeight: 1.5 }}>
                    <span style={{ color: 'var(--text-sec)' }}>
                      {cm.createdAtMs ? new Date(cm.createdAtMs).toLocaleString() : ''}{cm.vote ? ` · voted ${cm.vote}` : ''}:
                    </span>{' '}
                    {cm.comment}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="admin-outreach-grid">
            {/* LEFT: template picker + eligible-user list */}
            <div className="admin-outreach-left">
              <label className="admin-outreach-label">Template</label>
              <select
                className="input-field admin-outreach-template-select"
                value={outreachTemplate}
                onChange={(e) => setOutreachTemplate(e.target.value)}
              >
                {Object.entries(OUTREACH_TEMPLATES).map(([id, t]) => (
                  <option key={id} value={id}>{t.label}</option>
                ))}
              </select>
              <p className="admin-outreach-tpl-desc">{tpl?.description}</p>

              <div className="admin-outreach-list-head">
                <div>
                  <strong>{outreachLoading ? 'Loading…' : `${users.length} eligible recipient${users.length === 1 ? '' : 's'}`}</strong>
                  {!outreachLoading && users.length > 0 && (
                    <span className="admin-outreach-selected"> · {selectedCount} selected</span>
                  )}
                </div>
                <div className="admin-outreach-list-actions">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={reloadOutreachEligible} disabled={outreachLoading}>
                    <RefreshCw size={11} className={outreachLoading ? 'spin' : ''} /> Refresh
                  </button>
                  {users.length > 0 && (
                    <>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={selectAllOutreach}>Select all</button>
                      <button type="button" className="btn btn-ghost btn-xs" onClick={selectNoneOutreach}>None</button>
                    </>
                  )}
                </div>
              </div>

              {/* Follow-up guardrail — template-agnostic, reads B1 email
                  history. Lets the operator set their own N-day window and
                  bulk de/select anyone contacted within it. */}
              <div className="admin-outreach-recent-filter">
                <span className="admin-outreach-recent-text">
                  Emailed in last
                  <input
                    type="number"
                    min="1"
                    max="120"
                    className="input-field admin-outreach-recent-input"
                    value={outreachRecentDays}
                    onChange={(e) => setOutreachRecentDays(e.target.value)}
                    aria-label="Recent-email window in days"
                  />
                  day{_recentDaysWindow() === 1 ? '' : 's'}
                  {users.length > 0 && (
                    <span className="admin-outreach-recent-count"> · {outreachRecentCount()} of {users.length} match</span>
                  )}
                </span>
                <span className="admin-outreach-recent-actions">
                  <button type="button" className="btn btn-ghost btn-xs" onClick={deselectRecentlyEmailed} disabled={!users.length} title="Uncheck everyone emailed within this window (avoid over-messaging on follow-ups)">Deselect these</button>
                  <button type="button" className="btn btn-ghost btn-xs" onClick={selectRecentlyEmailed} disabled={!users.length} title="Check only those emailed within this window">Select these</button>
                </span>
              </div>

              <div className="admin-outreach-userlist admin-scroll">
                {outreachLoading && <div className="admin-empty">Loading eligible users…</div>}
                {!outreachLoading && users.length === 0 && (
                  <div className="admin-empty">
                    No users match this filter right now.
                    {' '}If you sent recently, the 7-day cooldown is excluding people you already nudged.
                  </div>
                )}
                {!outreachLoading && users.map((u) => {
                  const checked = outreachSelectedIds.has(u.userId);
                  return (
                    <label key={u.userId} className={`admin-outreach-user-row ${checked ? 'is-checked' : ''}`}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOutreachUser(u.userId)}
                      />
                      <div className="admin-outreach-user-main">
                        <div className="admin-outreach-user-name">
                          {u.displayName ? <strong>{u.displayName}</strong> : <em style={{ color: 'var(--text-sec)' }}>(no name)</em>}
                          {u.country && <span className="admin-outreach-user-country">{u.country}</span>}
                        </div>
                        <div className="admin-outreach-user-email">{u.email}</div>
                        {(() => {
                          const ei = _emailInfo(u.userId);
                          if (!ei) return <div className="admin-outreach-user-emailed is-never">Never emailed</div>;
                          const recent = _emailedWithinDays(u.userId, _recentDaysWindow());
                          return (
                            <div className={`admin-outreach-user-emailed ${recent ? 'is-recent' : ''}`}>
                              Last emailed: {ei.label}{ei.totalSent > 1 ? ` · ${ei.totalSent} total` : ''}
                            </div>
                          );
                        })()}
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* RIGHT: preview + send controls */}
            <div className="admin-outreach-right">
              {/* In-page rendered preview. Iframe is sandboxed (no
                  scripts, no forms, no top-nav) — pure visual render so
                  the operator can spot copy / layout issues without
                  leaving the dashboard. The send-to-email preview below
                  is still useful for verifying client-side rendering
                  (Gmail, Apple Mail, Outlook all render differently). */}
              <div className="admin-outreach-card">
                <h3>Live preview</h3>
                <p className="admin-outreach-step-desc">
                  Rendered with your admin account as the recipient stand-in. Subject and personalization tokens reflect what a real recipient would see.
                </p>
                {outreachPreviewSubject && (
                  <div className="admin-outreach-preview-subject">
                    <span className="admin-outreach-preview-subject-label">Subject</span>
                    <span className="admin-outreach-preview-subject-text">{outreachPreviewSubject}</span>
                  </div>
                )}
                {outreachPreviewHtml === null ? (
                  <div className="admin-outreach-preview-loading">Loading preview…</div>
                ) : outreachPreviewHtml ? (
                  <iframe
                    title="Email preview"
                    className="admin-outreach-preview-iframe"
                    srcDoc={outreachPreviewHtml}
                    sandbox=""
                  />
                ) : (
                  <div className="admin-outreach-preview-loading">Could not render preview.</div>
                )}
              </div>

              <div className="admin-outreach-card">
                <h3>1. Send a preview to your inbox</h3>
                <p className="admin-outreach-step-desc">
                  We&apos;ll render the exact email a user would receive and send it to this address. Required before you can send to the batch — gives you a chance to spot copy issues, broken links, or rendering problems.
                </p>
                <div className="admin-outreach-preview-row">
                  <input
                    type="email"
                    className="input-field"
                    placeholder="you@example.com"
                    value={outreachPreviewEmail}
                    onChange={(e) => setOutreachPreviewEmail(e.target.value)}
                    disabled={outreachPreviewBusy}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSendPreview}
                    disabled={outreachPreviewBusy || !outreachPreviewEmail.trim()}
                  >
                    {outreachPreviewBusy
                      ? <><RefreshCw size={14} className="spin" /> Sending…</>
                      : <>Send preview</>}
                  </button>
                </div>
                {outreachPreviewSent && (
                  <p className="admin-outreach-preview-ok">
                    <Check size={14} /> Preview sent. Check your inbox, confirm it looks right, then send to the batch.
                  </p>
                )}
              </div>

              {/* CANARY CARD — optional safety step between preview and
                  full batch. Sends to N randomly-picked users from the
                  current selection so the operator can verify rendering
                  in real inboxes (different clients render differently)
                  before broadcasting to everyone. Counts as completing
                  the preview gate. */}
              <div className="admin-outreach-card">
                <h3>2. Canary send (optional)</h3>
                <p className="admin-outreach-step-desc">
                  Send to a small random subset before the full batch. Catches issues a single-recipient preview misses — odd display names, missing emails, weird country flags. Recipients are automatically excluded from the full batch below.
                </p>
                <div className="admin-outreach-canary-row">
                  <label className="admin-outreach-canary-count-label">
                    Count
                    <input
                      type="number"
                      min="1"
                      max="50"
                      className="input-field admin-outreach-canary-count"
                      value={outreachCanaryCount}
                      onChange={(e) => setOutreachCanaryCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                      disabled={outreachCanaryBusy}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleSendCanary}
                    disabled={outreachCanaryBusy || selectedCount === 0}
                  >
                    {outreachCanaryBusy
                      ? <><RefreshCw size={14} className="spin" /> Sending canary…</>
                      : <>Send canary to {Math.min(outreachCanaryCount, selectedCount)} random</>}
                  </button>
                </div>
                {outreachSentThisSession.size > 0 && (
                  <p className="admin-outreach-canary-meta">
                    {outreachSentThisSession.size} user{outreachSentThisSession.size === 1 ? '' : 's'} already sent this session — excluded from the batch below.
                  </p>
                )}
              </div>

              <div className="admin-outreach-card">
                <h3>3. Send to {Math.max(0, selectedCount - outreachSentThisSession.size)} remaining user{Math.max(0, selectedCount - outreachSentThisSession.size) === 1 ? '' : 's'}</h3>
                <p className="admin-outreach-step-desc">
                  Disabled until you&apos;ve sent a preview to your own inbox OR a canary above. The batch send writes a per-user audit row to{' '}
                  <code>/outreachSent</code> and a summary row to <code>/outreachRuns</code>. Resend webhook events (delivered / opened / clicked / bounced) stamp those same rows in the background.
                </p>
                <button
                  type="button"
                  className="btn btn-primary admin-outreach-batch-btn"
                  onClick={handleSendBatch}
                  disabled={!canSendBatch}
                  title={!outreachPreviewSent
                    ? 'Send a preview to your inbox first'
                    : selectedCount === 0
                      ? 'Select at least one user'
                      : ''}
                >
                  {outreachBatchBusy
                    ? <><RefreshCw size={14} className="spin" /> Sending…</>
                    : <>Send to {Math.max(0, selectedCount - outreachSentThisSession.size)} user{Math.max(0, selectedCount - outreachSentThisSession.size) === 1 ? '' : 's'} now →</>}
                </button>

                {/* Schedule-for-later option. Same selection + same
                    template; just stamped into /outreachScheduled and
                    drained by the /api/cron/outreach-drain cron. */}
                <div className="admin-outreach-schedule-row">
                  <label className="admin-outreach-schedule-label">
                    Or schedule for
                    <input
                      type="datetime-local"
                      className="input-field admin-outreach-schedule-input"
                      value={outreachScheduleAt}
                      onChange={(e) => setOutreachScheduleAt(e.target.value)}
                      disabled={outreachScheduleBusy}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={handleScheduleOutreach}
                    disabled={outreachScheduleBusy || !outreachPreviewSent || !outreachScheduleAt || (selectedCount - outreachSentThisSession.size) <= 0}
                    title={!outreachPreviewSent
                      ? 'Send a preview or canary first'
                      : !outreachScheduleAt
                        ? 'Pick a date and time'
                        : ''}
                  >
                    {outreachScheduleBusy
                      ? <><RefreshCw size={14} className="spin" /> Scheduling…</>
                      : <>Schedule send</>}
                  </button>
                </div>

                {outreachBatchResult && (
                  <div className="admin-outreach-batch-result">
                    <div><strong>Sent:</strong> {outreachBatchResult.sent}</div>
                    <div><strong>Skipped:</strong> {outreachBatchResult.skipped}</div>
                    <div><strong>Failed:</strong> {outreachBatchResult.failed}</div>
                    {outreachBatchResult.errors?.length > 0 && (
                      <details className="admin-outreach-errors">
                        <summary>{outreachBatchResult.errors.length} error{outreachBatchResult.errors.length === 1 ? '' : 's'}</summary>
                        <ul>
                          {outreachBatchResult.errors.slice(0, 20).map((e, i) => (
                            <li key={i}><code>{e.uid?.slice(0, 10)}</code> — {e.error}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Recent Runs panel ─────────────────────────────────
              Last 20 batches/canaries + per-template aggregate stats
              from the Resend webhook data (delivered / opened /
              clicked / bounced / complained). Refreshes every time
              the operator switches into the tab and after each send. */}

          {/* ─── Scheduled sends panel ────────────────────────────
              Pending sends sit at the top with a Cancel button; once
              drained they fall to the bottom as audit history. */}
          <div className="admin-outreach-scheduled">
            <div className="admin-outreach-runs-head">
              <h3>Scheduled sends</h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={reloadOutreachScheduled}>
                <RefreshCw size={11} /> Refresh
              </button>
            </div>
            {outreachScheduled === null && <div className="admin-empty">Loading…</div>}
            {outreachScheduled?.length === 0 && <div className="admin-empty">No scheduled sends.</div>}
            {outreachScheduled && outreachScheduled.length > 0 && (
              <table className="admin-outreach-runs-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Template</th>
                    <th>Status</th>
                    <th className="admin-outreach-runs-num">Recipients</th>
                    <th className="admin-outreach-runs-num">Sent</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {outreachScheduled.map((s) => {
                    const when = s.scheduledForMs ? new Date(s.scheduledForMs) : null;
                    return (
                      <tr key={s.id}>
                        <td title={when ? when.toString() : ''}>{when ? when.toLocaleString() : '—'}</td>
                        <td>{OUTREACH_TEMPLATES[s.template]?.label || s.template}</td>
                        <td>
                          <span className={`admin-outreach-status admin-outreach-status-${s.status}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="admin-outreach-runs-num">{s.recipientCount}</td>
                        <td className="admin-outreach-runs-num">
                          {s.status === 'pending' || s.status === 'sending' ? '—' : `${s.sent} / ${s.attempted}`}
                        </td>
                        <td>
                          {s.status === 'pending' && (
                            <button type="button" className="btn btn-ghost btn-xs" onClick={() => handleCancelScheduled(s.id)}>
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="admin-outreach-runs">
            <div className="admin-outreach-runs-head">
              <h3>Recent runs</h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={reloadOutreachRecentRuns}>
                <RefreshCw size={11} /> Refresh
              </button>
            </div>

            {/* Per-template stats — show once at the top, rolls up all-time. */}
            {Object.keys(outreachTemplateStats).length > 0 && (
              <div className="admin-outreach-template-stats">
                {Object.entries(outreachTemplateStats).map(([tpl, s]) => {
                  const sent = s.totalSendRows || 0;
                  const open = s.opened || 0;
                  const click = s.clicked || 0;
                  const openRate = sent > 0 ? Math.round((open / sent) * 100) : 0;
                  const clickRate = sent > 0 ? Math.round((click / sent) * 100) : 0;
                  return (
                    <div key={tpl} className="admin-outreach-tstat-card">
                      <div className="admin-outreach-tstat-name">{OUTREACH_TEMPLATES[tpl]?.label || tpl}</div>
                      <div className="admin-outreach-tstat-row">
                        <span>{sent}</span><em>sent</em>
                      </div>
                      <div className="admin-outreach-tstat-row">
                        <span>{open}</span><em>opened ({openRate}%)</em>
                      </div>
                      <div className="admin-outreach-tstat-row">
                        <span>{click}</span><em>clicked ({clickRate}%)</em>
                      </div>
                      {(s.bounced > 0 || s.complained > 0) && (
                        <div className="admin-outreach-tstat-row admin-outreach-tstat-warn">
                          <span>{s.bounced + s.complained}</span><em>bounced/complained</em>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Per-run audit table */}
            {outreachRecentRuns === null && (
              <div className="admin-empty">Loading recent runs…</div>
            )}
            {outreachRecentRuns?.length === 0 && (
              <div className="admin-empty">No outreach runs yet.</div>
            )}
            {outreachRecentRuns && outreachRecentRuns.length > 0 && (
              <table className="admin-outreach-runs-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Template</th>
                    <th>Type</th>
                    <th className="admin-outreach-runs-num">Sent</th>
                    <th className="admin-outreach-runs-num">Skipped</th>
                    <th className="admin-outreach-runs-num">Failed</th>
                  </tr>
                </thead>
                <tbody>
                  {outreachRecentRuns.map((r) => (
                    <tr key={r.id}>
                      <td title={r.triggeredAtMs ? new Date(r.triggeredAtMs).toString() : ''}>
                        {r.triggeredAtMs ? new Date(r.triggeredAtMs).toLocaleString() : '—'}
                      </td>
                      <td>{OUTREACH_TEMPLATES[r.template]?.label || r.template}</td>
                      <td>{r.canary ? <span className="admin-outreach-runs-canary">canary</span> : 'batch'}</td>
                      <td className="admin-outreach-runs-num"><strong>{r.sent}</strong> / {r.attempted}</td>
                      <td className="admin-outreach-runs-num">{r.skipped}</td>
                      <td className="admin-outreach-runs-num">{r.failed}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ─── Automation rules (B2d) ─────────────────────────── */}
          <div className="admin-automation">
            <div className="admin-outreach-runs-head">
              <h3>Automation rules</h3>
              {isSuperadmin && <button type="button" className="btn btn-secondary btn-xs" onClick={newRuleDraft}>+ New rule</button>}
            </div>
            <p className="admin-automation-note">
              Rules auto-send a template to a segment on each automation run, respecting a per-user cooldown and a per-run cap. New rules are <strong>disabled by default</strong> — enable only after previewing who they hit.
            </p>
            {automationRules === null ? (
              <div className="admin-empty">Loading rules…</div>
            ) : automationRules.length === 0 ? (
              <div className="admin-empty">No automation rules yet.</div>
            ) : (
              <table className="admin-outreach-runs-table">
                <thead>
                  <tr><th>Rule</th><th>Segment</th><th>Template</th><th>Timing</th><th>Cooldown</th><th>Cap</th><th>State</th><th></th></tr>
                </thead>
                <tbody>
                  {automationRules.map(r => (
                    <tr key={r.id}>
                      <td>{r.name || <em>(unnamed)</em>}</td>
                      <td>{AUTOMATION_SEGMENTS.find(s => s.id === r.segment)?.label || r.segment}</td>
                      <td>{OUTREACH_TEMPLATES[r.template]?.label || r.template}</td>
                      <td>{r.hoursBeforeLock == null ? 'any time' : `≤ ${r.hoursBeforeLock}h to lock`}</td>
                      <td>{r.cooldownDays}d</td>
                      <td>{r.maxPerRun}</td>
                      <td>
                        <button type="button" className={`admin-rule-toggle ${r.enabled ? 'on' : 'off'}`} onClick={() => isSuperadmin && toggleRuleEnabled(r)} disabled={!isSuperadmin} title={isSuperadmin ? 'Toggle enabled' : 'Superadmin only'}>
                          {r.enabled ? 'ENABLED' : 'disabled'}
                        </button>
                      </td>
                      <td className="admin-outreach-runs-num">
                        {isSuperadmin && <>
                          <button type="button" className="btn btn-ghost btn-xs" onClick={() => editRuleDraft(r)}>Edit</button>
                          <button type="button" className="btn btn-ghost btn-xs admin-rule-del" onClick={() => deleteRule(r)}>Delete</button>
                        </>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {ruleDraft && (
              <div className="admin-modal-overlay" onClick={closeRuleDraft}>
                <div className="admin-modal admin-rule-editor" onClick={e => e.stopPropagation()}>
                  <div className="admin-modal-head">
                    <h3>{ruleDraft.id ? 'Edit rule' : 'New rule'}</h3>
                    <button type="button" className="admin-modal-close" onClick={closeRuleDraft} disabled={ruleBusy}><X size={16} /></button>
                  </div>
                  <label className="admin-custom-email-label">Name</label>
                  <input className="input-field" value={ruleDraft.name} maxLength={80} onChange={e => setRuleDraft({ ...ruleDraft, name: e.target.value })} placeholder="e.g. No-picks nudge, 48h to lock" disabled={ruleBusy} />
                  <label className="admin-custom-email-label">Segment</label>
                  <select className="input-field" value={ruleDraft.segment} onChange={e => { setRuleDraft({ ...ruleDraft, segment: e.target.value }); setRulePreview(null); }} disabled={ruleBusy}>
                    {AUTOMATION_SEGMENTS.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <label className="admin-custom-email-label">Template</label>
                  <select className="input-field" value={ruleDraft.template} onChange={e => setRuleDraft({ ...ruleDraft, template: e.target.value })} disabled={ruleBusy}>
                    {Object.keys(OUTREACH_TEMPLATES).map(t => <option key={t} value={t}>{OUTREACH_TEMPLATES[t]?.label || t}</option>)}
                  </select>
                  <label className="admin-custom-email-label">Lock stage (the deadline “hours before lock” counts down to)</label>
                  <select className="input-field" value={ruleDraft.stage || 'groupStage'} onChange={e => setRuleDraft({ ...ruleDraft, stage: e.target.value })} disabled={ruleBusy}>
                    {AUTOMATION_STAGES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                  <div className="admin-rule-row">
                    <div>
                      <label className="admin-custom-email-label">Only after games finish (blank = no gate)</label>
                      <select className="input-field" value={ruleDraft.requireStageComplete || ''} onChange={e => setRuleDraft({ ...ruleDraft, requireStageComplete: e.target.value })} disabled={ruleBusy}>
                        <option value="">— no gate —</option>
                        {AUTOMATION_STAGES.map(s => <option key={s.id} value={s.id}>{s.label} games done</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="admin-custom-email-label">Repeat every N hours (blank = once)</label>
                      <input className="input-field" type="number" min="6" max="720" value={ruleDraft.repeatEveryHours} onChange={e => setRuleDraft({ ...ruleDraft, repeatEveryHours: e.target.value })} placeholder="e.g. 12" disabled={ruleBusy} />
                    </div>
                  </div>
                  <div className="admin-rule-row">
                    <div>
                      <label className="admin-custom-email-label">Hours before lock (blank = any time)</label>
                      <input className="input-field" type="number" min="0" value={ruleDraft.hoursBeforeLock} onChange={e => setRuleDraft({ ...ruleDraft, hoursBeforeLock: e.target.value })} placeholder="e.g. 48" disabled={ruleBusy} />
                    </div>
                    <div>
                      <label className="admin-custom-email-label">Cooldown (days)</label>
                      <input className="input-field" type="number" min="1" max="60" value={ruleDraft.cooldownDays} onChange={e => { setRuleDraft({ ...ruleDraft, cooldownDays: e.target.value }); setRulePreview(null); }} disabled={ruleBusy} />
                    </div>
                    <div>
                      <label className="admin-custom-email-label">Max per run</label>
                      <input className="input-field" type="number" min="1" max="1000" value={ruleDraft.maxPerRun} onChange={e => { setRuleDraft({ ...ruleDraft, maxPerRun: e.target.value }); setRulePreview(null); }} disabled={ruleBusy} />
                    </div>
                  </div>
                  <label className="admin-rule-enable">
                    <input type="checkbox" checked={ruleDraft.enabled} onChange={e => setRuleDraft({ ...ruleDraft, enabled: e.target.checked })} disabled={ruleBusy} />
                    <span>Enabled (auto-sends on each run)</span>
                  </label>

                  <div className="admin-rule-preview-box">
                    <button type="button" className="btn btn-secondary btn-xs" onClick={previewRule} disabled={ruleBusy}>
                      {ruleBusy ? <><RefreshCw size={12} className="spin" /> Checking…</> : 'Dry-run preview'}
                    </button>
                    {rulePreview && (
                      <div className="admin-rule-preview-result">
                        <p><strong>{rulePreview.wouldSend}</strong> would be emailed now
                          {' '}(segment {rulePreview.segmentSize}, {rulePreview.excludedByGuardrail} skipped by cooldown{rulePreview.cappedBy ? `, capped at ${rulePreview.cappedBy}` : ''}).</p>
                        {rulePreview.sample?.length > 0 && (
                          <p className="admin-rule-preview-sample">e.g. {rulePreview.sample.map(s => s.displayName || s.email || s.id).join(', ')}</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="admin-modal-actions">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={closeRuleDraft} disabled={ruleBusy}>Cancel</button>
                    <button type="button" className="btn btn-primary btn-sm" onClick={saveRule} disabled={ruleBusy || !ruleDraft.segment || !ruleDraft.template}>
                      {ruleBusy ? <><RefreshCw size={14} className="spin" /> Saving…</> : 'Save rule'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
        );
      })()}

      {/* ═══════ TAB: ORACLE STATUS ═══════ */}
      {tab === 'oracle' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Oracle Status</h2>
              <p className="admin-panel-desc">Live connectivity test for both data sources</p>
            </div>
            <button type="button" className="btn btn-primary btn-sm" onClick={runHealthCheck} disabled={healthLoading}>
              {healthLoading ? <><RefreshCw size={13} className="spin" /> Testing...</> : <><Zap size={13} /> Run Health Check</>}
            </button>
          </div>

          {healthError && !health && (
            <div className="admin-oracle-info" style={{borderColor:'rgba(255,59,92,0.15)', background:'rgba(255,59,92,0.04)', color:'var(--danger)'}}>
              <AlertTriangle size={14} />
              <span>{healthError}</span>
            </div>
          )}

          {!health && !healthLoading && !healthError && (
            <div className="admin-empty">Click "Run Health Check" to test oracle connections.</div>
          )}

          {healthLoading && !health && (
            <div className="admin-empty"><RefreshCw size={18} className="spin" style={{display:'inline-block', marginRight:'0.5rem'}} /> Pinging oracle APIs...</div>
          )}

          {health && (
            <>
              {/* Timestamp */}
              <div style={{fontSize:'0.62rem', color:'var(--text-dim)', fontFamily:'var(--mono)', marginBottom:'1rem', display:'flex', alignItems:'center', gap:'0.3rem'}}>
                <Clock size={11} /> Checked: {new Date(health.timestamp).toLocaleString()}
              </div>

              <div className="admin-oracle-grid">
                {/* Oracle 1 */}
                <div className={`admin-oracle-card ${health.oracle1.status === 'connected' ? 'oracle-ok' : 'oracle-err'}`}>
                  <h3>
                    {health.oracle1.status === 'connected' ? <Wifi size={14} style={{color:'var(--success)'}} /> : <WifiOff size={14} style={{color:'var(--danger)'}} />}
                    Oracle 1 — Football-Data.org
                  </h3>

                  <div className="admin-oracle-status-live">
                    <span className={`admin-status-dot ${health.oracle1.status === 'connected' ? 'green' : health.oracle1.status === 'rate_limited' ? 'amber' : 'red'}`}></span>
                    <span className="admin-status-label">
                      {health.oracle1.status === 'connected' && 'Connected'}
                      {health.oracle1.status === 'no_key' && 'API Key Missing'}
                      {health.oracle1.status === 'rate_limited' && 'Rate Limited'}
                      {health.oracle1.status === 'error' && 'Connection Failed'}
                      {health.oracle1.status === 'unknown' && 'Unknown'}
                    </span>
                  </div>

                  {health.oracle1.latency != null && (
                    <div className="admin-oracle-detail">Latency: <strong>{health.oracle1.latency}ms</strong></div>
                  )}
                  {health.oracle1.competition && (
                    <div className="admin-oracle-detail">Competition: <strong>{health.oracle1.competition}</strong></div>
                  )}
                  {health.oracle1.error && (
                    <div className="admin-oracle-err-msg"><AlertTriangle size={11} /> {health.oracle1.error}</div>
                  )}

                  <a href="https://www.football-data.org" target="_blank" rel="noopener noreferrer" className="admin-oracle-link"><ExternalLink size={11} /> football-data.org</a>
                </div>

              </div>

              {/* Env vars status */}
              <h3 className="admin-section-title">Environment Variables</h3>
              <div className="admin-contract-card">
                {Object.entries(health.envVars).map(([key, isSet]) => (
                  <div key={key} className="admin-contract-row">
                    <span className="admin-contract-lbl">{key}</span>
                    <span className={`admin-env-status ${isSet ? 'set' : 'missing'}`}>
                      {isSet ? <><CheckCircle size={12} /> Set</> : <><AlertTriangle size={12} /> Missing</>}
                    </span>
                  </div>
                ))}
              </div>

              {/* Contract status */}
              <h3 className="admin-section-title">Smart Contract</h3>
              <div className="admin-contract-card">
                <div className="admin-contract-row">
                  <span className="admin-contract-lbl">Contract Address</span>
                  <span className={`admin-contract-val ${health.contract.deployed ? '' : 'pending'}`}>
                    {health.contract.address || 'Not deployed'}
                  </span>
                </div>
                <div className="admin-contract-row">
                  <span className="admin-contract-lbl">Polygon RPC</span>
                  <span className={`admin-env-status ${health.contract.rpc ? 'set' : 'missing'}`}>
                    {health.contract.rpc ? <><CheckCircle size={12} /> Configured</> : <><AlertTriangle size={12} /> Not set</>}
                  </span>
                </div>
              </div>

              <div className="admin-oracle-info" style={{marginTop:'1rem'}}>
                <AlertTriangle size={14} />
                <span>Match results are sourced from football-data.org. If a result is reported incorrectly, a superadmin can override it via the Matches tab; users can also email support@goaloracle.io to flag a result.</span>
              </div>
            </>
          )}

          {/* ─── Live smoke test ─── */}
          <div className="admin-panel-head" style={{ marginTop: '2rem' }}>
            <div>
              <h2>Live End-to-End Test</h2>
              <p className="admin-panel-desc">Pick a recent finished match in another league, fetch it from football-data.org, and confirm our parser ingests it correctly. Use this before the World Cup to verify the whole pipeline works.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => runSmokeTest('PL')} disabled={smokeTestLoading}>
                {smokeTestLoading ? <><RefreshCw size={13} className="spin" /> Running…</> : <>Test EPL</>}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => runSmokeTest('CL')} disabled={smokeTestLoading}>
                Test UCL
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => runSmokeTest('WC')} disabled={smokeTestLoading}>
                Test WC
              </button>
            </div>
          </div>

          {smokeTestError && (
            <div className="admin-oracle-info" style={{ borderColor: 'rgba(255,59,92,0.15)', background: 'rgba(255,59,92,0.04)', color: 'var(--danger)' }}>
              <AlertTriangle size={14} />
              <span>{smokeTestError}</span>
            </div>
          )}

          {smokeTest && (
            <div className="admin-contract-card">
              <div className="admin-contract-row">
                <span className="admin-contract-lbl">{smokeTest.competition}</span>
                <span className={`admin-env-status ${smokeTest.failed === 0 ? 'set' : 'missing'}`}>
                  {smokeTest.failed === 0
                    ? <><CheckCircle size={12} /> {smokeTest.passed}/{smokeTest.passed} passed</>
                    : <><AlertTriangle size={12} /> {smokeTest.failed} failed of {smokeTest.passed + smokeTest.failed}</>}
                </span>
              </div>
              {smokeTest.checks?.map((c, i) => (
                <div key={i} className="admin-contract-row">
                  <span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>
                    {c.ok ? '✓' : '✗'} {c.name}
                  </span>
                  <span className="admin-contract-val" style={{ fontSize: '0.8rem', color: c.ok ? 'var(--text-2)' : 'var(--danger)' }}>
                    {c.detail}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* ─── Manual cron triggers (post-deploy verification) ─── */}
          <div className="admin-panel-head" style={{ marginTop: '2rem' }}>
            <div>
              <h2>Verify Automation</h2>
              <p className="admin-panel-desc">Click these once after deploy to confirm the scheduled crons are wired up correctly. Both run automatically on schedule otherwise — these buttons just trigger the same handler now so you get instant feedback.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={runAutoPollNow} disabled={cronLoading !== null}>
                {cronLoading === 'poll' ? <><RefreshCw size={13} className="spin" /> Running…</> : <>Run Auto-Poll Now</>}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={runDailyReportNow} disabled={cronLoading !== null}>
                {cronLoading === 'report' ? <><RefreshCw size={13} className="spin" /> Sending…</> : <>Email Daily Report Now</>}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => runReminderCron('24h', true)} disabled={cronLoading !== null} title="Count how many users would receive the 24h reminder right now (no email sent)">
                {cronLoading === 'reminder-24h-dry' ? <><RefreshCw size={13} className="spin" /> Counting…</> : <>Reminder 24h (dry)</>}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => runReminderCron('24h')} disabled={cronLoading !== null} title="Force-send the 24h-window reminder to all incomplete-bracket users right now">
                {cronLoading === 'reminder-24h' ? <><RefreshCw size={13} className="spin" /> Sending…</> : <>Send 24h Reminders</>}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => runReminderCron('1h')} disabled={cronLoading !== null} title="Force-send the 1h-window reminder to all incomplete-bracket users right now">
                {cronLoading === 'reminder-1h' ? <><RefreshCw size={13} className="spin" /> Sending…</> : <>Send 1h Reminders</>}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={clearMyAntiSybil} disabled={cronLoading !== null} title="Wipe your own deviceFingerprints + signupIps records so you can sign up new test accounts on this device. Doesn't delete your account.">
                {cronLoading === 'clear-asyb' ? <><RefreshCw size={13} className="spin" /> Clearing…</> : <>Clear my device block</>}
              </button>
            </div>
          </div>

          {/* ─── Sign-in diagnostic ─── */}
          <div className="admin-panel-head" style={{ marginTop: '2rem' }}>
            <div>
              <h2>Inspect User by Email</h2>
              <p className="admin-panel-desc">When a user reports a sign-in regression, look up the canonical /users docs for their email here. Surfaces duplicate accounts (one did:privy:* + one auth_*, or two auth_* with the same dedupe key) that can strand the client's getDoc lookup.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input
                type="email"
                className="login-input"
                placeholder="user@example.com"
                value={inspectEmail}
                onChange={(e) => setInspectEmail(e.target.value)}
                disabled={inspectLoading}
                style={{ minWidth: 240 }}
                onKeyDown={(e) => { if (e.key === 'Enter') inspectUser(); }}
              />
              <button type="button" className="btn btn-secondary btn-sm" onClick={inspectUser} disabled={inspectLoading || !inspectEmail.trim()}>
                {inspectLoading ? <><RefreshCw size={13} className="spin" /> Looking up…</> : <>Inspect</>}
              </button>
            </div>
          </div>

          {inspectResult && (
            <div className="admin-oracle-info" style={{ display: 'block', padding: '1rem', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5, background: 'rgba(0,0,0,0.04)' }}>
              <div style={{ fontWeight: 600, marginBottom: 8 }}>
                {inspectResult.queriedEmail} → would resolve to <code>{inspectResult.wouldResolveTo || '(none)'}</code>
                {inspectResult.duplicateCount > 1 && (
                  <span style={{ color: 'var(--danger)', marginLeft: 8 }}>⚠ {inspectResult.duplicateCount} duplicate doc(s)</span>
                )}
              </div>
              {JSON.stringify(inspectResult, null, 2)}
            </div>
          )}

          {cronStatus?.error && (
            <div className="admin-oracle-info" style={{ borderColor: 'rgba(255,59,92,0.15)', background: 'rgba(255,59,92,0.04)', color: 'var(--danger)' }}>
              <AlertTriangle size={14} />
              <span>{cronStatus.kind === 'poll' ? 'Auto-poll' : cronStatus.kind === 'reminder' ? 'Reminder cron' : 'Daily report'} error: {cronStatus.error}</span>
            </div>
          )}

          {/* ─── Anti-Sybil bypass allowlist ─── */}
          <div className="admin-panel-head" style={{ marginTop: '2rem' }}>
            <div>
              <h2>Anti-Sybil Bypass List</h2>
              <p className="admin-panel-desc">
                Emails on this list skip the per-device + per-IP single-account
                check. Gmail+ aliases auto-match (e.g. <code>you@gmail.com</code>
                {' '}also covers <code>you+test1@gmail.com</code>). Use this for
                your own laptop / phone test accounts. Changes take effect within
                ~60 seconds. Up to 200 entries.
              </p>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              {bypassList === null ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={loadBypassList}>Load list</button>
              ) : (
                <>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={addMyEmailToBypass} disabled={!userData?.email}>
                    + add my email
                  </button>
                  <button type="button" className="btn btn-primary btn-sm" onClick={saveBypassList} disabled={bypassBusy}>
                    {bypassBusy ? <><RefreshCw size={13} className="spin" /> Saving…</> : <>Save</>}
                  </button>
                </>
              )}
            </div>
          </div>

          {bypassList !== null && (
            <div className="admin-contract-card" style={{ display: 'block', padding: '0.75rem 1rem' }}>
              <textarea
                value={bypassDraft}
                onChange={(e) => setBypassDraft(e.target.value)}
                placeholder={'one email per line\nyou@gmail.com\nteammate@example.com'}
                rows={Math.max(4, Math.min(12, bypassDraft.split('\n').length + 1))}
                spellCheck={false}
                style={{
                  width: '100%',
                  fontFamily: 'var(--mono, monospace)',
                  fontSize: 13,
                  padding: 8,
                  borderRadius: 6,
                  border: '1px solid var(--border)',
                  background: 'var(--bg)',
                  color: 'var(--text)',
                  resize: 'vertical',
                }}
              />
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-sec)' }}>
                Saved: <strong>{bypassList.length}</strong> entries.
                {bypassEnvList.length > 0 && (
                  <> Plus <strong>{bypassEnvList.length}</strong> from <code>ANTI_SYBIL_BYPASS_EMAILS</code> env var (read-only here).</>
                )}
              </div>
            </div>
          )}

          {cronStatus?.data && cronStatus.kind === 'poll' && (
            <div className="admin-contract-card">
              <div className="admin-contract-row">
                <span className="admin-contract-lbl">Auto-poll result</span>
                <span className="admin-env-status set"><CheckCircle size={12} /> ran at {new Date(cronStatus.data.runAt).toLocaleString()}</span>
              </div>
              <div className="admin-contract-row"><span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>Candidates (matches finished, not yet ingested)</span><span className="admin-contract-val">{cronStatus.data.candidates}</span></div>
              <div className="admin-contract-row"><span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>Newly ingested</span><span className="admin-contract-val">{cronStatus.data.ingested}</span></div>
              <div className="admin-contract-row"><span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>Disputed (sources disagree)</span><span className="admin-contract-val" style={{ color: cronStatus.data.disputed > 0 ? 'var(--danger)' : 'var(--text-2)' }}>{cronStatus.data.disputed}</span></div>
              <div className="admin-contract-row"><span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>Partial (only one source)</span><span className="admin-contract-val">{cronStatus.data.partial}</span></div>
              {cronStatus.data.errors?.length > 0 && (
                <div className="admin-contract-row"><span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>Errors</span><span className="admin-contract-val" style={{ fontSize: '0.75rem', color: 'var(--danger)' }}>{cronStatus.data.errors.length} — see Vercel logs</span></div>
              )}
            </div>
          )}

          {cronStatus?.data && cronStatus.kind === 'report' && (
            <div className="admin-contract-card">
              <div className="admin-contract-row">
                <span className="admin-contract-lbl">Daily report</span>
                <span className={`admin-env-status ${cronStatus.data.emailed ? 'set' : 'missing'}`}>
                  {cronStatus.data.emailed
                    ? <><CheckCircle size={12} /> Email sent — check your inbox</>
                    : <><AlertTriangle size={12} /> Email FAILED: {cronStatus.data.emailError || 'unknown'}</>}
                </span>
              </div>
              <div className="admin-contract-row"><span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>Status</span><span className="admin-contract-val" style={{ color: cronStatus.data.allGreen ? 'var(--text-2)' : 'var(--danger)' }}>{cronStatus.data.allGreen ? 'All green' : `${cronStatus.data.issues?.length || 0} issue(s)`}</span></div>
              {cronStatus.data.missing?.length > 0 && (
                <div className="admin-contract-row"><span className="admin-contract-lbl" style={{ paddingLeft: '0.75rem' }}>Missing match results</span><span className="admin-contract-val" style={{ fontSize: '0.75rem' }}>{cronStatus.data.missing.slice(0, 5).join(', ')}{cronStatus.data.missing.length > 5 ? '…' : ''}</span></div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ═══════ TAB: SMART CONTRACT ═══════ */}
      {tab === 'contract' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Smart Contract</h2>
              <p className="admin-panel-desc">GoalOracleVerifier.sol — Polygon PoS (Chain 137)</p>
            </div>
          </div>

          <div className="admin-contract-card">
            <div className="admin-contract-row"><span className="admin-contract-lbl">Contract</span><span className="admin-contract-val">GoalOracleVerifier.sol</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Network</span><span className="admin-contract-val">Polygon PoS (Chain 137)</span></div>
            <div className="admin-contract-row">
              <span className="admin-contract-lbl">Address</span>
              <span className="admin-contract-val pending">{health?.contract?.address || 'Not deployed'}</span>
            </div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Required Confirmations</span><span className="admin-contract-val">2 / 2 oracles</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Dispute Window</span><span className="admin-contract-val">1 hour</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Oracle 1 Wallet</span><span className="admin-contract-val pending">Not registered</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Oracle 2 Wallet</span><span className="admin-contract-val pending">Not registered</span></div>
          </div>

          <div className="admin-contract-actions">
            <a href="https://github.com/nicholascpark/goaloracle/blob/main/contracts/GoalOracleVerifier.sol" target="_blank" rel="noopener noreferrer" className="btn"><ExternalLink size={13} /> View Source on GitHub</a>
            <a href="https://polygonscan.com" target="_blank" rel="noopener noreferrer" className="btn"><ExternalLink size={13} /> Polygonscan</a>
          </div>
        </div>
      )}

      {/* ═══════ TAB: GLOBAL SUBMITS (copy-to-Global audit) ═══════ */}
      {tab === 'globalLog' && (() => {
        const outcomeColor = {
          created: 'var(--lime)',
          overwritten: 'var(--cyan)',
          skipped_existing: 'var(--text-sec)',
          ineligible: 'var(--amber)',
          error: '#ef4444',
        };
        return (
        <div className="admin-panel">
          <div className="admin-outreach-runs">
            <div className="admin-outreach-runs-head">
              <h3>Copy-to-Global audit</h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={reloadGlobalSubmitLog}>
                <RefreshCw size={11} /> Refresh
              </button>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Every copy of a private bracket into the Global Quick Picks league — superadmin actions and the <code>system:auto-submit</code> on private-league completion. Newest 50.
            </p>

            {globalLog === null && <div className="admin-empty">Loading audit log…</div>}
            {globalLog?.length === 0 && <div className="admin-empty">No copy-to-Global activity yet.</div>}
            {globalLog && globalLog.length > 0 && (
              <table className="admin-outreach-runs-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Actor</th>
                    <th>User</th>
                    <th>Source league</th>
                    <th>Mode</th>
                    <th>Outcome</th>
                    <th>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {globalLog.map((r) => (
                    <tr key={r.id}>
                      <td title={r.timestampMs ? new Date(r.timestampMs).toString() : ''}>
                        {r.timestampMs ? new Date(r.timestampMs).toLocaleString() : '—'}
                      </td>
                      <td>
                        {r.actor === 'system:auto-submit'
                          ? <em>auto-submit</em>
                          : (r.actorName || r.actor || '—')}
                      </td>
                      <td title={r.userId || ''}>{r.userName || r.userId || '—'}</td>
                      <td title={r.sourceLeagueId || ''}>{r.sourceLeagueName || r.sourceLeagueId || '—'}</td>
                      <td>{r.mode || '—'}</td>
                      <td>
                        <span style={{ color: outcomeColor[r.outcome] || 'var(--text-sec)', fontWeight: 600 }}>
                          {r.outcome || '—'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-sec)' }}>{r.reason || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
        );
      })()}

      {/* ═══════ TAB: DELETIONS ═══════ */}
      {tab === 'deletions' && (
        <div className="admin-panel">
          <div className="admin-outreach-runs">
            <div className="admin-outreach-runs-head">
              <h3>Account deletions</h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={reloadDeletionLog}>
                <RefreshCw size={11} /> Refresh
              </button>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Every permanently deleted account — self-serve (user typed DELETE) and admin-initiated.
              The row snapshots the name/email at deletion time since the user doc is gone. Newest 100.
            </p>

            {deletionLog === null && <div className="admin-empty">Loading deletion log…</div>}
            {deletionLog?.length === 0 && <div className="admin-empty">No account deletions yet.</div>}
            {deletionLog && deletionLog.length > 0 && (
              <table className="admin-outreach-runs-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Email</th>
                    <th>How</th>
                    <th>Wiped</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {deletionLog.map((r) => (
                    <tr key={r.id}>
                      <td title={r.timestampMs ? new Date(r.timestampMs).toString() : ''}>
                        {r.timestampMs ? new Date(r.timestampMs).toLocaleString() : '—'}
                      </td>
                      <td title={r.targetUserId || ''}>{r.targetDisplayName || r.targetUserId || '—'}</td>
                      <td>{r.targetEmail || '—'}</td>
                      <td>
                        {r.action === 'self_delete_account'
                          ? <span style={{ color: 'var(--amber)', fontWeight: 600 }}>Self</span>
                          : <span style={{ color: 'var(--cyan)', fontWeight: 600 }} title={r.adminId || ''}>Admin{r.adminName ? ` (${r.adminName})` : ''}</span>}
                      </td>
                      <td style={{ color: 'var(--text-sec)' }}>
                        {r.deleted
                          ? `${r.deleted.simplePredictions ?? 0} QP, ${r.deleted.predictions ?? 0} classic, ${r.deleted.leagueMemberships ?? 0} league${(r.deleted.leagueMemberships ?? 0) === 1 ? '' : 's'}`
                          : '—'}
                      </td>
                      <td>
                        {r.recoveredAtMs ? (
                          <span style={{ color: 'var(--lime)', fontWeight: 600 }} title={new Date(r.recoveredAtMs).toString()}>Recovered ✓</span>
                        ) : (
                          // PITR keeps 7 days of history; older deletions aren't recoverable.
                          r.timestampMs && (Date.now() - r.timestampMs) < 6.5 * 24 * 60 * 60 * 1000 && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => handleRecoverUser(r)}
                              disabled={recoveringId === r.id}
                              title="Restore this account and all its picks as they were just before deletion (Firestore point-in-time recovery)"
                            >
                              {recoveringId === r.id ? 'Recovering…' : 'Recover'}
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TAB: INSIGHTS ═══════ */}
      {tab === 'insights' && (() => {
        const data = insights;
        const countryByCode = {};
        COUNTRIES.forEach(c => { countryByCode[c.code] = c; });
        const teamFlag = (name) => TEAM_COLORS[name]?.flag || '🏳️';
        const pct = (n, total) => (total > 0 ? Math.round((n / total) * 100) : 0);
        const renderBars = (items, total, flagFor, labelFor) => {
          const max = items.reduce((m, it) => Math.max(m, it.count), 0) || 1;
          return (
            <div className="ins-bars">
              {items.map((it, i) => (
                <div className="ins-bar-row" key={i}>
                  <span className="ins-bar-flag" aria-hidden="true">{flagFor(it)}</span>
                  <span className="ins-bar-label" title={labelFor(it)}>{labelFor(it)}</span>
                  <span className="ins-bar-track"><span className="ins-bar-fill" style={{ width: `${(it.count / max) * 100}%` }} /></span>
                  <span className="ins-bar-val">{it.count} · {pct(it.count, total)}%</span>
                </div>
              ))}
            </div>
          );
        };
        const block = (title, sub, cat, flagFor, labelFor, emptyMsg) => (
          <div className="ins-block">
            <div className="ins-block-title">{title} <span className="ins-block-sub">{sub}</span></div>
            {(!cat || cat.top.length === 0)
              ? <div className="admin-empty">{emptyMsg}</div>
              : renderBars(cat.top, cat.total, flagFor, labelFor)}
          </div>
        );
        return (
          <div className="admin-panel">
            <div className="admin-outreach-runs-head">
              <h3>User &amp; prediction insights</h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={reloadInsights} disabled={insightsBusy}>
                <RefreshCw size={11} className={insightsBusy ? 'spin' : ''} /> Refresh
              </button>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Demographics from the user base + the wisdom of the crowd from everyone’s <strong>Global League</strong> bracket. Read-only.
            </p>

            {!data && <div className="admin-empty">Loading insights…</div>}
            {data?.error && <div className="admin-empty" style={{ color: '#ef4444' }}>Error: {data.error}</div>}
            {data && !data.error && (
              <>
                <div className="ins-cards">
                  <div className="ins-card"><div className="ins-card-val">{(data.totals.totalUsers || 0).toLocaleString()}</div><div className="ins-card-label">Total users</div></div>
                  <div className="ins-card"><div className="ins-card-val">{(data.totals.started || 0).toLocaleString()}</div><div className="ins-card-label">Started a bracket</div></div>
                  <div className="ins-card"><div className="ins-card-val">{(data.totals.completedGlobal || 0).toLocaleString()}</div><div className="ins-card-label">Completed · Global</div></div>
                  <div className="ins-card"><div className="ins-card-val">{pct(data.totals.completedGlobal, data.totals.totalUsers)}%</div><div className="ins-card-label">Completion rate</div></div>
                  <div className="ins-card"><div className="ins-card-val">{(data.totals.newLast7 || 0).toLocaleString()}</div><div className="ins-card-label">New · 7 days</div></div>
                  <div className="ins-card"><div className="ins-card-val">{(data.totals.countries || 0).toLocaleString()}</div><div className="ins-card-label">Countries</div></div>
                </div>

                <div className="ins-grid">
                  {block('🏆 Predicted Champion', `${data.champions?.total || 0} picks`, data.champions, (it) => teamFlag(it.name), (it) => it.name, 'No champion picks yet.')}
                  {block('🥈 Predicted Runner-up', `${data.runnersUp?.total || 0} picks`, data.runnersUp, (it) => teamFlag(it.name), (it) => it.name, 'No runner-up picks yet.')}
                  {block('🎟️ Most-backed Best Thirds', `${data.bestThirds?.total || 0} picks`, data.bestThirds, (it) => teamFlag(it.name), (it) => it.name, 'No best-third picks yet.')}
                  {block('🌍 Top Countries', `${data.countries?.total || 0} users`, data.countries, (it) => countryByCode[it.code]?.flag || '🏳️', (it) => countryByCode[it.code]?.name || it.code, 'No country data yet.')}
                </div>

                {/* Anonymous starters — made picks but never signed up (item C) */}
                {(() => {
                  const a = data.anonStarters || { total: 0, completed: 0, groupsOnly: 0, withCountry: 0, countries: { total: 0, top: [] } };
                  const anonLabel = (it) => it.code === 'unknown' ? 'Unknown (no IP geo)' : (countryByCode[it.code]?.name || it.code);
                  const anonFlag = (it) => it.code === 'unknown' ? '🏳️' : (countryByCode[it.code]?.flag || '🏳️');
                  return (
                    <div className="ins-anon">
                      <div className="ins-block-title" style={{ marginBottom: 8 }}>
                        👤 Anonymous starters <span className="ins-block-sub">made picks, not signed up</span>
                      </div>
                      <div className="ins-cards">
                        <div className="ins-card"><div className="ins-card-val">{(a.total || 0).toLocaleString()}</div><div className="ins-card-label">Started · not signed up</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(a.completed || 0).toLocaleString()}</div><div className="ins-card-label">Filled full bracket</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(a.groupsOnly || 0).toLocaleString()}</div><div className="ins-card-label">Partial (no champion)</div></div>
                        <div className="ins-card"><div className="ins-card-val">{pct(a.completed, a.total)}%</div><div className="ins-card-label">Bracket-fill rate</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(a.withCountry || 0).toLocaleString()}</div><div className="ins-card-label">With known country</div></div>
                      </div>
                      <div className="ins-block" style={{ marginTop: 4 }}>
                        <div className="ins-block-title">🌍 Anonymous starters by country <span className="ins-block-sub">via IP geo</span></div>
                        {(!a.countries || a.countries.top.length === 0)
                          ? <div className="admin-empty">No anonymous starters yet. Country fills in as logged-out visitors make picks (blank on localhost).</div>
                          : renderBars(a.countries.top, a.countries.total, anonFlag, anonLabel)}
                      </div>
                    </div>
                  );
                })()}

                {/* Identical brackets: Global vs non-global leagues */}
                {(() => {
                  const ib = data.identicalBrackets || { users: 0, pairs: 0, privatePairs: 0, publicPairs: 0, usersWithNonGlobal: 0 };
                  return (
                    <div className="ins-anon">
                      <div className="ins-block-title" style={{ marginBottom: 8 }}>
                        🧬 Identical brackets <span className="ins-block-sub">same picks in Global &amp; another league</span>
                      </div>
                      <div className="ins-cards">
                        <div className="ins-card"><div className="ins-card-val">{(ib.users || 0).toLocaleString()}</div><div className="ins-card-label">People · Global = a league</div></div>
                        <div className="ins-card"><div className="ins-card-val">{pct(ib.users, ib.usersWithNonGlobal)}%</div><div className="ins-card-label">of users in a 2nd league</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(ib.privatePairs || 0).toLocaleString()}</div><div className="ins-card-label">Private-league matches</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(ib.publicPairs || 0).toLocaleString()}</div><div className="ins-card-label">Public-league matches</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(ib.usersWithNonGlobal || 0).toLocaleString()}</div><div className="ins-card-label">In a non-Global league</div></div>
                      </div>
                      <p className="form-hint" style={{ marginTop: 0 }}>
                        Counts users whose Global bracket exactly matches their bracket in at least one private/public league (copied Global picks, left unchanged). “Matches” counts each identical (user, league) pair. Only non-empty brackets compared.
                      </p>
                    </div>
                  );
                })()}

                {/* Cross-user duplicate brackets in Global → guaranteed same score */}
                {(() => {
                  const gd = data.globalDuplicates || { dupUsers: 0, dupClusters: 0, dupUsersComplete: 0, largestCluster: 0, globalWithPicks: 0, topClusters: [] };
                  return (
                    <div className="ins-anon">
                      <div className="ins-block-title" style={{ marginBottom: 8 }}>
                        🟰 Duplicate brackets in Global <span className="ins-block-sub">different users, identical picks → same score</span>
                      </div>
                      <div className="ins-cards">
                        <div className="ins-card"><div className="ins-card-val">{(gd.dupUsers || 0).toLocaleString()}</div><div className="ins-card-label">Users sharing a bracket</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(gd.dupClusters || 0).toLocaleString()}</div><div className="ins-card-label">Identical-bracket groups</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(gd.largestCluster || 0).toLocaleString()}</div><div className="ins-card-label">Largest group</div></div>
                        <div className="ins-card"><div className="ins-card-val">{(gd.dupUsersComplete || 0).toLocaleString()}</div><div className="ins-card-label">Of those · full bracket</div></div>
                        <div className="ins-card"><div className="ins-card-val">{pct(gd.dupUsers, gd.globalWithPicks)}%</div><div className="ins-card-label">of Global predictors</div></div>
                      </div>
                      {Array.isArray(gd.topClusters) && gd.topClusters.length > 0 && (
                        <p className="form-hint" style={{ marginTop: 0 }}>
                          Biggest identical-bracket groups: {gd.topClusters.map((n, i) => `${n}${i < gd.topClusters.length - 1 ? '' : ''}`).join(' · ')} users.
                          Anyone in a group is locked to the exact same score as the others, so they’ll tie on points (the leaderboard breaks ties by earliest submission, then name). Different brackets can still tie depending on results — that’s outcome-dependent.
                        </p>
                      )}
                      {(!gd.topClusters || gd.topClusters.length === 0) && (
                        <p className="form-hint" style={{ marginTop: 0 }}>No two users currently share an identical Global bracket — no guaranteed point ties yet.</p>
                      )}
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        );
      })()}

      {/* ═══════ TAB: BRACKET HEALTH (superadmin) ═══════ */}
      {tab === 'bracketHealth' && (
        <div className="admin-panel">
          <div className="admin-outreach-runs" style={{ marginBottom: '1.5rem' }}>
            <div className="admin-outreach-runs-head">
              <h3>Populate leagues from members’ Global picks</h3>
              <span style={{ display: 'inline-flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost btn-xs" onClick={() => runSweep(true)} disabled={sweepBusy}>
                  {sweepBusy ? <RefreshCw size={11} className="spin" /> : null} Preview (dry run)
                </button>
                <button type="button" className="btn btn-primary btn-xs" onClick={() => runSweep(false)} disabled={sweepBusy || !sweepResult}>
                  Apply
                </button>
              </span>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              One-time sweep: copies each member’s Global bracket into every Quick Picks league they’re in — only where they have a Global bracket AND no picks in that league yet. Fixes members who joined a private league but never copied their picks in (they show “—”). Idempotent; run <strong>Preview</strong> first, then <strong>Apply</strong>.
            </p>
            {sweepResult && (
              <div className="form-hint" style={{ marginTop: 8 }}>
                {sweepResult.dryRun ? '🔍 Dry run — nothing written yet. ' : '✓ Applied. '}
                <strong>{sweepResult.copiedCount}</strong> bracket(s) {sweepResult.dryRun ? 'would be' : 'were'} copied across {sweepResult.leaguesProcessed} league(s).
                {' '}Skipped: {sweepResult.skipped?.hasPicks || 0} already have league picks, {sweepResult.skipped?.noGlobalPicks || 0} have no Global bracket
                {sweepResult.skipped?.stageLocked ? `, ${sweepResult.skipped.stageLocked} stage-locked` : ''}
                {sweepResult.skipped?.errors ? `, ${sweepResult.skipped.errors} errors` : ''}.
                {Array.isArray(sweepResult.truncatedLeagues) && sweepResult.truncatedLeagues.length > 0 && (
                  <span style={{ color: 'var(--danger)', display: 'block', marginTop: 4 }}>
                    ⚠ {sweepResult.truncatedLeagues.length} league(s) over 5000 members were capped: {sweepResult.truncatedLeagues.map(l => `${l.name} (${l.total})`).join(', ')}. Some members were not covered.
                  </span>
                )}
              </div>
            )}
          </div>

          <div className="admin-outreach-runs">
            <div className="admin-outreach-runs-head">
              <h3>Bracket health — finished but not submitted</h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={reloadBracketHealth} disabled={bracketHealthBusy}>
                <RefreshCw size={11} className={bracketHealthBusy ? 'spin' : ''} /> Refresh
              </button>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Quick Picks docs whose bracket is complete (a Final winner is picked) but whose stored <code>isComplete</code> flag is not <code>true</code> — i.e. a finished bracket that still shows as “not submitted”. The save path is now server-authoritative so this list should stay empty going forward; use <strong>Mark submitted</strong> to repair any legacy rows.
            </p>

            {bracketHealth === null && <div className="admin-empty">Loading…</div>}
            {bracketHealth?.error && <div className="admin-empty" style={{ color: '#ef4444' }}>Error: {bracketHealth.error}</div>}
            {bracketHealth && !bracketHealth.error && bracketHealth.total === 0 && (
              <div className="admin-empty">✓ All clear — no finished brackets are stuck unsubmitted.</div>
            )}
            {bracketHealth && bracketHealth.total > 0 && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '0 0 12px' }}>
                  <strong>{bracketHealth.total}</strong> affected bracket{bracketHealth.total === 1 ? '' : 's'}
                  {Array.isArray(bracketHealth.byLeague) && bracketHealth.byLeague.length > 0 && (
                    <span style={{ color: 'var(--text-sec)', fontSize: '0.85rem' }}>
                      ({bracketHealth.byLeague.map(l => `${l.leagueName}: ${l.count}`).join(' · ')})
                    </span>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-xs"
                    onClick={() => handleRepairBracket({ all: true })}
                    disabled={!!repairingDoc}
                    style={{ marginLeft: 'auto' }}
                  >
                    {repairingDoc === 'all' ? <><RefreshCw size={11} className="spin" /> Repairing…</> : <>Mark all {bracketHealth.total} submitted</>}
                  </button>
                </div>
                <table className="admin-outreach-runs-table">
                  <thead>
                    <tr>
                      <th>User</th>
                      <th>League</th>
                      <th>Picks left</th>
                      <th>Last updated</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {bracketHealth.rows.map((r) => (
                      <tr key={r.docId}>
                        <td title={r.userId}>{r.displayName || r.userId}</td>
                        <td title={r.leagueId}>{r.leagueName || r.leagueId}</td>
                        <td>{r.picksLeft}</td>
                        <td title={r.updatedAtMs ? new Date(r.updatedAtMs).toString() : ''}>
                          {r.updatedAtMs ? new Date(r.updatedAtMs).toLocaleString() : '—'}
                        </td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-secondary btn-xs"
                            onClick={() => handleRepairBracket({ docId: r.docId })}
                            disabled={!!repairingDoc}
                          >
                            {repairingDoc === r.docId ? <RefreshCw size={11} className="spin" /> : 'Mark submitted'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>
      )}

      {/* ═══════ TAB: FUNNEL HEALTH (superadmin) ═══════ */}
      {tab === 'funnelHealth' && (() => {
        const fh = funnelHealth;
        const days = fh?.days || [];
        const today = days[0] || null;
        const mig = today?.migration || {};
        const auth = today?.authCustomToken || {};
        const totals = fh?.totals || null;
        const fmtDay = (iso) => {
          if (!iso) return '—';
          const d = new Date(iso + 'T12:00:00Z');
          return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
        };
        const codeRows = Object.entries(auth.byCode || {}).sort((a, b) => b[1] - a[1]);
        return (
          <div className="admin-panel">
            <div className="admin-outreach-runs-head">
              <h3>Funnel health <span style={{ fontWeight: 400, opacity: 0.6 }}>· no-login conversion</span></h3>
              <button type="button" className="btn btn-ghost btn-xs" onClick={reloadFunnelHealth} disabled={funnelHealthBusy}>
                <RefreshCw size={11} className={funnelHealthBusy ? 'spin' : ''} /> Refresh
              </button>
            </div>
            <p className="form-hint" style={{ marginTop: 0 }}>
              Monitors the anonymous → sign-up path: did pre-signup picks migrate to the new
              account, and are custom-token sign-ins erroring? Daily counters (UTC), last 7 days.
            </p>

            {!fh && <div className="admin-empty">Loading funnel health…</div>}
            {fh?.error && <div className="admin-empty" style={{ color: '#ef4444' }}>Error: {fh.error}</div>}

            {fh && !fh.error && (
              <>
                {/* Status banner */}
                <div className={`fh-status fh-status-${fh.status === 'watch' ? 'watch' : 'ok'}`}>
                  <span className="fh-status-dot" aria-hidden="true" />
                  <div>
                    <div className="fh-status-title">
                      {fh.status === 'watch' ? 'Worth a look' : 'All clear'}
                    </div>
                    {fh.status === 'watch'
                      ? <ul className="fh-status-reasons">{(fh.reasons || []).map((r, i) => <li key={i}>{r}</li>)}</ul>
                      : <div className="fh-status-sub">No migration errors and custom-token errors under threshold today.</div>}
                  </div>
                </div>

                {/* Today's headline metrics */}
                <div className="fh-section-label">Today ({fmtDay(today?.date)})</div>
                <div className="ins-cards">
                  <div className="ins-card"><div className="ins-card-val">{mig.migrated || 0}</div><div className="ins-card-label">Picks migrated ✓</div></div>
                  <div className="ins-card"><div className="ins-card-val">{mig.target_has_picks || 0}</div><div className="ins-card-label">Not applied · existing acct</div></div>
                  <div className="ins-card"><div className={`ins-card-val${(mig.error || 0) > 0 ? ' fh-bad' : ''}`}>{mig.error || 0}</div><div className="ins-card-label">Migration errors</div></div>
                  <div className="ins-card" title="Users who couldn't sign in after all retries"><div className={`ins-card-val${(auth.total || 0) >= 10 ? ' fh-bad' : ''}`}>{auth.total || 0}</div><div className="ins-card-label">Sign-in failures</div></div>
                  <div className="ins-card" title="Sign-in attempts that failed once but recovered on retry — flaky networks, not blocked users"><div className="ins-card-val" style={{ opacity: 0.7 }}>{auth.transient || 0}</div><div className="ins-card-label">Transient retries</div></div>
                  <div className="ins-card"><div className="ins-card-val">{mig.no_anon_picks || 0}</div><div className="ins-card-label">Signup · no anon picks</div></div>
                </div>

                {/* Today's auth-error breakdown by Firebase code */}
                {codeRows.length > 0 && (
                  <>
                    <div className="fh-section-label">Today’s sign-in failures by code</div>
                    <div className="fh-codes">
                      {codeRows.map(([code, n]) => (
                        <div className="fh-code-row" key={code}>
                          <code className="fh-code">{code}</code>
                          <span className="fh-code-n">{n}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}

                {/* 7-day table */}
                <div className="fh-section-label">Last 7 days</div>
                <div className="fh-table-wrap">
                  <table className="admin-outreach-runs-table fh-table">
                    <thead>
                      <tr>
                        <th>Day</th>
                        <th title="Anon picks migrated to a new account">Migrated</th>
                        <th title="Returning user signed into an account that already had a bracket — new anon picks not applied">Not applied</th>
                        <th title="Signed up without making picks first">No picks</th>
                        <th title="Exceptions during migration">Mig. err</th>
                        <th title="Terminal sign-in failures (after all retries)">Sign-in fail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d) => (
                        <tr key={d.date}>
                          <td>{fmtDay(d.date)}</td>
                          <td>{d.migration?.migrated || 0}</td>
                          <td>{d.migration?.target_has_picks || 0}</td>
                          <td>{d.migration?.no_anon_picks || 0}</td>
                          <td className={(d.migration?.error || 0) > 0 ? 'fh-bad' : ''}>{d.migration?.error || 0}</td>
                          <td className={(d.authCustomToken?.total || 0) >= 10 ? 'fh-bad' : ''}>{d.authCustomToken?.total || 0}</td>
                        </tr>
                      ))}
                    </tbody>
                    {totals && (
                      <tfoot>
                        <tr>
                          <td>7-day total</td>
                          <td>{totals.migration?.migrated || 0}</td>
                          <td>{totals.migration?.target_has_picks || 0}</td>
                          <td>{totals.migration?.no_anon_picks || 0}</td>
                          <td className={(totals.migration?.error || 0) > 0 ? 'fh-bad' : ''}>{totals.migration?.error || 0}</td>
                          <td className={(totals.authCustomToken?.total || 0) > 0 ? '' : ''}>{totals.authCustomToken?.total || 0}</td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                <p className="form-hint">
                  “Not applied” is an expected edge case (a returning user signing into an account
                  that already has a bracket) — surfaced for visibility, it doesn’t raise the status.
                  “Sign-in failures” count only users blocked after all 3 retries (transient retries
                  that recover are tracked separately and don’t alarm). “Migration errors” and a
                  spike in sign-in failures raise the status.
                </p>
              </>
            )}
          </div>
        );
      })()}

      {/* ═══════ TAB: SETTINGS ═══════ */}
      {tab === 'settings' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Settings</h2>
              <p className="admin-panel-desc">Feature toggles, platform configuration, and environment status</p>
            </div>
          </div>

          {/* ── Daily leaderboard-movement emails ── */}
          {isSuperadmin && (
            <div className="rde-card">
              <div className="rde-head">
                <h3 className="admin-section-title" style={{ margin: 0 }}>📣 Leaderboard movement emails</h3>
                {rankCfg && (
                  <span className={`rde-status ${rankCfg.enabled ? 'on' : 'off'}`}>{rankCfg.enabled ? 'ON' : 'OFF'}</span>
                )}
              </div>
              <p className="form-hint" style={{ marginTop: 0 }}>
                After each day’s games, email Global-League players who climbed ≥{rankCfg?.upThreshold ?? 20} or dropped ≥{rankCfg?.downThreshold ?? 30} places. You get a preview + recipient count 2 hours before each send, and nothing sends unless this is ON.
              </p>
              {!rankCfg ? <div className="admin-empty">Loading…</div> : (
                <>
                  <div className="rde-grid">
                    <label className="rde-field rde-toggle">
                      <input type="checkbox" checked={!!rankCfg.enabled} onChange={(e) => setRankField('enabled', e.target.checked)} />
                      <span>Enabled (master switch)</span>
                    </label>
                    <label className="rde-field rde-toggle">
                      <input type="checkbox" checked={!!rankCfg.skipNext} onChange={(e) => setRankField('skipNext', e.target.checked)} />
                      <span>Skip the next send</span>
                    </label>
                    <label className="rde-field">
                      <span className="rde-label">Send hour (UTC, 0–23)</span>
                      <input type="number" min="0" max="23" value={rankCfg.sendHourUtc ?? 13} onChange={(e) => setRankField('sendHourUtc', e.target.value)} />
                      <span className="rde-sub">Preview goes out 2h before. Set this ~2h after the day’s last game.</span>
                    </label>
                    <div />
                    <label className="rde-field">
                      <span className="rde-label">Up threshold (places climbed)</span>
                      <input type="number" min="1" max="500" value={rankCfg.upThreshold ?? 20} onChange={(e) => setRankField('upThreshold', e.target.value)} />
                    </label>
                    <label className="rde-field">
                      <span className="rde-label">Down threshold (places dropped)</span>
                      <input type="number" min="1" max="500" value={rankCfg.downThreshold ?? 30} onChange={(e) => setRankField('downThreshold', e.target.value)} />
                    </label>
                    <label className="rde-field">
                      <span className="rde-label">Subject — climbed (blank = default)</span>
                      <input type="text" maxLength={160} placeholder="🚀 You climbed N spots on the World Cup leaderboard!" value={rankCfg.subjectUp || ''} onChange={(e) => setRankField('subjectUp', e.target.value)} />
                    </label>
                    <label className="rde-field">
                      <span className="rde-label">Subject — dropped (blank = default)</span>
                      <input type="text" maxLength={160} placeholder="📊 Your World Cup leaderboard update" value={rankCfg.subjectDown || ''} onChange={(e) => setRankField('subjectDown', e.target.value)} />
                    </label>
                    <label className="rde-field rde-wide">
                      <span className="rde-label">Intro note — climbed (blank = default, keep it fun)</span>
                      <textarea rows={2} maxLength={600} placeholder="Big moves on the pitch, big moves on the table…" value={rankCfg.introUp || ''} onChange={(e) => setRankField('introUp', e.target.value)} />
                    </label>
                    <label className="rde-field rde-wide">
                      <span className="rde-label">Intro note — dropped (blank = default)</span>
                      <textarea rows={2} maxLength={600} placeholder="Today's results shook things up…" value={rankCfg.introDown || ''} onChange={(e) => setRankField('introDown', e.target.value)} />
                    </label>
                  </div>

                  <div className="rde-actions">
                    <button type="button" className="btn btn-primary btn-sm" onClick={saveRankCfg} disabled={rankCfgBusy}>
                      {rankCfgBusy ? 'Saving…' : 'Save config'}
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={sendRankPreview} disabled={rankCfgBusy}>
                      <Send size={13} /> Send me a preview now
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={seedBaseline} disabled={rankCfgBusy}>
                      Seed baseline from yesterday
                    </button>
                    {rankPreviewMsg && (
                      <span className={`rde-msg ${rankPreviewMsg.ok ? 'ok' : 'err'}`}>{rankPreviewMsg.text}</span>
                    )}
                  </div>

                  {(rankCfg.pendingPreview || rankCfg.lastSendCounts) && (
                    <div className="rde-runs">
                      {rankCfg.pendingPreview && (
                        <div className="rde-run">
                          <strong>Pending preview</strong> — {rankCfg.pendingPreview.total} recipient{rankCfg.pendingPreview.total === 1 ? '' : 's'} ({rankCfg.pendingPreview.upCount}↑ {rankCfg.pendingPreview.downCount}↓), sends {String(rankCfg.pendingPreview.sendHourUtc).padStart(2, '0')}:00 UTC.
                          {Array.isArray(rankCfg.pendingPreview.topMovers) && rankCfg.pendingPreview.topMovers.length > 0 && (
                            <div className="rde-movers">
                              {rankCfg.pendingPreview.topMovers.slice(0, 12).map((m, i) => (
                                <span key={i} className={`rde-mover ${m.direction}`}>{m.direction === 'up' ? '▲' : '▼'}{m.places} {m.name} <span className="rde-mover-rank">#{m.newRank}</span></span>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      {rankCfg.lastSendCounts && (
                        <div className="rde-run">
                          <strong>Last send</strong> — {rankCfg.lastSendCounts.total} email{rankCfg.lastSendCounts.total === 1 ? '' : 's'} ({rankCfg.lastSendCounts.up}↑ {rankCfg.lastSendCounts.down}↓){rankCfg.lastSendDate ? ` · ${rankCfg.lastSendDate}` : ''}.
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <h3 className="admin-section-title">Feature flags</h3>
          <div className="admin-flag-card">
            <div className="admin-flag-row">
              <div className="admin-flag-text">
                <strong>Bracket league</strong>
                <span>Group rankings + best thirds + knockout bracket. The fast on-ramp for new users.</span>
              </div>
              <button
                type="button"
                className={`admin-flag-switch ${featureFlags.quickPicksEnabled !== false ? 'is-on' : 'is-off'}`}
                onClick={() => toggleFeatureFlag('quickPicksEnabled')}
                disabled={flagBusy === 'quickPicksEnabled'}
                aria-pressed={featureFlags.quickPicksEnabled !== false}
                aria-label="Toggle Bracket league"
              >
                <span className="admin-flag-switch-knob" />
                <span className="admin-flag-switch-label">{featureFlags.quickPicksEnabled !== false ? 'ON' : 'OFF'}</span>
              </button>
            </div>
            <div className="admin-flag-row">
              <div className="admin-flag-text">
                <strong>Classic Predictions league</strong>
                <span>Score + result for every fixture. Heavier prediction model — turn off to hide the entire Classic UX from users while keeping all data + code intact.</span>
              </div>
              <button
                type="button"
                className={`admin-flag-switch ${featureFlags.classicEnabled !== false ? 'is-on' : 'is-off'}`}
                onClick={() => toggleFeatureFlag('classicEnabled')}
                disabled={flagBusy === 'classicEnabled'}
                aria-pressed={featureFlags.classicEnabled !== false}
                aria-label="Toggle Classic Predictions league"
              >
                <span className="admin-flag-switch-knob" />
                <span className="admin-flag-switch-label">{featureFlags.classicEnabled !== false ? 'ON' : 'OFF'}</span>
              </button>
            </div>
            <div className="admin-flag-row">
              <div className="admin-flag-text">
                <strong>User-created Prize Leagues</strong>
                <span>Off by default. When enabled, users can create private leagues with an entry fee + payout split. Disabling hides the &ldquo;Prize League&rdquo; option in the create flow and the &ldquo;PAID&rdquo; badges; existing prize leagues (if any) gracefully degrade to standard private leagues until re-enabled. Toggling prompts for an optional reason logged to the audit trail.</span>
              </div>
              <button
                type="button"
                className={`admin-flag-switch ${isFlagOn('enablePrizeLeagues') ? 'is-on' : 'is-off'}`}
                onClick={() => toggleFeatureFlag('enablePrizeLeagues')}
                disabled={flagBusy === 'enablePrizeLeagues'}
                aria-pressed={isFlagOn('enablePrizeLeagues')}
                aria-label="Toggle Prize Leagues"
              >
                <span className="admin-flag-switch-knob" />
                <span className="admin-flag-switch-label">{isFlagOn('enablePrizeLeagues') ? 'ON' : 'OFF'}</span>
              </button>
            </div>
            <div className="admin-flag-row">
              <div className="admin-flag-text">
                <strong>Knockout real-team reseed</strong>
                <span>Off by default. When ON, the bracket wizard shows the REAL advancing teams (per group as they finish) instead of each user&rsquo;s predicted teams, and restricts each user to advancing only teams they correctly predicted to reach the knockouts (others are locked). Scoring is unchanged (per-fixture). Turn ON in the window after the group stage finishes and before the Round of 32 locks; keep it ON once enabled. Reason is logged to the audit trail.</span>
              </div>
              <button
                type="button"
                className={`admin-flag-switch ${isFlagOn('knockoutRealReseed') ? 'is-on' : 'is-off'}`}
                onClick={() => toggleFeatureFlag('knockoutRealReseed')}
                disabled={flagBusy === 'knockoutRealReseed'}
                aria-pressed={isFlagOn('knockoutRealReseed')}
                aria-label="Toggle knockout real-team reseed"
              >
                <span className="admin-flag-switch-knob" />
                <span className="admin-flag-switch-label">{isFlagOn('knockoutRealReseed') ? 'ON' : 'OFF'}</span>
              </button>
            </div>
            <p className="admin-flag-note">
              Toggles propagate to every connected client within ~60 seconds via the live
              feature-flags subscription. Existing predictions and league data are untouched
              when a mode is turned off — they&rsquo;re just hidden from the UI. Feature-flag
              changes are restricted to superadmins.
            </p>
          </div>

          {(flagAuditLog.length > 0 || flagAuditError) && (
            <>
              <h3 className="admin-section-title" style={{ marginTop: '1.5rem' }}>Recent flag changes</h3>
              <div className="admin-audit-card">
                {flagAuditError ? (
                  <p className="admin-flag-note" style={{ color: 'var(--danger, #c44)' }}>{flagAuditError}</p>
                ) : (
                  <ul className="admin-audit-list">
                    {flagAuditLog.map((e) => (
                      <li key={e.id} className="admin-audit-item">
                        <div className="admin-audit-line">
                          <strong>{flagLabels[e.flag] || e.flag}</strong>
                          <span className="admin-audit-arrow">
                            {String(e.previousValue)} <span aria-hidden="true">→</span> <strong>{String(e.value)}</strong>
                          </span>
                        </div>
                        <div className="admin-audit-meta">
                          {e.actorName} · {e.timestamp ? new Date(e.timestamp).toLocaleString() : 'unknown time'}
                        </div>
                        {e.reason && <div className="admin-audit-reason">&ldquo;{e.reason}&rdquo;</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          <h3 className="admin-section-title">Platform configuration</h3>
          <div className="admin-contract-card">
            <div className="admin-contract-row"><span className="admin-contract-lbl">Prediction Lock</span><span className="admin-contract-val">5 min before kickoff</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Default Points — Result</span><span className="admin-contract-val">3 pts</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Default Points — Exact Score</span><span className="admin-contract-val">5 pts</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Default Points — Extra Time</span><span className="admin-contract-val">1 pt</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Default Points — Penalties</span><span className="admin-contract-val">2 pts</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Prize Distribution</span><span className="admin-contract-val">50% / 30% / 20%</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Platform Fee</span><span className="admin-contract-val" style={{color:'var(--success)'}}>0% (non-custodial)</span></div>
          </div>

          <h3 className="admin-section-title">Environment Variables</h3>
          <div className="admin-contract-card">
            <div className="admin-contract-row"><span className="admin-contract-lbl">FOOTBALL_DATA_API_KEY</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">ORACLE_PRIVATE_KEY_1</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">ORACLE_PRIVATE_KEY_2</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">FIREBASE_SERVICE_ACCOUNT</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">RESEND_API_KEY</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">GOOGLE_OAUTH_CLIENT_ID</span><span className="admin-env-check">Set in Vercel env</span></div>
          </div>

          <div className="admin-oracle-info" style={{marginTop:'1rem'}}>
            <AlertTriangle size={14} />
            <span>Environment variable status cannot be checked from the client. Verify in Vercel Dashboard → Settings → Environment Variables.</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;