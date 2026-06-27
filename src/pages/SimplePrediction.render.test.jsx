/* Regression guard: SSR-render the FULL <SimplePrediction> wizard across many
 * data states so a render-time crash in the "edit picks" flow can never ship
 * silently again. This catches the class of bug the build + unit tests miss:
 * a TDZ ReferenceError, a Rules-of-Hooks violation, an undefined component/
 * icon, or an unguarded throw in the bracket derivation — none of which fail
 * `npm run build` but all of which blank the wizard at runtime.
 *
 * (Originally written to reproduce a TDZ crash: handleSyncLeagues' dep array
 * referenced `bracketState` before its declaration — fixed by reordering.)
 *
 * Heavy deps are vi.mock'd so render is deterministic + offline; the real
 * useBracketState + bracketUtils run (we want their real behavior).
 */
import { describe, it, expect, vi, beforeAll } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  deriveRoundOf32, predictedR32TeamSet,
} from '../utils/bracketUtils';

// ── Browser globals the wizard touches at render time (node test env has none).
// All localStorage reads in the wizard are try/catch-wrapped, but provide a real
// store so we faithfully mirror the browser path rather than the catch path.
beforeAll(() => {
  const store = {};
  const ls = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  };
  if (typeof globalThis.window === 'undefined') {
    globalThis.window = {
      innerWidth: 1280,
      localStorage: ls,
      addEventListener: () => {},
      removeEventListener: () => {},
      scrollTo: () => {},
      confirm: () => true,
      alert: () => {},
    };
  }
  if (typeof globalThis.localStorage === 'undefined') globalThis.localStorage = ls;
  if (typeof globalThis.document === 'undefined') {
    globalThis.document = { getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {} };
  }
});

// ── Mocks ────────────────────────────────────────────────────────────────
let LAYOUT = 'desktop';
vi.mock('../hooks/useBracketLayout', () => ({ default: () => LAYOUT }));

vi.mock('../utils/track', () => ({ default: () => {}, track: () => {} }));

vi.mock('../utils/db', () => ({
  // subscribeToFeatureFlags must invoke its callback with reseed ON.
  subscribeToFeatureFlags: (cb) => { cb({ knockoutRealReseed: true }); return () => {}; },
  fetchActualBracket: async () => globalThis.__REAL_BRACKET__ || { r32: {} },
  getSimpleConsensus: async () => null,
  getSimplePrediction: async () => null,
  copySimplePrediction: async () => ({ payload: {} }),
  applyGlobalKnockoutToMyLeagues: async () => ({ count: 0 }),
  resetSimplePrediction: async () => {},
  // HouseRulesSection imports these from db.
  acknowledgeLeagueHouseRules: async () => {},
  editLeagueHouseRules: async () => {},
  reportContent: async () => {},
}));

// The real useSimplePrediction subscribes to Firestore — stub it.
vi.mock('../hooks/useSimplePrediction', () => ({
  default: (userId, leagueId) => ({
    data: globalThis.__PRED_DATA__ ?? null,
    loading: false,
    saving: false,
    savedAt: null,
    error: null,
    save: () => {},
    saveNow: async () => {},
  }),
}));

// Coachmarks overlay — keep hasSeenWizardTutorial real-ish (returns true so the
// overlay is suppressed and doesn't add render noise). Render a no-op overlay.
vi.mock('../components/onboarding/WizardCoachmarks', () => ({
  default: () => null,
  hasSeenWizardTutorial: () => true,
}));

import SimplePrediction from './SimplePrediction';

// ── Fixtures ───────────────────────────────────────────────────────────────
const GROUP_TEAMS = {
  A: ['Czechia', 'Mexico', 'South Africa', 'South Korea'],
  B: ['Bosnia and Herzegovina', 'Canada', 'Qatar', 'Switzerland'],
  C: ['Brazil', 'Haiti', 'Morocco', 'Scotland'],
  D: ['Australia', 'Paraguay', 'Türkiye', 'USA'],
  E: ['Curaçao', 'Ecuador', 'Germany', 'Ivory Coast'],
  F: ['Japan', 'Netherlands', 'Sweden', 'Tunisia'],
  G: ['Belgium', 'Egypt', 'Iran', 'New Zealand'],
  H: ['Cape Verde', 'Saudi Arabia', 'Spain', 'Uruguay'],
  I: ['France', 'Iraq', 'Norway', 'Senegal'],
  J: ['Algeria', 'Argentina', 'Austria', 'Jordan'],
  K: ['Colombia', 'DR Congo', 'Portugal', 'Uzbekistan'],
  L: ['Croatia', 'England', 'Ghana', 'Panama'],
};
const GROUPS = Object.keys(GROUP_TEAMS);
function makeGroups() {
  const g = {};
  for (const L of GROUPS) g[L] = { ranking: [...GROUP_TEAMS[L]] };
  return g;
}
const VALID_THIRDS = ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']; // valid Annexe C combo

function makeRealR32(groupPredictions, thirds, { partial = false } = {}) {
  // /api/actual-bracket shape: { r32: { 'r32-01': { home, away, homeReal, awayReal } } }
  const predicted = deriveRoundOf32(groupPredictions, thirds);
  const r32 = {};
  predicted.forEach((slot, i) => {
    if (partial && i % 3 === 0) {
      // Some slots null / homeReal false / home null but homeReal true.
      if (i % 6 === 0) { r32[slot.matchId] = { home: null, away: slot.away || 'Brazil', homeReal: true, awayReal: true }; }
      else { r32[slot.matchId] = { home: slot.home || 'Mexico', away: 'Spain', homeReal: false, awayReal: true }; }
      return;
    }
    r32[slot.matchId] = {
      home: slot.home || 'Mexico',
      away: 'Spain',           // foreign → NOT in predicted set → locked row
      homeReal: true,
      awayReal: true,
    };
  });
  return { r32 };
}

function makeFullKnockout(groupPredictions, thirds) {
  // Pick the home team of every R32 match, then derive winners forward by
  // always advancing whichever team is "home" in each derived slot. Simplest:
  // mirror the baseline repro — fill R32 only and let the hook derive the rest
  // as TBD; for a COMPLETE bracket we walk the rounds.
  const rounds = { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: [], final: [] };
  const predicted = deriveRoundOf32(groupPredictions, thirds);
  for (const slot of predicted) {
    if (slot.home && slot.away) rounds.roundOf32.push({ matchId: slot.matchId, winnerId: slot.home, loserId: slot.away });
  }
  return rounds;
}

const baseLeague = { id: 'global-simple', name: 'Global Quick Picks' };

function render(data, league = baseLeague, userLeagues = [], realBracket = null) {
  globalThis.__PRED_DATA__ = data;
  globalThis.__REAL_BRACKET__ = realBracket;
  return renderToStaticMarkup(
    <SimplePrediction userId="u1" league={league} userLeagues={userLeagues} />,
  );
}

function tryRender(label, data, league, userLeagues, realBracket) {
  try {
    render(data, league, userLeagues, realBracket);
    return { label, threw: false };
  } catch (e) {
    return { label, threw: true, message: e?.message, stack: e?.stack };
  }
}

// ── Data states ──────────────────────────────────────────────────────────────
describe('repro: full SimplePrediction wizard render (reseed ON)', () => {
  const groups = makeGroups();
  const fullR32 = makeRealR32(groups, VALID_THIRDS);

  const states = [];

  // 1. Complete global bracket (Final winner picked), reseed ON, all-real R32.
  states.push(() => tryRender(
    'complete-global-allreal',
    { groupPredictions: groups, bestThirdPicks: VALID_THIRDS, knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS), isComplete: true },
    baseLeague, [], fullR32,
  ));

  // 2. Incomplete global bracket, reseed ON.
  states.push(() => tryRender(
    'incomplete-global',
    { groupPredictions: groups, bestThirdPicks: VALID_THIRDS, knockoutPredictions: { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: [], final: [] } },
    baseLeague, [], fullR32,
  ));

  // 3. realR32 PARTIAL (some slots null / homeReal false / home null but homeReal true).
  states.push(() => tryRender(
    'partial-realR32',
    { groupPredictions: groups, bestThirdPicks: VALID_THIRDS, knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS) },
    baseLeague, [], makeRealR32(groups, VALID_THIRDS, { partial: true }),
  ));

  // 4a. bestThirdPicks MALFORMED: 7 picks.
  states.push(() => tryRender(
    'thirds-7',
    { groupPredictions: groups, bestThirdPicks: ['C', 'D', 'E', 'F', 'G', 'H', 'I'], knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS) },
    baseLeague, [], fullR32,
  ));
  // 4b. 9 picks.
  states.push(() => tryRender(
    'thirds-9',
    { groupPredictions: groups, bestThirdPicks: ['C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K'], knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS) },
    baseLeague, [], fullR32,
  ));
  // 4c. 8 invalid letters (unknown Annexe C combo).
  states.push(() => tryRender(
    'thirds-8-invalid',
    { groupPredictions: groups, bestThirdPicks: ['Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z', 'Z'], knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS) },
    baseLeague, [], fullR32,
  ));
  // 4d. duplicates.
  states.push(() => tryRender(
    'thirds-dupes',
    { groupPredictions: groups, bestThirdPicks: ['C', 'C', 'D', 'D', 'E', 'E', 'F', 'F'], knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS) },
    baseLeague, [], fullR32,
  ));

  // 5. knockout-only league (empty groupPredictions/bestThirdPicks).
  states.push(() => tryRender(
    'knockout-only-empty',
    { groupPredictions: {}, bestThirdPicks: [], knockoutPredictions: { roundOf32: [], roundOf16: [], quarterFinals: [], semiFinals: [], thirdPlace: [], final: [] } },
    { id: 'ko-league', name: 'KO League', knockoutOnly: true }, [], fullR32,
  ));

  // 6. otherSyncableLeagues: a league with predictionMode undefined / knockoutOnly true.
  states.push(() => tryRender(
    'otherSyncableLeagues-mixed',
    { groupPredictions: groups, bestThirdPicks: VALID_THIRDS, knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS), isComplete: true },
    baseLeague,
    [
      { id: 'global-simple', name: 'Global' },
      { id: 'lg-a' },                                   // predictionMode undefined
      { id: 'lg-b', knockoutOnly: true, name: 'KO' },
      { id: 'lg-c', predictionMode: 'classic', name: 'Classic' },
      null,                                             // null entry
      { id: 'lg-d', predictionMode: 'simple', name: 'Sync me' },
    ],
    fullR32,
  ));

  // 7. Mobile layout variant.
  states.push(() => {
    LAYOUT = 'mobile';
    const r = tryRender(
      'mobile-complete',
      { groupPredictions: groups, bestThirdPicks: VALID_THIRDS, knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS), isComplete: true },
      baseLeague, [], fullR32,
    );
    LAYOUT = 'desktop';
    return r;
  });

  // 8. Null/empty data (loading already false).
  states.push(() => tryRender('null-data', null, baseLeague, [], fullR32));

  // 9. Non-global league (triggers copy banner + getSimplePrediction effect path).
  states.push(() => tryRender(
    'nonglobal-haspicks',
    { groupPredictions: groups, bestThirdPicks: VALID_THIRDS, knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS) },
    { id: 'priv-1', name: 'Friends Pool', createdBy: 'u1' }, [], fullR32,
  ));

  // 10. realR32 with extra/unknown matchIds + missing r32 key entirely.
  states.push(() => tryRender(
    'realR32-noKey',
    { groupPredictions: groups, bestThirdPicks: VALID_THIRDS, knockoutPredictions: makeFullKnockout(groups, VALID_THIRDS) },
    baseLeague, [], {},  // fetchActualBracket returns {} → realBracket.r32 is undefined
  ));

  it('renders every data state without throwing (reports the first that does)', () => {
    const results = states.map((fn) => fn());
    const failures = results.filter((r) => r.threw);
    if (failures.length) {
      for (const f of failures) {
        // eslint-disable-next-line no-console
        console.error(`\n=== THREW: ${f.label} ===\n${f.message}\n${f.stack}\n`);
      }
    }
    const summary = results.map((r) => `${r.threw ? 'THROW' : 'ok   '}  ${r.label}`).join('\n');
    // eslint-disable-next-line no-console
    console.log('\nWizard render matrix:\n' + summary + '\n');
    expect(failures.map((f) => `${f.label}: ${f.message}`)).toEqual([]);
  });
});
