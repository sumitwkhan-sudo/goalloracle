/**
 * QuickPicksScoringPanel
 *
 * Collapsible "How Points Are Scored" card shown at the top of Step 1 of
 * the Quick Picks wizard. Default-collapsed so the rules don't push the
 * actual prediction UI below the fold — users can expand if they want
 * the breakdown. Their choice persists in localStorage so the panel
 * doesn't fight them across sessions.
 *
 * Values are pulled directly from `src/utils/scoringSimple.js` so this
 * panel never drifts from the engine.
 */

import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, Award } from 'lucide-react';
import {
  GROUP_STAGE_POINTS_PER_POSITION,
  GROUP_STAGE_MAX,
  BEST_THIRD_POINTS_PER_PICK,
  BEST_THIRD_MAX,
  KNOCKOUT_POINTS_PER_PICK,
  KNOCKOUT_MAX,
  TOTAL_MAX,
} from '../../utils/scoringSimple';

// localStorage values: '1' = expanded, '0' or unset = collapsed.
// (Inverted from the original "dismissed" key so the new default matches
// the localStorage absence-of-value, instead of needing a migration.)
const STORAGE_KEY = 'goaloracle_qp_scoring_open';

export default function QuickPicksScoringPanel() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(STORAGE_KEY) === '1'; } catch { return false; }
  });

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, open ? '1' : '0'); } catch {}
  }, [open]);

  return (
    <section className={`qp-scoring-panel ${open ? 'is-open' : ''}`}>
      <button
        type="button"
        className="qp-scoring-head"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls="qp-scoring-body"
      >
        <span className="qp-scoring-title">
          <Award size={14} aria-hidden="true" /> How Points Are Scored
        </span>
        <span className="qp-scoring-max" aria-hidden="true">Max {TOTAL_MAX} pts</span>
        {open ? <ChevronUp size={16} aria-hidden="true" /> : <ChevronDown size={16} aria-hidden="true" />}
      </button>
      {open && (
        <div id="qp-scoring-body" className="qp-scoring-body">
          <ul className="qp-scoring-list">
            <li>
              <span className="qp-scoring-bullet">⚽</span>
              <span>Correct 1st place in a group</span>
              <strong>{GROUP_STAGE_POINTS_PER_POSITION[1]} pts</strong>
            </li>
            <li>
              <span className="qp-scoring-bullet">⚽</span>
              <span>Correct 2nd place in a group</span>
              <strong>{GROUP_STAGE_POINTS_PER_POSITION[2]} pts</strong>
            </li>
            <li>
              <span className="qp-scoring-bullet">⚽</span>
              <span>Correct 3rd or 4th place in a group</span>
              <strong>{GROUP_STAGE_POINTS_PER_POSITION[3]} pt each</strong>
            </li>
            <li>
              <span className="qp-scoring-bullet">🥉</span>
              <span>Each correct best-third pick (8 picks)</span>
              <strong>{BEST_THIRD_POINTS_PER_PICK} pts each</strong>
            </li>
            <li className="qp-scoring-knockouts">
              <span className="qp-scoring-bullet">🏆</span>
              <span>Knockout winners — points scale by round</span>
              <table className="qp-scoring-ko-table">
                <tbody>
                  <tr><td>Round of 32</td><td><strong>{KNOCKOUT_POINTS_PER_PICK.roundOf32} pts</strong></td></tr>
                  <tr><td>Round of 16</td><td><strong>{KNOCKOUT_POINTS_PER_PICK.roundOf16} pts</strong></td></tr>
                  <tr><td>Quarter-finals</td><td><strong>{KNOCKOUT_POINTS_PER_PICK.quarterFinals} pts</strong></td></tr>
                  <tr><td>Semi-finals</td><td><strong>{KNOCKOUT_POINTS_PER_PICK.semiFinals} pts</strong></td></tr>
                  <tr><td>3rd-place</td><td><strong>{KNOCKOUT_POINTS_PER_PICK.thirdPlace} pts</strong></td></tr>
                  <tr><td>Final</td><td><strong>{KNOCKOUT_POINTS_PER_PICK.final} pts</strong></td></tr>
                </tbody>
              </table>
            </li>
          </ul>
          <div className="qp-scoring-totals">
            <span>Group stage: <strong>{GROUP_STAGE_MAX}</strong></span>
            <span>·</span>
            <span>Best thirds: <strong>{BEST_THIRD_MAX}</strong></span>
            <span>·</span>
            <span>Knockouts: <strong>{KNOCKOUT_MAX}</strong></span>
            <span>·</span>
            <span>Total: <strong>{TOTAL_MAX} pts</strong></span>
          </div>
        </div>
      )}
    </section>
  );
}
