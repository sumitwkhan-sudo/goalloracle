/**
 * PrivacyPolicy — full GoalOracle privacy policy. Rendered at /privacy.
 * Static (no auth required) so Reddit / Meta ad reviewers and cold
 * crawlers land on a complete legal document.
 *
 * Pulls sponsor info, age threshold, and effective date constants
 * from src/config/legal.js so the policy and the rest of the product
 * never drift apart. Designed to satisfy:
 *
 *   - Reddit's ad policy disclosure requirements (cookies, tracking,
 *     advertising pixels, retargeting, age targeting)
 *   - Meta's ad policy disclosure requirements (custom audiences,
 *     personalized advertising, opt-out)
 *   - CCPA / CPRA (California) — including the "Do Not Sell or
 *     Share My Personal Information" disclosure required for any site
 *     using cross-context behavioral advertising (we use AdRoll)
 *   - GDPR / UK GDPR — lawful basis, data subject rights, transfers
 *   - General good-faith disclosure of every third-party processor
 */

import React from 'react';
import {
  SPONSOR_NAME,
  SPONSOR_DBA,
  SPONSOR_ADDRESS,
  MIN_AGE,
  LAUNCH_DATE,
} from '../config/legal';

const EFFECTIVE_DATE = LAUNCH_DATE;
const POLICY_VERSION = '1.0.0';
const CONTACT_EMAIL = 'support@goaloracle.io';
const PRIVACY_EMAIL = 'privacy@goaloracle.io';

export default function PrivacyPolicy() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">Privacy Policy</h1>
          <p className="legal-subtitle">
            How GoalOracle collects, uses, shares, and protects your information.
          </p>
          <p className="legal-meta">
            Version {POLICY_VERSION} &middot; Effective {EFFECTIVE_DATE}
          </p>
        </header>

        <div className="legal-callout">
          <strong>Plain-English summary.</strong> We collect the minimum we need to run a free
          World Cup prediction game: an account identifier from your sign-in provider, your
          display name and country, the predictions you make, and basic device data. We share
          some of this with the third-party services that host, secure, and measure our
          product. We do not sell your personal information. We use advertising pixels
          (including AdRoll, Meta, and Reddit) to show GoalOracle ads to people who&apos;ve
          visited the site — you can opt out at any time. The full details are below.
        </div>

        {/* 1. Who we are */}
        <section className="legal-section">
          <h2 className="legal-section-title">1. Who we are</h2>
          <p>
            GoalOracle (&ldquo;GoalOracle,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
            &ldquo;our&rdquo;) is operated by {SPONSOR_DBA}, a Delaware limited liability
            company with its registered office at {SPONSOR_ADDRESS}. This Privacy Policy
            applies to information collected through goaloracle.io and any related subdomains,
            services, and applications (collectively, the &ldquo;Service&rdquo;).
          </p>
          <p>
            If you have questions about this policy or want to exercise any of the rights
            described below, email us at <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>{' '}
            or <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
          </p>
        </section>

        {/* 2. Information we collect */}
        <section className="legal-section">
          <h2 className="legal-section-title">2. Information we collect</h2>
          <p>We collect the following categories of information:</p>

          <h3 className="legal-subhead">2.1 Information you provide</h3>
          <ul className="legal-list">
            <li>
              <strong>Account information.</strong> When you sign in via our authentication
              provider (Privy), we receive a unique account identifier and, depending on the
              sign-in method you choose, an email address or social identifier (e.g., a Google
              or Twitter/X account ID). You may optionally provide a display name and your
              country of residence.
            </li>
            <li>
              <strong>Predictions and game activity.</strong> The bracket picks, group
              rankings, scores, league memberships, and other choices you make inside the
              product.
            </li>
            <li>
              <strong>Contest eligibility data.</strong> If you are eligible for a prize
              contest, we record your attestation that you are at least {MIN_AGE} years old
              and that you reside in a jurisdiction where free skill-based contests are
              permitted, together with a timestamp of that attestation.
            </li>
            <li>
              <strong>Wallet address (optional).</strong> Privy provisions an embedded
              cryptocurrency wallet at signup for potential future features and prize
              payouts. We never hold custody of your wallet&apos;s keys; Privy does. The
              wallet address itself is stored on your user record so that we can deliver a
              prize to you if you win.
            </li>
            <li>
              <strong>User-generated content.</strong> League names, House Rules text,
              feedback you submit through our forms, and any content you post in shared
              league surfaces.
            </li>
          </ul>

          <h3 className="legal-subhead">2.2 Information collected automatically</h3>
          <ul className="legal-list">
            <li>
              <strong>Device and connection data.</strong> IP address, user-agent string,
              operating system, browser type, screen size, language, and timezone.
            </li>
            <li>
              <strong>Usage data.</strong> Pages visited, features used, buttons clicked,
              time spent on pages, referring URL, and similar interaction events.
            </li>
            <li>
              <strong>Device fingerprint.</strong> We compute a non-cryptographic, lossy
              hash of selected browser characteristics as a deterrent against duplicate
              accounts. The fingerprint is not used to identify you across the open web; it
              is only compared against other accounts on our own service.
            </li>
            <li>
              <strong>Cookies, pixels, and similar technologies.</strong> See Section 5 for
              a full breakdown.
            </li>
          </ul>

          <h3 className="legal-subhead">2.3 Information from third parties</h3>
          <ul className="legal-list">
            <li>
              <strong>Authentication providers.</strong> When you sign in with Google,
              Twitter/X, email, or another supported method via Privy, we receive the basic
              account identifier and any profile fields you have authorized.
            </li>
            <li>
              <strong>Advertising platforms.</strong> When you click a GoalOracle ad on
              Reddit, Meta (Facebook/Instagram), or another platform, that platform may pass
              us a click identifier so we can attribute the visit to the campaign. We do not
              receive any underlying account information from those platforms.
            </li>
          </ul>
        </section>

        {/* 3. How we use it */}
        <section className="legal-section">
          <h2 className="legal-section-title">3. How we use information</h2>
          <p>We use the information we collect for the following purposes:</p>
          <ul className="legal-list">
            <li>
              <strong>Provide and operate the Service</strong> &mdash; authenticate you,
              save your predictions, maintain leaderboards, deliver league features,
              process eligibility, and (where applicable) deliver prize payouts.
            </li>
            <li>
              <strong>Improve the Service</strong> &mdash; understand which features are
              used, diagnose bugs, A/B-test improvements, and measure the performance of
              individual product surfaces.
            </li>
            <li>
              <strong>Protect the Service</strong> &mdash; detect and prevent fraud,
              duplicate accounts, automated abuse, and violations of our Terms.
            </li>
            <li>
              <strong>Communicate with you</strong> &mdash; respond to support requests
              and, where applicable, notify you about contest outcomes or material changes
              to our Service.
            </li>
            <li>
              <strong>Advertise the Service</strong> &mdash; measure the performance of our
              ad campaigns and show GoalOracle ads to people who have visited our site or
              who match similar profiles, on platforms including Reddit, Meta, Google, and
              AdRoll&apos;s network.
            </li>
            <li>
              <strong>Comply with legal obligations</strong> &mdash; including sanctions
              screening on prize payouts and responding to lawful requests from regulators
              or law enforcement.
            </li>
          </ul>

          <p>
            <strong>Lawful basis (EU/UK users).</strong> We process your data under one or
            more of the following lawful bases under the GDPR / UK GDPR: performance of a
            contract (delivering the Service you signed up for), our legitimate interests
            (running, securing, and improving the Service), your consent (for non-essential
            cookies and personalized advertising where required), and compliance with legal
            obligations.
          </p>
        </section>

        {/* 4. How we share it */}
        <section className="legal-section">
          <h2 className="legal-section-title">4. How we share information</h2>
          <p>We share information in the following circumstances:</p>

          <h3 className="legal-subhead">4.1 Service providers (sub-processors)</h3>
          <p>
            We use the following third parties to operate the Service. Each is contractually
            obligated to handle your information only on our instructions and to protect it
            with appropriate safeguards:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Privy</strong> &mdash; authentication, identity, and embedded wallet
              provisioning.
            </li>
            <li>
              <strong>Google / Firebase</strong> &mdash; database (Firestore), authentication
              token exchange, and serverless infrastructure.
            </li>
            <li>
              <strong>Vercel</strong> &mdash; web hosting, edge functions, and CDN.
            </li>
            <li>
              <strong>Google Analytics 4</strong> &mdash; aggregated product analytics.
            </li>
            <li>
              <strong>PostHog</strong> &mdash; product analytics, funnel measurement, and
              feature usage events. Data is processed on PostHog&apos;s US Cloud.
            </li>
            <li>
              <strong>Microsoft Clarity</strong> &mdash; session recordings and heatmaps,
              used to diagnose usability problems.
            </li>
            <li>
              <strong>AdRoll (NextRoll, Inc.)</strong> &mdash; advertising pixel for
              retargeting and ad-campaign measurement across AdRoll&apos;s ad network.
            </li>
            <li>
              <strong>Reddit, Meta, Google, and other advertising platforms</strong> &mdash;
              when we run ads on these platforms, their advertising pixels and conversion
              APIs receive event data necessary to measure and optimize our campaigns.
            </li>
            <li>
              <strong>Football data providers</strong> (football-data.org, api-football.com)
              &mdash; we receive match results from these providers; we do not transmit your
              personal data to them.
            </li>
          </ul>

          <h3 className="legal-subhead">4.2 Other GoalOracle users</h3>
          <p>
            Your display name, country flag, and your public bracket and leaderboard
            standing are visible to other GoalOracle users in the leagues you join and on
            public leaderboards. Do not include sensitive information in your display name
            or any user-generated content.
          </p>

          <h3 className="legal-subhead">4.3 Legal compliance and protection</h3>
          <p>
            We may disclose information when we believe in good faith that disclosure is
            necessary to comply with applicable law, respond to a valid legal process (e.g.,
            a subpoena or court order), enforce our Terms, protect the rights, property, or
            safety of GoalOracle, our users, or the public, or comply with our sanctions
            obligations described in our <a href="/terms">Terms</a> and{' '}
            <a href="/official-rules">Official Rules</a>.
          </p>

          <h3 className="legal-subhead">4.4 Business transfers</h3>
          <p>
            If GoalOracle (or {SPONSOR_NAME}) is involved in a merger, acquisition,
            reorganization, financing, or sale of all or a portion of its assets, your
            information may be transferred to the successor entity. We will continue to
            honor the commitments made in this Privacy Policy, or notify you and provide a
            choice if any material change applies.
          </p>

          <h3 className="legal-subhead">4.5 What we do not do</h3>
          <p>
            We do not sell your personal information for money. We do not share your
            information with data brokers. We do not use your information to train
            third-party AI models. Our use of advertising pixels for retargeting is
            considered &ldquo;sharing for cross-context behavioral advertising&rdquo; under
            California law; see Section 7 for how to opt out.
          </p>
        </section>

        {/* 5. Cookies and tracking */}
        <section className="legal-section">
          <h2 className="legal-section-title">5. Cookies, pixels, and similar technologies</h2>
          <p>
            We and our service providers use cookies, pixels, local storage, and similar
            technologies to operate the Service. The categories in use are:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Strictly necessary</strong> &mdash; session and authentication
              cookies set by Privy and Firebase. These cannot be turned off without breaking
              the sign-in flow. Local storage entries used to remember in-progress
              predictions, House Rules acknowledgments, and theme preferences also fall in
              this category.
            </li>
            <li>
              <strong>Analytics</strong> &mdash; Google Analytics 4, PostHog, and Microsoft
              Clarity. These help us understand which features are used, where users get
              stuck, and how to improve the product.
            </li>
            <li>
              <strong>Advertising</strong> &mdash; AdRoll, Meta (Facebook Pixel, when
              enabled), Reddit Pixel (when enabled), and similar tags. These are used to
              measure ad campaign performance and to show GoalOracle ads to people who have
              visited the site (retargeting).
            </li>
          </ul>
          <p>
            <strong>How to control these technologies.</strong> Most browsers let you reject
            or delete cookies. You can also opt out of cross-site advertising tracking at
            industry-wide pages such as <a href="https://optout.aboutads.info/" target="_blank" rel="noopener noreferrer">optout.aboutads.info</a>{' '}
            (Digital Advertising Alliance), <a href="https://www.networkadvertising.org/choices/" target="_blank" rel="noopener noreferrer">networkadvertising.org/choices</a>{' '}
            (Network Advertising Initiative), and <a href="https://youronlinechoices.eu/" target="_blank" rel="noopener noreferrer">youronlinechoices.eu</a>{' '}
            (European users). You can opt out of AdRoll specifically at{' '}
            <a href="https://app.adroll.com/optout/safari" target="_blank" rel="noopener noreferrer">app.adroll.com/optout</a>.
            For Google Analytics, install the{' '}
            <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener noreferrer">Google Analytics opt-out browser add-on</a>.
            Note that some browser-level signals such as Global Privacy Control (GPC) and Do
            Not Track will also be respected where supported by our service providers.
          </p>
        </section>

        {/* 6. Your rights */}
        <section className="legal-section">
          <h2 className="legal-section-title">6. Your rights and choices</h2>
          <p>
            Subject to the limits of applicable law, you have the following rights with
            respect to your personal information:
          </p>
          <ul className="legal-list">
            <li><strong>Access</strong> &mdash; ask for a copy of the personal information we hold about you.</li>
            <li><strong>Correction</strong> &mdash; ask us to correct information that is inaccurate or incomplete.</li>
            <li><strong>Deletion</strong> &mdash; ask us to delete your account and the personal information associated with it.</li>
            <li><strong>Portability</strong> &mdash; ask for a machine-readable copy of the personal information you have provided to us.</li>
            <li><strong>Objection / restriction</strong> &mdash; object to certain uses of your information, including for direct marketing and certain analytics.</li>
            <li><strong>Withdrawal of consent</strong> &mdash; where we rely on your consent, you may withdraw it at any time without affecting the lawfulness of prior processing.</li>
            <li><strong>Opt-out of personalized advertising</strong> &mdash; see Section 7.</li>
            <li><strong>Complain to a regulator</strong> &mdash; you may lodge a complaint with your local data protection authority.</li>
          </ul>
          <p>
            To exercise any of these rights, email{' '}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> from the address on file
            with your account (or otherwise sufficient to verify identity). We will respond
            within the timeframe required by applicable law (typically 30&ndash;45 days).
          </p>
        </section>

        {/* 7. CCPA / CPRA */}
        <section className="legal-section">
          <h2 className="legal-section-title">7. California privacy disclosures (CCPA / CPRA)</h2>
          <p>
            If you are a California resident, the California Consumer Privacy Act (as
            amended by the California Privacy Rights Act) gives you the following rights
            with respect to the personal information we collect about you:
          </p>
          <ul className="legal-list">
            <li><strong>Right to know</strong> what personal information we collect, the sources we collect it from, the purposes we collect it for, and the categories of third parties we share it with.</li>
            <li><strong>Right to delete</strong> personal information we have collected from you, subject to certain exceptions.</li>
            <li><strong>Right to correct</strong> inaccurate personal information.</li>
            <li><strong>Right to opt out</strong> of the &ldquo;sale&rdquo; or &ldquo;sharing&rdquo; of your personal information.</li>
            <li><strong>Right to limit</strong> the use and disclosure of sensitive personal information.</li>
            <li><strong>Right to non-discrimination</strong> for exercising your CCPA rights.</li>
          </ul>
          <p>
            <strong>Categories of personal information we collect:</strong> identifiers
            (account ID, email, IP address), internet activity (usage and device data),
            geolocation data (country, approximate location from IP), commercial information
            (where you have provided a wallet address for a potential prize payout),
            inferences drawn from the above (e.g., interests inferred from gameplay).
          </p>
          <p>
            <strong>&ldquo;Do Not Sell or Share My Personal Information.&rdquo;</strong> We
            do not sell personal information for money. However, our use of advertising
            pixels (including AdRoll, Meta, and Reddit) for cross-context behavioral
            advertising is considered &ldquo;sharing&rdquo; under the CPRA. To opt out, you
            can:
          </p>
          <ul className="legal-list">
            <li>Enable Global Privacy Control (GPC) in your browser. We honor GPC signals where they apply.</li>
            <li>Email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> with &ldquo;Do Not Sell or Share&rdquo; in the subject line.</li>
            <li>Use the industry opt-out tools listed in Section 5.</li>
          </ul>
          <p>
            You may also designate an authorized agent to make a request on your behalf.
            We may require verification of identity for both the requester and the agent
            before fulfilling such a request.
          </p>
        </section>

        {/* 8. GDPR / UK GDPR */}
        <section className="legal-section">
          <h2 className="legal-section-title">8. EU and UK privacy disclosures (GDPR / UK GDPR)</h2>
          <p>
            If you are located in the European Economic Area, the United Kingdom, or
            Switzerland, the GDPR (or UK GDPR) gives you the rights described in Section 6.
            Some additional disclosures:
          </p>
          <ul className="legal-list">
            <li>
              <strong>Controller.</strong> The data controller is {SPONSOR_DBA}, at the
              address listed in Section 1. We have not appointed an EU representative; if
              this changes we will update this policy.
            </li>
            <li>
              <strong>International transfers.</strong> We are based in the United States,
              and most of our service providers are also located in or transfer data to the
              United States. Where required, we rely on the European Commission&apos;s
              Standard Contractual Clauses (SCCs) or equivalent transfer mechanisms with
              each provider.
            </li>
            <li>
              <strong>Lawful basis.</strong> See Section 3 for the lawful bases we rely on
              for each processing activity.
            </li>
            <li>
              <strong>Automated decision-making.</strong> We do not make decisions about
              you that produce legal or similarly significant effects based solely on
              automated processing.
            </li>
            <li>
              <strong>Right to complain.</strong> You may lodge a complaint with your local
              data protection authority. A list of EEA authorities is available at{' '}
              <a href="https://edpb.europa.eu/about-edpb/about-edpb/members_en" target="_blank" rel="noopener noreferrer">edpb.europa.eu</a>;
              the UK ICO is at <a href="https://ico.org.uk" target="_blank" rel="noopener noreferrer">ico.org.uk</a>.
            </li>
          </ul>
        </section>

        {/* 9. Children */}
        <section className="legal-section">
          <h2 className="legal-section-title">9. Children&apos;s privacy</h2>
          <p>
            The Service is intended for users aged {MIN_AGE} or older. We do not knowingly
            collect personal information from children under 13 (or the equivalent minimum
            age in your jurisdiction). If you believe a child under that age has provided us
            with personal information, please contact{' '}
            <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> and we will take
            reasonable steps to delete it.
          </p>
        </section>

        {/* 10. Security */}
        <section className="legal-section">
          <h2 className="legal-section-title">10. Security</h2>
          <p>
            We use commercially reasonable technical and organizational measures to protect
            personal information, including HTTPS in transit, encryption at rest provided
            by our infrastructure providers (Google Cloud, Vercel), least-privilege access
            controls, and audit logging on administrative actions. No security control is
            perfect; you use the Service at your own risk and should choose a strong,
            unique password (or use a passwordless sign-in method).
          </p>
        </section>

        {/* 11. Retention */}
        <section className="legal-section">
          <h2 className="legal-section-title">11. Data retention</h2>
          <ul className="legal-list">
            <li>
              <strong>Account data</strong> &mdash; retained for as long as your account is
              active.
            </li>
            <li>
              <strong>After account deletion</strong> &mdash; we delete or anonymize active
              account data within 30 days of a verified deletion request, subject to the
              exceptions below.
            </li>
            <li>
              <strong>Predictions and leaderboard history</strong> &mdash; we may retain
              your past predictions in aggregated or anonymized form so that historical
              leaderboards remain coherent.
            </li>
            <li>
              <strong>Audit logs and abuse evidence</strong> &mdash; retained for up to two
              years to investigate fraud, abuse, and compliance issues.
            </li>
            <li>
              <strong>Contest records</strong> &mdash; retained for at least the period
              required by applicable contest, sweepstakes, tax, or AML/sanctions
              regulations.
            </li>
            <li>
              <strong>Backups</strong> &mdash; encrypted backups may persist for up to 90
              days after deletion before being overwritten in the normal course.
            </li>
          </ul>
        </section>

        {/* 12. Marketing */}
        <section className="legal-section">
          <h2 className="legal-section-title">12. Marketing communications</h2>
          <p>
            We may send you transactional emails (for example, contest result
            notifications) that you cannot opt out of without closing your account. Any
            promotional or newsletter emails we send will include an unsubscribe link, and
            you can also email <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a> to
            opt out of marketing communications at any time.
          </p>
        </section>

        {/* 13. Third-party links */}
        <section className="legal-section">
          <h2 className="legal-section-title">13. Third-party websites and integrations</h2>
          <p>
            The Service may contain links to third-party websites (for example, the
            sub-processor opt-out pages listed in Section 5) and may interoperate with
            third-party services such as social-media sharing tools. We are not responsible
            for the privacy practices of those third parties. We encourage you to review
            their own privacy policies.
          </p>
        </section>

        {/* 14. Changes */}
        <section className="legal-section">
          <h2 className="legal-section-title">14. Changes to this policy</h2>
          <p>
            We may update this Privacy Policy from time to time. When we do, we will update
            the &ldquo;Effective&rdquo; date at the top and, for material changes, provide
            additional notice (for example, an in-product banner or an email to your
            account). The most current version is always available at{' '}
            <a href="/privacy">goaloracle.io/privacy</a>.
          </p>
        </section>

        {/* 15. Contact */}
        <section className="legal-section">
          <h2 className="legal-section-title">15. Contact us</h2>
          <p>
            Questions, requests, or complaints? You can reach us at:
          </p>
          <ul className="legal-list">
            <li>Email (privacy): <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a></li>
            <li>Email (general support): <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a></li>
            <li>Mail: {SPONSOR_DBA}, {SPONSOR_ADDRESS}</li>
          </ul>
        </section>

        <footer className="legal-footer">
          <p>
            This Privacy Policy should be read together with our{' '}
            <a href="/terms">Terms &amp; Conditions</a> and, where applicable, our{' '}
            <a href="/official-rules">Official Rules</a>.
          </p>
        </footer>
      </div>
    </div>
  );
}
