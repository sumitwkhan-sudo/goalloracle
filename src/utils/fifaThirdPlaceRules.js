/**
 * fifaThirdPlaceRules.js
 *
 * FIFA 2026 World Cup — third-place qualification rules and Annex C bracket
 * assignment lookup. Shared by Classic Mode (bracket.js) and Simple Mode
 * (bracketUtils.js) so both modes derive knockout matchups identically.
 *
 * The FIFA format: 12 groups (A–L), top 2 advance automatically, best 8 of 12
 * third-placed teams advance into the Round of 32. Which third-placed team
 * plays which group winner depends on the combination of qualifying groups
 * (FIFA Technical Regulations Annex C).
 */

export const GROUPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];

// ─── R32 slot keys that receive a best-third-place team ────────────────
// Each slot's value is the Group whose 3rd-place team fills the AWAY side
// of that R32 match.
export const THIRD_PLACE_SLOT_IDS = [
  'r32_03', 'r32_06', 'r32_07', 'r32_08',
  'r32_09', 'r32_10', 'r32_14', 'r32_16',
];

// ─── Slot eligibility (which groups' 3rd-place teams may fill each slot) ──
// Derived from the FIFA 2026 bracket template. Each slot lists the 5 groups
// whose 3rd-place teams could validly occupy that slot. Used as a fallback
// when the qualifying combination isn't in the Annex C lookup.
export const THIRD_PLACE_SLOT_ELIGIBILITY = {
  r32_03: 'ABCDF',
  r32_06: 'CDFGH',
  r32_07: 'CEFHI',
  r32_08: 'EHIJK',
  r32_09: 'BEFIJ',
  r32_10: 'AEHIJ',
  r32_14: 'EFGIJ',
  r32_16: 'DEIJL',
};

// ─── FIFA Annex C lookup ──────────────────────────────────────────────
// Key: sorted string of the 8 group letters whose 3rd-placed teams qualify.
// Value: { slotId: group } assignment for all 8 R32 third-place slots.
// Not all 495 combinations are enumerated — missing combinations fall back
// to the greedy-matching algorithm in resolveThirdPlaceSlots().
export const THIRD_PLACE_ANNEX_C = {
  EFGHIJKL: { r32_07: 'E', r32_14: 'J', r32_09: 'I', r32_03: 'F', r32_10: 'H', r32_06: 'G', r32_16: 'L', r32_08: 'K' },
  DFGHIJKL: { r32_07: 'H', r32_14: 'G', r32_09: 'I', r32_03: 'D', r32_10: 'J', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  DEGHIJKL: { r32_07: 'E', r32_14: 'J', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'G', r32_16: 'L', r32_08: 'K' },
  DEFHIJKL: { r32_07: 'E', r32_14: 'J', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  DEFGIJKL: { r32_07: 'E', r32_14: 'G', r32_09: 'I', r32_03: 'D', r32_10: 'J', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  DEFGHJKL: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  DEFGHIKL: { r32_07: 'E', r32_14: 'G', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  DEFGHIJL: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'I' },
  DEFGHIJK: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'I', r32_08: 'K' },
  CFGHIJKL: { r32_07: 'H', r32_14: 'G', r32_09: 'I', r32_03: 'C', r32_10: 'J', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CEGHIJKL: { r32_07: 'E', r32_14: 'J', r32_09: 'I', r32_03: 'C', r32_10: 'H', r32_06: 'G', r32_16: 'L', r32_08: 'K' },
  CEFHIJKL: { r32_07: 'E', r32_14: 'J', r32_09: 'I', r32_03: 'C', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CEFGIJKL: { r32_07: 'E', r32_14: 'G', r32_09: 'I', r32_03: 'C', r32_10: 'J', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CEFGHJKL: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'C', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CEFGHIKL: { r32_07: 'E', r32_14: 'G', r32_09: 'I', r32_03: 'C', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CEFGHIJL: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'C', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'I' },
  CEFGHIJK: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'C', r32_10: 'H', r32_06: 'F', r32_16: 'I', r32_08: 'K' },
  CDGHIJKL: { r32_07: 'H', r32_14: 'G', r32_09: 'I', r32_03: 'C', r32_10: 'J', r32_06: 'D', r32_16: 'L', r32_08: 'K' },
  CDFHIJKL: { r32_07: 'C', r32_14: 'J', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDFGIJKL: { r32_07: 'C', r32_14: 'G', r32_09: 'I', r32_03: 'D', r32_10: 'J', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDFGHJKL: { r32_07: 'C', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDFGHIKL: { r32_07: 'C', r32_14: 'G', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDFGHIJL: { r32_07: 'C', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'I' },
  CDFGHIJK: { r32_07: 'C', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'I', r32_08: 'K' },
  CDEHIJKL: { r32_07: 'E', r32_14: 'J', r32_09: 'I', r32_03: 'C', r32_10: 'H', r32_06: 'D', r32_16: 'L', r32_08: 'K' },
  CDEGIJKL: { r32_07: 'E', r32_14: 'G', r32_09: 'I', r32_03: 'C', r32_10: 'J', r32_06: 'D', r32_16: 'L', r32_08: 'K' },
  CDEGHJKL: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'C', r32_10: 'H', r32_06: 'D', r32_16: 'L', r32_08: 'K' },
  CDEGHIKL: { r32_07: 'E', r32_14: 'G', r32_09: 'I', r32_03: 'C', r32_10: 'H', r32_06: 'D', r32_16: 'L', r32_08: 'K' },
  CDEGHIJL: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'C', r32_10: 'H', r32_06: 'D', r32_16: 'L', r32_08: 'I' },
  CDEGHIJK: { r32_07: 'E', r32_14: 'G', r32_09: 'J', r32_03: 'C', r32_10: 'H', r32_06: 'D', r32_16: 'I', r32_08: 'K' },
  CDEFIJKL: { r32_07: 'C', r32_14: 'J', r32_09: 'E', r32_03: 'D', r32_10: 'I', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDEFHJKL: { r32_07: 'C', r32_14: 'J', r32_09: 'E', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDEFHIKL: { r32_07: 'C', r32_14: 'E', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDEFHIJL: { r32_07: 'C', r32_14: 'J', r32_09: 'E', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'I' },
  CDEFHIJK: { r32_07: 'C', r32_14: 'J', r32_09: 'E', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'I', r32_08: 'K' },
  CDEFGJKL: { r32_07: 'C', r32_14: 'G', r32_09: 'E', r32_03: 'D', r32_10: 'J', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDEFGIKL: { r32_07: 'C', r32_14: 'G', r32_09: 'E', r32_03: 'D', r32_10: 'I', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDEFGIJL: { r32_07: 'C', r32_14: 'G', r32_09: 'E', r32_03: 'D', r32_10: 'J', r32_06: 'F', r32_16: 'L', r32_08: 'I' },
  CDEFGIJK: { r32_07: 'C', r32_14: 'G', r32_09: 'E', r32_03: 'D', r32_10: 'J', r32_06: 'F', r32_16: 'I', r32_08: 'K' },
  CDEFGHKL: { r32_07: 'C', r32_14: 'G', r32_09: 'E', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'K' },
  CDEFGHJL: { r32_07: 'C', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'E' },
  CDEFGHJK: { r32_07: 'C', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'E', r32_08: 'K' },
  CDEFGHIL: { r32_07: 'C', r32_14: 'E', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'L', r32_08: 'G' },
  CDEFGHIK: { r32_07: 'C', r32_14: 'E', r32_09: 'I', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'G', r32_08: 'K' },
  CDEFGHIJ: { r32_07: 'C', r32_14: 'G', r32_09: 'J', r32_03: 'D', r32_10: 'H', r32_06: 'F', r32_16: 'E', r32_08: 'I' },
};

import annexeC from '../data/annexe-c.json';

// Map from Annexe C match IDs (FIFA source format, e.g. "M74") to our
// internal slot IDs (e.g. "r32_03"). Used to translate the authoritative
// annexe-c.json routing into the legacy slot-name format used elsewhere.
const MATCH_TO_SLOT = {
  M74: 'r32_03', M77: 'r32_06', M79: 'r32_07', M80: 'r32_08',
  M81: 'r32_09', M82: 'r32_10', M85: 'r32_14', M87: 'r32_16',
};

// Transform the JSON lookup once at module load.
const JSON_LOOKUP = (() => {
  const out = {};
  const raw = annexeC?.lookup || {};
  for (const [key, routing] of Object.entries(raw)) {
    const slots = {};
    for (const [matchId, val] of Object.entries(routing)) {
      const slotId = MATCH_TO_SLOT[matchId];
      if (slotId && typeof val === 'string' && val.length >= 2) {
        slots[slotId] = val[1]; // "3X" → "X"
      }
    }
    if (Object.keys(slots).length === 8) out[key] = slots;
  }
  return out;
})();

/**
 * Resolve which 3rd-place group fills each R32 third-place slot.
 *
 * Lookups come from annexe-c.json (preferred, 495-row canonical FIFA source)
 * or the legacy 45-entry THIRD_PLACE_ANNEX_C table above as a transitional
 * backstop. There is intentionally NO algorithmic fallback — FIFA does not
 * publish the derivation algorithm, and a hand-rolled approximation will
 * disagree with the official routing in edge cases. Unknown combinations
 * throw loudly rather than silently returning wrong brackets.
 *
 * @param {string[]} qualifyingGroups  exactly 8 group letters
 * @returns {Object}                   { slotId: groupLetter } for all 8 slots
 */
export function resolveThirdPlaceSlots(qualifyingGroups) {
  if (!Array.isArray(qualifyingGroups) || qualifyingGroups.length !== 8) {
    throw new Error('resolveThirdPlaceSlots expects exactly 8 qualifying groups');
  }
  const key = [...qualifyingGroups].sort().join('');
  if (JSON_LOOKUP[key]) return { ...JSON_LOOKUP[key] };
  if (THIRD_PLACE_ANNEX_C[key]) return { ...THIRD_PLACE_ANNEX_C[key] };
  throw new Error(`No Annexe C routing for advancing groups: ${key}`);
}

// ─── User-facing copy ────────────────────────────────────────────────
export const FIFA_THIRD_PLACE_EXPLANATION =
  'FIFA ranks all 12 third-place finishers by: points → goal difference → goals scored → disciplinary record. The 8 best advance to the Round of 32.';

export const FIFA_THIRD_PLACE_CRITERIA = [
  'Points (W=3, D=1, L=0)',
  'Goal difference',
  'Goals scored',
  'Disciplinary record (fewest yellow/red cards)',
  'FIFA ranking',
];
