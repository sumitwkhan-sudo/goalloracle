/**
 * BracketShareModal
 *
 * Lets a user share their Quick Picks bracket — champion, runner-up, and
 * third place — via X, Facebook, Instagram (copy-to-caption), or a copied
 * link / screenshot. The preview card is laid out so a phone screenshot
 * looks good as-is on social.
 */

import React, { useState, useEffect } from 'react';
import { X, Copy, Check, Trophy, Award, Camera, Share2 } from 'lucide-react';
import { track } from '../utils/track';

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

function buildCaption({ displayName, leagueName, winner, runnerUp, thirdPlace, shareUrl }) {
  const you = displayName || 'I';
  const lg = leagueName ? ` (${leagueName})` : '';
  const lines = [
    `🏆 My GoalOracle${lg} bracket:`,
    `Champion: ${winner?.flag || ''} ${winner?.name || 'TBD'}`.trim(),
    `Runner-up: ${runnerUp?.flag || ''} ${runnerUp?.name || 'TBD'}`.trim(),
  ];
  if (thirdPlace?.name) lines.push(`Third: ${thirdPlace.flag || ''} ${thirdPlace.name}`.trim());
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
  notify,
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (open) track('share_opened', { league_id: leagueId || null });
  }, [open, leagueId]);
  if (!open) return null;

  const shareUrl = buildShareUrl(userId, leagueId);
  const caption = buildCaption({ displayName, leagueName, winner, runnerUp, thirdPlace, shareUrl });
  const encoded = encodeURIComponent(caption);

  const openX = () => {
    track('share_completed', { channel: 'x', league_id: leagueId || null });
    window.open(`https://x.com/intent/tweet?text=${encoded}`, '_blank', 'noopener,noreferrer');
  };
  const openFacebook = () => {
    // FB sharer reads og: tags from the URL; caption goes as a quote.
    track('share_completed', { channel: 'facebook', league_id: leagueId || null });
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encoded}`,
      '_blank', 'noopener,noreferrer',
    );
  };
  const copyForInstagram = async () => {
    // Instagram web doesn't accept prefilled captions, so we copy the text
    // so the user can paste into a new post/story.
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track('share_completed', { channel: 'instagram', league_id: leagueId || null });
      if (notify) notify('Caption copied — paste into Instagram');
    } catch {
      if (notify) notify('Copy failed', 'error');
    }
  };
  const copyCaption = async () => {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track('share_completed', { channel: 'copy', league_id: leagueId || null });
      if (notify) notify('Copied to clipboard');
    } catch {
      if (notify) notify('Copy failed', 'error');
    }
  };
  const nativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'My GoalOracle bracket', text: caption, url: shareUrl });
        track('share_completed', { channel: 'native', league_id: leagueId || null });
      } catch {
        // user cancelled — no-op
      }
    } else {
      copyCaption();
    }
  };

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
            <span className="bsc-brand-mode">Quick Picks</span>
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

        <div className="bracket-share-actions">
          <button type="button" className="share-btn share-btn-x" onClick={openX}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
              <path d="M18.244 2H21.5l-7.49 8.56L22.5 22h-6.83l-5.35-6.99L4.3 22H1.04l8.01-9.16L1.5 2h6.93l4.83 6.38L18.244 2zm-1.19 18h1.82L7.05 4H5.1l11.95 16z" />
            </svg>
            Share on X
          </button>
          <button type="button" className="share-btn share-btn-fb" onClick={openFacebook}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor">
              <path d="M13.5 22v-8h2.7l.4-3.13H13.5V8.87c0-.9.25-1.52 1.55-1.52h1.65V4.56c-.3-.04-1.27-.13-2.4-.13-2.37 0-4 1.45-4 4.1v2.34H7.5V14h2.8v8h3.2z" />
            </svg>
            Facebook
          </button>
          <button type="button" className="share-btn share-btn-ig" onClick={copyForInstagram}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="4" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
            Instagram
          </button>
          <button type="button" className="share-btn share-btn-copy" onClick={copyCaption}>
            {copied ? <><Check size={16} /> Copied</> : <><Copy size={16} /> Copy caption</>}
          </button>
          {typeof navigator !== 'undefined' && navigator.share && (
            <button type="button" className="share-btn share-btn-native" onClick={nativeShare}>
              <Share2 size={16} /> More…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
