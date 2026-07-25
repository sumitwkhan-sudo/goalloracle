/**
 * PlayerProfile (/player/:userId) — a player's permanent tournament record:
 * global finish, badges, league placements. Reads ONE frozen, edge-cached
 * profile doc (written once at tournament finalization) — costs nothing per
 * view and never recomputes. Public + shareable by design.
 */

import React, { useEffect, useState } from 'react';
import { RefreshCw, GitBranch } from 'lucide-react';
import { fetchPlayerProfile } from '../utils/db';
import { badgeDef } from '../config/badges';
import { countryFlag } from '../utils/flags';

export default function PlayerProfile({ userId, onViewBracket, onGoHome, viewerLeagues = [] }) {
  const [state, setState] = useState({ loading: true, profile: null, notFound: false });

  useEffect(() => {
    let cancelled = false;
    if (!userId) { setState({ loading: false, profile: null, notFound: true }); return undefined; }
    fetchPlayerProfile(userId)
      .then((p) => { if (!cancelled) setState({ loading: false, profile: p, notFound: false }); })
      .catch(() => { if (!cancelled) setState({ loading: false, profile: null, notFound: true }); });
    return () => { cancelled = true; };
  }, [userId]);

  if (state.loading) {
    return <div className="profile-page"><div className="ll-loading"><RefreshCw size={16} className="spin" /> Loading profile…</div></div>;
  }
  if (state.notFound || !state.profile) {
    return (
      <div className="profile-page">
        <div className="profile-card">
          <h1>Profile not found</h1>
          <p className="profile-sub">This player&rsquo;s tournament record isn&rsquo;t available (profiles appear once a tournament is finalized).</p>
          <button type="button" className="btn btn-secondary" onClick={onGoHome}>← Back to GoalOracle</button>
        </div>
      </div>
    );
  }

  const { displayName, country, wc2026: s } = state.profile;

  return (
    <div className="profile-page">
      <div className="profile-card">
        <div className="profile-avatar" aria-hidden="true">{(displayName || '?')[0].toUpperCase()}</div>
        <h1 className="profile-name">
          {country && <span aria-hidden="true">{countryFlag(country)} </span>}
          {displayName}
        </h1>
        <p className="profile-sub">FIFA World Cup 2026 · GoalOracle record</p>

        {s && (
          <>
            <div className="profile-rankcard">
              <div className="profile-rank-big">#{s.rank?.toLocaleString?.() || s.rank}</div>
              <div className="profile-rank-meta">
                of {Number(s.total || 0).toLocaleString()} players worldwide
                {s.percentile != null && <> · <strong>top {s.percentile}%</strong></>}
                <br />{s.points} points
              </div>
            </div>

            {Array.isArray(s.badges) && s.badges.length > 0 && (
              <div className="profile-badges">
                {s.badges.map((id) => {
                  const b = badgeDef(id);
                  return (
                    <div key={id} className="profile-badge" title={b.desc}>
                      <span className="profile-badge-emoji" aria-hidden="true">{b.emoji}</span>
                      <span className="profile-badge-label">{b.label}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {Array.isArray(s.leagues) && s.leagues.length > 0 && (
              <div className="profile-leagues">
                <h2>Leagues &amp; pools ({s.leagues.length})</h2>
                {s.leagues.map((l, i) => {
                  // Private league names never come through the public
                  // profile API (name is null). Resolve them locally, but
                  // ONLY when the viewer is a member of that league — for
                  // everyone else the row stays a generic "Private league".
                  const mine = l.private ? viewerLeagues.find((v) => v?.id === l.id) : null;
                  const name = l.name || mine?.name || '🔒 Private league';
                  return (
                    <div key={i} className="profile-league-row">
                      <span className="profile-league-name">{l.rank === 1 ? '👑 ' : ''}{name}</span>
                      <span className="profile-league-rank">#{l.rank} of {l.total}</span>
                    </div>
                  );
                })}
              </div>
            )}

            {s.bestCall && (
              <p className="profile-bestcall">
                🎯 Best call: <strong>{s.bestCall.team}</strong> in {s.bestCall.roundLabel} — only {s.bestCall.pct}% of players saw it coming.
              </p>
            )}
          </>
        )}

        <div className="profile-actions">
          <button type="button" className="btn btn-primary" onClick={() => onViewBracket && onViewBracket(userId)}>
            <GitBranch size={14} aria-hidden="true" /> View their bracket
          </button>
          <button type="button" className="btn btn-ghost" onClick={onGoHome}>← GoalOracle</button>
        </div>
      </div>
    </div>
  );
}
