/**
 * OfficialRules — full Official Rules page for the GoalOracle Prize
 * Contest. Rendered at /official-rules. Static (no auth required) so
 * search engines + cold ad clicks land on a complete legal document.
 *
 * Pulls all dates, prize amounts, sponsor info, and excluded
 * jurisdictions from src/config/legal.js so the rules + the in-product
 * surfaces never drift apart. Bracketed placeholders ([LAUNCH_DATE]
 * etc.) render visibly until real values land in legal.js.
 */

import React from 'react';
import {
  RULES_VERSION,
  SPONSOR_NAME,
  SPONSOR_DBA,
  SPONSOR_ADDRESS,
  PRIZES,
  PRIZE_DEFAULT_CURRENCY,
  PRIZE_ALT_CURRENCY,
  PRIZE_NETWORK,
  EXCLUDED_JURISDICTIONS,
  LAUNCH_DATE,
  GROUP_STAGE_LOCK_DATE,
  FINAL_DATE,
  WINNER_NOTIFICATION_WINDOW_DAYS,
  WINNER_RESPONSE_WINDOW_DAYS,
  WINNER_FORFEIT_WINDOW_DAYS,
  PAYOUT_WINDOW_DAYS,
  MIN_AGE,
  CONTEST_LEAGUE_ID,
} from '../config/legal';

export default function OfficialRules({ onNavPrivacy }) {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">Official Rules</h1>
          <p className="legal-subtitle">
            GoalOracle World Cup 2026 Prediction Contest
          </p>
          <p className="legal-meta">
            Version {RULES_VERSION} &middot; Effective {LAUNCH_DATE}
          </p>
        </header>

        <div className="legal-callout">
          <strong>NO PURCHASE NECESSARY.</strong> A purchase or payment of any kind will not increase your chances of winning. Void where prohibited.
        </div>

        <section className="legal-section">
          <h2>1. Sponsor</h2>
          <p>
            This contest is sponsored by <strong>{SPONSOR_DBA}</strong>, a Delaware limited liability company with its principal place of business at <strong>{SPONSOR_ADDRESS}</strong> (&ldquo;Sponsor&rdquo;).
          </p>
        </section>

        <section className="legal-section">
          <h2>2. Eligibility</h2>
          <p>
            Open to natural persons who, at the time of entry, (a) are at least <strong>{MIN_AGE} years old</strong>, (b) have a valid email address, and (c) are residents of an eligible jurisdiction. The following jurisdictions are <strong>excluded</strong>:
          </p>
          <ul>
            {EXCLUDED_JURISDICTIONS.map((j) => <li key={j}>{j}</li>)}
          </ul>
          <p>
            Employees of Sponsor, its affiliates, and immediate family members of such persons are not eligible. Void where prohibited or restricted by law.
          </p>
        </section>

        <section className="legal-section">
          <h2>3. Contest Period</h2>
          <p>
            Entry opens on <strong>{LAUNCH_DATE}</strong>. To be eligible, an entrant must submit predictions for the Group Stage of the FIFA World Cup 2026 before the Group Stage lock on <strong>{GROUP_STAGE_LOCK_DATE}</strong>. The contest concludes at the conclusion of the World Cup 2026 Final on <strong>{FINAL_DATE}</strong>.
          </p>
        </section>

        <section className="legal-section">
          <h2>4. How to Enter</h2>
          <p>
            <strong>FREE TO ENTER.</strong> To enter:
          </p>
          <ol>
            <li>Create a free GoalOracle account at goaloracle.io.</li>
            <li>You will be automatically enrolled in the Global League ({CONTEST_LEAGUE_ID}).</li>
            <li>Submit your predictions for the FIFA World Cup 2026 before the Group Stage lock.</li>
            <li>Confirm eligibility by accepting these Official Rules. Your acceptance is recorded with a timestamp and the version of the rules in effect.</li>
          </ol>
          <p>
            No purchase, payment, wager, or cryptocurrency wallet connection is required to enter. A wallet is required only to receive a prize if you win.
          </p>
          <p>
            Limit one (1) entry per natural person. Multiple accounts are prohibited and may result in disqualification of all entries linked to the same person.
          </p>
        </section>

        <section className="legal-section">
          <h2>5. Prizes</h2>
          <p>
            Total prize pool: <strong>${PRIZES.reduce((s, p) => s + p.amount, 0)} USD-equivalent</strong>, paid in {PRIZE_DEFAULT_CURRENCY} stablecoin ({PRIZE_ALT_CURRENCY} alternative available on request).
          </p>
          <ul className="legal-prize-list">
            {PRIZES.map((p) => (
              <li key={p.place}>
                <strong>{p.label}:</strong> ${p.amount} {p.currency}
              </li>
            ))}
          </ul>
          <p>
            Prizes are paid on the <strong>{PRIZE_NETWORK} network</strong>. Winner is responsible for receiving the prize at an EVM-compatible wallet address they control.
          </p>
        </section>

        <section className="legal-section">
          <h2>6. Winner Selection</h2>
          <p>
            Winners are determined by the top three (3) finishers on the Global League leaderboard at the conclusion of the FIFA World Cup 2026 Final. Scoring is based on prediction accuracy under the rules published on goaloracle.io.
          </p>
        </section>

        <section className="legal-section">
          <h2>7. Tie-Breaker</h2>
          <p>
            In the event of a tie in total points, the entrant with the <strong>earliest cumulative submission timestamp</strong> for their predictions wins. If a tie remains thereafter, Sponsor reserves the right to break the tie by random selection.
          </p>
        </section>

        <section className="legal-section">
          <h2>8. Winner Notification &amp; Wallet Requirement</h2>
          <p>
            Winners will be contacted via the email address registered with their GoalOracle account within <strong>{WINNER_NOTIFICATION_WINDOW_DAYS} days</strong> of the FIFA World Cup 2026 Final.
          </p>
          <p>
            To claim the prize, a winner must respond to the notification email within <strong>{WINNER_RESPONSE_WINDOW_DAYS} days</strong> and provide a valid EVM-compatible wallet address (e.g., MetaMask, Coinbase Wallet, Rainbow). Failure to respond within <strong>{WINNER_FORFEIT_WINDOW_DAYS} days</strong> of the original notification results in <strong>forfeiture</strong> of the prize, and Sponsor reserves the right to award the prize to the next eligible entrant or not award it at all, in its sole discretion.
          </p>
          <p>
            Sponsor will send the prize within <strong>{PAYOUT_WINDOW_DAYS} days</strong> of the winner providing a valid wallet address.
          </p>
        </section>

        <section className="legal-section">
          <h2>9. Tax Responsibility</h2>
          <p>
            Winners are solely responsible for any and all federal, state, local, and foreign taxes, duties, and assessments arising from acceptance or use of any prize. Sponsor may be required to issue tax forms (e.g., IRS Form 1099) and may request supporting information from winners as a condition of payout.
          </p>
        </section>

        <section className="legal-section">
          <h2>10. Publicity Rights</h2>
          <p>
            By accepting a prize, winners grant Sponsor the right to use their GoalOracle username and country flag for promotional purposes related to the contest, without further compensation, except where prohibited by law. Winners may opt out by contacting <a href="mailto:support@goaloracle.io" className="faq-link">support@goaloracle.io</a> within seven (7) days of notification.
          </p>
        </section>

        <section className="legal-section">
          <h2>11. General Conditions</h2>
          <p>
            Sponsor reserves the right, in its sole discretion, to disqualify any entrant found to be (a) tampering with the entry process or operation of the contest, (b) acting in violation of these Official Rules, or (c) acting in an unsportsmanlike or disruptive manner.
          </p>
          <p>
            Sponsor reserves the right to modify, suspend, or cancel the contest at any time for any reason, including but not limited to fraud, technical failure, or any factor beyond Sponsor&rsquo;s reasonable control. In such event, Sponsor may, at its sole discretion, award prizes from among eligible entries received up to the time of cancellation.
          </p>
          <p>
            Sponsor and its affiliates are not responsible for lost, late, incomplete, illegible, or misdirected entries; printing, technical, computer, network, human, or other errors; or for any technical malfunction.
          </p>
        </section>

        <section className="legal-section">
          <h2>12. Limitation of Liability</h2>
          <p>
            By entering, entrants release and hold harmless Sponsor and its affiliates, officers, directors, employees, and agents from any and all liability for any injuries, losses, or damages of any kind arising from or related to the contest or the acceptance, possession, use, or misuse of any prize.
          </p>
        </section>

        <section className="legal-section">
          <h2>13. Governing Law</h2>
          <p>
            This contest is governed by the laws of the <strong>State of Delaware, USA</strong>, without regard to its conflict-of-law principles.
          </p>
        </section>

        <section className="legal-section">
          <h2>14. Disputes &amp; Arbitration</h2>
          <p>
            Any dispute arising out of or relating to this contest shall be resolved by <strong>binding arbitration</strong> in Delaware, in accordance with the rules of the American Arbitration Association. Entrants agree to waive any right to participate in a class, collective, or representative action.
          </p>
        </section>

        <section className="legal-section">
          <h2>15. Privacy</h2>
          <p>
            Personal information collected from entrants is subject to GoalOracle&rsquo;s Privacy Policy.
            {onNavPrivacy && (
              <> See the <button type="button" className="faq-link" onClick={onNavPrivacy}>Privacy Policy</button> for details.</>
            )}
          </p>
        </section>

        <section className="legal-section">
          <h2>16. Sponsor Contact</h2>
          <p>
            For questions about these Official Rules, contact: <a href="mailto:support@goaloracle.io" className="faq-link">support@goaloracle.io</a>.
          </p>
          <p className="legal-meta">
            <strong>Sponsor:</strong> {SPONSOR_DBA}<br />
            <strong>Address:</strong> {SPONSOR_ADDRESS}<br />
            <strong>Effective Date:</strong> {LAUNCH_DATE}<br />
            <strong>Rules Version:</strong> {RULES_VERSION}
          </p>
        </section>
      </div>
    </div>
  );
}
