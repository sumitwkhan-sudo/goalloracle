/**
 * HouseRulesCard
 *
 * Collapsible card shown on the user-created league detail page when
 * the league has House Rules set. Behavior:
 *
 *   - Expanded by default on first view after joining (i.e. when the
 *     user has no acknowledgment record yet, OR the rules have been
 *     updated since they last acknowledged).
 *   - Collapsed after acknowledgment.
 *   - Three-dot menu: Edit (creator only) and Report (any member).
 *
 * Plain-text rendering only. Line breaks preserved via white-space:
 * pre-wrap on the content element. No markdown, no link auto-linking
 * in v1.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ChevronRight, MoreHorizontal, Pencil, Flag } from 'lucide-react';

export default function HouseRulesCard({
  houseRules,            // { content, lastUpdatedAt, lastUpdatedBy } | null
  isCreator,             // bool — show Edit menu item
  defaultExpanded = false,
  onAcknowledge,         // optional async () => void called the first time the card expands
  onEdit,                // optional () => void — opens the edit flow
  onReport,              // optional () => void — opens ReportContentModal
}) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const ackedRef = useRef(false);

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // Fire acknowledge once when defaultExpanded=true AND the user actually
  // sees the expanded content. Idempotent on the server.
  useEffect(() => {
    if (defaultExpanded && expanded && !ackedRef.current) {
      ackedRef.current = true;
      onAcknowledge?.();
    }
  }, [defaultExpanded, expanded, onAcknowledge]);

  if (!houseRules || !houseRules.content) return null;

  const toggle = () => setExpanded((v) => !v);

  return (
    <section className="house-rules-card" aria-label="House Rules">
      <header className="house-rules-card-head">
        <button
          type="button"
          className="house-rules-card-toggle"
          onClick={toggle}
          aria-expanded={expanded}
        >
          <ChevronRight size={16} className={`house-rules-card-chev ${expanded ? 'rotated' : ''}`} />
          <span>House Rules</span>
          {defaultExpanded && !ackedRef.current && (
            <span className="house-rules-badge">Updated</span>
          )}
        </button>
        <div className="house-rules-card-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className="house-rules-card-menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="House Rules options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen && (
            <div className="house-rules-card-menu" role="menu">
              {isCreator && onEdit && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onEdit(); }}
                >
                  <Pencil size={13} /> Edit
                </button>
              )}
              {onReport && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => { setMenuOpen(false); onReport(); }}
                >
                  <Flag size={13} /> Report
                </button>
              )}
            </div>
          )}
        </div>
      </header>
      {expanded && (
        <div className="house-rules-card-body">
          {/* white-space: pre-wrap preserves line breaks. React escapes
              the content automatically so any &lt;script&gt; tag is rendered
              as text, not executed. */}
          <p className="house-rules-card-content">{houseRules.content}</p>
          <p className="house-rules-card-foot">
            Set by the league creator. GoalOracle does not enforce these rules.
          </p>
        </div>
      )}
    </section>
  );
}
