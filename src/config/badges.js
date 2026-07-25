/**
 * badges.js — display definitions for profile badges/accomplishments.
 *
 * Badge IDS are computed once, server-side, at tournament finalization
 * (admin → Close out → Finalize) and stored on the user's /profiles doc —
 * so a profile page render costs ONE cached read, never a recompute. This
 * file only maps ids → presentation; adding new badges for future
 * tournaments = new ids here + logic in the finalizer.
 */

export const BADGES = {
  podium_1: { emoji: '🥇', label: 'World #1', desc: 'Finished 1st in the Global League — World Cup 2026' },
  podium_2: { emoji: '🥈', label: 'World #2', desc: 'Finished 2nd in the Global League — World Cup 2026' },
  podium_3: { emoji: '🥉', label: 'World #3', desc: 'Finished 3rd in the Global League — World Cup 2026' },
  top_10: { emoji: '🏅', label: 'Top 10 worldwide', desc: 'A top-10 finish among every player on the planet' },
  top_1pct: { emoji: '💎', label: 'Top 1%', desc: 'Finished in the top 1% of all players' },
  top_10pct: { emoji: '⭐', label: 'Top 10%', desc: 'Finished in the top 10% of all players' },
  champion_caller: { emoji: '👑', label: 'Called the champion', desc: 'Picked the world champions before the tournament decided it' },
  oracle_eye: { emoji: '🔮', label: 'Oracle Eye', desc: 'Made a correct call that few others saw coming' },
  league_champion: { emoji: '🏆', label: 'League champion', desc: 'Won a league outright' },
  league_collector: { emoji: '🎪', label: 'League collector', desc: 'Competed in 3 or more leagues' },
  bracket_finisher: { emoji: '✅', label: 'Full bracket', desc: 'Completed every pick, groups to Final' },
  early_bird: { emoji: '🐦', label: 'Day-one player', desc: 'Locked in before the group stage kicked off' },
  founding_player: { emoji: '⚽', label: 'WC 2026 founding player', desc: 'Played the first GoalOracle World Cup' },
};

export function badgeDef(id) {
  return BADGES[id] || { emoji: '🎖️', label: id, desc: '' };
}
