/**
 * QuickActionsTiles
 *
 * Six equal-weight icon tiles for the logged-in landing page —
 * Dashboard, My Leagues, Global Leaderboard, Join a League, Create
 * a League, Invite Friends. Same card style + spacing across all
 * six. Create-a-League sits next to Join-a-League so the two
 * league-entry actions are visually paired.
 *
 * Layout:
 *   Desktop (>720px): 6 in a row, equal width.
 *   Mobile  (<=720px): 3×2 grid (3 columns × 2 rows). 6 tiles is
 *   actually cleaner on mobile than the previous 5 — no need for
 *   the orphan-spanning hack the 5-tile version used.
 */

import React from 'react';
import { Trophy, Users, TrendingUp, Search, PlusCircle, UserPlus } from 'lucide-react';

export default function QuickActionsTiles({
  onDashboard,
  onMyLeagues,
  onLeaderboard,
  onJoin,
  onCreate,
  onInvite,
}) {
  const tiles = [
    { icon: Trophy,    label: 'Dashboard',         onClick: onDashboard },
    { icon: Users,     label: 'My Leagues',        onClick: onMyLeagues },
    { icon: TrendingUp,label: 'Global Leaderboard',onClick: onLeaderboard },
    { icon: Search,    label: 'Join a League',     onClick: onJoin },
    { icon: PlusCircle,label: 'Create a League',   onClick: onCreate },
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
