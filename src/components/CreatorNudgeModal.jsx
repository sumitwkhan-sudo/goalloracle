/**
 * CreatorNudgeModal — lets a private-league creator send a one-shot
 * "hey, check the league" email to their members. Pulls the member
 * list from /api/leagues `creatorListNudgeEligible`, lets the creator
 * pick recipients + add an optional personal note, sends via the
 * `creatorNudge` action.
 *
 * Server enforces the rate limit (one nudge per league per 7 days);
 * this modal surfaces the next-available time when the limit is hit.
 */

import { useEffect, useMemo, useState } from 'react';
import { MessageCircle, X, Loader2, Send, AlertTriangle, Check } from 'lucide-react';
import { creatorListNudgeEligible, creatorSendNudge } from '../utils/db';

const NOTE_MAX = 200;

// Filter presets per league type. Each preset has a `match(member)`
// fn that returns true when a member belongs in this filter.
// `default: true` flags the chip that starts selected on open.
function buildFilterPresets(predictionMode) {
  if (predictionMode === 'classic') {
    return [
      { id: 'all', label: 'All members', match: () => true },
      { id: 'not-started', label: 'Not started', match: (m) => m.phase === 'not-started' },
      { id: 'in-progress', label: 'In progress', match: (m) => m.phase === 'in-progress' },
      { id: 'incomplete', label: 'Anyone incomplete', match: (m) => m.phase !== 'done', default: true },
    ];
  }
  // Quick Picks (simple)
  return [
    { id: 'all', label: 'All members', match: () => true },
    { id: 'not-started', label: 'Not started', match: (m) => m.phase === 'not-started' },
    { id: 'groups', label: 'Missing groups', match: (m) => m.phase === 'groups' || m.phase === 'not-started' },
    { id: 'best-thirds', label: 'Missing best thirds', match: (m) => m.phase === 'best-thirds' },
    { id: 'knockout', label: 'Missing knockout', match: (m) => m.phase === 'knockout' },
    { id: 'incomplete', label: 'Anyone incomplete', match: (m) => m.phase !== 'done', default: true },
  ];
}

function PhaseProgress({ member, predictionMode }) {
  const p = member.progress || {};
  if (predictionMode === 'classic') {
    const done = p.classicDone || 0;
    const total = p.classicTotal || 104;
    return <span className="creator-nudge-progress">{done}/{total}</span>;
  }
  return (
    <span className="creator-nudge-progress" title={`Groups ${p.groupsDone || 0}/${p.groupsTotal || 12} · Thirds ${p.bestThirdsDone || 0}/${p.bestThirdsTotal || 8} · Knockout ${p.knockoutDone || 0}/${p.knockoutTotal || 32}`}>
      G {p.groupsDone || 0}/{p.groupsTotal || 12} · T {p.bestThirdsDone || 0}/{p.bestThirdsTotal || 8} · K {p.knockoutDone || 0}/{p.knockoutTotal || 32}
    </span>
  );
}

function phaseChip(phase) {
  switch (phase) {
    case 'not-started': return 'Not started';
    case 'groups': return 'Missing groups';
    case 'best-thirds': return 'Missing thirds';
    case 'knockout': return 'Missing knockout';
    case 'in-progress': return 'In progress';
    case 'done': return 'Done';
    default: return null;
  }
}

function formatRelative(ms) {
  if (!ms) return '';
  const diff = ms - Date.now();
  if (diff <= 0) return 'now';
  const days = Math.floor(diff / (24 * 60 * 60 * 1000));
  const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h`;
  const mins = Math.max(1, Math.floor(diff / (60 * 1000)));
  return `in ${mins}m`;
}

export default function CreatorNudgeModal({ open, onClose, league, notify }) {
  const [loading, setLoading] = useState(false);
  const [members, setMembers] = useState([]);
  const [nextAvailable, setNextAvailable] = useState(null);
  const [predictionMode, setPredictionMode] = useState('simple');
  const [selected, setSelected] = useState(() => new Set());
  const [activeFilter, setActiveFilter] = useState('incomplete');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open || !league?.id) return;
    let cancelled = false;
    setLoading(true);
    setResult(null);
    creatorListNudgeEligible(league.id)
      .then((r) => {
        if (cancelled) return;
        const list = r.members || [];
        setMembers(list);
        setNextAvailable(r.nextNudgeAvailableAt || null);
        const mode = r.predictionMode || (league?.predictionMode === 'classic' ? 'classic' : 'simple');
        setPredictionMode(mode);
        // Default the selection to "anyone incomplete" — the most common
        // creator intent. If everyone is done (unlikely but possible),
        // fall through to all members so the form isn't empty.
        const incomplete = list.filter((m) => m.phase !== 'done');
        const initial = incomplete.length > 0 ? incomplete : list;
        setSelected(new Set(initial.map((m) => m.userId)));
        setActiveFilter(incomplete.length > 0 ? 'incomplete' : 'all');
      })
      .catch((e) => {
        if (cancelled) return;
        if (notify) notify(e?.message || 'Could not load members', 'error');
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, league?.id, notify, league?.predictionMode]);

  const filterPresets = useMemo(() => buildFilterPresets(predictionMode), [predictionMode]);

  // Apply a preset to the selection set. Clicking the active chip just
  // re-applies it so the operator can "reset" without flipping chips.
  const applyFilter = (filterId) => {
    const preset = filterPresets.find((f) => f.id === filterId);
    if (!preset) return;
    setActiveFilter(filterId);
    const matched = members.filter(preset.match).map((m) => m.userId);
    setSelected(new Set(matched));
  };

  if (!open) return null;

  const nextAvailableMs = nextAvailable ? new Date(nextAvailable).getTime() : null;
  const rateLimited = !!(nextAvailableMs && nextAvailableMs > Date.now());

  const toggleOne = (uid) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(members.map((m) => m.userId)));
  const selectNone = () => setSelected(new Set());

  const noteLen = note.length;
  const noteOver = noteLen > NOTE_MAX;

  const handleSend = async () => {
    if (sending || rateLimited) return;
    const targets = [...selected];
    if (targets.length === 0) {
      if (notify) notify('Pick at least one member to nudge', 'error');
      return;
    }
    if (noteOver) {
      if (notify) notify(`Personal note must be ${NOTE_MAX} characters or fewer`, 'error');
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const r = await creatorSendNudge(league.id, targets, note.trim() || null);
      setResult(r);
      if (r.sent > 0) {
        if (notify) notify(`Nudged ${r.sent} member${r.sent === 1 ? '' : 's'}`);
        setNextAvailable(r.nextNudgeAvailableAt || null);
      } else if (notify) {
        notify('No nudges were sent', 'error');
      }
    } catch (e) {
      const msg = e?.message || 'Could not send nudges';
      if (notify) notify(msg, 'error');
      // Surface server-provided next-available time if we got a 429.
      if (e?.data?.nextNudgeAvailableAt) setNextAvailable(e.data.nextNudgeAvailableAt);
      setResult({ error: msg });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="creator-nudge-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fund-modal-header">
          <h3><MessageCircle size={20} /> Nudge {league?.name || 'league'} members</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="creator-nudge-body">
          <p className="fund-desc">
            Send a one-shot reminder email to members of <strong>{league?.name}</strong>. Recipients see your name in the subject and body; replies route back to you.
          </p>

          {rateLimited && (
            <div className="creator-nudge-banner">
              <AlertTriangle size={14} />
              <span>
                You already nudged this league recently. Next nudge available {formatRelative(nextAvailableMs)}.
              </span>
            </div>
          )}

          {loading ? (
            <div className="creator-nudge-loading"><Loader2 size={16} className="spin" /> Loading members…</div>
          ) : members.length === 0 ? (
            <p className="form-hint">No eligible members yet. Once people join, they'll show up here.</p>
          ) : (
            <>
              {/* Phase filter chips — picking one auto-selects every
                  member matching the filter. Operator can still toggle
                  individual rows afterward. */}
              <div className="creator-nudge-filters" role="tablist" aria-label="Filter members by phase">
                {filterPresets.map((preset) => {
                  const count = members.filter(preset.match).length;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      role="tab"
                      aria-selected={activeFilter === preset.id}
                      className={`creator-nudge-filter-chip ${activeFilter === preset.id ? 'is-active' : ''}`}
                      onClick={() => applyFilter(preset.id)}
                      disabled={sending}
                    >
                      {preset.label} <span className="creator-nudge-filter-count">{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="creator-nudge-toolbar">
                <span className="creator-nudge-count"><strong>{selected.size}</strong> of {members.length} selected</span>
                <div className="creator-nudge-toolbar-actions">
                  <button type="button" className="btn btn-xs btn-secondary" onClick={selectAll} disabled={sending}>Select all</button>
                  <button type="button" className="btn btn-xs btn-secondary" onClick={selectNone} disabled={sending}>None</button>
                </div>
              </div>

              <ul className="creator-nudge-list">
                {members.map((m) => {
                  const checked = selected.has(m.userId);
                  const chip = phaseChip(m.phase);
                  return (
                    <li key={m.userId} className={`creator-nudge-row ${checked ? 'is-selected' : ''}`}>
                      <label>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleOne(m.userId)}
                          disabled={sending}
                        />
                        <span className="creator-nudge-name">{m.displayName || m.email}</span>
                        {m.displayName && <span className="creator-nudge-email">{m.email}</span>}
                        <span className="creator-nudge-meta">
                          {chip && (
                            <span className={`creator-nudge-phase creator-nudge-phase-${m.phase}`}>{chip}</span>
                          )}
                          <PhaseProgress member={m} predictionMode={predictionMode} />
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>

              <label className="creator-invite-label">
                <span>Personal note (optional)</span>
                <textarea
                  className="creator-invite-textarea"
                  placeholder='e.g. "Finals tomorrow — lock in your picks!"'
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                  disabled={sending || rateLimited}
                />
                <span className={`creator-invite-helper ${noteOver ? 'is-error' : ''}`}>
                  {noteLen}/{NOTE_MAX}
                </span>
              </label>
            </>
          )}

          {result && !result.error && (
            <div className="creator-invite-result">
              <Check size={14} /> <strong>{result.sent || 0}</strong> sent
              {result.skipped > 0 && <> · <strong>{result.skipped}</strong> skipped</>}
              {result.failed > 0 && <> · <strong className="is-error">{result.failed}</strong> failed</>}
            </div>
          )}
          {result?.error && <div className="creator-invite-result is-error">{result.error}</div>}

          <div className="form-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sending}>Close</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleSend}
              disabled={sending || rateLimited || loading || members.length === 0 || selected.size === 0 || noteOver}
              title={rateLimited ? `Available again ${formatRelative(nextAvailableMs)}` : ''}
            >
              {sending
                ? <><Loader2 size={14} className="spin" /> Sending…</>
                : <><Send size={14} /> Send nudge</>}
            </button>
          </div>
          <p className="form-hint">
            Rate-limited to once per league every 7 days. Members who opt out of GoalOracle email are excluded.
          </p>
        </div>
      </div>
    </div>
  );
}
