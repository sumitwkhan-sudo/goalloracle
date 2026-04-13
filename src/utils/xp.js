// XP & Level system
// XP is derived from predictions, results, and league membership — no separate DB field needed.

// ─── XP Awards ───
const XP_CORRECT_RESULT = 10;
const XP_CORRECT_SCORE = 30;
const XP_JOIN_LEAGUE = 5;
// const XP_INVITE_FRIEND = 50; // future feature placeholder

// ─── Level Thresholds ───
// Each level requires progressively more XP
const LEVELS = [
  { level: 1,  title: 'Fan',       xpRequired: 0 },
  { level: 2,  title: 'Fan',       xpRequired: 50 },
  { level: 3,  title: 'Fan',       xpRequired: 120 },
  { level: 4,  title: 'Fan',       xpRequired: 200 },
  { level: 5,  title: 'Analyst',   xpRequired: 300 },
  { level: 6,  title: 'Analyst',   xpRequired: 420 },
  { level: 7,  title: 'Analyst',   xpRequired: 560 },
  { level: 8,  title: 'Analyst',   xpRequired: 720 },
  { level: 9,  title: 'Analyst',   xpRequired: 900 },
  { level: 10, title: 'Oracle',    xpRequired: 1100 },
  { level: 11, title: 'Oracle',    xpRequired: 1320 },
  { level: 12, title: 'Oracle',    xpRequired: 1560 },
  { level: 13, title: 'Oracle',    xpRequired: 1820 },
  { level: 14, title: 'Oracle',    xpRequired: 2100 },
  { level: 15, title: 'Oracle',    xpRequired: 2400 },
  { level: 16, title: 'Oracle',    xpRequired: 2720 },
  { level: 17, title: 'Oracle',    xpRequired: 3060 },
  { level: 18, title: 'Oracle',    xpRequired: 3420 },
  { level: 19, title: 'Oracle',    xpRequired: 3800 },
  { level: 20, title: 'Oracle',    xpRequired: 4200 },
  { level: 21, title: 'Oracle',    xpRequired: 4620 },
  { level: 22, title: 'Oracle',    xpRequired: 5060 },
  { level: 23, title: 'Oracle',    xpRequired: 5520 },
  { level: 24, title: 'Oracle',    xpRequired: 6000 },
  { level: 25, title: 'Legend',    xpRequired: 6500 },
  { level: 26, title: 'Legend',    xpRequired: 7020 },
  { level: 27, title: 'Legend',    xpRequired: 7560 },
  { level: 28, title: 'Legend',    xpRequired: 8120 },
  { level: 29, title: 'Legend',    xpRequired: 8700 },
  { level: 30, title: 'Legend',    xpRequired: 9300 },
];

// Calculate total XP from predictions, results, and league count
export function calculateXP(userPredictions, matchResults, leagueCount) {
  let xp = 0;

  // XP from predictions
  for (const [matchId, pred] of Object.entries(userPredictions)) {
    const result = matchResults[matchId];
    if (!result?.completed || !pred?.result) continue;

    let actual;
    if (result.homeScore > result.awayScore) actual = 'home';
    else if (result.homeScore < result.awayScore) actual = 'away';
    else actual = 'draw';

    // Correct result
    if (pred.result === actual) {
      xp += XP_CORRECT_RESULT;
    }

    // Correct exact score
    const pH = parseInt(pred.score?.home);
    const pA = parseInt(pred.score?.away);
    if (!isNaN(pH) && !isNaN(pA) && pH === result.homeScore && pA === result.awayScore) {
      xp += XP_CORRECT_SCORE;
    }
  }

  // XP from league joins (excluding global which everyone gets)
  const joinedLeagues = Math.max(0, (leagueCount || 0) - 1);
  xp += joinedLeagues * XP_JOIN_LEAGUE;

  return xp;
}

// Get level info from total XP
export function getLevelInfo(totalXP) {
  let current = LEVELS[0];
  let next = LEVELS[1] || null;

  for (let i = 0; i < LEVELS.length; i++) {
    if (totalXP >= LEVELS[i].xpRequired) {
      current = LEVELS[i];
      next = LEVELS[i + 1] || null;
    } else {
      break;
    }
  }

  const xpInLevel = totalXP - current.xpRequired;
  const xpForNext = next ? next.xpRequired - current.xpRequired : 0;
  const progress = next ? Math.min(1, xpInLevel / xpForNext) : 1;

  return {
    level: current.level,
    title: current.title,
    totalXP,
    xpInLevel,
    xpForNext,
    xpToNext: next ? next.xpRequired - totalXP : 0,
    nextLevelXP: next ? next.xpRequired : totalXP,
    progress,
    isMaxLevel: !next,
  };
}
