// FIFA 3-letter country codes for all World Cup 2026 teams
const COUNTRY_CODES = {
  'Mexico': 'MEX', 'South Africa': 'RSA', 'South Korea': 'KOR',
  'USA': 'USA', 'Paraguay': 'PAR', 'Australia': 'AUS',
  'Canada': 'CAN', 'Qatar': 'QAT', 'Haiti': 'HAI',
  'Scotland': 'SCO', 'Brazil': 'BRA', 'Morocco': 'MAR',
  'Germany': 'GER', 'Curaçao': 'CUW', 'Netherlands': 'NED',
  'Japan': 'JPN', 'Tunisia': 'TUN', 'Belgium': 'BEL',
  'Iran': 'IRN', 'New Zealand': 'NZL', 'Ecuador': 'ECU',
  'Spain': 'ESP', 'Cape Verde': 'CPV', 'Saudi Arabia': 'KSA',
  'Uruguay': 'URU', 'France': 'FRA', 'Senegal': 'SEN',
  'Norway': 'NOR', 'Argentina': 'ARG', 'Algeria': 'ALG',
  'Austria': 'AUT', 'Jordan': 'JOR', 'Portugal': 'POR',
  'Uzbekistan': 'UZB', 'Colombia': 'COL', 'England': 'ENG',
  'Croatia': 'CRO', 'Ghana': 'GHA', 'Panama': 'PAN',
  'Switzerland': 'SUI',
  // Playoff / TBD placeholders
  'UEFA Playoff A': 'TBD', 'UEFA Playoff B': 'TBD',
  'UEFA Playoff C': 'TBD', 'UEFA Playoff D': 'TBD',
  'Intercon. Playoff 1': 'TBD', 'Intercon. Playoff 2': 'TBD',
};

export const getCode = (name) => {
  if (!name) return '???';
  // Direct lookup
  if (COUNTRY_CODES[name]) return COUNTRY_CODES[name];
  // Knockout placeholders like "W R32-01", "1st Group A", etc.
  if (name.startsWith('W ') || name.startsWith('L ') || name.includes('Group') || name.includes('3rd')) return name.length > 6 ? name.slice(0, 5) : name;
  // Fallback: first 3 chars uppercase
  return name.slice(0, 3).toUpperCase();
};

export default COUNTRY_CODES;
