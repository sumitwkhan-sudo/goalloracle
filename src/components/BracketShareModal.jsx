/**
 * BracketShareModal
 *
 * Lets a user share their Quick Picks bracket — champion, runner-up, and
 * third place — via X, Facebook, Instagram (copy-to-caption), or a copied
 * link / screenshot. The preview card is laid out so a phone screenshot
 * looks good as-is on social.
 */

import React, { useEffect } from 'react';
import { X, Trophy, Award, Camera, Flame } from 'lucide-react';
import { track } from '../utils/track';
import ShareButtons from './ShareButtons';
import { biggestUpset, ROUND_LABELS } from '../utils/bracketInsights';
import { teamFlags } from '../utils/flags';

const SITE_URL = 'https://goaloracle.io';

// Build a share URL that deep-links to the specific league so unfurls
// (Phase 4 middleware will inject per-league OG tags for crawlers) and clicks
// drop the recipient straight into the league detail view rather than the
// generic landing page.
function buildShareUrl(userId, leagueId) {
  // Prefer the public bracket page (`/u/{userId}/bracket`) so the
  // recipient lands on the actual prediction, not the generic home page.
  // Append `?ref={userId}` so any sign-up arriving via this link gets
  // attributed to the bracket owner. Falls back to a league deep link
  // if we don't have a userId for some reason, then to the home page.
  const origin = (typeof window !== 'undefined' && window.location?.origin) || SITE_URL;
  if (userId) return `${origin}/u/${encodeURIComponent(userId)}/bracket?ref=${encodeURIComponent(userId)}`;
  if (leagueId) return `${origin}/league/${encodeURIComponent(leagueId)}`;
  return origin;
}

function buildCaption({ displayName, leagueName, winner, runnerUp, thirdPlace, shareUrl, rarityPct }) {
  const you = displayName || 'I';
  const lg = leagueName ? ` (${leagueName})` : '';
  const lines = [
    `🏆 My GoalOracle${lg} bracket:`,
    `Champion: ${winner?.flag || ''} ${winner?.name || 'TBD'}`.trim(),
    `Runner-up: ${runnerUp?.flag || ''} ${runnerUp?.name || 'TBD'}`.trim(),
  ];
  if (thirdPlace?.name) lines.push(`Third: ${thirdPlace.flag || ''} ${thirdPlace.name}`.trim());
  // Drop the rarity hook into the caption when we have it — gives the
  // share text a contrarian / consensus brag worth retweeting.
  if (typeof rarityPct === 'number' && rarityPct >= 0 && rarityPct <= 99) {
    lines.push('', `🎯 ${rarityPct}% more unique than the average bracket`);
  }
  lines.push('', `Beat ${you === 'I' ? 'me' : you}: ${shareUrl || SITE_URL}`, '#GoalOracle #WorldCup26');
  return lines.join('\n');
}

export default function BracketShareModal({
  open,
  onClose,
  displayName,
  leagueName,
  leagueId,     // optional — when provided, share URLs deep-link to the league
  userId,       // optional — when provided, share URLs use the public /u/{userId}/bracket page
  winner,       // { name, flag }
  runnerUp,     // { name, flag }
  thirdPlace,   // { name, flag } — optional
  rarityPct,    // optional — rarity score appended to the caption
  knockoutPredictions, // optional — used to compute "biggest upset" insight
  notify,
}) {
  useEffect(() => {
    if (open) track('share_opened', { league_id: leagueId || null });
  }, [open, leagueId]);
  if (!open) return null;

  const shareUrl = buildShareUrl(userId, leagueId);
  const caption = buildCaption({ displayName, leagueName, winner, runnerUp, thirdPlace, shareUrl, rarityPct });
  // Surface the user's biggest upset (lowest-FIFA-ranked team they
  // picked to advance furthest) — same calc as BracketInsightsRow so
  // the share card matches what they see on the dashboard.
  const upset = biggestUpset(knockoutPredictions);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="bracket-share-modal" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <X size={20} />
        </button>

        {/* Screenshot-friendly preview */}
        <div className="bracket-share-card" id="bracket-share-card">
          <div className="bsc-brand">
            <span className="bsc-brand-name">GoalOracle</span>
            <span className="bsc-brand-dot">•</span>
            <span className="bsc-brand-mode">World Cup 26</span>
          </div>
          <div className="bsc-heading">
            My World Cup 26 bracket
            {displayName && <span className="bsc-author"> — {displayName}</span>}
          </div>

          <div className="bsc-row bsc-row-winner">
            <div className="bsc-row-icon"><Trophy size={18} /></div>
            <div className="bsc-row-main">
              <div className="bsc-row-label">Champion</div>
              <div className="bsc-row-team">
                <span className="bsc-flag">{winner?.flag || '🏳️'}</span>
                <span className="bsc-name">{winner?.name || 'TBD'}</span>
              </div>
            </div>
          </div>

          <div className="bsc-row bsc-row-runner">
            <div className="bsc-row-icon"><Award size={18} /></div>
            <div className="bsc-row-main">
              <div className="bsc-row-label">Runner-up</div>
              <div className="bsc-row-team">
                <span className="bsc-flag">{runnerUp?.flag || '🏳️'}</span>
                <span className="bsc-name">{runnerUp?.name || 'TBD'}</span>
              </div>
            </div>
          </div>

          {thirdPlace?.name && (
            <div className="bsc-row bsc-row-third">
              <div className="bsc-row-icon"><Award size={16} /></div>
              <div className="bsc-row-main">
                <div className="bsc-row-label">Third place</div>
                <div className="bsc-row-team">
                  <span className="bsc-flag">{thirdPlace.flag || '🏳️'}</span>
                  <span className="bsc-name">{thirdPlace.name}</span>
                </div>
              </div>
            </div>
          )}

          {upset && (
            <div className="bsc-insight">
              <Flame size={14} aria-hidden="true" />
              <span className="bsc-insight-label">Biggest upset</span>
              <span className="bsc-insight-team">
                {teamFlags[upset.team] || '🏳️'} {upset.team}
                <span className="bsc-insight-sub"> → {ROUND_LABELS[upset.round]}</span>
              </span>
            </div>
          )}

          <div className="bsc-footer">
            <span>Can you beat me?</span>
            <strong>goaloracle.io</strong>
          </div>
          <div className="bsc-tags">#GoalOracle #WorldCup26</div>
        </div>

        <p className="bracket-share-hint">
          <Camera size={14} /> On iPhone / Android, screenshot the card above to share as an image on
          Instagram, WhatsApp, or any platform. Or use the quick-share buttons below.
        </p>

        <ShareButtons
          text={caption}
          url={shareUrl}
          copyLabel="Copy caption"
          trackEvent="share_completed"
          trackProps={{ league_id: leagueId || null }}
          notify={notify}
        />
      </div>
    </div>
  );
}
