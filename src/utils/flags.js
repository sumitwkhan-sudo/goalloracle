import WORLD_CUP_MATCHES from '../data/matches';

// Team-name → emoji-flag map. Built once at module load from the fixture
// list; group-stage rows have both home and away flags so we cover every
// participating team without needing a separate lookup table.
export const teamFlags = (() => {
  const flags = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) continue;
    flags[m.home] = m.homeFlag;
    flags[m.away] = m.awayFlag;
  }
  return flags;
})();

// ISO-2 country code → regional-indicator flag emoji. Empty string when
// the input isn't a 2-letter code so callers can string-concat safely.
export function countryFlag(code) {
  if (!code || typeof code !== 'string' || code.length !== 2) return '';
  const A = 0x1F1E6;
  const base = 'A'.charCodeAt(0);
  const cc = code.toUpperCase();
  return String.fromCodePoint(A + (cc.charCodeAt(0) - base), A + (cc.charCodeAt(1) - base));
}
