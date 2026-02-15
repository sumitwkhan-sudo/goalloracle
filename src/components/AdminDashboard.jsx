import React, { useState, useEffect } from 'react';
import { Trophy, Users, Coins, RefreshCw, Lock } from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import { updateMatchResult, getAllUsers, setUserRole } from '../utils/db';

const AdminDashboard = ({ userData, platformStats, matchResults, notify }) => {
  const [adminTab, setAdminTab] = useState('results');
  const [users, setUsers] = useState([]);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [form, setForm] = useState({ homeScore: '', awayScore: '', extraTime: false, penalties: false });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (adminTab === 'users') getAllUsers().then(setUsers).catch(console.error);
  }, [adminTab]);

  const handleSaveResult = async () => {
    if (!selectedMatch || form.homeScore === '' || form.awayScore === '') return;
    setSaving(true);
    try {
      await updateMatchResult(selectedMatch.id, {
        homeScore: parseInt(form.homeScore),
        awayScore: parseInt(form.awayScore),
        extraTime: form.extraTime,
        penalties: form.penalties,
      }, userData.id);
      notify(`Result saved: ${selectedMatch.home} vs ${selectedMatch.away}`);
      setSelectedMatch(null);
      setForm({ homeScore: '', awayScore: '', extraTime: false, penalties: false });
    } catch (e) { notify('Failed to save', 'error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="admin-dashboard">
      <h1>Admin Dashboard</h1>
      <div className="admin-stats">
        <div className="stat-card"><Users size={32} /><div><div className="stat-value">{platformStats.totalPlayers}</div><div className="stat-label">Users</div></div></div>
        <div className="stat-card"><Trophy size={32} /><div><div className="stat-value">{platformStats.activeLeagues}</div><div className="stat-label">Leagues</div></div></div>
        <div className="stat-card"><Coins size={32} /><div><div className="stat-value">${platformStats.totalPrizePools.toLocaleString()}</div><div className="stat-label">Prize Pools</div></div></div>
      </div>

      <div className="tabs">
        <button className={`tab ${adminTab === 'results' ? 'active' : ''}`} onClick={() => setAdminTab('results')}>Match Results</button>
        <button className={`tab ${adminTab === 'users' ? 'active' : ''}`} onClick={() => setAdminTab('users')}>Users</button>
      </div>

      {adminTab === 'results' && (
        <div className="admin-results">
          <h3>Update Match Results</h3>
          <div className="admin-matches-list">
            {WORLD_CUP_MATCHES.filter(m => !matchResults[m.id]?.completed).slice(0, 20).map(m => (
              <div key={m.id} className={`admin-match-item ${selectedMatch?.id === m.id ? 'selected' : ''}`} onClick={() => setSelectedMatch(m)}>
                <span className="match-stage">{m.stage}</span>
                <span>{m.homeFlag} {m.home} vs {m.away} {m.awayFlag}</span>
                <span className="match-date">{m.date}</span>
              </div>
            ))}
          </div>
          {selectedMatch && (
            <div className="result-form">
              <h4>{selectedMatch.homeFlag} {selectedMatch.home} vs {selectedMatch.away} {selectedMatch.awayFlag}</h4>
              <div className="score-prediction">
                <input type="number" min="0" placeholder="Home" className="score-input" value={form.homeScore} onChange={e => setForm({ ...form, homeScore: e.target.value })} />
                <span className="score-dash">-</span>
                <input type="number" min="0" placeholder="Away" className="score-input" value={form.awayScore} onChange={e => setForm({ ...form, awayScore: e.target.value })} />
              </div>
              {selectedMatch.isKnockout && (
                <div className="knockout-options">
                  <label className="checkbox-label"><input type="checkbox" checked={form.extraTime} onChange={e => setForm({ ...form, extraTime: e.target.checked })} /><span>Extra Time</span></label>
                  <label className="checkbox-label"><input type="checkbox" checked={form.penalties} onChange={e => setForm({ ...form, penalties: e.target.checked })} /><span>Penalties</span></label>
                </div>
              )}
              <button className="btn btn-primary" onClick={handleSaveResult} disabled={saving}>
                {saving ? <><RefreshCw size={16} className="spin" /> Saving...</> : 'Save Result'}
              </button>
            </div>
          )}
        </div>
      )}

      {adminTab === 'users' && (
        <div className="admin-users">
          <h3>Users ({users.length})</h3>
          <div className="users-list">
            {users.map(u => (
              <div key={u.id} className="user-item">
                <div className="user-info">
                  <strong>{u.displayName || u.email || u.id.slice(0, 12)}</strong>
                  <span className="user-role">{u.role || 'user'}</span>
                </div>
                <div className="user-actions">
                  <select value={u.role || 'user'} onChange={async (e) => {
                    await setUserRole(u.id, e.target.value, userData.id);
                    setUsers(prev => prev.map(p => p.id === u.id ? { ...p, role: e.target.value } : p));
                    notify(`Updated role to ${e.target.value}`);
                  }}>
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                    <option value="superadmin">Super Admin</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
