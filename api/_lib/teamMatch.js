/**
 * teamMatch.js — robust team-name matching between our fixtures
 * (src/data/matches.js) and an upstream results provider (football-data.org).
 *
 * The poller matched provider names by naive lowercase substring, which
 * silently fails whenever a provider uses a team's official FIFA name instead
 * of the common one — e.g. football-data.org reports South Korea as
 * "Korea Republic", which substring-matches neither way, so the result never
 * ingests and (because no result is found) the game just looks "not updated".
 *
 * This adds: accent/punctuation folding + noise-word stripping (handles
 * "Côte d'Ivoire", "Türkiye", "IR Iran"), plus an explicit alias table for
 * names that fold to something different ("Korea Republic" vs "south korea").
 */

// our matches.js name → additional provider spellings to accept.
// Only high-confidence, real-world divergences (FIFA official vs common).
const TEAM_ALIASES = {
  'South Korea': ['Korea Republic', 'Republic of Korea', 'Korea, Republic of'],
  'North Korea': ['Korea DPR'],
  'USA': ['United States', 'United States of America'],
  'Iran': ['IR Iran', 'Iran, Islamic Republic of', 'Islamic Republic of Iran'],
  'Ivory Coast': ["Côte d'Ivoire", "Cote d'Ivoire"],
  'Cape Verde': ['Cabo Verde'],
  'Czechia': ['Czech Republic'],
  'Türkiye': ['Turkey', 'Turkiye'],
  'DR Congo': ['Congo DR', 'DR Congo', 'Democratic Republic of the Congo', 'Congo, The Democratic Republic of the'],
  'Bosnia and Herzegovina': ['Bosnia-Herzegovina', 'Bosnia & Herzegovina'],
  'Curaçao': ['Curacao'],
  'China': ['China PR'],
};

// Lowercase, strip accents + punctuation, drop noise tokens, collapse spaces.
//   "Côte d'Ivoire" -> "cote divoire"  ·  "IR Iran" -> "iran"  ·  "Türkiye" -> "turkiye"
export function normalizeTeamName(s) {
  return (s || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')                        // punctuation -> space
    .replace(/\b(fc|the|of|ir|pr|republic)\b/g, ' ')   // common noise tokens
    .replace(/\s+/g, ' ')
    .trim();
}

// The set of normalized strings that should be accepted for `ourName`.
function acceptedForms(ourName) {
  const forms = new Set([normalizeTeamName(ourName)]);
  for (const alias of (TEAM_ALIASES[ourName] || [])) forms.add(normalizeTeamName(alias));
  forms.delete('');
  return forms;
}

/**
 * Does `providerName` refer to our `ourName`? Exact normalized match or an
 * alias match first; falls back to a normalized substring either direction
 * (catches minor suffixes/prefixes the alias table doesn't enumerate).
 */
export function teamNameMatches(ourName, providerName) {
  const p = normalizeTeamName(providerName);
  if (!p) return false;
  const forms = acceptedForms(ourName);
  if (forms.has(p)) return true;
  for (const f of forms) {
    if (p.includes(f) || f.includes(p)) return true;
  }
  return false;
}

export const __TEAM_ALIASES = TEAM_ALIASES; // exported for tests
