/**
 * PublicBracket
 *
 * Read-only public share page rendered at `/u/{userId}/bracket`. No auth
 * required — anyone with the link can see what the user predicted. Used
 * as the landing target for the share button so a tweet / WhatsApp link
 * actually shows the bracket instead of dropping the visitor on the
 * generic home page.
 *
 * Pulls a sanitized snapshot from `/api/public?type=bracket&userId=...`.
 * Append `?ref={userId}` to the URL when generating share links so we
 * can attribute new sign-ups to the referrer.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Trophy, Award, Share2, ChevronRight, RefreshCw, AlertTriangle, Users } from 'lucide-react';
import WORLD_CUP_MATCHES from '../data/matches';
import { ROUND_ORDER } from '../utils/bracketUtils';
import { getSimpleConsensus } from '../utils/db';

const ROUND_LABEL = {
  roundOf32: 'Round of 32',
  roundOf16: 'Round of 16',
  quarterFinals: 'Quarterfinals',
  semiFinals: 'Semifinals',
  thirdPlace: '3rd Place',
  final: 'Final',
};

function _flagFromCode(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const A = 0x1F1E6;
  const base = 'A'.charCodeAt(0);
  const cc = code.toUpperCase();
  return String.fromCodePoint(A + (cc.charCodeAt(0) - base), A + (cc.charCodeAt(1) - base));
}

function buildTeamFlags() {
  const flags = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) continue;
    if (m.home && m.homeFlag) flags[m.home] = m.homeFlag;
    if (m.away && m.awayFlag) flags[m.away] = m.awayFlag;
  }
  return flags;
}

export default function PublicBracket({ userId, onSignUp, authenticated = false }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const teamFlags = useMemo(buildTeamFlags, []);

  // Crowd consensus from the global Quick Picks league — used to render
  // "X% agree" chips next to champion / runner-up / 3rd. Fetch is fire-
  // and-forget; if it fails the chips just don't appear (the bracket
  // itself still renders).
  const [consensus, setConsensus] = useState(null);

  useEffect(() => {
    if (!userId) { setErr('Missing user'); setLoading(false); return; }
    let cancelled = false;
    (async () => {
      setLoading(true); setErr('');
      try {
        const res = await fetch(`/api/public?type=bracket&userId=${encodeURIComponent(userId)}`);
        const json = await res.json();
        if (cancelled) return;
        if (!res.ok) { setErr(json?.error || 'Failed to load'); return; }
        setData(json);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'Failed to load');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    getSimpleConsensus('global-simple')
      .then((c) => { if (!cancelled) setConsensus(c); })
      .catch(() => { /* non-fatal */ });
    return () => { cancelled = true; };
  }, [userId]);

  // Build a compact list of round → winner pairs for display.
  const roundWinners = useMemo(() => {
    if (!data?.knockoutPredictions) return [];
    const out = [];
    for (const r of ROUND_ORDER) {
      const picks = data.knockoutPredictions[r] || [];
      const filled = picks.filter(p => p && p.winnerId).length;
      out.push({ round: r, label: ROUND_LABEL[r], filled, total: r === 'roundOf32' ? 16 : r === 'roundOf16' ? 8 : r === 'quarterFinals' ? 4 : r === 'semiFinals' ? 2 : 1 });
    }
    return out;
  }, [data]);

  if (loading) {
    return (
      <div className="public-bracket">
        <div className="public-bracket-loading"><RefreshCw size={18} className="spin" /> Loading bracket…</div>
      </div>
    );
  }

  if (err || !data) {
    return (
      <div className="public-bracket">
        <div className="public-bracket-error">
          <AlertTriangle size={20} />
          <h2>This bracket isn't available</h2>
          <p>{err || 'The user may not have submitted picks yet.'}</p>
          <button type="button" className="btn btn-primary" onClick={onSignUp}>
            Make your own bracket <ChevronRight size={16} />
          </button>
        </div>
      </div>
    );
  }

  const winnerFlag = teamFlags[data.winner] || '';
  const runnerFlag = teamFlags[data.runnerUp] || '';
  const thirdFlag = teamFlags[data.thirdPlace] || '';
  const userFlag = _flagFromCode(data.country);

  // Outbound share — points back at this same URL, with a ?ref= so
  // sign-ups arriving via this link get attributed to the bracket owner.
  const shareUrl = (typeof window !== 'undefined')
    ? `${window.location.origin}/u/${encodeURIComponent(userId)}/bracket?ref=${encodeURIComponent(userId)}`
    : `https://goaloracle.io/u/${encodeURIComponent(userId)}/bracket?ref=${encodeURIComponent(userId)}`;
  const shareText = data.winner
    ? `🏆 ${data.displayName}'s World Cup 26 prediction: ${data.winner} beats ${data.runnerUp || 'TBD'}. Can you do better?`
    : `${data.displayName}'s World Cup 26 bracket on GoalOracle.`;
  const shareTwitter = () => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`, '_blank');
  const shareWhatsApp = () => window.open(`https://wa.me/?text=${encodeURIComponent(`${shareText} ${shareUrl}`)}`, '_blank');

  return (
    <div className="public-bracket">
      {/* Top CTA banner for visitors who aren't signed in. The bottom
          "Make your own bracket" button alone was easy to miss above
          the fold; a banner up here makes the value prop the first
          thing they see. */}
      {!authenticated && (
        <div className="public-bracket-cta-banner" role="region" aria-label="Make your prediction">
          <div className="public-bracket-cta-banner-text">
            <strong>Want to beat {data.displayName}?</strong>
            <span>Free FIFA World Cup 26 prediction game — make your bracket in 2 minutes.</span>
          </div>
          <button type="button" className="btn btn-primary" onClick={onSignUp}>
            Make my prediction <ChevronRight size={16} />
          </button>
        </div>
      )}
      <div className="public-bracket-card">
        <div className="public-bracket-head">
          <div className="public-bracket-who">
            {userFlag && <span className="public-bracket-flag" aria-hidden="true">{userFlag}</span>}
            <div>
              <div className="public-bracket-eyebrow">Predicting World Cup 26</div>
              <h1 className="public-bracket-name">{data.displayName}</h1>
            </div>
          </div>
          <div className="public-bracket-status">
            {data.isComplete ? <span className="pb-status pb-complete">Bracket complete</span> : <span className="pb-status pb-progress">In progress</span>}
          </div>
        </div>

        {data.winner ? (
          <div className="public-bracket-finals">
            <div className="public-bracket-final pb-final-winner">
              <span className="pb-role"><Trophy size={14} /> Champion</span>
              <span className="pb-team">{winnerFlag} {data.winner}</span>
              {consensus && consensus.champion?.[data.winner] != null && (
                <span className="pb-consensus" title="Share of GoalOracle users who picked the same champion">
                  <Users size={11} /> {Math.round(consensus.champion[data.winner] * 100)}% agree
                </span>
              )}
            </div>
            <div className="public-bracket-final pb-final-runner">
              <span className="pb-role"><Award size={14} /> Runner-up</span>
              <span className="pb-team">{runnerFlag} {data.runnerUp || 'TBD'}</span>
              {consensus && data.runnerUp && consensus.runnerUp?.[data.runnerUp] != null && (
                <span className="pb-consensus">
                  <Users size={11} /> {Math.round(consensus.runnerUp[data.runnerUp] * 100)}% agree
                </span>
              )}
            </div>
            {data.thirdPlace && (
              <div className="public-bracket-final pb-final-third">
                <span className="pb-role">3rd place</span>
                <span className="pb-team">{thirdFlag} {data.thirdPlace}</span>
                {consensus && consensus.thirdPlace?.[data.thirdPlace] != null && (
                  <span className="pb-consensus">
                    <Users size={11} /> {Math.round(consensus.thirdPlace[data.thirdPlace] * 100)}% agree
                  </span>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="public-bracket-empty">
            <p>{data.displayName} hasn't picked a winner yet.</p>
          </div>
        )}

        <div className="public-bracket-rounds">
          <h3>Round-by-round</h3>
          <ul>
            {roundWinners.map(r => (
              <li key={r.round} className={r.filled === r.total ? 'is-complete' : r.filled === 0 ? 'is-empty' : 'is-partial'}>
                <span>{r.label}</span>
                <strong>{r.filled} / {r.total}</strong>
              </li>
            ))}
          </ul>
        </div>

        <div className="public-bracket-actions">
          <button type="button" className="btn btn-primary btn-lg" onClick={onSignUp}>
            {authenticated ? <>Open my dashboard <ChevronRight size={16} /></> : <>Make my prediction <ChevronRight size={16} /></>}
          </button>
          <div className="public-bracket-share">
            <button type="button" className="btn btn-secondary btn-sm" onClick={shareTwitter}>
              <Share2 size={14} /> Share on X
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={shareWhatsApp}>
              <Share2 size={14} /> WhatsApp
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
