/**
 * Apex Timing - Race & Timing Engine
 * Manages practice/race sessions, timestamps crossings, tracks statistics,
 * and maintains the sorted leaderboard state.
 */

import {
  getDrivers,
  getCars,
  saveSession,
  logLap,
  assignHistoricalLaps,
  getSettings
} from './database.js';
import { speak } from './speech.js';

let sessionState = {
  mode: 'practice',
  status: 'ready', // 'ready', 'warmup', 'active', 'finished'
  startTime: null, // Browser performance.now()
  endTime: null,
  limitType: 'time', // 'time', 'laps'
  limitValue: 5, // 5 minutes or 50 laps
  minLapTime: 3.0, // Filter out double triggers
  lapsLogged: 0,
  assignments: {}, // Map of transponder -> driverId
  racers: {} // Map of transponder -> RacerSessionState
};

let leaderboard = [];
let updateCallback = null;
let timerInterval = null;
let timerCallback = null;
let overallBestLap = Infinity;

/**
 * Initialize a new session.
 * @param {Object} config - Config parameters.
 * @param {Function} onUpdate - Triggered when leaderboard changes.
 * @param {Function} onTimerUpdate - Triggered every 10ms for clock.
 */
export function initSession(config, onUpdate, onTimerUpdate) {
  stopSessionTimer();

  sessionState = {
    mode: 'practice',
    status: 'ready',
    startTime: null,
    endTime: null,
    elapsedTime: 0,
    limitType: config.limitType || 'time',
    limitValue: parseFloat(config.limitValue) || 5,
    minLapTime: parseFloat(config.minLapTime) || 3.0,
    maxLapTime: parseFloat(config.maxLapTime) || 25.0,
    lapsLogged: 0,
    assignments: {},
    racers: {}
  };

  leaderboard = [];
  overallBestLap = Infinity;
  updateCallback = onUpdate;
  timerCallback = onTimerUpdate;

  // Pre-load all registered profiles
  const cars = getCars();
  cars.forEach((c) => {
    // Initial assignments are empty (unassigned)
    sessionState.racers[c.transponder.toUpperCase()] = createRacerSessionData({
      driverName: 'Unknown Driver',
      carName: c.name,
      transponder: c.transponder.toUpperCase(),
      color: c.color
    });
  });

  triggerUpdate();
}

function createRacerSessionData(profile) {
  return {
    name: profile.driverName,
    carName: profile.carName,
    transponder: profile.transponder,
    color: profile.color,
    laps: [],
    lastCrossingTicks: null,
    lastCrossingTime: null,
    bestLap: Infinity,
    averageLap: 0,
    consistency: 100, // Percentage consistency
    totalTime: 0, // Total active running time
    gap: '',
    isActive: false
  };
}

/**
 * Start the active session timer and countdown.
 */
export function startSession() {
  if (sessionState.status === 'active') return;

  if (sessionState.status === 'paused') {
    sessionState.status = 'active';
    sessionState.startTime = performance.now() - (sessionState.elapsedTime || 0);
    speak('Session resumed.', true);
  } else {
    // Fresh start: clear laps
    clearSession();
    sessionState.status = 'active';
    sessionState.startTime = performance.now();
    sessionState.elapsedTime = 0;
    speak(`${sessionState.mode} session started. Good luck!`, true);
  }

  startSessionTimer();
  triggerUpdate();
}

/**
 * Pause the active session timer.
 */
export function pauseSession() {
  if (sessionState.status !== 'active') return;

  sessionState.status = 'paused';
  sessionState.elapsedTime = performance.now() - sessionState.startTime;
  stopSessionTimer();
  speak('Session paused.', true);
  triggerUpdate();
}

/**
 * Stop/Finish the current session.
 */
export function stopSession() {
  if (sessionState.status === 'finished') return;

  sessionState.status = 'finished';
  sessionState.endTime = performance.now();
  stopSessionTimer();

  speak('Checkered flag! Session finished.', true);

  // Save results to history database
  const results = {
    date: new Date().toISOString(),
    mode: sessionState.mode,
    leaderboard: leaderboard.map((r) => ({
      name: r.name,
      laps: r.laps.length,
      bestLap: r.bestLap,
      averageLap: r.averageLap,
      consistency: r.consistency
    }))
  };
  saveSession(results);

  triggerUpdate();
}

/**
 * Reset/Clear current laps.
 */
export function clearSession() {
  stopSessionTimer();

  sessionState.status = 'ready';
  sessionState.startTime = null;
  sessionState.endTime = null;
  sessionState.elapsedTime = 0;
  sessionState.lapsLogged = 0;
  overallBestLap = Infinity;

  // Clear lap lists for all racers
  Object.keys(sessionState.racers).forEach((id) => {
    const r = sessionState.racers[id];
    r.laps = [];
    r.lastCrossingTicks = null;
    r.lastCrossingTime = null;
    r.bestLap = Infinity;
    r.averageLap = 0;
    r.consistency = 100;
    r.totalTime = 0;
    r.gap = '';
    // Keeping r.isActive untouched to keep car assignments in the session
  });

  if (timerCallback) {
    timerCallback(0);
  }

  triggerUpdate();
}

/**
 * Primary hardware parser interface.
 * Process a crossing packet (transponder ID and hardware ticks).
 * @param {string} transponderId - Hex string.
 * @param {number} ticks - 24-bit integer timestamp in 0.25ms units.
 */
export function processCrossing(transponderId, ticks) {
  // If session is finished, ignore new laps
  if (sessionState.status === 'finished') return;

  const id = transponderId.toUpperCase();
  const now = performance.now();

  // Auto-start on first crossing
  if (sessionState.status === 'ready') {
    startSession();
  }

  // If session hasn't started yet (e.g. waiting for race lights), ignore crossing
  if (sessionState.status === 'ready') return;

  const cars = getCars();
  const drivers = getDrivers();
  const car = cars.find((c) => c.transponder.toUpperCase() === id) || {
    name: 'Unknown Car',
    color: '#ef4444'
  };

  const assignedDriverId = sessionState.assignments[id] || null;
  const driver = drivers.find((d) => d.id === assignedDriverId) || { name: 'Unknown Driver' };

  // Retrieve or create racer profile (in case of unregistered transponder)
  let racer = sessionState.racers[id];
  if (!racer) {
    racer = createRacerSessionData({
      driverName: driver.name,
      carName: car.name,
      transponder: id,
      color: car.color
    });
    sessionState.racers[id] = racer;

    // Fire unregistered notification callback
    if (car.name === 'Unknown Car') {
      triggerUnregisteredAlert(id);
    }
  }

  racer.isActive = true;

  // CASE 1: First crossing of the session (Lap 0 - Out Lap)
  if (racer.lastCrossingTicks === null) {
    racer.lastCrossingTicks = ticks;
    racer.lastCrossingTime = now;

    speak(`${racer.name} is on track.`);
    triggerUpdate();
    return;
  }

  // CASE 2: Subsequent crossing - Calculate lap time
  // Hardware ticks are 1.0ms units.
  // Handle timer rollover (assuming 24-bit timer, but hardware might be 32-bit. We use 24-bit handling as a guess)
  let tickDelta = ticks - racer.lastCrossingTicks;
  if (tickDelta < 0) {
    // 24-bit integer rollover (16,777,216 ticks)
    tickDelta += 16777216;
  }

  const lapTimeSeconds = (tickDelta * 1.0) / 1000.0;

  // Double trigger filter: reject if faster than minimum lap time threshold
  if (lapTimeSeconds < sessionState.minLapTime) {
    console.log(`[Filter] Rejected double trigger for ID ${id}: ${lapTimeSeconds}s`);
    return;
  }

  // Update crossing references for all valid single-triggers
  racer.lastCrossingTicks = ticks;
  racer.lastCrossingTime = now;

  // Max lap time filter: reject if slower than maximum threshold (e.g. flipped, pitted)
  if (sessionState.maxLapTime > 0 && lapTimeSeconds > sessionState.maxLapTime) {
    console.log(`[Filter] Rejected slow lap for ID ${id}: ${lapTimeSeconds}s`);
    return;
  }

  // Record the lap
  const lapNumber = racer.laps.length + 1;
  const isDriverSessionBest = lapTimeSeconds < racer.bestLap;
  let isOverallBest = false;

  if (isDriverSessionBest) {
    racer.bestLap = lapTimeSeconds;
  }

  if (lapTimeSeconds < overallBestLap) {
    overallBestLap = lapTimeSeconds;
    isOverallBest = true;
  }

  const lapInfo = {
    lapNumber,
    lapTime: lapTimeSeconds,
    gap: '',
    isDriverSessionBest,
    isOverallBest,
    timestamp: now,
    driverId: assignedDriverId
  };
  racer.laps.push(lapInfo);
  sessionState.lapsLogged++;

  // Log to database
  const dbResult = logLap(assignedDriverId, id, lapTimeSeconds);

  // Recalculate Racer Statistics
  recalculateRacerStats(racer);

  announceLap(racer, lapInfo, dbResult);

  triggerUpdate();
}

/**
 * Re-evaluate racer average and consistency (standard deviation percentage).
 * @param {Object} racer
 */
function recalculateRacerStats(racer) {
  const lapTimes = racer.laps.map((l) => l.lapTime);
  const totalLaps = lapTimes.length;

  if (totalLaps === 0) return;

  // Average Lap
  const sum = lapTimes.reduce((a, b) => a + b, 0);
  racer.averageLap = sum / totalLaps;
  racer.totalTime = sum;

  // Consistency (standard deviation relative to average)
  if (totalLaps > 1) {
    const variance =
      lapTimes.reduce((acc, t) => acc + Math.pow(t - racer.averageLap, 2), 0) / totalLaps;
    const stdDev = Math.sqrt(variance);
    // Convert to consistency score (100% is perfect consistency)
    racer.consistency = Math.max(
      0,
      Math.min(100, Math.round(100 - (stdDev / racer.averageLap) * 100))
    );
  } else {
    racer.consistency = 100;
  }
}

/**
 * Perform speech synthesis audio callouts.
 * @param {Object} racer
 * @param {Object} lap
 * @param {Object} dbResult
 */
function announceLap(racer, lap, dbResult) {
  const formattedTime = lap.lapTime.toFixed(2);
  let announcement = '';

  const isCarRecord = dbResult?.carResult?.isPR;
  const isDriverBestEver = dbResult?.driverResult?.isPR;
  const isDriverCarPR = dbResult?.driverResult?.isDriverCarPR;

  const settings = getSettings();
  const ann = settings.announcements || {};

  // Helper to replace tokens
  const formatMsg = (template, streakLen = 0) => {
    if (!template) return '';
    return template
      .replace(/{driver}/g, racer.name)
      .replace(/{car}/g, racer.carName)
      .replace(/{time}/g, formattedTime)
      .replace(/{streak}/g, streakLen);
  };

  if (isDriverBestEver) {
    announcement = formatMsg(ann.driverOverallPR);
  } else if (isCarRecord) {
    announcement = formatMsg(ann.overallCarBest);
  } else if (isDriverCarPR) {
    announcement = formatMsg(ann.driverCarPR);
  } else if (lap.isOverallBest) {
    announcement = formatMsg(ann.overallSessionBest);
  } else if (lap.isDriverSessionBest) {
    announcement = formatMsg(ann.driverSessionBest);
  } else {
    announcement = formatMsg(ann.normalLap);
  }

  // Calculate Ongoing Consistency Streak
  const streakSettings = settings.streak || {
    minLaps: 3,
    varianceThreshold: 10,
    mustBeFast: true
  };
  const totalLaps = racer.laps.length;

  if (totalLaps >= streakSettings.minLaps) {
    let streakLength = 1;
    let minLap = lap.lapTime;
    let maxLap = lap.lapTime;

    const allowedVariance = lap.lapTime * (streakSettings.varianceThreshold / 100);

    // Scan backward to find consecutive laps within the variance threshold
    for (let i = totalLaps - 2; i >= 0; i--) {
      const prevLap = racer.laps[i].lapTime;
      const newMin = Math.min(minLap, prevLap);
      const newMax = Math.max(maxLap, prevLap);

      if (newMax - newMin <= allowedVariance) {
        streakLength++;
        minLap = newMin;
        maxLap = newMax;
      } else {
        break;
      }
    }

    // Check if streak meets criteria
    if (streakLength >= streakSettings.minLaps) {
      let qualifies = true;
      if (streakSettings.mustBeFast && lap.lapTime >= racer.averageLap) {
        qualifies = false;
      }

      if (qualifies && ann.consistentStreak) {
        announcement += ` ${formatMsg(ann.consistentStreak, streakLength)}`;
      }
    }
  }

  // Speak the main announcement with global settings
  speak(announcement);
}

/**
 * Re-sort and build the leaderboard array.
 */
function sortLeaderboard() {
  const racersList = Object.values(sessionState.racers).filter((r) => r.isActive);

  // Sorted by fastest single lap
  racersList.sort((a, b) => a.bestLap - b.bestLap);

  // Compute Gaps
  if (racersList.length > 0) {
    const leader = racersList[0];
    leader.gap = 'Leader';

    for (let i = 1; i < racersList.length; i++) {
      const current = racersList[i];
      if (current.bestLap === Infinity) {
        current.gap = '--';
      } else {
        const gapTime = current.bestLap - leader.bestLap;
        current.gap = `+${gapTime.toFixed(3)}s`;
      }
    }
  }

  // Update best laps overlays (mark overall best)
  racersList.forEach((r) => {
    r.laps.forEach((l) => {
      l.isOverallBest = l.lapTime === overallBestLap;
    });
  });

  leaderboard = racersList;
}

function triggerUpdate() {
  sortLeaderboard();
  if (updateCallback) {
    updateCallback({
      state: sessionState,
      leaderboard
    });
  }
}

/**
 * Handle session timer loop.
 */
function startSessionTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (!sessionState.startTime || sessionState.status !== 'active') return;

    const elapsedMs = performance.now() - sessionState.startTime;

    if (timerCallback) {
      timerCallback(elapsedMs);
    }
  }, 50); // Fast enough updates for smooth clocks
}

function stopSessionTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

/**
 * Notification handler when an unregistered transponder crosses.
 */
let unregisteredAlertCallback = null;
export function onUnregisteredAlert(callback) {
  unregisteredAlertCallback = callback;
}

function triggerUnregisteredAlert(transponderId) {
  if (unregisteredAlertCallback) {
    unregisteredAlertCallback(transponderId);
  }
}

/**
 * Dynamically assign a transponder to a newly registered profile.
 */
export function assignUnregisteredRacer(_transponderId, _name, _color, _vehicle) {
  // Deprecated: reinitSessionState will handle the reload
}

/**
 * Removes a car from the active session leaderboard.
 */
export function removeCarFromSession(transponder) {
  const id = transponder.toUpperCase();
  if (sessionState.racers[id]) {
    sessionState.racers[id].isActive = false;
    assignSessionDriver(id, ''); // This clears assignment and calls triggerUpdate()
  }
}

/**
 * Assign a driver to a car for the current session.
 * Retroactively credits unassigned laps to the new driver.
 */
export function assignSessionDriver(transponder, driverId) {
  const drivers = getDrivers();
  const driver = drivers.find((d) => d.id === driverId);
  const id = transponder.toUpperCase();

  if (!driver) {
    // Unassign
    sessionState.assignments[id] = null;
    if (sessionState.racers[id]) {
      sessionState.racers[id].name = 'Unknown Driver';
    }
    triggerUpdate();
    return;
  }

  // If the driver is already assigned to another car, unassign them from that car
  for (const [tId, dId] of Object.entries(sessionState.assignments)) {
    if (dId === driverId && tId !== id) {
      sessionState.assignments[tId] = null;
      if (sessionState.racers[tId]) {
        sessionState.racers[tId].name = 'Unknown Driver';
      }
    }
  }

  sessionState.assignments[id] = driverId;

  if (sessionState.racers[id]) {
    const racer = sessionState.racers[id];
    racer.name = driver.name;

    // Retroactively credit laps that have NO driver assigned yet in memory
    racer.laps.forEach((lap) => {
      if (!lap.driverId) {
        lap.driverId = driverId;
      }
    });

    // Safely apply the batch edit to the database without duplicating laps
    assignHistoricalLaps(id, driverId, sessionState.startTime);
  }

  triggerUpdate();
}

/**
 * Re-sync the names and colors of active racers in the session
 * with the latest data from the database.
 */
export function refreshActiveRacers() {
  const drivers = getDrivers();
  const cars = getCars();

  for (const [id, racer] of Object.entries(sessionState.racers)) {
    const car = cars.find((c) => c.transponder === id);
    if (car) {
      racer.carName = car.name;
      racer.color = car.color;
    }

    const driverId = sessionState.assignments[id];
    if (driverId) {
      const driver = drivers.find((d) => d.id === driverId);
      if (driver) {
        racer.name = driver.name;
      }
    }
  }
  triggerUpdate();
}

/**
 * Backs up the current session assignments to localStorage.
 */
export function backupSessionState() {
  if (sessionState.status === 'active') {
    localStorage.setItem(
      'lappr-session-backup',
      JSON.stringify({
        timestamp: Date.now(),
        status: sessionState.status,
        assignments: sessionState.assignments,
        racers: sessionState.racers,
        lapsLogged: sessionState.lapsLogged,
        sessionElapsedTime:
          sessionState.status === 'active' ? performance.now() - sessionState.startTime : null
      })
    );
  } else {
    localStorage.removeItem('lappr-session-backup');
  }
}

/**
 * Recovers session assignments if less than a minute old.
 */
export function recoverSessionState() {
  try {
    const data = localStorage.getItem('lappr-session-backup');
    if (!data) return { recovered: false, wasRunning: false };

    const backup = JSON.parse(data);
    if (Date.now() - backup.timestamp > 60000 || backup.status !== 'active') {
      localStorage.removeItem('lappr-session-backup');
      return { recovered: false, wasRunning: false };
    }

    if (backup.assignments) {
      for (const [transponder, driverId] of Object.entries(backup.assignments)) {
        if (driverId) {
          assignSessionDriver(transponder, driverId);
        }
      }
    }

    if (backup.racers) {
      let restoredBestLap = Infinity;
      for (const r of Object.values(backup.racers)) {
        if (r.bestLap === null) {
          r.bestLap = Infinity;
        }
        if (r.bestLap < restoredBestLap) {
          restoredBestLap = r.bestLap;
        }
      }

      // I need to set the global overallBestLap. Since it's not exported, I can just assign it.
      // Wait! Is overallBestLap in scope? Yes, it's at the top of race.js.
      overallBestLap = restoredBestLap;

      sessionState.racers = backup.racers;
      sessionState.lapsLogged = backup.lapsLogged || 0;
      if (backup.sessionElapsedTime != null) {
        sessionState.startTime = performance.now() - backup.sessionElapsedTime;
      }
      sortLeaderboard();
      triggerUpdate();
    }

    return { recovered: true, wasRunning: backup.status === 'active' };
  } catch (err) {
    console.error('Recovery failed:', err);
    return { recovered: false, wasRunning: false };
  }
}
