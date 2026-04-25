// World Cup titles per country — shown on prediction cards as heritage context
export const TITLES = {
  'Brazil': 5, 'Germany': 4, 'Italy': 4, 'Argentina': 3,
  'France': 2, 'Uruguay': 2, 'England': 1, 'Spain': 1,
};

// Coarse "knockout pedigree" used as a tiebreaker for best-third
// suggestions when a group's third-place pick has no World Cup titles.
// Hand-curated for 2026: 2 = perennial knockout side, 1 = regular
// qualifier with recent knockout appearances. Unlisted = 0.
export const KNOCKOUT_PEDIGREE = {
  Netherlands: 2, Portugal: 2, Croatia: 2, Belgium: 2, Mexico: 2,
  Morocco: 2, Switzerland: 1, USA: 1, Senegal: 1, Japan: 1,
  'South Korea': 1, Australia: 1, Colombia: 1, Ecuador: 1,
  Denmark: 1, Sweden: 1, Poland: 1, Serbia: 1, Ghana: 1,
};

// Combined strength score used for ranking 12 third-place teams when the
// user wants a starting suggestion for the "best 8" selection on Step 2.
export function thirdPlaceStrength(name) {
  if (!name) return 0;
  return (TITLES[name] || 0) * 3 + (KNOCKOUT_PEDIGREE[name] || 0);
}

export function getPedigree(name) {
  const t = TITLES[name];
  if (t) return `${t}× 🏆`;
  return null;
}

// Finals data for scrolling strip
export const FINALS = [
  { yr: '1930', win: 'URU', score: '4–2 ARG', city: 'Montevideo' },
  { yr: '1934', win: 'ITA', score: '2–1 CZE', city: 'Rome' },
  { yr: '1938', win: 'ITA', score: '4–2 HUN', city: 'Paris' },
  { yr: '1950', win: 'URU', score: '2–1 BRA', city: 'Rio' },
  { yr: '1954', win: 'GER', score: '3–2 HUN', city: 'Bern' },
  { yr: '1958', win: 'BRA', score: '5–2 SWE', city: 'Stockholm' },
  { yr: '1962', win: 'BRA', score: '3–1 CZE', city: 'Santiago' },
  { yr: '1966', win: 'ENG', score: '4–2 GER', city: 'London' },
  { yr: '1970', win: 'BRA', score: '4–1 ITA', city: 'Mexico City' },
  { yr: '1974', win: 'GER', score: '2–1 NED', city: 'Munich' },
  { yr: '1978', win: 'ARG', score: '3–1 NED', city: 'Buenos Aires' },
  { yr: '1982', win: 'ITA', score: '3–1 GER', city: 'Madrid' },
  { yr: '1986', win: 'ARG', score: '3–2 GER', city: 'Mexico City' },
  { yr: '1990', win: 'GER', score: '1–0 ARG', city: 'Rome' },
  { yr: '1994', win: 'BRA', score: '0–0(P) ITA', city: 'Los Angeles' },
  { yr: '1998', win: 'FRA', score: '3–0 BRA', city: 'Paris' },
  { yr: '2002', win: 'BRA', score: '2–0 GER', city: 'Yokohama' },
  { yr: '2006', win: 'ITA', score: '1–1(P) FRA', city: 'Berlin' },
  { yr: '2010', win: 'ESP', score: '1–0 NED', city: 'Johannesburg' },
  { yr: '2014', win: 'GER', score: '1–0 ARG', city: 'Rio' },
  { yr: '2018', win: 'FRA', score: '4–2 CRO', city: 'Moscow' },
  { yr: '2022', win: 'ARG', score: '3–3(P) FRA', city: 'Doha' },
  { yr: '2026', win: '???', score: 'You decide', city: 'USA/MEX/CAN' },
];

export const CHAMPIONS = [
  { flag: '🇧🇷', name: 'Brazil', count: 5, years: '1958 · 1962 · 1970 · 1994 · 2002' },
  { flag: '🇩🇪', name: 'Germany', count: 4, years: '1954 · 1974 · 1990 · 2014' },
  { flag: '🇮🇹', name: 'Italy', count: 4, years: '1934 · 1938 · 1982 · 2006' },
  { flag: '🇦🇷', name: 'Argentina', count: 3, years: '1978 · 1986 · 2022' },
  { flag: '🇫🇷', name: 'France', count: 2, years: '1998 · 2018' },
  { flag: '🇺🇾', name: 'Uruguay', count: 2, years: '1930 · 1950' },
  { flag: '🏴\u200D☠️', name: 'England', count: 1, years: '1966', flagAlt: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { flag: '🇪🇸', name: 'Spain', count: 1, years: '2010' },
];
