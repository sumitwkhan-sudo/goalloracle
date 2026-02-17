// Points calculation engine & tiebreaker logic

export function calculatePoints(prediction, actualResult, pointsSystem) {
  if (!prediction || !actualResult || !actualResult.completed) return 0;
  let points = 0;

  const predictedOutcome = prediction.result;
  let actualOutcome;
  if (actualResult.homeScore > actualResult.awayScore) actualOutcome = 'home';
  else if (actualResult.homeScore < actualResult.awayScore) actualOutcome = 'away';
  else actualOutcome = 'draw';

  if (predictedOutcome === actualOutcome) {
    points += pointsSystem.correctResult || 3;
  }

  const pH = parseInt(prediction.score?.home);
  const pA = parseInt(prediction.score?.away);
  if (!isNaN(pH) && !isNaN(pA) && pH === actualResult.homeScore && pA === actualResult.awayScore) {
    points += pointsSystem.correctScore || 5;
  }

  if (actualResult.isKnockout || actualResult.extraTime || actualResult.penalties) {
    if (prediction.extraTime && actualResult.extraTime) points += pointsSystem.extraTimeBonus || 1;
    if (prediction.penalties && actualResult.penalties) points += pointsSystem.penaltyBonus || 2;
  }

  return points;
}

export function calculateTotalPoints(userPredictions, matchResults, pointsSystem) {
  let totalPoints = 0, exactScores = 0, knockoutBonuses = 0, correctResults = 0;

  for (const [matchId, pred] of Object.entries(userPredictions)) {
    const result = matchResults[matchId];
    if (!result?.completed) continue;

    totalPoints += calculatePoints(pred, result, pointsSystem);

    const pH = parseInt(pred.score?.home);
    const pA = parseInt(pred.score?.away);
    if (!isNaN(pH) && !isNaN(pA) && pH === result.homeScore && pA === result.awayScore) exactScores++;

    let actual;
    if (result.homeScore > result.awayScore) actual = 'home';
    else if (result.homeScore < result.awayScore) actual = 'away';
    else actual = 'draw';
    if (pred.result === actual) correctResults++;

    if (pred.extraTime && result.extraTime) knockoutBonuses++;
    if (pred.penalties && result.penalties) knockoutBonuses++;
  }

  return { totalPoints, exactScores, knockoutBonuses, correctResults };
}

export function sortLeaderboard(entries) {
  return [...entries].sort((a, b) => {
    if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
    if (b.exactScores !== a.exactScores) return b.exactScores - a.exactScores;
    if (b.knockoutBonuses !== a.knockoutBonuses) return b.knockoutBonuses - a.knockoutBonuses;
    if (a.earliestSubmission && b.earliestSubmission) return a.earliestSubmission - b.earliestSubmission;
    return 0;
  });
}

export function isPredictionLocked(matchDate, matchTime) {
  // Match times are ET. During World Cup (June–July), ET = UTC-4 (EDT).
  // Construct UTC timestamp: e.g., 15:00 ET = 19:00 UTC
  const [hh, mm] = matchTime.split(':').map(Number);
  const utc = new Date(`${matchDate}T00:00:00Z`);
  utc.setUTCHours(hh + 4, mm, 0, 0);
  return Date.now() >= utc.getTime() - 5 * 60 * 1000;
}

export function getMatchStatus(matchDate, matchTime) {
  const [hh, mm] = matchTime.split(':').map(Number);
  const utc = new Date(`${matchDate}T00:00:00Z`);
  utc.setUTCHours(hh + 4, mm, 0, 0);
  const kickoff = utc.getTime();
  const lock = kickoff - 5 * 60 * 1000;
  const now = Date.now();
  if (now < lock) return 'open';
  if (now < kickoff) return 'locked';
  return 'started';
}
