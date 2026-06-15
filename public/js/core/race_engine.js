/**
 * RaceEngine.js
 * The core business logic for lap timing and session state management.
 * 100% decoupled from the UI and Database.
 */

import { bus } from './event_bus.js';
import { sessionStore } from './session_store.js';
import { calculateRacerStats } from './stat_calculator.js';

export class RaceEngine {
  constructor() {
    this.timerInterval = null;
    this.overallBestLap = Infinity;
  }

  /**
   * Initializes a session with specific configurations.
   */
  initSession(config) {
    this.stopTimer();

    sessionStore.reset();
    sessionStore.setState({
      mode: 'practice',
      status: 'ready',
      limitType: config.limitType || 'time',
      limitValue: parseFloat(config.limitValue) || 5,
      minLapTime: parseFloat(config.minLapTime) || 3.0,
      maxLapTime: parseFloat(config.maxLapTime) || 25.0
    });

    this.overallBestLap = Infinity;
    bus.emit('sessionStatusChanged', sessionStore.getState());
  }

  /**
   * Pre-load racers into the session state
   */
  registerCars(cars) {
    const state = sessionStore.getState();
    cars.forEach(car => {
      state.racers[car.transponder.toUpperCase()] = sessionStore.createRacerSessionData({
        carName: car.name,
        transponder: car.transponder.toUpperCase(),
        color: car.color
      });
    });
    bus.emit('leaderboardUpdated', state);
  }

  /**
   * Start the session and the active clock timer.
   */
  startSession() {
    const state = sessionStore.getState();
    
    // If it's ready, we need to set the start time
    if (state.status === 'ready') {
      state.startTime = performance.now();
      state.status = 'active';
      bus.emit('sessionStarted', state);
    } else if (state.status === 'paused') {
      // Resume from pause: adjust start time by elapsed time
      state.startTime = performance.now() - state.elapsedTime;
      state.status = 'active';
      bus.emit('sessionResumed', state);
    } else {
      return; // Already active or finished
    }

    bus.emit('sessionStatusChanged', state);
    this.startTimer();
  }

  /**
   * Pause the session (e.g. crash recovery or manual pause)
   */
  pauseSession() {
    const state = sessionStore.getState();
    if (state.status !== 'active') return;

    state.status = 'paused';
    state.elapsedTime = performance.now() - state.startTime;
    this.stopTimer();
    
    bus.emit('sessionPaused', state);
    bus.emit('sessionStatusChanged', state);
  }

  /**
   * Manually stop or finish the session
   */
  stopSession() {
    const state = sessionStore.getState();
    if (state.status === 'finished') return;

    state.status = 'finished';
    state.endTime = performance.now();
    this.stopTimer();

    bus.emit('sessionFinished', state);
    bus.emit('sessionStatusChanged', state);
  }

  /**
   * Internal timer loop. Emits timerTick every 50ms.
   */
  startTimer() {
    this.stopTimer();
    this.timerInterval = setInterval(() => {
      const state = sessionStore.getState();
      
      let elapsedMs = 0;
      if (state.status === 'active') {
        elapsedMs = performance.now() - state.startTime;
        state.elapsedTime = elapsedMs;
      } else if (state.status === 'paused') {
        elapsedMs = state.elapsedTime;
      }

      bus.emit('timerTick', elapsedMs);

      // Check Limits (Time based)
      if (state.status === 'active' && state.limitType === 'time' && state.limitValue > 0) {
        if (elapsedMs >= state.limitValue * 60000) {
          this.stopSession();
        }
      }
    }, 50);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Primary entry point for hardware hits.
   * Processes a transponder crossing event.
   */
  processCrossing(transponderId, ticks, timestampOverride = null) {
    const state = sessionStore.getState();
    
    if (state.status === 'finished') return;

    const id = transponderId.toUpperCase();
    const now = timestampOverride || performance.now();

    // Auto-start on first hit
    if (state.status === 'ready') {
      this.startSession();
    }

    if (state.status !== 'active') return;

    let racer = sessionStore.getRacer(id);
    
    // Unregistered transponder alert
    if (!racer) {
      bus.emit('unregisteredTransponder', id);
      racer = sessionStore.createRacerSessionData({
        transponder: id
      });
      state.racers[id] = racer;
    }

    racer.isActive = true;
    const assignedDriverId = state.assignments[id] || null;

    // Out Lap (First Hit)
    if (racer.lastCrossingTicks === null) {
      racer.lastCrossingTicks = ticks;
      racer.lastCrossingTime = now;
      bus.emit('racerOnTrack', racer);
      bus.emit('leaderboardUpdated', state);
      return;
    }

    // Calculate Lap Time
    let tickDelta = ticks - racer.lastCrossingTicks;
    if (tickDelta < 0) {
      tickDelta += 16777216; // 24-bit rollover
    }

    const lapTimeSeconds = (tickDelta * 1.0) / 1000.0;

    // Fast lap filter (double triggers)
    if (lapTimeSeconds < state.minLapTime) {
      bus.emit('lapRejected', { reason: 'too_fast', transponder: id, time: lapTimeSeconds });
      return;
    }

    racer.lastCrossingTicks = ticks;
    racer.lastCrossingTime = now;

    // Slow lap filter (flipped / pitted)
    if (state.maxLapTime > 0 && lapTimeSeconds > state.maxLapTime) {
      bus.emit('lapRejected', { reason: 'too_slow', transponder: id, time: lapTimeSeconds });
      return;
    }

    // Valid Lap Recorded
    const isDriverSessionBest = lapTimeSeconds < racer.bestLap;
    let isOverallBest = false;

    if (isDriverSessionBest) {
      racer.bestLap = lapTimeSeconds;
    }

    if (lapTimeSeconds < this.overallBestLap) {
      this.overallBestLap = lapTimeSeconds;
      isOverallBest = true;
    }

    // Create memory object
    const lapInfo = {
      id: crypto.randomUUID(),
      sessionId: state.id,
      driverId: assignedDriverId,
      carId: id, // Transponder as fallback car ID
      timestamp: Date.now(), // Real clock time for DB
      lapTime: lapTimeSeconds,
      lapNumber: racer.laps.length + 1,
      isDriverSessionBest,
      isOverallBest
    };

    racer.laps.push(lapInfo);
    state.lapsLogged++;

    // Recompute Stats
    const driverLaps = racer.laps.filter(l => l.driverId === assignedDriverId);
    const lapTimes = driverLaps.map(l => l.lapTime);
    
    // We emit an event to request streak settings from the app layer, or default them
    // Assuming defaults for now, but UI layer can pass them into engine.
    const stats = calculateRacerStats(lapTimes);
    
    racer.averageLap = stats.averageLap;
    racer.consistency = stats.consistency;
    racer.longestStreak = stats.longestStreak;
    racer.totalTime = stats.totalTime;

    // Check lap limit
    if (state.limitType === 'laps' && state.limitValue > 0) {
      if (racer.laps.length >= state.limitValue) {
        this.stopSession();
      }
    }

    // Fire events for UI and DB layer
    bus.emit('lapRecorded', { racer, lap: lapInfo });
    bus.emit('leaderboardUpdated', state);
  }
}

export const raceEngine = new RaceEngine();
