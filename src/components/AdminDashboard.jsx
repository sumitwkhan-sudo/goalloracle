import React, { useState, useEffect, useMemo } from 'react';
import { Shield, Users, Trophy, Coins, RefreshCw, ChevronRight, Search, Trash2, AlertTriangle, CheckCircle, ExternalLink, Eye, EyeOff, Wifi, WifiOff, Clock, Zap, Pencil, Check, X, Wallet } from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import { updateMatchResult, getAllUsers, setUserRole, adminDeleteLeague, adminRenameLeague, adminBackfillCountries, adminAssignWallet, adminSetFeatureFlag, checkOracleHealth, adminRunOracleSmokeTest, adminRunAutoPoll, adminRunDailyReport, adminRunReminderCron, adminClearAntiSybil, adminGetAntiSybilBypassList, adminSetAntiSybilBypassList, DEFAULT_FEATURE_FLAGS } from '../utils/db';

function _countryFlagFromCode(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const A = 0x1F1E6;
  const base = 'A'.charCodeAt(0);
  const cc = code.toUpperCase();
  return String.fromCodePoint(A + (cc.charCodeAt(0) - base), A + (cc.charCodeAt(1) - base));
}

const AdminDashboard = ({ userData, platformStats, matchResults, allLeagues, notify, featureFlags = DEFAULT_FEATURE_FLAGS }) => {
  const [tab, setTab] = useState('results');
  const [users, setUsers] = useState([]);
  const [selMatch, setSelMatch] = useState(null);
  const [form, setForm] = useState({ homeScore: '', awayScore: '', extraTime: false, penalties: false });
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [matchFilter, setMatchFilter] = useState('pending'); // pending | verified | all
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
   // a successful write.
  const [flagBusy, setFlagBusy] = useState(null);
  const toggleFeatureFlag = async (flag) => {
    setFlagBusy(flag);
    try {
      const next = !(featureFlags[flag] !== false);
      await adminSetFeatureFlag(flag, next);
      notify(`${flag === 'classicEnabled' ? 'Classic Predictions' : 'Bracket'} ${next ? 'enabled' : 'disabled'}`);
    } catch (e) {
      notify('Toggle failed: ' + e.message, 'error');
    } finally {
      setFlagBusy(null);
    }
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
    if (tab === 'users') getAllUsers().then(setUsers).catch(e => { console.error(e); notify('Failed to load users', 'error'); });
    if (tab === 'oracle' && !health && !healthLoading) runHealthCheck();
  }, [tab]);

  const handleSaveResult = async () => {
    if (!selMatch || form.homeScore === '' || form.awayScore === '') return;
    setSaving(true);
    try {
      await updateMatchResult(selMatch.id, {
        homeScore: parseInt(form.homeScore),
        awayScore: parseInt(form.awayScore),
        extraTime: form.extraTime,
        penalties: form.penalties,
      }, userData.id);
      notify(`Result saved: ${selMatch.home} ${form.homeScore}–${form.awayScore} ${selMatch.away}`);
      setSelMatch(null);
      setForm({ homeScore: '', awayScore: '', extraTime: false, penalties: false });
    } catch (e) { notify('Failed to save: ' + e.message, 'error'); }
    finally { setSaving(false); }
  };

  const handleDeleteLeague = async (leagueId, name) => {
    if (leagueId === 'global') { notify('Cannot delete the global league', 'error'); return; }
    setDeleting(leagueId);
    try {
      await adminDeleteLeague(leagueId);
      notify(`Deleted league: ${name}`);
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

  // Stats
  const verifiedCount = Object.values(matchResults).filter(r => r.completed).length;
  const totalMatches = WORLD_CUP_MATCHES.length;
  const paidLeagues = (allLeagues || []).filter(l => l.type === 'paid').length;
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

  // Filtered users
  const filteredUsers = users.filter(u => {
    if (!userSearch) return true;
    const s = userSearch.toLowerCase();
    return (u.displayName || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s) || u.id.toLowerCase().includes(s);
  });

  const tabs = [
    { id: 'results', icon: '⚽', label: 'Match Results', count: `${verifiedCount}/${totalMatches}` },
    { id: 'users', icon: '👥', label: 'Users', count: String(platformStats.totalPlayers || 0) },
    { id: 'leagues', icon: '🏆', label: 'Leagues', count: String(platformStats.activeLeagues || 0) },
    { id: 'oracle', icon: '🔮', label: 'Oracle Status' },
    { id: 'contract', icon: '📜', label: 'Smart Contract' },
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
          <span className="admin-stat-sub">{paidLeagues} paid · {freeLeagues} free</span>
        </div>
        <div className="admin-stat-card">
          <span className="admin-stat-lbl">Prize Pools</span>
          <span className="admin-stat-num" style={{color: 'var(--lime)'}}>${(platformStats.totalPrizePools || 0).toLocaleString()}</span>
          <span className="admin-stat-sub">USDC on Polygon</span>
        </div>
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

          <div className="admin-card-list admin-scroll">
            {filteredMatches.length === 0 && <div className="admin-empty">No matches found for this filter.</div>}
            {filteredMatches.map(m => {
              const r = matchResults[m.id];
              const isSelected = selMatch?.id === m.id;
              return (
                <div key={m.id}>
                  <div className={`admin-list-card ${r?.completed ? 'verified' : ''} ${isSelected ? 'selected' : ''}`} onClick={() => {
                    if (r?.completed) return;
                    setSelMatch(isSelected ? null : m);
                    setForm({ homeScore: '', awayScore: '', extraTime: false, penalties: false });
                  }}>
                    <div className="admin-list-left">
                      <span className="admin-match-flags">{m.homeFlag} {m.awayFlag}</span>
                      <div>
                        <div className="admin-match-teams">{m.home} vs {m.away}</div>
                        <div className="admin-match-meta">{m.stage} · {fmtDate(m.date)} · {m.city}</div>
                      </div>
                    </div>
                    <div className="admin-list-right">
                      {r?.completed ? (
                        <>
                          <span className="admin-score-verified">{r.homeScore} — {r.awayScore}{r.extraTime ? ' AET' : ''}{r.penalties ? ' PEN' : ''}</span>
                          <span className="admin-verified-tag"><CheckCircle size={11} /> VERIFIED</span>
                        </>
                      ) : (
                        <>
                          <span className="admin-pending-tag">PENDING</span>
                          <button type="button" className="btn btn-sm admin-enter-btn" onClick={e => { e.stopPropagation(); setSelMatch(isSelected ? null : m); setForm({ homeScore: '', awayScore: '', extraTime: false, penalties: false }); }}>
                            {isSelected ? 'Close' : 'Enter Result'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                  {/* Expanded inline form */}
                  {isSelected && !r?.completed && (
                    <div className="admin-result-form">
                      <h3>{m.homeFlag} {m.home} vs {m.away} {m.awayFlag} <span className="admin-form-meta">{m.stage} · {fmtDate(m.date)}</span></h3>
                      <div className="admin-score-row">
                        <div className="admin-score-col">
                          <label>{getCode(m.home)}</label>
                          <input type="number" min="0" max="20" className="admin-score-input" value={form.homeScore} onChange={e => setForm({...form, homeScore: e.target.value})} autoFocus />
                        </div>
                        <span className="admin-score-dash">—</span>
                        <div className="admin-score-col">
                          <label>{getCode(m.away)}</label>
                          <input type="number" min="0" max="20" className="admin-score-input" value={form.awayScore} onChange={e => setForm({...form, awayScore: e.target.value})} />
                        </div>
                      </div>
                      {m.isKnockout && (
                        <div className="admin-ko-row">
                          <label className="admin-ko-check"><input type="checkbox" checked={form.extraTime} onChange={e => setForm({...form, extraTime: e.target.checked})} /><span>Extra Time</span></label>
                          <label className="admin-ko-check"><input type="checkbox" checked={form.penalties} onChange={e => setForm({...form, penalties: e.target.checked})} /><span>Penalties</span></label>
                        </div>
                      )}
                      <div className="admin-form-btns">
                        <button type="button" className="btn btn-primary" onClick={handleSaveResult} disabled={saving || form.homeScore === '' || form.awayScore === ''}>
                          {saving ? <><RefreshCw size={14} className="spin" /> Saving...</> : <><CheckCircle size={14} /> Save & Verify Result</>}
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

          <div className="admin-card-list admin-scroll">
            {filteredUsers.length === 0 && <div className="admin-empty">{users.length === 0 ? 'Loading users...' : 'No users match your search.'}</div>}
            {filteredUsers.map(u => {
              const referrals = referralCountById[u.id] || 0;
              const referrer = u.referredBy ? userById[u.referredBy] : null;
              return (
              <div key={u.id} className="admin-list-card">
                <div className="admin-list-left">
                  <div>
                    <div className="admin-user-name">
                      {u.country && <span className="admin-user-flag" title={u.country}>{_countryFlagFromCode(u.country)}</span>}
                      {u.displayName || u.id.slice(0, 12)}
                      {!u.email && <span className="admin-user-noemail" title="No email on file — user can't be reached for reminders">no email</span>}
                      {!u.country && <span className="admin-user-noemail" title="No country on file">no country</span>}
                    </div>
                    {u.email && <div className="admin-user-email">{u.email}</div>}
                    {!u.email && <div className="admin-user-email">{u.id.slice(0, 20)}...</div>}
                    {editingWalletUserId === u.id ? (
                      <div className="admin-wallet-edit-row">
                        <input
                          type="text"
                          className="input-field admin-wallet-input"
                          value={editingWalletValue}
                          onChange={(e) => setEditingWalletValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveWalletAssignment(u);
                            else if (e.key === 'Escape') cancelWalletEdit();
                          }}
                          placeholder="0x... (leave blank to clear)"
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
                      </div>
                    ) : (
                      <div className="admin-wallet-row">
                        <Wallet size={11} style={{opacity:0.6}} />
                        {u.walletAddress ? (
                          <code className="admin-wallet-addr">{u.walletAddress.slice(0, 10)}...{u.walletAddress.slice(-6)}</code>
                        ) : (
                          <span className="admin-wallet-empty">No payout wallet</span>
                        )}
                        <button type="button" className="admin-wallet-edit-btn" onClick={() => startWalletEdit(u)} title="Assign payout wallet">
                          <Pencil size={11} />
                        </button>
                      </div>
                    )}
                    {u.referredBy && (
                      <div className="admin-user-via" title={`referredBy: ${u.referredBy}`}>
                        Joined via {referrer?.displayName || `${u.referredBy.slice(0, 10)}…`}
                      </div>
                    )}
                  </div>
                </div>
                <div className="admin-list-right">
                  {referrals > 0 && (
                    <span className="admin-user-ref-pill" title={`${referrals} new sign-up${referrals === 1 ? '' : 's'} attributed to this user`}>
                      <strong>{referrals}</strong> invited
                    </span>
                  )}
                  <span className={`admin-role-badge ${u.role || 'user'}`}>{(u.role || 'user').toUpperCase()}</span>
                  <select className="admin-select" value={u.role || 'user'} onChange={e => handleRoleChange(u.id, e.target.value)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="superadmin">superadmin</option>
                  </select>
                </div>
              </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══════ TAB: LEAGUES ═══════ */}
      {tab === 'leagues' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Leagues ({(allLeagues || []).length})</h2>
              <p className="admin-panel-desc">View and manage all leagues on the platform</p>
            </div>
          </div>

          <div className="admin-card-list admin-scroll">
            {(allLeagues || []).length === 0 && <div className="admin-empty">No leagues found.</div>}
            {(allLeagues || []).map(l => {
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
                        Created by {l.createdBy?.slice(0, 10) || 'system'} · {l.visibility || 'public'}
                        {l.passcode ? ` · ${l.passcode}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="admin-list-right">
                    <span className={`admin-league-type ${l.type === 'paid' ? 'paid' : 'free'}`}>
                      {l.type === 'paid' ? `PAID · ${l.entryFee} ${l.currency || 'USDC'}` : 'FREE'}
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
      )}

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

      {/* ═══════ TAB: SETTINGS ═══════ */}
      {tab === 'settings' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Settings</h2>
              <p className="admin-panel-desc">Feature toggles, platform configuration, and environment status</p>
            </div>
          </div>

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
            <p className="admin-flag-note">
              Toggles propagate to every connected client within ~60 seconds via the live
              feature-flags subscription. Existing predictions and league data are untouched
              when a mode is turned off — they're just hidden from the UI.
            </p>
          </div>

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