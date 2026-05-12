/**
 * HouseRulesSection
 *
 * Self-contained integration of HouseRulesCard + edit modal + report
 * modal for a user-created private league's detail page. Renders null
 * when the league doesn't qualify (no rules set, global league,
 * public league, or no user).
 *
 * Ack state is tracked in localStorage to avoid an extra fetch on
 * every league-detail render. Server-side ack still fires via
 * acknowledgeLeagueHouseRules so we have the audit trail; localStorage
 * is just the read cache.
 */

import React, { useEffect, useMemo, useState } from 'react';
import HouseRulesCard from './HouseRulesCard';
import HouseRulesInput from './HouseRulesInput';
import ReportContentModal from './ReportContentModal';
import { RefreshCw, X } from 'lucide-react';
import {
  acknowledgeLeagueHouseRules,
  editLeagueHouseRules,
  reportContent,
} from '../utils/db';

const ACK_KEY = (leagueId, userId) => `goaloracle_hr_ack_${leagueId}_${userId}`;

function readAck(leagueId, userId) {
  try { return localStorage.getItem(ACK_KEY(leagueId, userId)) === '1'; } catch { return false; }
}
function writeAck(leagueId, userId) {
  try { localStorage.setItem(ACK_KEY(leagueId, userId), '1'); } catch {}
}
function clearAck(leagueId, userId) {
  try { localStorage.removeItem(ACK_KEY(leagueId, userId)); } catch {}
}

export default function HouseRulesSection({ league, userId, isCreator, notify }) {
  const houseRules = league?.houseRules;
  const leagueId = league?.id;

  // Eligibility — bail early when the league doesn't qualify.
  const eligible = (
    !!leagueId && !!userId
    && !!houseRules && typeof houseRules === 'object' && !!houseRules.content
    && league?.visibility === 'private'
    && !league?.isGlobal
    && leagueId !== 'global' && leagueId !== 'global-simple'
  );

  // Default expanded on first view; localStorage flag flips after ack.
  // Recomputed when the league or user changes (e.g. navigating between
  // leagues without unmounting the page).
  const defaultExpanded = useMemo(() => {
    if (!eligible) return false;
    return !readAck(leagueId, userId);
  }, [eligible, leagueId, userId]);

  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [editErr, setEditErr] = useState('');

  // Seed the edit-draft from server state whenever the modal opens.
  useEffect(() => {
    if (editOpen) setEditDraft(houseRules?.content || '');
  }, [editOpen, houseRules]);

  if (!eligible) return null;

  const onAcknowledge = async () => {
    writeAck(leagueId, userId);
    try { await acknowledgeLeagueHouseRules(leagueId); } catch {
      // Best-effort. localStorage already records the local view, so a
      // transient server error doesn't re-expand the card.
    }
  };

  const onEditSave = async () => {
    if (editBusy) return;
    setEditBusy(true);
    setEditErr('');
    try {
      await editLeagueHouseRules(leagueId, editDraft);
      // Clear the ack so the updated rules re-default to expanded on
      // next view. Server also resets the per-member ack records.
      clearAck(leagueId, userId);
      setEditOpen(false);
      notify?.('House Rules updated.');
    } catch (e) {
      setEditErr(e?.message || 'Could not save House Rules.');
    } finally {
      setEditBusy(false);
    }
  };

  const onReportSubmit = async ({ contentType, contentId, reason }) => {
    await reportContent({ contentType, contentId, reason });
    notify?.('Thanks — we’ll review this.');
  };

  return (
    <>
      <HouseRulesCard
        houseRules={houseRules}
        isCreator={!!isCreator}
        defaultExpanded={defaultExpanded}
        onAcknowledge={onAcknowledge}
        onEdit={isCreator ? () => setEditOpen(true) : undefined}
        onReport={() => setReportOpen(true)}
      />

      {editOpen && (
        <div className="modal-overlay" onClick={() => !editBusy && setEditOpen(false)} role="dialog" aria-modal="true">
          <div className="edit-house-rules-modal" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="modal-close" onClick={() => !editBusy && setEditOpen(false)} aria-label="Close" disabled={editBusy}>
              <X size={20} />
            </button>
            <h2 className="edit-house-rules-title">Edit House Rules</h2>
            <p className="edit-house-rules-desc">
              Update the notes for your league members. Members will be
              notified that the rules changed on their next visit.
            </p>
            <HouseRulesInput
              value={editDraft}
              onChange={setEditDraft}
              disabled={editBusy}
              label="House Rules"
            />
            {editErr && <div className="form-error" role="alert">{editErr}</div>}
            <div className="form-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditOpen(false)} disabled={editBusy}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={onEditSave} disabled={editBusy}>
                {editBusy ? <><RefreshCw size={14} className="spin" /> Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ReportContentModal
        open={reportOpen}
        onClose={() => setReportOpen(false)}
        onSubmit={onReportSubmit}
        contentType="league_house_rules"
        contentId={leagueId}
        title="Report House Rules"
        description="Let us know why this content is inappropriate. Optional — we review every report."
      />
    </>
  );
}
