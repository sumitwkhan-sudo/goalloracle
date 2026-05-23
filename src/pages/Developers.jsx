/**
 * Developers — public-facing developer reference for the GoalOracle
 * API surface. Rendered at /developers. Static (no auth).
 *
 * Job: be the canonical landing page when an AI agent, developer,
 * journalist, or partner searches for "goaloracle api" / "goaloracle
 * developer" / "goaloracle MCP". Lists the no-auth public endpoints,
 * links to the OpenAPI spec, and honestly describes what auth /
 * rate-limit story we have today (and what we don't).
 */

import React from 'react';

const PUBLIC_ENDPOINTS = [
  { method: 'GET', path: '/api/public?type=stats',                       desc: 'Platform stats: total players, active leagues, prize pool aggregate.' },
  { method: 'GET', path: '/api/public?type=results',                     desc: 'All match results that have been verified by the dual-source oracle.' },
  { method: 'GET', path: '/api/public?type=league&id={leagueId}',        desc: 'Public league metadata (name, member count, prediction mode).' },
  { method: 'GET', path: '/api/public?type=flags',                       desc: 'Live feature flags (Quick Picks / Classic / Prize Leagues toggles).' },
  { method: 'GET', path: '/api/public?type=bracket&userId={userId}',     desc: 'Read-only Quick Picks bracket for the public share page (/u/:userId/bracket).' },
  { method: 'GET', path: '/api/spicy-stats?leagueId={leagueId}',         desc: 'Post-ready Quick Picks consensus aggregates (top champions, finalist gaps, group-stage tiebreakers).' },
  { method: 'GET', path: '/api/og?type={default|league|bracket}&...',    desc: 'Dynamic Open Graph image generator (1200×630 PNG). Cached at the edge for 1 year.' },
];

export default function Developers() {
  return (
    <div className="legal-page">
      <div className="legal-page-inner">
        <header className="legal-header">
          <h1 className="legal-title">GoalOracle for Developers &amp; AI Agents</h1>
          <p className="legal-subtitle">
            Public API endpoints, authentication, and machine-readable resources for
            agents, integrations, and automated tooling.
          </p>
        </header>

        <div className="legal-callout">
          <strong>TL;DR</strong> — Public read endpoints below need no auth. Schema:{' '}
          <a href="/openapi.json">/openapi.json</a> (OpenAPI 3.1.0). AI-engine summaries:{' '}
          <a href="/llms.txt">/llms.txt</a> and <a href="/llms-full.txt">/llms-full.txt</a>.
          Questions: <a href="mailto:support@goaloracle.io">support@goaloracle.io</a>.
        </div>

        {/* Quick start */}
        <section className="legal-section">
          <h2 className="legal-section-title">1. Quick start</h2>
          <p>
            Read the global Quick Picks consensus — no auth required:
          </p>
          <pre className="legal-code-block">{`curl https://goaloracle.io/api/spicy-stats?leagueId=global-simple`}</pre>
          <p>Returns JSON with the top-5 picks for Champion, Runner-up, Third Place, plus best-thirds aggregates and the "most contested group" headline pre-computed.</p>
        </section>

        {/* Public APIs */}
        <section className="legal-section">
          <h2 className="legal-section-title">2. Public API endpoints (no auth)</h2>
          <p>The following endpoints are read-only and require no authentication. CORS is open for production origins; server-to-server callers can ignore CORS entirely.</p>
          <table className="legal-table" aria-label="Public API endpoints">
            <thead>
              <tr>
                <th>Method</th>
                <th>Endpoint</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {PUBLIC_ENDPOINTS.map((e) => (
                <tr key={e.path}>
                  <td><code>{e.method}</code></td>
                  <td><code>{e.path}</code></td>
                  <td>{e.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '0.75rem' }}>
            Full schemas, query parameter constraints, and response shapes are in the{' '}
            <strong><a href="/openapi.json">OpenAPI 3.1.0 spec</a></strong>. Paste the spec URL
            into <a href="https://editor.swagger.io" target="_blank" rel="noopener noreferrer">Swagger Editor</a>{' '}
            or any OpenAPI-aware tool (Postman, Insomnia, openapi-typescript, etc.) to
            generate client code automatically.
          </p>
        </section>

        {/* Authentication */}
        <section className="legal-section">
          <h2 className="legal-section-title">3. Authentication for write endpoints</h2>
          <p>
            Endpoints that mutate state — submitting predictions, joining leagues, editing
            House Rules, etc. — require a <strong>Firebase ID token</strong> in the
            <code>Authorization: Bearer &lt;token&gt;</code> header.
          </p>
          <p>
            We use <strong>Privy</strong> as the front-end auth provider. Privy issues an
            ID token to the client, which we exchange for a Firebase custom token via{' '}
            <code>POST /api/auth</code>. The resulting Firebase ID token is what the API
            expects. Tokens expire after 1 hour; refresh before they expire.
          </p>
          <p>
            <strong>Role-based access:</strong> two roles exist today.
          </p>
          <ul className="legal-list">
            <li><strong>user</strong> (default) — can submit predictions, join leagues, manage their own bracket, view their own profile.</li>
            <li><strong>superadmin</strong> — can hit the <code>/api/admin</code> endpoints (edit match results, manage roles, delete / rename leagues, toggle feature flags). Cannot be obtained programmatically; granted manually in Firestore by an existing superadmin.</li>
          </ul>
          <p>
            <strong>OAuth scopes / API keys:</strong> not yet implemented. Today there's no
            way to mint a long-lived API key with a subset of permissions. If you have a
            specific integration use case that needs this, email{' '}
            <a href="mailto:support@goaloracle.io">support@goaloracle.io</a> — we&apos;ll prioritize
            based on real demand.
          </p>
        </section>

        {/* Rate limits */}
        <section className="legal-section">
          <h2 className="legal-section-title">4. Rate limits</h2>
          <p>
            No application-level rate limiting is enforced today beyond the Vercel function
            defaults (each function caps at 60-second execution time). Public read endpoints
            are cached at the edge for 5 minutes to 1 hour depending on the endpoint, so
            high-frequency polling won&apos;t hit origin every time.
          </p>
          <p>
            Be reasonable. If you&apos;re polling at &gt; 1 req/s on a read endpoint,
            cache the response client-side. If you&apos;re building an integration that
            needs higher throughput, contact us so we can plan capacity.
          </p>
        </section>

        {/* AI resources */}
        <section className="legal-section">
          <h2 className="legal-section-title">5. AI engine resources</h2>
          <p>
            GoalOracle ships machine-readable summaries for AI answer engines and LLM
            crawlers:
          </p>
          <ul className="legal-list">
            <li><strong><a href="/llms.txt">/llms.txt</a></strong> — short authoritative summary of the product, key facts, and links to canonical pages.</li>
            <li><strong><a href="/llms-full.txt">/llms-full.txt</a></strong> — deep reference with full scoring tables, Annexe C explanation, prize contest mechanics, and the dual-source oracle methodology.</li>
            <li><strong><a href="/robots.txt">/robots.txt</a></strong> — explicit allow for every major AI crawler (GPTBot, ChatGPT-User, OAI-SearchBot, ClaudeBot, PerplexityBot, Google-Extended, Meta-ExternalAgent, etc.).</li>
          </ul>
          <p>
            All three files are stable URLs and safe to bookmark / cite. Content licensing:
            citation with attribution to &ldquo;GoalOracle (goaloracle.io)&rdquo; is welcome.
            Please do not use users&apos; predictions, usernames, or league data for model
            training without explicit permission.
          </p>
        </section>

        {/* MCP */}
        <section className="legal-section">
          <h2 className="legal-section-title">6. MCP server</h2>
          <p>
            We don&apos;t yet ship a Model Context Protocol (MCP) server. Planned but
            not built. If a real integration use case needs one, email{' '}
            <a href="mailto:support@goaloracle.io">support@goaloracle.io</a> with the
            tool/agent scenario and we&apos;ll prioritize.
          </p>
        </section>

        {/* Webhooks */}
        <section className="legal-section">
          <h2 className="legal-section-title">7. Webhooks</h2>
          <p>
            No outbound webhooks today. If you want to be notified when a match is verified
            or when a leaderboard position changes, the current pattern is to poll the
            relevant public read endpoint with sensible caching.
          </p>
        </section>

        {/* Support */}
        <section className="legal-section">
          <h2 className="legal-section-title">8. Support</h2>
          <p>
            Technical questions, integration requests, bug reports:{' '}
            <a href="mailto:support@goaloracle.io">support@goaloracle.io</a>. Include your
            use case and the endpoint(s) you&apos;re working with. We aim to respond
            within 2 business days.
          </p>
        </section>

        <footer className="legal-footer">
          <p>
            Related: <a href="/how-it-works">How GoalOracle Works</a> ·{' '}
            <a href="/openapi.json">OpenAPI Spec</a> ·{' '}
            <a href="/llms-full.txt">AI Reference</a> ·{' '}
            <a href="/official-rules">Official Rules</a> ·{' '}
            <a href="/privacy">Privacy</a>
          </p>
        </footer>
      </div>
    </div>
  );
}
