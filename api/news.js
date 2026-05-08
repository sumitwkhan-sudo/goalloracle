/**
 * /api/news.js — Live FIFA World Cup 2026 news
 *
 * Pulls Google News' public RSS feed for the World Cup query, parses the
 * items, and tags each with a team match (when the headline mentions a
 * team in our roster). Returns two slices:
 *   - ticker:   up to 25 short items for the marquee under the navbar
 *   - articles: 3 items for the dashboard "Today" feed
 *
 * Edge-cached for 30 min, stale-while-revalidate for 2 h, so a single hit
 * per region keeps the whole user base fresh without hammering Google's
 * RSS endpoint or our function quota.
 *
 * Failure mode is intentionally lossy: a 500 with empty arrays. The
 * client treats that as "API down" and falls back to the seed.
 */

import TEAM_COLORS from '../src/data/teamColors.js';

const RSS_URL = 'https://news.google.com/rss/search?q=FIFA+World+Cup+2026&hl=en-US&gl=US&ceid=US:en';
const FETCH_TIMEOUT_MS = 8000;

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}

function unwrapCData(s) {
  const m = s.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return m ? m[1] : s;
}

function pick(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const m = block.match(re);
  return m ? unwrapCData(m[1]).trim() : '';
}

// Tiny RSS 2.0 parser — Google News' feed is well-formed and stable, so
// we don't need a generic XML library.
function parseRSS(xml) {
  const items = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml)) !== null) {
    const b = m[1];
    items.push({
      title: decodeEntities(pick(b, 'title')),
      link: pick(b, 'link'),
      pubDate: pick(b, 'pubDate'),
      source: decodeEntities(pick(b, 'source')),
    });
  }
  return items;
}

// Headlines from Google News are conventionally suffixed with " - Source"
// (em dash or hyphen). Split on the last separator so we keep article
// titles that themselves contain hyphens intact.
function splitTitleAndSource(title, fallbackSource) {
  const m = title.match(/^(.*?)\s+[-–—]\s+([^-–—]{2,40})$/);
  if (m) return { title: m[1].trim(), source: m[2].trim() };
  return { title: title.trim(), source: (fallbackSource || '').trim() || 'News' };
}

const TEAM_NAMES = Object.keys(TEAM_COLORS).sort((a, b) => b.length - a.length);

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectTeam(text) {
  for (const name of TEAM_NAMES) {
    const re = new RegExp(`\\b${escapeRegex(name)}\\b`, 'i');
    if (re.test(text)) {
      return { team: name, flag: TEAM_COLORS[name].flag };
    }
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    return res.status(200).json({});
  }
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const resp = await fetch(RSS_URL, {
      headers: { 'User-Agent': 'GoalOracle/1.0 (+https://goaloracle.com)' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!resp.ok) {
      return res.status(502).json({ error: `RSS upstream ${resp.status}`, ticker: [], articles: [] });
    }
    const xml = await resp.text();
    const items = parseRSS(xml);

    if (items.length === 0) {
      return res.status(200).json({ ticker: [], articles: [], fetchedAt: new Date().toISOString() });
    }

    const enriched = items.map(item => {
      const { title, source } = splitTitleAndSource(item.title, item.source);
      const t = detectTeam(title);
      return {
        title,
        link: item.link,
        pubDate: item.pubDate,
        source,
        team: t?.team || null,
        flag: t?.flag || null,
      };
    });

    // Ticker — prefer team-tagged headlines so the marquee stays
    // team-flavoured. Fill the rest with generic items if needed.
    const tagged = enriched.filter(e => e.team);
    const untagged = enriched.filter(e => !e.team);
    const ticker = [...tagged, ...untagged].slice(0, 25).map(e => ({
      team: e.team,
      flag: e.flag,
      text: e.title,
    }));

    const articles = enriched.slice(0, 3).map((e, i) => ({
      id: `live-${i}`,
      title: e.title,
      url: e.link,
      source: e.source,
      team: e.team || 'World Cup',
      flag: e.flag || '🏆',
      pubDate: e.pubDate,
    }));

    // Edge cache for 30 min, allow stale up to 2 h. One cold hit per
    // region per 30 min keeps Google happy and our function bill flat.
    res.setHeader('Cache-Control', 'public, s-maxage=1800, stale-while-revalidate=7200');
    return res.status(200).json({
      ticker,
      articles,
      fetchedAt: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'fetch failed', ticker: [], articles: [] });
  }
}
