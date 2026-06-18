/**
 * Lappr - UI Adapter for Core Engine
 * Bridges the pure JS core engine (race_engine.js) with the UI and Database.
 */

import { raceEngine } from '../core/race_engine.js';
import { sessionStore } from '../core/session_store.js';
import { bus } from '../core/event_bus.js';
import { getDrivers, getCars, saveCar, saveLap, saveSession, getLapsBySessionId, memCache, getLapsByCarId, getLapsByDriverId } from '../storage/idb_service.js';
import { getSettings } from '../storage/settings.js';
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
  saveSession(state);
});

bus.on('timerTick', (data) => {
  if (timerCallback) timerCallback(data);
});

bus.on('sessionStarted', (state) => {
  if (updateCallback) updateCallback({ state, leaderboard: generateLeaderboard(state) });
  speak(`${state.mode || 'practice'} session started. Good luck!`, true);
  saveSession(state);
});

bus.on('sessionPaused', (state) => {
  if (updateCallback) updateCallback({ state, leaderboard: generateLeaderboard(state) });
  speak('Session paused.', true);
  saveSession(state);
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

bus.on('lapRecorded', async ({ racer, lap }) => {
  const driver = getDrivers().find(d => d.name === racer.name);
  const driverId = driver ? driver.id : null;
  const carId = lap.carId;

  // 1. Determine All-Time PRs before saving this lap (so we compare to past laps)
  let isOverallCarBest = false;
  let isDriverOverallPR = false;
  let isDriverCarPR = false;

  const carLaps = await getLapsByCarId(carId);
  if (carLaps.length === 0 || lap.lapTime < Math.min(...carLaps.map(l => l.lapTime))) {
    isOverallCarBest = true;
  }

  if (driverId) {
    const driverLaps = await getLapsByDriverId(driverId);
    if (driverLaps.length === 0 || lap.lapTime < Math.min(...driverLaps.map(l => l.lapTime))) {
      isDriverOverallPR = true;
    }
    const driverCarLaps = driverLaps.filter(l => l.carId === carId);
    if (driverCarLaps.length === 0 || lap.lapTime < Math.min(...driverCarLaps.map(l => l.lapTime))) {
      isDriverCarPR = true;
    }
  }

  // 2. Select the highest priority announcement template
  const settings = getSettings();
  const tpl = settings.announcements;
  let templateStr = tpl.normalLap;

  if (isDriverOverallPR) templateStr = tpl.driverOverallPR;
  else if (isDriverCarPR) templateStr = tpl.driverCarPR;
  else if (isOverallCarBest) templateStr = tpl.overallCarBest;
  else if (lap.isOverallBest) templateStr = tpl.overallSessionBest;
  else if (lap.isDriverSessionBest) templateStr = tpl.driverSessionBest;
  else if (racer.currentStreak >= settings.streak.minLaps) templateStr = tpl.consistentStreak;

  // 3. Format strings
  const announcement = templateStr
    .replace('{driver}', racer.name)
    .replace('{car}', racer.carName)
    .replace('{time}', lap.lapTime.toFixed(1))
    .replace('{streak}', racer.currentStreak || 0);

  speak(announcement);

  saveLap({
    id: lap.id,
    driverId,
    carId: lap.carId,
    sessionId: sessionStore.getState().id,
    lapTime: lap.lapTime,
    timestamp: lap.timestamp
  });
});

bus.on('lapRejected', ({ reason, transponder, time }) => {
  console.warn(`[Lap Rejected] ${transponder} due to ${reason} (${time})`);
});

bus.on('unregisteredTransponder', async (data) => {
  let transponder;
  let generatedCarId = null;
  if (typeof data === 'object' && data !== null) {
    transponder = data.transponder || data.id;
    generatedCarId = data.carId;
  } else {
    transponder = data;
  }
  if (!transponder) return;
  
  const cars = getCars();
  const knownCar = cars.find(c => c.transponder === transponder);
  
  if (knownCar) {
    // Known car but wasn't explicitly started with the session
    raceEngine.registerCars([knownCar]);
    const state = sessionStore.getState();
    if (state.racers[transponder]) {
      state.racers[transponder].carName = knownCar.name;
      bus.emit('leaderboardUpdated', state);
    }
  } else {
    // Truly unregistered, auto-create a new car record
    const newCar = {
      id: generatedCarId || crypto.randomUUID(),
      transponder: transponder,
      name: `Car ${transponder}`,
      color: '#ffffff'
    };
    
    // Save to DB and cache
    await saveCar(newCar);
    
    // Notify UI that a new car was added to the database
    bus.emit('carCreated', newCar);
    
    // Register it
    raceEngine.registerCars([newCar]);

    const state = sessionStore.getState();
    if (state.racers[transponder]) {
      state.racers[transponder].carName = newCar.name;
      bus.emit('leaderboardUpdated', state);
    }
  }
});

// ==========================================
// Exported Adapter Methods for app.js
// ==========================================

export function initSession(config, onUpdate, onTimerUpdate) {
  updateCallback = onUpdate;
  timerCallback = onTimerUpdate;

  raceEngine.initSession(config);

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

export async function recoverSessionState() {
  // Try to load from IndexedDB
  const activeSessions = memCache.activeSessions;
  if (activeSessions && activeSessions.length > 0) {
    const sessionToRecover = activeSessions[0];
    sessionStore.recover(sessionToRecover);

    // Pull laps and reconstitute live memory state
    const laps = await getLapsBySessionId(sessionToRecover.id);
    laps.sort((a, b) => a.timestamp - b.timestamp);
    raceEngine.reconstituteLaps(laps, getCars());

    // Re-apply driver names to racers based on assignments
    const drivers = memCache.drivers || [];
    for (const [transponder, driverId] of Object.entries(sessionToRecover.assignments || {})) {
      if (driverId) {
        const driver = drivers.find(d => d.id === driverId);
        if (driver) {
          raceEngine.assignSessionDriver(transponder, driver.name, driver.id);
        }
      }
    }

    if (updateCallback) {
      updateCallback({ state: sessionStore.getState(), leaderboard: generateLeaderboard(sessionStore.getState()) });
    }
    return sessionToRecover;
  }
  return null;
}

// Unregistered transponder alert logic is now handled in bus listener

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
  const state = sessionStore.getState();
  const activeTransponders = Object.keys(state.racers);
  
  const activeCars = getCars().filter(c => activeTransponders.includes(c.transponder));
  raceEngine.registerCars(activeCars);

  const drivers = getDrivers();
  let updated = false;
  for (const transponder of activeTransponders) {
    const racer = state.racers[transponder];
    if (racer.driverId) {
      const driver = drivers.find(d => d.id === racer.driverId);
      if (driver && driver.name !== racer.name) {
        racer.name = driver.name;
        updated = true;
      }
    }
  }
  
  if (updated) {
    bus.emit('leaderboardUpdated', state);
  }
}

export async function assignSessionDriver(transponder, driverId) {
  const drivers = getDrivers();
  const driver = drivers.find((d) => d.id === driverId);
  const driverName = driver ? driver.name : 'Unknown Driver';
  
  // Update memory
  raceEngine.assignSessionDriver(transponder, driverName, driverId);

  // Update DB for retroactively assigned laps
  const state = sessionStore.getState();
  const id = transponder.toUpperCase();
  if (state.racers[id]) {
    const racer = state.racers[id];
    for (const lap of racer.laps) {
      await saveLap(lap);
    }
  }
}

export function removeCarFromSession(transponder) {
  raceEngine.removeCarFromSession(transponder);
}
