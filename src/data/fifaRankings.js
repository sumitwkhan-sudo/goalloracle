/**
 * fifaRankings.js
 *
 * Approximation of current FIFA Men's World Ranking for the 48 teams
 * in the 2026 World Cup. Lower number = stronger team. Numbers are
 * a snapshot of widely-published FIFA rankings as of early 2026; no
 * live source — refresh manually if a card surfaces stale data.
 *
 * Helper exports:
 *   - FIFA_RANK[teamName] → integer rank (1..48 for participants)
 *   - getRank(team) → integer | null  (null when team isn't listed)
 *   - getTopRanked(n) → [{ team, rank }]  for the FifaRanksCard list.
 */

export const FIFA_RANK = {
  // Top tier
  'Argentina': 1,
  'France': 2,
  'Spain': 3,
  'England': 4,
  'Brazil': 5,
  'Portugal': 6,
  'Netherlands': 7,
  'Belgium': 8,
  'Croatia': 10,
  'Germany': 11,

  // Strong contenders
  'Colombia': 13,
  'Uruguay': 14,
  'Morocco': 15,
  'Mexico': 16,
  'USA': 17,
  'Switzerland': 19,
  'Senegal': 20,
  'Japan': 22,
  'Iran': 23,
  'Australia': 25,
  'South Korea': 26,
  'Ecuador': 27,
  'Egypt': 30,
  'Tunisia': 32,
  'Algeria': 33,

  // Mid tier
  'Norway': 34,
  'Sweden': 38,
  'Austria': 39,
  'Czechia': 40,
  'Türkiye': 41,
  'Paraguay': 42,
  'Ivory Coast': 43,
  'Scotland': 44,
  'Canada': 45,
  'Qatar': 46,
  'Ghana': 48,
  'Saudi Arabia': 50,
  'Cape Verde': 56,
  'Iraq': 58,
  'Jordan': 62,
  'Panama': 64,
  'New Zealand': 67,
  'Uzbekistan': 70,

  // Lower tier
  'South Africa': 73,
  'DR Congo': 76,
  'Bosnia and Herzegovina': 78,
  'Haiti': 85,
  'Curaçao': 88,
};

export function getRank(team) {
  if (!team) return null;
  const r = FIFA_RANK[team];
  return typeof r === 'number' ? r : null;
}

export function getTopRanked(n = 5) {
  return Object.entries(FIFA_RANK)
    .sort(([, a], [, b]) => a - b)
    .slice(0, n)
    .map(([team, rank]) => ({ team, rank }));
}
