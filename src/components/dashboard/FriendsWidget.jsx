/**
 * FriendsWidget.jsx — "who's done in your private leagues" card.
 *
 * Shown on the dashboard when the user has at least one private league
 * (anything other than global / global-simple). Pulls the simple-mode
 * leaderboard for that league, takes the first 6 entries, and shows
 * each member's completion state. Surfaces an Invite CTA so the user
 * can pull friends in.
 *
 * Hidden gracefully when:
 *   - the user has no private leagues
 *   - the leaderboard fetch fails
 *   - the league has fewer than 2 members (no social value)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Users, ChevronRight, CheckCircle, Clock, Send } from 'lucide-react';
import { getSimpleLeaderboard } from '../../utils/db';

export default function FriendsWidget({ leagues, currentUserId, nav }) {
  // Pick the user's first private Quick Picks league. Global leagues
  // would dominate the list and aren't a "friends" surface.
  const privateLeague = useMemo(() => {
    return (leagues || []).find((l) => {
      if (!l) return false;
      if (l.id === 'global-simple' || l.id === 'global') return false;
      // Quick Picks leagues only — classic-only leagues don't surface
      // bracket completion via the simple-leaderboard endpoint.
      return l.predictionMode === 'simple' || l.id?.endsWith('-simple');
    });
  }, [leagues]);

  const [members, setMembers] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!privateLeague) return;
    let cancelled = false;
    setMembers(null);
    setError(null);
    getSimpleLeaderboard(privateLeague.id)
      .then((data) => {
        if (cancelled) return;
        const list = (data?.entries || data || []).slice(0, 6);
        setMembers(list);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e?.message || 'Could not load league');
      });
    return () => { cancelled = true; };
  }, [privateLeague?.id]);

  if (!privateLeague) return null;
  if (error) return null;
  if (members && members.length < 2) return null;

  return (
    <div className="dash-friends-widget">
      <div className="dash-friends-head">
        <div className="dash-friends-title">
          <Users size={14} />
          <strong>{privateLeague.name}</strong>
          <span className="dash-friends-count">
            {members ? `${members.length} member${members.length === 1 ? '' : 's'}` : '…'}
          </span>
        </div>
        <button type="button" className="dash-friends-view" onClick={() => nav('detail', privateLeague, { tab: 'leaderboard' })}>
          View leaderboard <ChevronRight size={11} />
        </button>
      </div>

      <ul className="dash-friends-list">
        {(members || Array.from({ length: 4 })).map((m, i) => {
          const isYou = m && m.userId === currentUserId;
          const done = !!m?.isComplete;
          return (
            <li key={m?.userId || `skel-${i}`} className={`dash-friends-row${isYou ? ' dash-friends-row-you' : ''}`}>
              <span className="dash-friends-name">{m ? (m.displayName || m.userId.slice(0, 6)) : <span className="td-skel">—</span>}{isYou ? ' (you)' : ''}</span>
              <span className={`dash-friends-state ${done ? 'is-done' : 'is-pending'}`}>
                {!m ? null : done ? (
                  <><CheckCircle size={11} /> Done</>
                ) : (
                  <><Clock size={11} /> In progress</>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        className="dash-friends-invite"
        onClick={() => {
          const code = privateLeague.passcode || privateLeague.id;
          const text = `Join my GoalOracle World Cup '26 league — passcode ${code}: https://goaloracle.io`;
          if (navigator.share) {
            navigator.share({ title: 'GoalOracle league invite', text }).catch(() => {});
          } else {
            navigator.clipboard?.writeText(text).catch(() => {});
          }
        }}
      >
        <Send size={12} /> Invite a friend
      </button>
    </div>
  );
}
