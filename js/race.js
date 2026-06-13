/**
 * Apex Timing - Race & Timing Engine
 * Manages practice/race sessions, timestamps crossings, tracks statistics,
 * and maintains the sorted leaderboard state.
 */

import { getDrivers, getCars, saveSession } from './database.js';
import { speak } from './speech.js';

let sessionState = {
  mode: 'practice',          // 'practice', 'qualifying', 'race'
  status: 'ready',           // 'ready', 'warmup', 'active', 'finished'
  startTime: null,           // Browser performance.now()
  endTime: null,
  limitType: 'time',         // 'time', 'laps'
  limitValue: 5,             // 5 minutes or 50 laps
  minLapTime: 3.0,           // Filter out double triggers
  lapsLogged: 0,
  racers: {}                 // Map of TransponderID -> RacerSessionState
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
    mode: config.mode || 'practice',
    status: 'ready',
    startTime: null,
    endTime: null,
    limitType: config.limitType || 'time',
    limitValue: parseFloat(config.limitValue) || 5,
    minLapTime: parseFloat(config.minLapTime) || 3.0,
    lapsLogged: 0,
    racers: {}
  };

  leaderboard = [];
  overallBestLap = Infinity;
  updateCallback = onUpdate;
  timerCallback = onTimerUpdate;

  // Pre-load all registered profiles
  const cars = getCars();
  const drivers = getDrivers();
  cars.forEach(c => {
    const driver = drivers.find(d => d.id === c.driverId) || { name: 'Unknown Driver' };
    const sessionKey = `${c.driverId}_${c.transponder.toUpperCase()}`;
    sessionState.racers[sessionKey] = createRacerSessionData({
      driverName: driver.name,
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
    totalTime: 0,     // Total active running time
    gap: '',
    isActive: false
  };
}

/**
 * Start the active session timer and countdown.
 */
export function startSession() {
  if (sessionState.status === 'active') return;
  
  sessionState.status = 'active';
  sessionState.startTime = performance.now();
  
  speak(`${sessionState.mode} session started. Good luck!`, true);
  
  startSessionTimer();
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
  
  speak("Checkered flag! Session finished.", true);
  
  // Save results to history database
  const results = {
    date: new Date().toISOString(),
    mode: sessionState.mode,
    leaderboard: leaderboard.map(r => ({
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
  sessionState.lapsLogged = 0;
  overallBestLap = Infinity;
  
  // Clear lap lists for all racers
  Object.keys(sessionState.racers).forEach(id => {
    const r = sessionState.racers[id];
    r.laps = [];
    r.lastCrossingTicks = null;
    r.lastCrossingTime = null;
    r.bestLap = Infinity;
    r.averageLap = 0;
    r.consistency = 100;
    r.totalTime = 0;
    r.gap = '';
    r.isActive = false;
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

  // If session is practice and not explicitly started, start automatically on first crossing
  if (sessionState.mode === 'practice' && sessionState.status === 'ready') {
    startSession();
  }

  // If session hasn't started yet (e.g. waiting for race lights), ignore crossing
  if (sessionState.status === 'ready') return;

  const cars = getCars();
  const drivers = getDrivers();
  const car = cars.find(c => c.transponder.toUpperCase() === id) || { name: 'Unknown Car', color: '#ef4444', driverId: 'unknown' };
  const driver = drivers.find(d => d.id === car.driverId) || { name: 'Unknown Driver' };
  
  const sessionKey = `${car.driverId}_${id}`;

  // Retrieve or create racer profile (in case of unregistered transponder)
  let racer = sessionState.racers[sessionKey];
  if (!racer) {
    racer = createRacerSessionData({
      driverName: driver.name,
      carName: car.name,
      transponder: id,
      color: car.color
    });
    sessionState.racers[sessionKey] = racer;
    
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
  // Robitronic ticks are in 0.25ms units.
  // Handle 24-bit timer rollover (if ticks overflowed, calculate correct delta)
  let tickDelta = ticks - racer.lastCrossingTicks;
  if (tickDelta < 0) {
    // 24-bit integer rollover (16,777,216 ticks)
    tickDelta += 16777216;
  }

  const lapTimeSeconds = (tickDelta * 0.25) / 1000.0;

  // Double trigger filter: reject if faster than minimum lap time threshold
  if (lapTimeSeconds < sessionState.minLapTime) {
    console.log(`[Filter] Rejected double trigger for ID ${id}: ${lapTimeSeconds}s`);
    return;
  }

  // Update crossing references
  racer.lastCrossingTicks = ticks;
  racer.lastCrossingTime = now;

  // Record the lap
  const lapNumber = racer.laps.length + 1;
  const isPersonalBest = lapTimeSeconds < racer.bestLap;
  let isOverallBest = false;

  if (isPersonalBest) {
    racer.bestLap = lapTimeSeconds;
  }

  if (lapTimeSeconds < overallBestLap) {
    overallBestLap = lapTimeSeconds;
    isOverallBest = true;
  }

  const lapObject = {
    lapNum: lapNumber,
    lapTime: lapTimeSeconds,
    crossingTime: now - sessionState.startTime,
    isPersonalBest,
    isOverallBest
  };

  racer.laps.push(lapObject);
  sessionState.lapsLogged++;

  // Recalculate Racer Statistics
  recalculateRacerStats(racer);

  // Announce the lap
  announceLap(racer, lapObject);

  // Check race finish condition (if limit type is Laps and racer completed target laps)
  if (sessionState.mode === 'race' && sessionState.limitType === 'laps') {
    if (racer.laps.length >= sessionState.limitValue) {
      stopSession();
    }
  }

  triggerUpdate();
}

/**
 * Re-evaluate racer average and consistency (standard deviation percentage).
 * @param {Object} racer 
 */
function recalculateRacerStats(racer) {
  const lapTimes = racer.laps.map(l => l.lapTime);
  const totalLaps = lapTimes.length;
  
  if (totalLaps === 0) return;

  // Average Lap
  const sum = lapTimes.reduce((a, b) => a + b, 0);
  racer.averageLap = sum / totalLaps;
  racer.totalTime = sum;

  // Consistency (standard deviation relative to average)
  if (totalLaps > 1) {
    const variance = lapTimes.reduce((acc, t) => acc + Math.pow(t - racer.averageLap, 2), 0) / totalLaps;
    const stdDev = Math.sqrt(variance);
    // Convert to consistency score (100% is perfect consistency)
    racer.consistency = Math.max(0, Math.min(100, Math.round(100 - (stdDev / racer.averageLap * 100))));
  } else {
    racer.consistency = 100;
  }
}

/**
 * Perform speech synthesis audio callouts.
 * @param {Object} racer 
 * @param {Object} lap 
 */
function announceLap(racer, lap) {
  const formattedTime = lap.lapTime.toFixed(2);
  let announcement = '';

  if (lap.isOverallBest) {
    announcement = `New overall fastest lap! ${racer.name}, ${formattedTime} seconds.`;
  } else if (lap.isPersonalBest) {
    announcement = `Personal best for ${racer.name}, ${formattedTime} seconds.`;
  } else {
    announcement = `${racer.name}, ${formattedTime}.`;
  }

  // Check 3-consecutive fast lap streak
  const totalLaps = racer.laps.length;
  if (totalLaps >= 3) {
    const last3 = racer.laps.slice(-3);
    const maxDiff = Math.max(...last3.map(l => l.lapTime)) - Math.min(...last3.map(l => l.lapTime));
    // If the difference between fastest and slowest of the last 3 laps is < 0.1s
    if (maxDiff < 0.1 && lap.lapTime < racer.averageLap) {
      announcement += ` Consistent streak!`;
    }
  }

  speak(announcement);
}

/**
 * Re-sort and build the leaderboard array.
 */
function sortLeaderboard() {
  const racersList = Object.values(sessionState.racers).filter(r => r.isActive);

  // Sorting logic based on mode:
  // Qualifying/Practice: Sorted by fastest single lap.
  // Race: Sorted by total laps (descending), then by total race time (ascending).
  if (sessionState.mode === 'race') {
    racersList.sort((a, b) => {
      if (a.laps.length !== b.laps.length) {
        return b.laps.length - a.laps.length; // More laps is better
      }
      return a.totalTime - b.totalTime;       // Less time is better
    });
  } else {
    racersList.sort((a, b) => a.bestLap - b.bestLap); // Lowest lap time is better
  }

  // Compute Gaps
  if (racersList.length > 0) {
    const leader = racersList[0];
    leader.gap = 'Leader';
    
    for (let i = 1; i < racersList.length; i++) {
      const current = racersList[i];
      if (sessionState.mode === 'race') {
        const lapDiff = leader.laps.length - current.laps.length;
        if (lapDiff > 0) {
          current.gap = `+${lapDiff} Lap${lapDiff > 1 ? 's' : ''}`;
        } else {
          const timeDiff = current.totalTime - leader.totalTime;
          current.gap = `+${timeDiff.toFixed(2)}s`;
        }
      } else {
        if (current.bestLap === Infinity) {
          current.gap = '--';
        } else {
          const gapTime = current.bestLap - leader.bestLap;
          current.gap = `+${gapTime.toFixed(3)}s`;
        }
      }
    }
  }

  // Update best laps overlays (mark overall best)
  racersList.forEach(r => {
    r.laps.forEach(l => {
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

    // Time-based finish condition
    if (sessionState.limitType === 'time' && sessionState.mode !== 'practice') {
      const targetMs = sessionState.limitValue * 60 * 1000;
      
      // Countdown announcements at specific times
      const remainingSec = Math.floor((targetMs - elapsedMs) / 1000);
      if (remainingSec === 120 && elapsedMs % 1000 < 20) speak("2 minutes remaining.");
      if (remainingSec === 60 && elapsedMs % 1000 < 20) speak("1 minute remaining.");
      if (remainingSec === 30 && elapsedMs % 1000 < 20) speak("30 seconds remaining.");
      if (remainingSec === 10 && elapsedMs % 1000 < 20) speak("10... 9... 8... 7... 6... 5... 4... 3... 2... 1...");

      if (elapsedMs >= targetMs) {
        stopSession();
      }
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
export function assignUnregisteredRacer(transponderId, name, color, vehicle) {
  // Deprecated: reinitSessionState will handle the reload
}
