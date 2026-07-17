/**
 * TipJar — self-contained tip button + modal (trigger and modal in one, so
 * placements are a single tag with no state threading).
 *
 * Variants:
 *   'footer'  — slim text link for footer strips ("💛 Tip the builder")
 *   'menu'    — account-dropdown-style row
 *   'inline'  — soft card for high-goodwill pages (survey thank-you)
 *
 * Renders nothing until src/config/tips.js is configured (safe to ship).
 * Payment rails: Stripe Payment Link (card/Apple Pay/Google Pay — hosted by
 * Stripe, nothing sensitive touches our code) and direct USDC on Polygon
 * (address + copy). Tips never affect gameplay or prizes — stated in-modal.
 */

import React, { useState } from 'react';
import { Heart, Copy, CheckCircle, ExternalLink, X } from 'lucide-react';
import { TIP_STRIPE_URL, TIP_WALLET_ADDRESS, TIP_WALLET_NETWORK, tipsConfigured } from '../config/tips';
import { track } from '../utils/track';

export default function TipJar({ variant = 'footer' }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!tipsConfigured()) return null;

  const openModal = () => {
    setOpen(true);
    setCopied(false);
    try { track('tip_modal_opened', { source: variant }); } catch { /* analytics only */ }
  };

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(TIP_WALLET_ADDRESS);
      setCopied(true);
      try { track('tip_address_copied', { source: variant }); } catch { /* analytics only */ }
      setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('Wallet address (copy this):', TIP_WALLET_ADDRESS);
    }
  };

  const cardClick = () => {
    try { track('tip_card_clicked', { source: variant }); } catch { /* analytics only */ }
    window.open(TIP_STRIPE_URL, '_blank', 'noopener,noreferrer');
  };

  const trigger = variant === 'menu' ? (
    <button type="button" className="dropdown-item" onClick={(e) => { e.stopPropagation(); openModal(); }}>
      <Heart size={16} />
      <span>Tip the builder</span>
    </button>
  ) : variant === 'inline' ? (
    <div className="tipjar-inline">
      <p>
        <strong>Enjoyed the ride?</strong> GoalOracle is built and run by one person.
        A small tip keeps it alive for the next tournament.
      </p>
      <button type="button" className="btn btn-primary btn-sm" onClick={openModal}>
        <Heart size={14} aria-hidden="true" /> Leave a tip
      </button>
    </div>
  ) : (
    <button type="button" className="home-footer-strip-link tipjar-footer-link" onClick={openModal}>
      💛 Tip the builder
    </button>
  );

  return (
    <>
      {trigger}
      {open && (
        <div className="modal-overlay" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Tip the builder">
          <div className="confirm-dialog tipjar-dialog" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="tipjar-close" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button>
            <div className="tipjar-emoji" aria-hidden="true">💛</div>
            <h2 className="confirm-dialog-title">Enjoying GoalOracle?</h2>
            <p className="confirm-dialog-msg">
              Every bracket, league, and leaderboard here was built by <strong>one person</strong> —
              no company, no ads, free to play. If GoalOracle made your World Cup more fun,
              a small tip genuinely helps keep it running and brings the next tournament to life.
            </p>
            {TIP_STRIPE_URL && (
              <button type="button" className="btn btn-primary tipjar-card-btn" onClick={cardClick}>
                ☕ Tip with card — takes 20 seconds <ExternalLink size={13} aria-hidden="true" />
              </button>
            )}
            {TIP_WALLET_ADDRESS && (
              <div className="tipjar-crypto">
                <span className="tipjar-crypto-label">{TIP_STRIPE_URL ? 'Or send crypto' : 'Send crypto'} · {TIP_WALLET_NETWORK}</span>
                <div className="tipjar-crypto-row">
                  <code className="tipjar-addr">{TIP_WALLET_ADDRESS.slice(0, 10)}…{TIP_WALLET_ADDRESS.slice(-8)}</code>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={copyAddress}>
                    {copied ? <><CheckCircle size={13} aria-hidden="true" /> Copied</> : <><Copy size={13} aria-hidden="true" /> Copy address</>}
                  </button>
                </div>
              </div>
            )}
            <p className="tipjar-fineprint">
              Tips are completely optional and never affect gameplay, scoring, or prize eligibility.
              Thank you. — Sumit
            </p>
          </div>
        </div>
      )}
    </>
  );
}
