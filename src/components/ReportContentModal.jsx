/**
 * ReportContentModal
 *
 * Generic UGC report modal. Currently used for league House Rules but
 * the props are intentionally generic (contentType + contentId) so it
 * can be reused for other user-generated content in the future.
 *
 * Behaviour:
 *   - Optional free-text reason (max 500 chars)
 *   - Submit → calls onSubmit({ contentType, contentId, reason })
 *   - Closes on submit success
 *   - Cancel button closes without sending
 */

import React, { useState } from 'react';
import { X, Flag, RefreshCw } from 'lucide-react';

const MAX_REASON_LEN = 500;

export default function ReportContentModal({
  open,
  onClose,
  onSubmit,                  // async (payload) => void
  contentType,               // 'league_house_rules'
  contentId,
  title = 'Report content',
  description = 'Tell us why this content is inappropriate. Optional — we review every report.',
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (!open) return null;

  const handle = (e) => {
    let v = e.target.value;
    if (v.length > MAX_REASON_LEN) v = v.slice(0, MAX_REASON_LEN);
    setReason(v);
    if (err) setErr('');
  };

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try {
      await onSubmit?.({ contentType, contentId, reason: reason.trim() || null });
      setReason('');
      onClose?.();
    } catch (e) {
      setErr(e?.message || 'Could not submit report — try again.');
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="report-content-title">
      <div className="report-content-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="Close" disabled={busy}>
          <X size={20} />
        </button>
        <div className="report-content-head">
          <Flag size={20} aria-hidden="true" />
          <h2 id="report-content-title">{title}</h2>
        </div>
        <p className="report-content-desc">{description}</p>
        <label className="report-content-label">
          <span>Reason (optional)</span>
          <textarea
            className="input-field report-content-textarea"
            value={reason}
            onChange={handle}
            placeholder="e.g., misleading, spam, abusive language…"
            rows={3}
            maxLength={MAX_REASON_LEN}
            disabled={busy}
          />
          <span className="report-content-counter">{reason.length} / {MAX_REASON_LEN}</span>
        </label>
        {err && <div className="report-content-err">{err}</div>}
        <div className="report-content-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={submit} disabled={busy}>
            {busy ? <><RefreshCw size={14} className="spin" /> Sending…</> : <>Submit report</>}
          </button>
        </div>
      </div>
    </div>
  );
}
