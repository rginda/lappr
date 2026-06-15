import { describe, it, expect } from 'vitest';
import { calculateRacerStats } from '../public/js/core/stat_calculator.js';

describe('StatCalculator', () => {
  it('should return default stats when given empty lap array', () => {
    const stats = calculateRacerStats([]);
    expect(stats.averageLap).toBe(0);
    expect(stats.medianLap).toBe(0);
    expect(stats.consistency).toBe(100);
    expect(stats.longestStreak).toBe(0);
  });

  it('should calculate basic stats for a single lap', () => {
    const stats = calculateRacerStats([10.5]);
    expect(stats.averageLap).toBe(10.5);
    expect(stats.medianLap).toBe(10.5);
    expect(stats.consistency).toBe(100);
    expect(stats.totalTime).toBe(10.5);
    expect(stats.bestLap).toBe(10.5);
  });

  it('should calculate average, median, and best lap correctly for multiple laps', () => {
    const laps = [10.0, 11.0, 12.0];
    const stats = calculateRacerStats(laps);
    expect(stats.averageLap).toBe(11.0);
    expect(stats.medianLap).toBe(11.0);
    expect(stats.bestLap).toBe(10.0);
    expect(stats.totalTime).toBe(33.0);
  });

  it('should calculate median correctly for an even number of laps', () => {
    const laps = [10.0, 12.0, 14.0, 16.0]; // sorted: 10, 12, 14, 16
    const stats = calculateRacerStats(laps);
    expect(stats.medianLap).toBe(13.0);
  });

  it('should calculate consistency correctly', () => {
    // 10, 10, 10 should be 100%
    let stats = calculateRacerStats([10, 10, 10]);
    expect(stats.consistency).toBe(100);

    // Highly variable laps should drop consistency
    stats = calculateRacerStats([10, 20, 30]);
    // avg = 20
    // var = ((10-20)^2 + (20-20)^2 + (30-20)^2) / 3 = (100 + 0 + 100) / 3 = 66.66
    // stddev = 8.16
    // consist = 100 - (8.16 / 20) * 100 = 100 - 40.8 = ~59
    expect(stats.consistency).toBeLessThan(100);
    expect(stats.consistency).toBeGreaterThan(0);
  });

  it('should calculate longest streak correctly', () => {
    // A streak of 3 laps within 10% variance (default)
    const settings = { minLaps: 3, varianceThreshold: 10, mustBeFast: false };
    
    // 10, 10.5, 10.2 (max 10.5, min 10.0 -> diff 0.5 <= 10.0 * 0.1) -> Streak of 3
    const stats1 = calculateRacerStats([10.0, 10.5, 10.2, 15.0], settings);
    expect(stats1.longestStreak).toBe(3);

    // No streak >= 3
    const stats2 = calculateRacerStats([10.0, 15.0, 10.0, 15.0], settings);
    expect(stats2.longestStreak).toBe(0);
  });

  it('should ignore slow streaks if mustBeFast is true', () => {
    const settings = { minLaps: 3, varianceThreshold: 10, mustBeFast: true };
    // Best lap is 10.0
    // Streak at 15.0, 15.1, 15.2 -> Consistent, but too slow ( > 10.0 * 1.1 )
    const stats = calculateRacerStats([10.0, 15.0, 15.1, 15.2], settings);
    expect(stats.longestStreak).toBe(0);
  });
});
