/**
 * bracketUtils.js
 *
 * Simple Mode bracket derivation. Given a user's group rankings and their
 * 8 best-third-place picks, resolves actual team names for every knockout
 * slot (Round of 32 → Final), and cascades winners forward as the user picks.
 *
 * No score math here — Simple Mode only asks users to rank teams and pick
 * winners. For Classic Mode's score-driven logic see src/utils/bracket.js.
 */

import WORLD_CUP_MATCHES from '../data/matches.js';
import {
  GROUPS,
  THIRD_PLACE_SLOT_IDS,
  resolveThirdPlaceSlots,
} from './fifaThirdPlaceRules.js';

// ─── R32 matchup template (16 matches) ────────────────────────────────
// - "home" and "away" are either slot references like 'A1' (Group A winner),
//   'B2' (Group B runner-up), or a third-place slot id like 'THIRD_r32_03'.
// - Mirrors the fixture list in src/data/matches.js (r32-01 … r32-16).
export const ROUND_OF_32_TEMPLATE = [
  { matchId: 'r32-01', home: 'A2', away: 'B2' },
  { matchId: 'r32-02', home: 'C1', away: 'F2' },
  { matchId: 'r32-03', home: 'E1', away: 'THIRD_r32_03' },
  { matchId: 'r32-04', home: 'F1', away: 'C2' },
  { matchId: 'r32-05', home: 'E2', away: 'I2' },
  { matchId: 'r32-06', home: 'I1', away: 'THIRD_r32_06' },
  { matchId: 'r32-07', home: 'A1', away: 'THIRD_r32_07' },
  { matchId: 'r32-08', home: 'L1', away: 'THIRD_r32_08' },
  { matchId: 'r32-09', home: 'D1', away: 'THIRD_r32_09' },
  { matchId: 'r32-10', home: 'G1', away: 'THIRD_r32_10' },
  { matchId: 'r32-11', home: 'D2', away: 'G2' },
  { matchId: 'r32-12', home: 'H1', away: 'J2' },
  { matchId: 'r32-13', home: 'K2', away: 'L2' },
  { matchId: 'r32-14', home: 'B1', away: 'THIRD_r32_14' },
  { matchId: 'r32-15', home: 'J1', away: 'H2' },
  { matchId: 'r32-16', home: 'K1', away: 'THIRD_r32_16' },
];

// ─── Subsequent rounds — sourced by winner of the previous round ──────
export const ROUND_OF_16_TEMPLATE = [
  { matchId: 'r16-01', homeSource: 'r32-03', awaySource: 'r32-06' },
  { matchId: 'r16-02', homeSource: 'r32-01', awaySource: 'r32-04' },
  { matchId: 'r16-03', homeSource: 'r32-02', awaySource: 'r32-05' },
  { matchId: 'r16-04', homeSource: 'r32-07', awaySource: 'r32-08' },
  { matchId: 'r16-05', homeSource: 'r32-13', awaySource: 'r32-12' },
  { matchId: 'r16-06', homeSource: 'r32-09', awaySource: 'r32-10' },
  { matchId: 'r16-07', homeSource: 'r32-15', awaySource: 'r32-11' },
  { matchId: 'r16-08', homeSource: 'r32-14', awaySource: 'r32-16' },
];

export const QUARTER_FINAL_TEMPLATE = [
  { matchId: 'qf-01', homeSource: 'r16-01', awaySource: 'r16-02' },
  { matchId: 'qf-02', homeSource: 'r16-05', awaySource: 'r16-06' },
  { matchId: 'qf-03', homeSource: 'r16-03', awaySource: 'r16-04' },
  { matchId: 'qf-04', homeSource: 'r16-07', awaySource: 'r16-08' },
];

export const SEMI_FINAL_TEMPLATE = [
  { matchId: 'sf-01', homeSource: 'qf-01', awaySource: 'qf-02' },
  { matchId: 'sf-02', homeSource: 'qf-03', awaySource: 'qf-04' },
];

export const THIRD_PLACE_TEMPLATE = [
  { matchId: '3rd', homeSource: 'sf-01', awaySource: 'sf-02', loserSource: true },
];

export const FINAL_TEMPLATE = [
  { matchId: 'final', homeSource: 'sf-01', awaySource: 'sf-02' },
];

export const ROUND_ORDER = ['roundOf32', 'roundOf16', 'quarterFinals', 'semiFinals', 'thirdPlace', 'final'];

// For each round, the BRACKET-ORDER pairing: which two matches feed each
// next-round match. Drives the mobile list's printed-bracket layout — the two
// games whose winners meet are rendered adjacent with a connector pointing at
// the match they feed. (R32 is scheduled in a different order than the bracket
// structure — e.g. M89's feeders are r32-03 and r32-06 — so a schedule-order
// list can't show connections; this map is the bracket-structure order.)
export const ROUND_FEED_PAIRS = {
  roundOf32: ROUND_OF_16_TEMPLATE.map((m) => ({ next: m.matchId, sources: [m.homeSource, m.awaySource] })),
  roundOf16: QUARTER_FINAL_TEMPLATE.map((m) => ({ next: m.matchId, sources: [m.homeSource, m.awaySource] })),
  quarterFinals: SEMI_FINAL_TEMPLATE.map((m) => ({ next: m.matchId, sources: [m.homeSource, m.awaySource] })),
  semiFinals: FINAL_TEMPLATE.map((m) => ({ next: m.matchId, sources: [m.homeSource, m.awaySource] })),
};

export const ROUND_TEMPLATE_BY_KEY = {
  roundOf32: ROUND_OF_32_TEMPLATE,
  roundOf16: ROUND_OF_16_TEMPLATE,
  quarterFinals: QUARTER_FINAL_TEMPLATE,
  semiFinals: SEMI_FINAL_TEMPLATE,
  thirdPlace: THIRD_PLACE_TEMPLATE,
  final: FINAL_TEMPLATE,
};

// ─── Knockout match numbers + slot descriptors (display only) ─────────
// The 32 knockout fixtures are FIFA matches M73–M104 (72 group matches precede
// them). FIFA numbers them in BRACKET-STRUCTURE order — not kickoff order:
//   r32-01..r32-16 → M73..M88, r16-01..r16-08 → M89..M96,
//   qf-01..qf-04 → M97..M100, sf-01/sf-02 → M101/M102, 3rd → M103, final → M104.
// (e.g. M89 is r16-01 — the July 4 Philadelphia game — even though r16-02 in
// Houston kicks off earlier that day.) Derived from the round templates so the
// id→number mapping stays in lockstep with the bracket definition above.
const _KO_MATCH_NUMBER = (() => {
  const order = [
    ...ROUND_OF_32_TEMPLATE,
    ...ROUND_OF_16_TEMPLATE,
    ...QUARTER_FINAL_TEMPLATE,
    ...SEMI_FINAL_TEMPLATE,
    ...THIRD_PLACE_TEMPLATE,
    ...FINAL_TEMPLATE,
  ];
  const out = {};
  order.forEach((m, i) => { out[m.matchId] = 73 + i; });
  return out;
})();

// FIFA match number (73–104) for a knockout matchId, or null.
export function koMatchNumber(matchId) {
  return _KO_MATCH_NUMBER[matchId] || null;
}

// Humanize a matches.js slot placeholder for an UNDECIDED slot side:
//   "1st Group A" / "2nd Group A"  → kept (which qualifier fills it)
//   "3rd ABCDF"                    → "3rd place (A/B/C/D/F)"
//   "W R32-03" / "L SF-01"         → "Winner of M75" / "Loser of M101"
function humanizeSlot(ph) {
  if (!ph || typeof ph !== 'string') return null;
  let mm = ph.match(/^(1st|2nd) Group ([A-L])$/i);
  if (mm) return `${mm[1]} Group ${mm[2].toUpperCase()}`;
  mm = ph.match(/^3rd ([A-L]+)$/i);
  if (mm) return `3rd place (${mm[1].toUpperCase().split('').join('/')})`;
  mm = ph.match(/^([WL])\s+(\S+)$/);
  if (mm) {
    const num = koMatchNumber(mm[2].toLowerCase());
    const word = mm[1].toUpperCase() === 'W' ? 'Winner' : 'Loser';
    return num ? `${word} of M${num}` : `${word} of ${mm[2]}`;
  }
  return ph;
}
const _KO_SLOT_LABEL = (() => {
  const out = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) out[m.id] = { home: humanizeSlot(m.home), away: humanizeSlot(m.away) };
  }
  return out;
})();

// { home, away } human descriptors for a knockout matchId's two sides — shown
// in place of a bare "TBD" when that side's real team isn't decided yet.
export function koSlotLabel(matchId) {
  return _KO_SLOT_LABEL[matchId] || { home: null, away: null };
}

// ─── Team flags, derived from fixture data ────────────────────────────
let _teamFlagCache = null;
export function getTeamFlags() {
  if (_teamFlagCache) return _teamFlagCache;
  const flags = {};
  for (const m of WORLD_CUP_MATCHES) {
    if (m.isKnockout) continue;
    flags[m.home] = m.homeFlag;
    flags[m.away] = m.awayFlag;
  }
  _teamFlagCache = flags;
  return flags;
}

/**
 * Read a team name from user group rankings using a slot reference.
 * @param {Object} groupPredictions  { A: { ranking: [t1, t2, t3, t4] }, ... }
 * @param {string} ref               e.g. 'A1' (= Group A 1st), 'C3' (= Group C 3rd)
 * @returns {string|null}            team name, or null if unranked
 */
export function getTeamByRef(groupPredictions, ref) {
  if (!ref || ref.length < 2) return null;
  const group = ref[0];
  const pos = parseInt(ref.slice(1), 10);
  const ranking = groupPredictions?.[group]?.ranking;
  if (!Array.isArray(ranking) || ranking.length < pos) return null;
  return ranking[pos - 1] || null;
}

/**
 * Derive the Round of 32 matchups as actual team names.
 *
 * @param {Object}   groupPredictions  { A: { ranking: [..] }, B: {..} ... }
 * @param {string[]} bestThirdPicks    8 group letters whose 3rd-place teams advance
 * @returns {Array<{ matchId, home, away, homeFlag, awayFlag }>}
 */
export function deriveRoundOf32(groupPredictions, bestThirdPicks) {
  const flags = getTeamFlags();
  // resolveThirdPlaceSlots() throws on an unknown/malformed 8-group combo
  // (no algorithmic fallback — by design). That's correct for the data
  // layer, but it must NOT crash the bracket UI: a single bad/legacy picks
  // doc would otherwise blank the whole wizard (it runs in a render-time
  // useMemo with no error boundary below it). Degrade to null third slots
  // (rendered as TBD) instead, so the user can still see and edit the rest
  // of their bracket. Mirrors the "fewer than 8 picks" path.
  let thirdSlots = null;
  if (Array.isArray(bestThirdPicks) && bestThirdPicks.length === 8) {
    try {
      thirdSlots = resolveThirdPlaceSlots(bestThirdPicks);
    } catch {
      thirdSlots = null;
    }
  }

  return ROUND_OF_32_TEMPLATE.map(({ matchId, home, away }) => {
    const resolve = (ref) => {
      if (ref.startsWith('THIRD_')) {
        if (!thirdSlots) return null;
        const slotId = ref.replace('THIRD_', '');
        const group = thirdSlots[slotId];
        if (!group) return null;
        return getTeamByRef(groupPredictions, `${group}3`);
      }
      return getTeamByRef(groupPredictions, ref);
    };
    const homeTeam = resolve(home);
    const awayTeam = resolve(away);
    return {
      matchId,
      home: homeTeam,
      away: awayTeam,
      homeFlag: homeTeam ? flags[homeTeam] || '🏳️' : null,
      awayFlag: awayTeam ? flags[awayTeam] || '🏳️' : null,
    };
  });
}

/**
 * The set of team names a user predicted would reach the Round of 32 (their
 * group top-2 + their best-thirds). A real team is "earned" — i.e. the user
 * may advance it once the bracket reseeds to real teams — iff it is in this
 * set. (Knockout-real-reseed feature.)
 *
 * @returns {Set<string>}
 */
export function predictedR32TeamSet(groupPredictions, bestThirdPicks) {
  const set = new Set();
  for (const m of deriveRoundOf32(groupPredictions, bestThirdPicks)) {
    if (m.home) set.add(m.home);
    if (m.away) set.add(m.away);
  }
  return set;
}

/**
 * Merge the REAL Round of 32 (resolved per side as groups finish) onto the
 * user's PREDICTED R32, side by side. A side that is decided upstream
 * (`homeReal`/`awayReal`) shows the real team and is "earned" only if the user
 * predicted that team to advance; an UNDECIDED side goes to null (TBD) — the
 * bracket reflects reality, so a side whose real qualifier isn't known yet shows
 * a TBD placeholder (the wizard renders its descriptor + match number) rather
 * than the user's group-based prediction. Mirrors deriveRoundOf32's slot shape
 * and adds `homeReal/awayReal/homeEarned/awayEarned`. (Knockout-real-reseed.)
 *
 * @param {Array} predictedR32      deriveRoundOf32(...) output
 * @param {Object} realR32          { matchId: { home, away, homeReal, awayReal } } | null
 * @param {Set<string>} predictedTeamSet  predictedR32TeamSet(...)
 */
export function mergeRealRoundOf32(predictedR32, realR32, predictedTeamSet) {
  const flags = getTeamFlags();
  const earnedSet = predictedTeamSet || new Set();
  return predictedR32.map((slot) => {
    const real = (realR32 && realR32[slot.matchId]) || {};
    const useRealHome = !!(real.homeReal && real.home);
    const useRealAway = !!(real.awayReal && real.away);
    // Decided → real team; undecided → null (TBD), never the predicted team.
    const home = useRealHome ? real.home : null;
    const away = useRealAway ? real.away : null;
    return {
      matchId: slot.matchId,
      home: home || null,
      away: away || null,
      homeFlag: home ? flags[home] || '🏳️' : null,
      awayFlag: away ? flags[away] || '🏳️' : null,
      homeReal: useRealHome,
      awayReal: useRealAway,
      // Predicted (own) teams are always pickable; real teams only if earned.
      homeEarned: useRealHome ? earnedSet.has(real.home) : true,
      awayEarned: useRealAway ? earnedSet.has(real.away) : true,
    };
  });
}

/**
 * Cascade winners from the previous round into the next round's slots.
 *
 * @param {Object<string, {winnerId: string, loserId: string}>} picksByMatchId
 *   The current state of picks across *all* rounds so far.
 * @param {Array} template
 *   One of the ROUND_*_TEMPLATE arrays.
 * @returns {Array<{ matchId, home, away, homeFlag, awayFlag }>}
 */
export function deriveNextRound(picksByMatchId, template) {
  const flags = getTeamFlags();
  return template.map(({ matchId, homeSource, awaySource, loserSource }) => {
    const homePick = picksByMatchId[homeSource];
    const awayPick = picksByMatchId[awaySource];
    const homeTeam = homePick ? (loserSource ? homePick.loserId : homePick.winnerId) : null;
    const awayTeam = awayPick ? (loserSource ? awayPick.loserId : awayPick.winnerId) : null;
    return {
      matchId,
      home: homeTeam || null,
      away: awayTeam || null,
      homeFlag: homeTeam ? flags[homeTeam] || '🏳️' : null,
      awayFlag: awayTeam ? flags[awayTeam] || '🏳️' : null,
    };
  });
}

/**
 * Collect all picks across all knockout rounds into a flat lookup by matchId.
 */
export function flattenPicks(knockoutPredictions) {
  const flat = {};
  for (const round of ROUND_ORDER) {
    const picks = knockoutPredictions?.[round];
    if (!Array.isArray(picks)) continue;
    for (const p of picks) {
      if (!p || !p.matchId) continue;
      flat[p.matchId] = p;
    }
  }
  return flat;
}

/**
 * Given a matchId whose winner was just changed, find every downstream matchId
 * whose home or away source chains back to that match. Used to reset stale picks
 * when a user changes an earlier-round selection.
 */
export function getDownstreamMatchIds(changedMatchId) {
  const downstream = new Set();
  const queue = [changedMatchId];

  const allDownstreamTemplates = [
    ...ROUND_OF_16_TEMPLATE,
    ...QUARTER_FINAL_TEMPLATE,
    ...SEMI_FINAL_TEMPLATE,
    ...THIRD_PLACE_TEMPLATE,
    ...FINAL_TEMPLATE,
  ];

  while (queue.length) {
    const current = queue.shift();
    for (const t of allDownstreamTemplates) {
      if (t.homeSource === current || t.awaySource === current) {
        if (!downstream.has(t.matchId)) {
          downstream.add(t.matchId);
          queue.push(t.matchId);
        }
      }
    }
  }

  return [...downstream];
}

/**
 * Which Firestore `knockoutPredictions[round]` array does this matchId live in?
 */
export function getRoundForMatchId(matchId) {
  if (matchId.startsWith('r32-')) return 'roundOf32';
  if (matchId.startsWith('r16-')) return 'roundOf16';
  if (matchId.startsWith('qf-')) return 'quarterFinals';
  if (matchId.startsWith('sf-')) return 'semiFinals';
  if (matchId === '3rd') return 'thirdPlace';
  if (matchId === 'final') return 'final';
  return null;
}

/**
 * Produce an empty knockoutPredictions scaffold (all rounds, empty arrays).
 */
export function emptyKnockoutPredictions() {
  return {
    roundOf32: [],
    roundOf16: [],
    quarterFinals: [],
    semiFinals: [],
    thirdPlace: [],
    final: [],
  };
}

/**
 * Has the user ranked every team in every group? (12 groups × 4 teams)
 */
export function areGroupRankingsComplete(groupPredictions) {
  if (!groupPredictions) return false;
  for (const g of GROUPS) {
    const ranking = groupPredictions[g]?.ranking;
    if (!Array.isArray(ranking) || ranking.length !== 4) return false;
    if (ranking.some((t) => !t)) return false;
  }
  return true;
}

export { GROUPS, THIRD_PLACE_SLOT_IDS };
