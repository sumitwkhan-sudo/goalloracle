/**
 * LiveStandingsDrawer
 *
 * Classic Predictions companion — a right-side slide-in panel that shows the
 * live group standings implied by the user's current picks. Updates live as
 * they change scores. Tap the tab handle on the right edge to open; tap the
 * backdrop, the close button, or the handle again to slide it away.
 *
 * Designed to work on mobile + desktop:
 *  - Mobile: nearly full-width drawer with backdrop
 *  - Desktop: ~420px wide drawer pinned to the right edge
 */

import React, { useMemo, useEffect } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import { calcGroupStandings } from '../utils/bracket';
import WORLD_CUP_MATCHES from '../data/matches';

const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

function buildFlagLookup() {
  const flags = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) continue;
    if (m.home && m.homeFlag) flags[m.home] = m.homeFlag;
    if (m.away && m.awayFlag) flags[m.away] = m.awayFlag;
  }
  return flags;
}

function playedCount(predictions) {
  let n = 0;
  for (const [matchId, p] of Object.entries(predictions || {})) {
    const m = WORLD_CUP_MATCHES.find((x) => x.id === matchId);
    if (!m || m.isKnockout) continue;
    const hs = parseInt(p?.score?.home);
    const as = parseInt(p?.score?.away);
    if (!isNaN(hs) && !isNaN(as)) n++;
  }
  return n;
}

export function LiveStandingsToggle({ open, onToggle, count }) {
  return (
    <button
      type="button"
      className={`lsd-toggle ${open ? 'is-open' : ''}`}
      onClick={onToggle}
      aria-expanded={open}
      aria-controls="live-standings-drawer"
      title={open ? 'Hide live table' : 'Show live table'}
    >
      <span className="lsd-toggle-chev" aria-hidden="true">
        {open ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </span>
      <span className="lsd-toggle-label">Live Table</span>
      {typeof count === 'number' && count > 0 && (
        <span className="lsd-toggle-count">{count}</span>
      )}
    </button>
  );
}

export default function LiveStandingsDrawer({ open, onClose, predictions }) {
  const flags = useMemo(buildFlagLookup, []);
  const standings = useMemo(() => calcGroupStandings(predictions || {}), [predictions]);
  const played = useMemo(() => playedCount(predictions || {}), [predictions]);

  // Close with Escape key.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Lock body scroll while drawer is open (mobile nicety).
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  return (
    <>
      <div
        className={`lsd-backdrop ${open ? 'is-open' : ''}`}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="live-standings-drawer"
        className={`lsd-drawer ${open ? 'is-open' : ''}`}
        role="dialog"
        aria-label="Live group standings"
        aria-hidden={!open}
      >
        <header className="lsd-head">
          <div>
            <h2 className="lsd-title">Live Group Table</h2>
            <p className="lsd-sub">Based on your current picks &middot; {played} match{played === 1 ? '' : 'es'} scored</p>
          </div>
          <button
            type="button"
            className="lsd-close"
            onClick={onClose}
            aria-label="Close live table"
          >
            <X size={18} />
          </button>
        </header>

        <div className="lsd-body">
          {played === 0 && (
            <div className="lsd-empty">
              <p>Start scoring matches and the table fills in here live.</p>
            </div>
          )}
          <div className="lsd-groups">
            {GROUPS.map((g) => {
              const rows = standings[g] || [];
              return (
                <section key={g} className="lsd-group">
                  <h3 className="lsd-group-title">Group {g}</h3>
                  <table className="lsd-table">
                    <thead>
                      <tr>
                        <th className="lsd-col-pos">#</th>
                        <th className="lsd-col-team">Team</th>
                        <th className="lsd-col-num">P</th>
                        <th className="lsd-col-num">W</th>
                        <th className="lsd-col-num">D</th>
                        <th className="lsd-col-num">L</th>
                        <th className="lsd-col-num">GD</th>
                        <th className="lsd-col-num lsd-col-pts">Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((team, i) => {
                        const posClass = i === 0 ? 'lsd-pos-1' : i === 1 ? 'lsd-pos-2' : i === 2 ? 'lsd-pos-3' : 'lsd-pos-4';
                        return (
                          <tr key={team.name} className={`lsd-row ${posClass}`}>
                            <td className="lsd-col-pos">{i + 1}</td>
                            <td className="lsd-col-team">
                              <span className="lsd-flag">{flags[team.name] || '🏳️'}</span>
                              <span className="lsd-name">{team.name}</span>
                            </td>
                            <td className="lsd-col-num">{team.played}</td>
                            <td className="lsd-col-num">{team.w}</td>
                            <td className="lsd-col-num">{team.d}</td>
                            <td className="lsd-col-num">{team.l}</td>
                            <td className={`lsd-col-num ${team.gd > 0 ? 'lsd-gd-pos' : team.gd < 0 ? 'lsd-gd-neg' : ''}`}>
                              {team.gd > 0 ? `+${team.gd}` : team.gd}
                            </td>
                            <td className="lsd-col-num lsd-col-pts">{team.pts}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              );
            })}
          </div>
          <p className="lsd-footnote">
            Ranked by points → head-to-head → overall GD → goals for. Top 2 of each group + 8 best third-placed teams advance to the Round of 32.
          </p>
        </div>
      </aside>
    </>
  );
}
