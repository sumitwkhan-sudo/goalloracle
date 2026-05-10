/**
 * ShareButtons — single share-target UI used everywhere a user can
 * push something out (their bracket, a referral link, a private-league
 * invite). Five buttons + same icon set:
 *
 *   X · Facebook · Instagram · Copy (caption / link) · More (native share)
 *
 * Caller passes the caption (`text`) and the URL it should link to.
 * Each button picks the right channel-specific format:
 *
 *   - X       → x.com/intent/tweet?text=<caption>
 *   - FB      → facebook.com/sharer/sharer.php?u=<url>&quote=<caption>
 *   - IG      → no API; copy caption to clipboard, then bounce to
 *               instagram.com so the user can paste into a story / post
 *   - Copy    → clipboard.write(`${caption}\n${url}`) so the recipient
 *               always gets a clickable link, not just text
 *   - More    → navigator.share() when available — falls back silently
 *               (button hidden) otherwise
 *
 * No layout opinion — caller controls the wrapping div with className.
 */

import React, { useState } from 'react';
import { Copy, Check, Share2 } from 'lucide-react';
import { track } from '../utils/track';

function buildCopyPayload(text, url) {
  if (!url) return text || '';
  if (!text) return url;
  // If the caption already mentions the URL (BracketShareModal does),
  // don't double it up — return as-is.
  if (text.includes(url)) return text;
  return `${text}\n${url}`;
}

export default function ShareButtons({
  text = '',
  url = '',
  copyLabel = 'Copy link',
  copiedLabel = 'Copied',
  trackEvent = 'share_completed',
  trackProps = {},
  notify,
  showNative = true,
}) {
  const [copied, setCopied] = useState(false);

  const encodedText = encodeURIComponent(text);
  const encodedUrl = encodeURIComponent(url);

  const openX = () => {
    track(trackEvent, { channel: 'x', ...trackProps });
    // X's compose endpoint takes both text and url params — passing
    // both means the URL gets unfurled to a card while the text is
    // still editable in the compose box.
    const u = url
      ? `https://x.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`
      : `https://x.com/intent/tweet?text=${encodedText}`;
    window.open(u, '_blank', 'noopener,noreferrer');
  };

  const openFacebook = () => {
    track(trackEvent, { channel: 'facebook', ...trackProps });
    window.open(
      `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}&quote=${encodedText}`,
      '_blank', 'noopener,noreferrer',
    );
  };

  const copyForInstagram = async () => {
    const payload = buildCopyPayload(text, url);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track(trackEvent, { channel: 'instagram', ...trackProps });
      notify?.('Caption copied — opening Instagram');
    } catch {
      notify?.('Copy failed', 'error');
      return;
    }
    const isMobile = typeof navigator !== 'undefined'
      && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || '');
    if (isMobile) window.location.href = 'https://www.instagram.com/';
    else window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
  };

  const copyText = async () => {
    const payload = buildCopyPayload(text, url);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      track(trackEvent, { channel: 'copy', ...trackProps });
      notify?.('Copied to clipboard');
    } catch {
      notify?.('Copy failed', 'error');
    }
  };

  const nativeShare = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'GoalOracle', text, url });
        track(trackEvent, { channel: 'native', ...trackProps });
      } catch {
        // user cancelled — silent
      }
    } else {
      copyText();
    }
  };

  const hasNative = typeof navigator !== 'undefined' && !!navigator.share;

  return (
    <div className="share-btn-strip">
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
      <button type="button" className="share-btn share-btn-copy" onClick={copyText}>
        {copied ? <><Check size={16} /> {copiedLabel}</> : <><Copy size={16} /> {copyLabel}</>}
      </button>
      {showNative && hasNative && (
        <button type="button" className="share-btn share-btn-native" onClick={nativeShare}>
          <Share2 size={16} /> More…
        </button>
      )}
    </div>
  );
}
