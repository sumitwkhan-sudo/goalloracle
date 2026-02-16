import React, { useState, useEffect } from 'react';
import { Shield, Users, Trophy, Coins, RefreshCw, ChevronRight, Search, Trash2, AlertTriangle, CheckCircle, ExternalLink, Eye, EyeOff } from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import { updateMatchResult, getAllUsers, setUserRole, deleteLeague } from '../utils/db';

const AdminDashboard = ({ userData, platformStats, matchResults, allLeagues, notify }) => {
  const [tab, setTab] = useState('results');
  const [users, setUsers] = useState([]);
  const [selMatch, setSelMatch] = useState(null);
  const [form, setForm] = useState({ homeScore: '', awayScore: '', extraTime: false, penalties: false });
  const [saving, setSaving] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [matchFilter, setMatchFilter] = useState('pending'); // pending | verified | all
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    if (tab === 'users') getAllUsers().then(setUsers).catch(e => { console.error(e); notify('Failed to load users', 'error'); });
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
      await deleteLeague(leagueId);
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
            </div>
          </div>

          <div className="admin-card-list admin-scroll">
            {filteredUsers.length === 0 && <div className="admin-empty">{users.length === 0 ? 'Loading users...' : 'No users match your search.'}</div>}
            {filteredUsers.map(u => (
              <div key={u.id} className="admin-list-card">
                <div className="admin-list-left">
                  <div>
                    <div className="admin-user-name">{u.displayName || u.id.slice(0, 12)}</div>
                    <div className="admin-user-email">{u.email || u.walletAddress?.slice(0, 16) + '...' || u.id}</div>
                  </div>
                </div>
                <div className="admin-list-right">
                  <span className={`admin-role-badge ${u.role || 'user'}`}>{(u.role || 'user').toUpperCase()}</span>
                  <select className="admin-select" value={u.role || 'user'} onChange={e => handleRoleChange(u.id, e.target.value)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                    <option value="superadmin">superadmin</option>
                  </select>
                </div>
              </div>
            ))}
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
            {(allLeagues || []).map(l => (
              <div key={l.id} className="admin-list-card">
                <div className="admin-list-left">
                  <div>
                    <div className="admin-user-name">{l.visibility === 'private' ? '🔒 ' : ''}{l.name || l.id}</div>
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
                  {l.id !== 'global' && (
                    <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDeleteLeague(l.id, l.name)} disabled={deleting === l.id}>
                      {deleting === l.id ? <RefreshCw size={12} className="spin" /> : <Trash2 size={12} />} Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══════ TAB: ORACLE STATUS ═══════ */}
      {tab === 'oracle' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Oracle Status</h2>
              <p className="admin-panel-desc">Dual-source oracle health and configuration</p>
            </div>
          </div>

          <div className="admin-oracle-grid">
            <div className="admin-oracle-card">
              <h3><span style={{color:'var(--cyan)'}}>●</span> Oracle 1 — Football-Data.org</h3>
              <p className="admin-oracle-desc">Free community-trusted API for live scores, fixtures, and standings.</p>
              <a href="https://www.football-data.org" target="_blank" rel="noopener noreferrer" className="admin-oracle-link"><ExternalLink size={11} /> football-data.org</a>
              <div className="admin-oracle-status">
                <span className="admin-oracle-key">FOOTBALL_DATA_API_KEY</span>
                <span className="admin-env-hint">Set in Vercel → Settings → Environment Variables</span>
              </div>
            </div>
            <div className="admin-oracle-card">
              <h3><span style={{color:'var(--amber)'}}>●</span> Oracle 2 — API-Sports</h3>
              <p className="admin-oracle-desc">Comprehensive sports data with 900+ leagues and real-time scores.</p>
              <a href="https://www.api-football.com" target="_blank" rel="noopener noreferrer" className="admin-oracle-link"><ExternalLink size={11} /> api-football.com</a>
              <div className="admin-oracle-status">
                <span className="admin-oracle-key">APISPORTS_API_KEY</span>
                <span className="admin-env-hint">Set in Vercel → Settings → Environment Variables</span>
              </div>
            </div>
          </div>

          <div className="admin-oracle-info">
            <AlertTriangle size={14} />
            <span>Both oracles must return matching scores for a result to be auto-verified. If they disagree, the result enters dispute state for manual review.</span>
          </div>
        </div>
      )}

      {/* ═══════ TAB: SMART CONTRACT ═══════ */}
      {tab === 'contract' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Smart Contract</h2>
              <p className="admin-panel-desc">GoalOracleVerifier.sol deployment status on Polygon</p>
            </div>
          </div>

          <div className="admin-contract-card">
            <div className="admin-contract-row"><span className="admin-contract-lbl">Contract</span><span className="admin-contract-val">GoalOracleVerifier.sol</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Network</span><span className="admin-contract-val">Polygon PoS (Chain 137)</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Address</span><span className="admin-contract-val pending">Not deployed</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Required Confirmations</span><span className="admin-contract-val">2 / 2 oracles</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Dispute Window</span><span className="admin-contract-val">1 hour</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Oracle 1 Wallet</span><span className="admin-contract-val pending">Not registered</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">Oracle 2 Wallet</span><span className="admin-contract-val pending">Not registered</span></div>
          </div>

          <div className="admin-contract-actions">
            <a href="https://github.com/nicholascpark/goaloracle/blob/main/contracts/GoalOracleVerifier.sol" target="_blank" rel="noopener noreferrer" className="btn"><ExternalLink size={13} /> View Source on GitHub</a>
          </div>
        </div>
      )}

      {/* ═══════ TAB: SETTINGS ═══════ */}
      {tab === 'settings' && (
        <div className="admin-panel">
          <div className="admin-panel-head">
            <div>
              <h2>Settings</h2>
              <p className="admin-panel-desc">Platform configuration and environment status</p>
            </div>
          </div>

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
            <div className="admin-contract-row"><span className="admin-contract-lbl">APISPORTS_API_KEY</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">ORACLE_PRIVATE_KEY_1</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">ORACLE_PRIVATE_KEY_2</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">FIREBASE_SERVICE_ACCOUNT</span><span className="admin-env-check">Set in Vercel env</span></div>
            <div className="admin-contract-row"><span className="admin-contract-lbl">PRIVY_APP_SECRET</span><span className="admin-env-check">Set in Vercel env</span></div>
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
