/**
 * QuickActionsTiles
 *
 * Equal-weight icon tiles for the logged-in landing page — My Leagues,
 * Global Leaderboard, Join a League, Create a League, Invite Friends. Same
 * card style + spacing across all. Create-a-League sits next to Join-a-League
 * so the two league-entry actions are visually paired. (Dashboard was removed
 * per product — its content surfaces directly on the home hero.)
 */

import React from 'react';
import { Users, TrendingUp, Search, PlusCircle, UserPlus } from 'lucide-react';

export default function QuickActionsTiles({
  onMyLeagues,
  onLeaderboard,
  onJoin,
  onCreate,
  onInvite,
}) {
  const tiles = [
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
