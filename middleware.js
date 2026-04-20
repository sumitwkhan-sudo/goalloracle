// Vercel Edge Middleware. Intercepts /league/:id requests from crawlers
// (Googlebot, Twitterbot, facebookexternalhit, Slackbot, Discordbot, the
// AI answer engines, etc.) and rewrites the served HTML to include a
// per-league <title> and og:* meta. Humans are passed through untouched
// and get the normal SPA — same content, same client behavior.
//
// This is NOT cloaking: the crawler sees the same meaningful content
// (pre-hydration #seo-shell + per-league meta), and humans see the same
// app once JS runs. We only augment the <head> for crawlers.

export const config = {
  matcher: ['/league/:path*'],
};

const CRAWLER_RE = /(googlebot|bingbot|duckduckbot|baiduspider|yandex|twitterbot|facebookexternalhit|facebot|linkedinbot|slackbot|discordbot|whatsapp|telegrambot|skypeuripreview|gptbot|chatgpt-user|oai-searchbot|claudebot|claude-web|anthropic-ai|perplexitybot|perplexity-user|google-extended|applebot-extended|bytespider|ccbot)/i;

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

async function fetchLeague(origin, id) {
  try {
    const r = await fetch(`${origin}/api/public?type=league&id=${encodeURIComponent(id)}`, {
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

export default async function middleware(req) {
  const ua = req.headers.get('user-agent') || '';
  if (!CRAWLER_RE.test(ua)) return; // humans: normal SPA

  const url = new URL(req.url);
  const m = url.pathname.match(/^\/league\/([^/?#]+)/);
  if (!m) return;
  const leagueId = decodeURIComponent(m[1]);

  const origin = `${url.protocol}//${url.host}`;
  const league = await fetchLeague(origin, leagueId);

  // Fetch the static index.html (bypass middleware to avoid recursion by
  // hitting an asset path that the matcher doesn't cover).
  let html;
  try {
    const r = await fetch(`${origin}/index.html`, { headers: { accept: 'text/html' } });
    html = await r.text();
  } catch {
    return; // give up; let the SPA handle it
  }

  const safeName = escapeHtml(league?.name || 'League');
  const memberCount = league?.memberCount || 0;
  const title = league
    ? `${safeName} — GoalOracle League`
    : 'League — GoalOracle';
  const description = league
    ? `Join ${safeName} on GoalOracle: ${memberCount} ${memberCount === 1 ? 'member' : 'members'} predicting the FIFA World Cup 2026. Free to play.`
    : 'A league on GoalOracle, the free FIFA World Cup 2026 prediction game.';
  const ogImage = `${origin}/api/og?type=league&name=${encodeURIComponent(league?.name || 'League')}&members=${memberCount}`;
  const canonical = `${origin}/league/${encodeURIComponent(leagueId)}`;

  const escTitle = escapeHtml(title);
  const escDesc = escapeHtml(description);

  // Surgical replacements — only the tags we own, leave JSON-LD + scripts intact.
  const patched = html
    .replace(/<title>[^<]*<\/title>/, `<title>${escTitle}</title>`)
    .replace(/<meta name="description" content="[^"]*"\s*\/>/, `<meta name="description" content="${escDesc}" />`)
    .replace(/<link rel="canonical" href="[^"]*"\s*\/>/, `<link rel="canonical" href="${canonical}" />`)
    .replace(/<meta property="og:title" content="[^"]*"\s*\/>/, `<meta property="og:title" content="${escTitle}" />`)
    .replace(/<meta property="og:description" content="[^"]*"\s*\/>/, `<meta property="og:description" content="${escDesc}" />`)
    .replace(/<meta property="og:url" content="[^"]*"\s*\/>/, `<meta property="og:url" content="${canonical}" />`)
    .replace(/<meta property="og:image" content="[^"]*"\s*\/>/, `<meta property="og:image" content="${ogImage}" />`)
    .replace(/<meta property="og:image:alt" content="[^"]*"\s*\/>/, `<meta property="og:image:alt" content="${escTitle}" />`)
    .replace(/<meta name="twitter:title" content="[^"]*"\s*\/>/, `<meta name="twitter:title" content="${escTitle}" />`)
    .replace(/<meta name="twitter:description" content="[^"]*"\s*\/>/, `<meta name="twitter:description" content="${escDesc}" />`)
    .replace(/<meta name="twitter:image" content="[^"]*"\s*\/>/, `<meta name="twitter:image" content="${ogImage}" />`)
    .replace(/<meta name="twitter:image:alt" content="[^"]*"\s*\/>/, `<meta name="twitter:image:alt" content="${escTitle}" />`);

  return new Response(patched, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // Cache the unfurl HTML at the edge for 5 min so a viral share doesn't
      // hammer Firestore. Browsers can revalidate immediately.
      'cache-control': 'public, s-maxage=300, stale-while-revalidate=3600',
      'x-goaloracle-middleware': 'crawler-meta',
    },
  });
}
