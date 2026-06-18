/**
 * StatCalculator.js
 * Pure functions for calculating racing statistics from lap data.
 */

export function calculateRacerStats(lapTimes, streakSettings = { minLaps: 3, varianceThreshold: 10, mustBeFast: true }) {
  const totalLaps = lapTimes.length;

  if (totalLaps === 0) {
    return {
      averageLap: 0,
      medianLap: 0,
      stdDev: 0,
      consistency: 100,
      longestStreak: 0,
      totalTime: 0,
      bestLap: Infinity
    };
  }

  // Average Lap
  const sum = lapTimes.reduce((a, b) => a + b, 0);
  const averageLap = sum / totalLaps;
  const totalTime = sum;

  // Best Lap
  const bestLap = Math.min(...lapTimes);

  // Median Lap
  const sorted = [...lapTimes].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const medianLap = sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;

  // Std Dev and Consistency
  let stdDev = 0;
  let consistency = 100;
  if (totalLaps > 1) {
    const variance = lapTimes.reduce((acc, t) => acc + Math.pow(t - averageLap, 2), 0) / totalLaps;
    stdDev = Math.sqrt(variance);
    // Convert to consistency score (100% is perfect consistency)
    consistency = Math.max(
      0,
      Math.min(100, Math.round(100 - (stdDev / averageLap) * 100))
    );
  }

  // Longest Streak Calculation
  const varianceRatio = streakSettings.varianceThreshold / 100;
  let maxStreak = 0;
  let currentActiveStreak = 0;

  if (totalLaps > 0) {
    let currentStreakLaps = [];

    for (let i = 0; i < lapTimes.length; i++) {
      const lap = lapTimes[i];

      if (currentStreakLaps.length === 0) {
        // To initiate a streak, they must start with a lap that is within variance% of their average lap time
        // Actually, we should also allow starting a streak if the lap is FASTER than the average lap time.
        // But the user said "within the variance% of their average lap time". Let's be strict:
        if (lap <= averageLap * (1 + varianceRatio)) {
          // If mustBeFast is true, ensure it's not absurdly slow compared to bestLap.
          // Since averageLap can be skewed, we can just let it start and check bestLap later, or just rely on averageLap.
          // The user specifically requested: "within the variance% of their average lap time".
          // We'll consider it starting if lap is <= averageLap * (1 + varianceRatio).
          if (!streakSettings.mustBeFast || lap <= bestLap * 1.1) {
            currentStreakLaps.push(lap);
          }
        }
      } else {
        // Once established, each additional lap must be no worse than variance% of the streak average
        const streakSum = currentStreakLaps.reduce((sum, val) => sum + val, 0);
        const streakAverage = streakSum / currentStreakLaps.length;

        if (lap <= streakAverage * (1 + varianceRatio)) {
          // It's a consistent lap (or faster!). Add to streak.
          currentStreakLaps.push(lap);
        } else {
          // Streak broken
          if (currentStreakLaps.length >= streakSettings.minLaps) {
            if (currentStreakLaps.length > maxStreak) {
              maxStreak = currentStreakLaps.length;
            }
          }
          currentStreakLaps = [];
          
          // Re-evaluate this breaking lap as the potential start of a NEW streak
          if (lap <= averageLap * (1 + varianceRatio)) {
            if (!streakSettings.mustBeFast || lap <= bestLap * 1.1) {
              currentStreakLaps.push(lap);
            }
          }
        }
      }
    }

    // Finalize the active streak at the end of the session
    if (currentStreakLaps.length >= streakSettings.minLaps) {
      currentActiveStreak = currentStreakLaps.length;
      if (currentActiveStreak > maxStreak) {
        maxStreak = currentActiveStreak;
      }
    }
  }

  return {
    averageLap,
    medianLap,
    stdDev,
    consistency,
    longestStreak: maxStreak,
    currentStreak: currentActiveStreak,
    totalTime,
    bestLap
  };
}
