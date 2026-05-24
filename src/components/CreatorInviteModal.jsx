/**
 * CreatorInviteModal — two ways for a private-league creator to invite
 * people:
 *   1. Copy a one-click join link (existing behavior, with passcode in
 *      the URL so the recipient auto-joins post-signup).
 *   2. Have GoalOracle email a list of addresses on the creator's
 *      behalf. The subject + body both name the creator so it doesn't
 *      look like spam from us; reply-to is set to the creator's email.
 *      Hard-capped at 25 per send + 50 per league per 24h, server-side.
 *
 * Drop-in: anywhere a creator can see their league, render
 *   <CreatorInviteModal open={...} league={...} onClose={...} notify={...} />
 */

import { useState } from 'react';
import { Key, Copy, Mail, X, CheckCircle, UserPlus, Loader2 } from 'lucide-react';
import { creatorInviteByEmail } from '../utils/db';

const NOTE_MAX = 200;
const EMAIL_MAX = 25;

function parseEmails(raw) {
  if (!raw) return [];
  // Accept commas, newlines, semicolons, whitespace.
  return [...new Set(
    raw
      .split(/[\s,;]+/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  )];
}

export default function CreatorInviteModal({ open, onClose, league, passcode, notify }) {
  const [tab, setTab] = useState('email');
  const [emailsRaw, setEmailsRaw] = useState('');
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);
  const [linkCopied, setLinkCopied] = useState(false);

  if (!open) return null;

  const parsed = parseEmails(emailsRaw);
  const tooMany = parsed.length > EMAIL_MAX;
  const noteLen = note.length;
  const noteOver = noteLen > NOTE_MAX;

  const inviteUrl = (() => {
    const origin = (typeof window !== 'undefined' && window.location.origin) || 'https://goaloracle.io';
    const params = new URLSearchParams();
    params.set('join', league?.id || '');
    if (passcode) params.set('p', passcode);
    return `${origin}/?${params.toString()}`;
  })();

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 2000);
      if (notify) notify('Invite link copied');
    } catch {
      if (notify) notify('Could not copy invite', 'error');
    }
  };

  const handleSendEmails = async () => {
    if (sending) return;
    if (parsed.length === 0) {
      if (notify) notify('Enter at least one email address', 'error');
      return;
    }
    if (tooMany) {
      if (notify) notify(`Max ${EMAIL_MAX} addresses per send`, 'error');
      return;
    }
    if (noteOver) {
      if (notify) notify(`Personal note must be ${NOTE_MAX} characters or fewer`, 'error');
      return;
    }
    setSending(true);
    setResult(null);
    try {
      const r = await creatorInviteByEmail(league.id, parsed, note.trim() || null);
      setResult(r);
      if (r.sent > 0) {
        if (notify) notify(`Sent ${r.sent} invite${r.sent === 1 ? '' : 's'}`);
        setEmailsRaw('');
        setNote('');
      } else if (r.skipped > 0 && r.failed === 0) {
        if (notify) notify('All addresses were skipped (already members or invalid)');
      } else if (notify) {
        notify('No invites were sent', 'error');
      }
    } catch (e) {
      if (notify) notify(e?.message || 'Could not send invites', 'error');
      setResult({ error: e?.message || 'Unknown error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="creator-invite-modal" onClick={(e) => e.stopPropagation()}>
        <div className="fund-modal-header">
          <h3><UserPlus size={20} /> Invite to {league?.name || 'this league'}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="creator-invite-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'email'}
            className={`creator-invite-tab ${tab === 'email' ? 'is-active' : ''}`}
            onClick={() => setTab('email')}
          >
            <Mail size={14} /> Email invites
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'link'}
            className={`creator-invite-tab ${tab === 'link' ? 'is-active' : ''}`}
            onClick={() => setTab('link')}
          >
            <Key size={14} /> Share link
          </button>
        </div>

        {tab === 'email' && (
          <div className="creator-invite-body">
            <p className="fund-desc">
              GoalOracle will send each address an invite email from <strong>{league?.name}</strong>.
              The recipient will see your name in the subject and body, and replies will go back to you.
            </p>

            <label className="creator-invite-label">
              <span>Email addresses</span>
              <textarea
                className="creator-invite-textarea"
                placeholder="alice@example.com, bob@example.com&#10;or one per line"
                value={emailsRaw}
                onChange={(e) => setEmailsRaw(e.target.value)}
                rows={4}
                disabled={sending}
              />
              <span className={`creator-invite-helper ${tooMany ? 'is-error' : ''}`}>
                {parsed.length} address{parsed.length === 1 ? '' : 'es'}
                {tooMany ? ` — max ${EMAIL_MAX} per send` : ''}
              </span>
            </label>

            <label className="creator-invite-label">
              <span>Personal note (optional)</span>
              <textarea
                className="creator-invite-textarea"
                placeholder='e.g. "Office bracket pool — entry deadline Friday."'
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                disabled={sending}
              />
              <span className={`creator-invite-helper ${noteOver ? 'is-error' : ''}`}>
                {noteLen}/{NOTE_MAX}
              </span>
            </label>

            {result && (
              <div className="creator-invite-result">
                {result.error
                  ? <span className="is-error">{result.error}</span>
                  : <>
                      <strong>{result.sent || 0}</strong> sent
                      {result.skipped > 0 && <> · <strong>{result.skipped}</strong> skipped</>}
                      {result.failed > 0 && <> · <strong className="is-error">{result.failed}</strong> failed</>}
                      {Array.isArray(result.errors) && result.errors.length > 0 && (
                        <ul className="creator-invite-errors">
                          {result.errors.slice(0, 5).map((er, i) => (
                            <li key={i}>{er.email || er.uid}: {er.error}</li>
                          ))}
                        </ul>
                      )}
                    </>}
              </div>
            )}

            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sending}>Close</button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleSendEmails}
                disabled={sending || parsed.length === 0 || tooMany || noteOver}
              >
                {sending ? <><Loader2 size={14} className="spin" /> Sending…</> : <><Mail size={14} /> Send invites</>}
              </button>
            </div>
            <p className="form-hint">
              Daily limit: 50 invites per league. Existing members and addresses that have unsubscribed are silently skipped.
            </p>
          </div>
        )}

        {tab === 'link' && (
          <div className="creator-invite-body">
            <p className="fund-desc">
              Share this link with people you want to invite to <strong>{league?.name}</strong>. The passcode is built into the link, so recipients join automatically after signing in.
            </p>
            <div className="invite-code-box">
              <code className="invite-code" style={{ wordBreak: 'break-all' }}>{inviteUrl}</code>
              <button className="btn btn-primary btn-sm" onClick={handleCopyLink}>
                {linkCopied ? <><CheckCircle size={14} /> Copied!</> : <><Copy size={14} /> Copy link</>}
              </button>
            </div>
            {passcode && (
              <p className="form-hint">
                Passcode (for the Browse Leagues page): <code className="settings-code">{passcode}</code>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
