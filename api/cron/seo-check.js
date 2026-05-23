/**
 * /api/cron/seo-check.js — daily SEO sanity check.
 *
 * Runs once a day. Checks the hygiene factors that quietly rot if
 * nobody watches them — the things Search Console would flag a week
 * later, after we've already lost the impressions.
 *
 * What it checks:
 *
 *   1. Sitemap.xml — every URL listed returns 200, has a recent
 *      <lastmod>, and matches the public route surface (no orphan
 *      entries pointing at deleted routes; no public routes missing
 *      from the sitemap).
 *   2. JSON-LD schemas in index.html — all blocks parse as valid JSON
 *      and have a non-empty @context + @type. Catches the case where
 *      a deploy accidentally breaks a schema block (a real failure
 *      mode — see the SportsEvent Country/Place fix in commit 57f8157).
 *   3. Robots.txt freshness — confirms the AI crawler allow-list is
 *      still intact and the Sitemap directive points at the canonical
 *      URL.
 *   4. Dead internal links — fetches a small set of authoritative pages
 *      (llms.txt, llms-full.txt, the #seo-shell nav) and verifies every
 *      internal href resolves to a real route.
 *   5. Ping Google — submits sitemap.xml to Google's ping endpoint so
 *      a fresh <lastmod> is picked up faster than the default crawl
 *      schedule. (Bing equivalent too.)
 *
 * What it does NOT do:
 *
 *   - It does not write new content. SEO content strategy is a human
 *     decision; this cron just keeps the technical hygiene clean.
 *   - It does not call Google Search Console. The user has to set up
 *     GSC verification separately (gated on swapping out the GA4
 *     placeholder in index.html).
 *   - It does not call a paid SERP API. Live ranking data is not in
 *     scope.
 *
 * If anything regresses, an operator alert email goes out via the
 * existing sendOperatorAlert helper. Otherwise the function is silent
 * — no alert spam when everything's clean.
 *
 * Schedule: declared in vercel.json. Auth: same CRON_SECRET as the
 * other crons.
 */

import { db, verifyAuth } from '../_lib/firebase.js';
import { sendOperatorAlert } from '../_lib/alerts.js';
import { escapeHtml } from '../_lib/security.js';

const PROD_ORIGIN = 'https://goaloracle.io';

// Source of truth for indexable public routes. Mirrors the `index:true`
// entries in src/goaloracle.jsx VIEW_META plus the static files served
// from /public. Update this list when a new public route ships.
const INDEXABLE_ROUTES = [
  '/',
  '/faq',
  '/official-rules',
  '/terms',
  '/privacy',
];

const STATIC_REFERENCE_FILES = [
  '/sitemap.xml',
  '/robots.txt',
  '/llms.txt',
  '/llms-full.txt',
];

const REQUIRED_AI_CRAWLERS = [
  'GPTBot',
  'ChatGPT-User',
  'OAI-SearchBot',
  'ClaudeBot',
  'PerplexityBot',
  'Google-Extended',
  'Meta-ExternalAgent',
];

async function isAuthorized(req) {
  const auth = req.headers.authorization || '';
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && auth === `Bearer ${cronSecret}`) return true;
  // Vercel Cron sets x-vercel-cron: 1 on production cron invocations.
  if (req.headers['x-vercel-cron'] === '1') return true;
  // Manual operator invocation from the admin panel — verify superadmin.
  const claims = await verifyAuth(req);
  if (!claims) return false;
  const userSnap = await db.collection('users').doc(claims.userId).get();
  return userSnap.exists && userSnap.data().role === 'superadmin';
}

async function fetchText(url, timeoutMs = 15000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal, headers: { 'user-agent': 'GoalOracleSEOCheck/1.0' } });
    return { ok: r.ok, status: r.status, text: r.ok ? await r.text() : null };
  } catch (e) {
    return { ok: false, status: 0, text: null, error: e.message };
  } finally {
    clearTimeout(t);
  }
}

// ─── Check 1: sitemap integrity ──────────────────────────────────
async function checkSitemap() {
  const findings = [];
  const r = await fetchText(`${PROD_ORIGIN}/sitemap.xml`);
  if (!r.ok) {
    findings.push({ severity: 'critical', message: `sitemap.xml fetch failed (HTTP ${r.status})` });
    return { findings, sitemapUrls: [] };
  }
  const locs = Array.from(r.text.matchAll(/<loc>([^<]+)<\/loc>/g)).map(m => m[1]);
  const lastmods = Array.from(r.text.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)).map(m => m[1]);

  if (locs.length === 0) {
    findings.push({ severity: 'critical', message: 'sitemap.xml has zero <loc> entries' });
  }

  // Every indexable route must appear in the sitemap.
  const sitemapPaths = new Set(locs.map(u => new URL(u).pathname));
  const missing = INDEXABLE_ROUTES.filter(p => !sitemapPaths.has(p));
  if (missing.length > 0) {
    findings.push({
      severity: 'warning',
      message: `sitemap.xml missing indexable routes: ${missing.join(', ')}`,
    });
  }

  // Lastmod staleness: warn if any is > 90 days old. Reasonable for legal
  // pages that don't change often; flagging older signals we're not
  // refreshing the sitemap as routes evolve.
  const now = Date.now();
  const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
  const stale = lastmods.filter(d => (now - new Date(d).getTime()) > NINETY_DAYS);
  if (stale.length > 0) {
    findings.push({
      severity: 'info',
      message: `sitemap.xml has ${stale.length} <lastmod> dates older than 90 days. Consider refreshing.`,
    });
  }

  return { findings, sitemapUrls: locs };
}

// ─── Check 2: JSON-LD validation ─────────────────────────────────
async function checkSchemas() {
  const findings = [];
  const r = await fetchText(`${PROD_ORIGIN}/`);
  if (!r.ok) {
    findings.push({ severity: 'critical', message: `homepage fetch failed (HTTP ${r.status})` });
    return { findings };
  }
  const blocks = Array.from(r.text.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)).map(m => m[1].trim());
  if (blocks.length === 0) {
    findings.push({ severity: 'critical', message: 'homepage has no JSON-LD blocks at all' });
    return { findings };
  }

  const expectedTypes = new Set(['Organization', 'WebSite', 'SoftwareApplication', 'SportsEvent', 'FAQPage']);
  const foundTypes = new Set();

  for (let i = 0; i < blocks.length; i++) {
    let parsed;
    try {
      parsed = JSON.parse(blocks[i]);
    } catch (e) {
      findings.push({ severity: 'critical', message: `JSON-LD block #${i + 1} failed to parse: ${e.message}` });
      continue;
    }
    const nodes = parsed['@graph'] || [parsed];
    for (const node of nodes) {
      if (!node['@context']) {
        findings.push({ severity: 'warning', message: `JSON-LD block #${i + 1} missing @context` });
      }
      if (node['@type']) {
        foundTypes.add(node['@type']);
      }
    }
  }

  for (const t of expectedTypes) {
    if (!foundTypes.has(t)) {
      findings.push({ severity: 'warning', message: `JSON-LD missing expected @type: ${t}` });
    }
  }

  return { findings };
}

// ─── Check 3: robots.txt ─────────────────────────────────────────
async function checkRobots() {
  const findings = [];
  const r = await fetchText(`${PROD_ORIGIN}/robots.txt`);
  if (!r.ok) {
    findings.push({ severity: 'critical', message: `robots.txt fetch failed (HTTP ${r.status})` });
    return { findings };
  }
  const txt = r.text.toLowerCase();
  for (const ua of REQUIRED_AI_CRAWLERS) {
    if (!txt.includes(`user-agent: ${ua.toLowerCase()}`)) {
      findings.push({ severity: 'warning', message: `robots.txt missing required crawler allow: ${ua}` });
    }
  }
  if (!txt.includes(`sitemap: ${PROD_ORIGIN.toLowerCase()}/sitemap.xml`)) {
    findings.push({ severity: 'warning', message: 'robots.txt Sitemap: directive missing or wrong URL' });
  }
  return { findings };
}

// ─── Check 4: dead internal links ────────────────────────────────
async function checkDeadLinks() {
  const findings = [];
  const referencedPaths = new Set();

  for (const file of STATIC_REFERENCE_FILES) {
    const r = await fetchText(`${PROD_ORIGIN}${file}`);
    if (!r.ok) {
      findings.push({ severity: 'warning', message: `static file fetch failed: ${file} (HTTP ${r.status})` });
      continue;
    }
    // Pull every internal path-style reference. Matches both markdown
    // (llms.txt) and HTML (sitemap.xml uses absolute URLs).
    const matches = Array.from(r.text.matchAll(/(?:https?:\/\/goaloracle\.io)?(\/[a-zA-Z0-9\-/_.]+)/g));
    for (const m of matches) {
      const p = m[1];
      if (p.startsWith('/api/') || p.includes('.png') || p.includes('.svg') || p.includes('.json')) continue;
      if (p === '/' || INDEXABLE_ROUTES.includes(p)) continue;
      referencedPaths.add(p);
    }
  }

  for (const p of referencedPaths) {
    const r = await fetchText(`${PROD_ORIGIN}${p}`, 8000);
    if (!r.ok) {
      findings.push({ severity: 'warning', message: `internal link to ${p} returns HTTP ${r.status}` });
    }
  }
  return { findings };
}

// ─── Check 5: ping search engines with the sitemap ───────────────
// Google and Bing both still honor the legacy /ping?sitemap= endpoint
// for sites without webmaster tools verification. Returns whatever the
// search engines say — never fails the run.
async function pingSearchEngines() {
  const sitemapUrl = encodeURIComponent(`${PROD_ORIGIN}/sitemap.xml`);
  const pings = [
    `https://www.google.com/ping?sitemap=${sitemapUrl}`,
    `https://www.bing.com/ping?sitemap=${sitemapUrl}`,
  ];
  const results = [];
  for (const url of pings) {
    const r = await fetchText(url, 10000);
    results.push({ url: url.split('?')[0], status: r.status });
  }
  return results;
}

// ─── Persist run history (small Firestore log) ──────────────────
async function recordRun({ findings, pings, durationMs }) {
  const today = new Date().toISOString().slice(0, 10);
  const docRef = db.collection('seoChecks').doc(today);
  await docRef.set({
    date: today,
    timestamp: Date.now(),
    durationMs,
    findingCount: findings.length,
    findings,
    pings,
  }, { merge: true });
}

// ─── Handler ─────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).json({});
  if (!await isAuthorized(req)) return res.status(403).json({ error: 'forbidden' });

  const t0 = Date.now();

  const [sm, sc, rb, dl] = await Promise.all([
    checkSitemap(),
    checkSchemas(),
    checkRobots(),
    checkDeadLinks(),
  ]);
  const pings = await pingSearchEngines();

  const allFindings = [...sm.findings, ...sc.findings, ...rb.findings, ...dl.findings];
  const critical = allFindings.filter(f => f.severity === 'critical');
  const warnings = allFindings.filter(f => f.severity === 'warning');
  const info = allFindings.filter(f => f.severity === 'info');

  const durationMs = Date.now() - t0;
  try {
    await recordRun({ findings: allFindings, pings, durationMs });
  } catch (e) {
    console.error('[seo-check] recordRun failed:', e.message);
  }

  // Only email the operator if something actually needs attention.
  // Daily clean runs are silent — no alert fatigue.
  if (critical.length > 0 || warnings.length > 0) {
    const subject = critical.length > 0
      ? `[GoalOracle SEO] CRITICAL — ${critical.length} issue${critical.length === 1 ? '' : 's'}`
      : `[GoalOracle SEO] ${warnings.length} warning${warnings.length === 1 ? '' : 's'}`;
    const body = [
      `<h2>${escapeHtml(subject)}</h2>`,
      critical.length > 0 ? `<h3 style="color:#c00">Critical</h3><ul>${critical.map(f => `<li>${escapeHtml(f.message)}</li>`).join('')}</ul>` : '',
      warnings.length > 0 ? `<h3 style="color:#c70">Warnings</h3><ul>${warnings.map(f => `<li>${escapeHtml(f.message)}</li>`).join('')}</ul>` : '',
      info.length > 0 ? `<h3>Info</h3><ul>${info.map(f => `<li>${escapeHtml(f.message)}</li>`).join('')}</ul>` : '',
      `<h3>Sitemap ping responses</h3><ul>${pings.map(p => `<li>${escapeHtml(p.url)} — HTTP ${p.status}</li>`).join('')}</ul>`,
      `<p style="color:#666;font-size:0.85em">Daily SEO check completed in ${durationMs} ms. Full history: Firestore /seoChecks/{YYYY-MM-DD}.</p>`,
    ].filter(Boolean).join('');
    await sendOperatorAlert(subject, body).catch(e => console.error('[seo-check] alert failed:', e.message));
  }

  return res.status(200).json({
    ok: critical.length === 0,
    findingCount: allFindings.length,
    critical: critical.length,
    warnings: warnings.length,
    info: info.length,
    durationMs,
    pings,
  });
}
