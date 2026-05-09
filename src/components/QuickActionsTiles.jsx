/**
 * QuickActionsTiles
 *
 * Five equal-weight icon tiles for the logged-in landing page —
 * Dashboard, My Leagues, Global Leaderboard, Join a League, Invite
 * Friends. Same card style + spacing across all five (no
 * gradients, no accent), all the same size. Replaces the old
 * chip row that mixed accent + neutral chips at uneven weights.
 *
 * On mobile the grid drops to two columns and the 5th tile spans
 * the bottom row in full so we don't have a ragged orphan.
 */

import React from 'react';
import { Trophy, Users, TrendingUp, Search, UserPlus } from 'lucide-react';

export default function QuickActionsTiles({
  onDashboard,
  onMyLeagues,
  onLeaderboard,
  onJoin,
  onInvite,
}) {
  const tiles = [
    { icon: Trophy,    label: 'Dashboard',         onClick: onDashboard },
    { icon: Users,     label: 'My Leagues',        onClick: onMyLeagues },
    { icon: TrendingUp,label: 'Global Leaderboard',onClick: onLeaderboard },
    { icon: Search,    label: 'Join a League',     onClick: onJoin },
    { icon: UserPlus,  label: 'Invite Friends',    onClick: onInvite },
  ];

  return (
    <nav className="home-tiles" aria-label="Quick actions">
      {tiles.map(({ icon: Icon, label, onClick }) => (
        <button
          key={label}
          type="button"
          className="home-tile"
          onClick={onClick}
        >
          <span className="home-tile-icon" aria-hidden="true">
            <Icon size={18} />
          </span>
          <span className="home-tile-label">{label}</span>
        </button>
      ))}
    </nav>
  );
}
