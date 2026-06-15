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
  
  if (totalLaps >= streakSettings.minLaps) {
    for (let i = 0; i < lapTimes.length; i++) {
      let minLap = lapTimes[i];
      let maxLap = lapTimes[i];
      let currentStreak = 1;
      let qualifies = true;
      
      for (let j = i + 1; j < lapTimes.length; j++) {
        minLap = Math.min(minLap, lapTimes[j]);
        maxLap = Math.max(maxLap, lapTimes[j]);
        if (maxLap - minLap <= minLap * varianceRatio) {
          currentStreak++;
        } else {
          break;
        }
      }
      
      if (currentStreak >= streakSettings.minLaps) {
        if (streakSettings.mustBeFast) {
          let streakSum = 0;
          for (let k = i; k < i + currentStreak; k++) {
            streakSum += lapTimes[k];
          }
          let streakAvg = streakSum / currentStreak;
          if (streakAvg > bestLap * 1.1) {
            qualifies = false;
          }
        }
        
        if (qualifies && currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      }
    }
  }

  return {
    averageLap,
    medianLap,
    stdDev,
    consistency,
    longestStreak: maxStreak,
    totalTime,
    bestLap
  };
}
