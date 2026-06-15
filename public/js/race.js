/**
 * Apex Timing - UI Adapter for Core Engine
 * Bridges the pure JS core engine (race_engine.js) with the UI and Database.
 */

import { raceEngine } from './core/race_engine.js';
import { sessionStore } from './core/session_store.js';
import { bus } from './core/event_bus.js';
import { getDrivers, getCars, saveCar, saveLap, saveSession, memCache } from './db/idb_service.js';
import { getSettings } from './database.js';
import { speak } from './speech.js';

let updateCallback = null;
let timerCallback = null;

// ==========================================
// Leaderboard Generation
// ==========================================
function generateLeaderboard(state) {
  const racers = Object.values(state.racers);
  racers.sort((a, b) => {
    if (a.laps.length !== b.laps.length) return b.laps.length - a.laps.length;
    return a.totalTime - b.totalTime;
  });

  if (racers.length > 0 && racers[0].laps.length > 0) {
    const leader = racers[0];
    leader.gap = 'Leader';
    for (let i = 1; i < racers.length; i++) {
      const racer = racers[i];
      if (racer.laps.length === 0) {
        racer.gap = '';
        continue;
      }
      const lapDiff = leader.laps.length - racer.laps.length;
      if (lapDiff > 0) {
        racer.gap = `-${lapDiff} Laps`;
      } else {
        racer.gap = `+${(racer.totalTime - leader.totalTime).toFixed(1)}s`;
      }
    }
  }
  return racers;
}

// ==========================================
// Bridge Bus Events to UI & Speech
// ==========================================

bus.on('leaderboardUpdated', (state) => {
  if (updateCallback) updateCallback({ state, leaderboard: generateLeaderboard(state) });
});

bus.on('timerUpdated', (data) => {
  if (timerCallback) timerCallback(data);
});

bus.on('sessionStarted', (state) => {
  if (updateCallback) updateCallback({ state, leaderboard: generateLeaderboard(state) });
  speak(`${state.mode || 'practice'} session started. Good luck!`, true);
});

bus.on('sessionPaused', (state) => {
  if (updateCallback) updateCallback({ state, leaderboard: generateLeaderboard(state) });
  speak('Session paused.', true);
});

bus.on('sessionFinished', (state) => {
  if (updateCallback) updateCallback({ state, leaderboard: generateLeaderboard(state) });
  speak('Checkered flag! Session finished.', true);
  saveSession(state);
});

bus.on('sessionCleared', () => {
  const state = sessionStore.getState();
  if (updateCallback) updateCallback({ state, leaderboard: generateLeaderboard(state) });
  speak('Session cleared.');
});

bus.on('racerOnTrack', (data) => {
  speak(`${data.name} is on track.`);
});

bus.on('lapRecorded', ({ racer, lap, isPR, isBestInSession }) => {
  // Speech Logic
  let announcement = `${racer.name}, ${lap.lapTime.toFixed(1)}`;
  if (isPR) {
    announcement = `Personal Record! ${announcement}`;
  } else if (isBestInSession) {
    announcement = `Fastest Lap! ${announcement}`;
  }
  speak(announcement);

  // Determine driver id
  const driver = getDrivers().find(d => d.name === racer.name);
  const driverId = driver ? driver.id : null;

  saveLap({
    id: lap.id,
    driverId,
    carId: lap.carId, // Assuming lap has carId from somewhere
    sessionId: sessionStore.getState().id,
    lapTime: lap.lapTime,
    timestamp: lap.timestamp
  });
});

bus.on('lapRejected', ({ reason, transponder, time }) => {
  console.warn(`[Lap Rejected] ${transponder} due to ${reason} (${time})`);
});

// ==========================================
// Exported Adapter Methods for app.js
// ==========================================

export function initSession(config, onUpdate, onTimerUpdate) {
  updateCallback = onUpdate;
  timerCallback = onTimerUpdate;

  raceEngine.initSession(config);

  // Register all known cars to engine
  const cars = getCars();
  raceEngine.registerCars(cars);

  if (updateCallback) {
    updateCallback({ state: sessionStore.getState(), leaderboard: [] });
  }
}

export function startSession() {
  raceEngine.startSession();
}

export function stopSession() {
  raceEngine.stopSession();
}

export function pauseSession() {
  raceEngine.pauseSession();
}

export function clearSession() {
  raceEngine.clearSession();
}

export function processCrossing(transponder, ticks) {
  raceEngine.processCrossing(transponder, ticks);
}

export function backupSessionState() {
  return sessionStore.getState();
}

export function recoverSessionState() {
  // Try to load from IndexedDB
  const activeSessions = memCache.activeSessions;
  if (activeSessions && activeSessions.length > 0) {
    const sessionToRecover = activeSessions[0];
    sessionStore.recover(sessionToRecover);
    if (updateCallback) {
      updateCallback({ state: sessionStore.getState(), leaderboard: sessionToRecover.leaderboard || [] });
    }
    return sessionToRecover;
  }
  return null;
}

// Unregistered transponder logic from original race.js
let unregisteredQueue = [];
export function onUnregisteredAlert(transponder, ticks) {
  if (unregisteredQueue.some(u => u.transponder === transponder)) return;
  unregisteredQueue.push({ transponder, timestamp: Date.now() });

  // Let UI handle alert
  const event = new CustomEvent('unregistered_transponder', { detail: { transponder } });
  document.dispatchEvent(event);
  speak(`Unregistered transponder detected. Check alert dialog.`);
}

export function assignUnregisteredRacer(transponder, driverId, carId) {
  const driver = getDrivers().find(d => d.id === driverId);
  const cars = getCars();
  let car = cars.find(c => c.id === carId);

  if (!car) {
    // Creating new ad-hoc car
    car = {
      id: 'car_' + Date.now(),
      transponder: transponder,
      name: `Car ${transponder}`,
      color: '#ffffff'
    };
    saveCar(car); // Async write, sync cache update
  } else {
    // Update existing car with transponder
    car.transponder = transponder;
    saveCar(car);
  }

  raceEngine.registerCars([car]);
  // We can assign driver info in the future via a mapping,
  // For now, RaceEngine just uses car details unless we update it
}

export function refreshActiveRacers() {
  // Re-register cars in case settings changed
  raceEngine.registerCars(getCars());
}
