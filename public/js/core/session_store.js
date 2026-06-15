/**
 * SessionStore.js
 * Holds and manages the pure data state of the active session.
 */

class SessionStore {
  constructor() {
    this.reset();
  }

  reset() {
    this.state = {
      id: crypto.randomUUID(), // Unique ID for this session instance
      mode: 'practice',
      status: 'ready', // 'ready', 'active', 'paused', 'finished'
      startTime: null,
      endTime: null,
      elapsedTime: 0,
      minLapTime: 3.0,
      maxLapTime: 25.0,
      lapsLogged: 0,
      assignments: {}, // transponder -> driverId
      racers: {} // Map of transponder -> RacerSessionState
    };
  }

  getState() {
    return this.state;
  }

  setState(newState) {
    this.state = { ...this.state, ...newState };
  }

  getRacers() {
    return this.state.racers;
  }

  getRacer(transponder) {
    return this.state.racers[transponder.toUpperCase()];
  }

  /**
   * Reconstitute session state from a crash recovery or historical load
   */
  recover(recoveredState) {
    this.state = { ...this.state, ...recoveredState };
    if (!this.state.racers) this.state.racers = {};
    if (!this.state.assignments) this.state.assignments = {};
  }

  /**
   * Helper to create the initial structure for a racer in a session
   */
  createRacerSessionData(profile) {
    return {
      driverId: profile.driverId || null,
      carId: profile.carId || crypto.randomUUID(),
      name: profile.driverName || 'Unknown Driver',
      carName: profile.carName || 'Unknown Car',
      transponder: profile.transponder.toUpperCase(),
      color: profile.color || '#ffffff',
      laps: [],
      lastCrossingTicks: null,
      lastCrossingTime: null,
      bestLap: Infinity,
      averageLap: 0,
      medianLap: 0,
      stdDev: 0,
      consistency: 100,
      longestStreak: 0,
      totalTime: 0,
      gap: '',
      isActive: false
    };
  }
}

export const sessionStore = new SessionStore();
