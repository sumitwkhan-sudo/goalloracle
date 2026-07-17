/**
 * tips.js — tip-jar configuration (single source of truth).
 *
 * The TipJar UI renders NOTHING until at least one of these is filled in, so
 * this ships safely with placeholders. To go live:
 *
 *  1. Card / Apple Pay / Google Pay: create a Payment Link in the Stripe
 *     dashboard (Products → Payment Links → "Customers choose what to pay",
 *     suggested presets e.g. $3 / $5 / $10) and paste the https://buy.stripe.com/…
 *     URL below. No API keys, no webhooks, no PCI scope — Stripe hosts the
 *     whole checkout. Optionally enable "Pay with crypto" on the same link.
 *
 *  2. Direct USDC: paste the receiving EVM wallet address (Polygon — same
 *     network the prize payouts use).
 *
 * Tips are optional and must never affect gameplay, scoring, or prize
 * eligibility (the contest stays free-to-play — the UI states this).
 */

export const TIP_STRIPE_URL = '';   // e.g. 'https://buy.stripe.com/xxxx'
export const TIP_WALLET_ADDRESS = ''; // e.g. '0xAbC…' (EVM, Polygon)
export const TIP_WALLET_NETWORK = 'USDC or POL on Polygon';

export function tipsConfigured() {
  return !!(TIP_STRIPE_URL || TIP_WALLET_ADDRESS);
}
