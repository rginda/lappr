import { describe, it, expect, beforeEach, vi } from 'vitest';
import { raceEngine } from '../public/js/core/race_engine.js';
import { sessionStore } from '../public/js/core/session_store.js';
import { bus } from '../public/js/core/event_bus.js';

describe('RaceEngine', () => {
  beforeEach(() => {
    // Reset state before each test
    sessionStore.reset();
    raceEngine.stopTimer();
    raceEngine.overallBestLap = Infinity;
    
    // Clear all bus listeners to prevent test bleed
    bus.listeners = {};
  });

  it('should initialize a session correctly', () => {
    raceEngine.initSession({
      limitType: 'laps',
      limitValue: 50,
      minLapTime: 5.0,
      maxLapTime: 30.0
    });

    const state = sessionStore.getState();
    expect(state.status).toBe('ready');
    expect(state.limitType).toBe('laps');
    expect(state.limitValue).toBe(50);
    expect(state.minLapTime).toBe(5.0);
    expect(state.maxLapTime).toBe(30.0);
  });

  it('should register cars and initialize racers', () => {
    raceEngine.registerCars([
      { transponder: 'ABC', name: 'Car 1', color: '#f00' }
    ]);

    const state = sessionStore.getState();
    expect(state.racers['ABC']).toBeDefined();
    expect(state.racers['ABC'].carName).toBe('Car 1');
  });

  it('should process a crossing and start session automatically', () => {
    const emitSpy = vi.fn();
    bus.on('sessionStarted', emitSpy);
    bus.on('racerOnTrack', emitSpy);

    // Initial state is 'ready'
    raceEngine.initSession({ minLapTime: 2.0, maxLapTime: 20.0 });
    
    // First crossing (out lap)
    raceEngine.processCrossing('XYZ', 1000, 1000000);

    const state = sessionStore.getState();
    expect(state.status).toBe('active');
    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' })); // sessionStarted
    
    const racer = sessionStore.getRacer('XYZ');
    expect(racer).toBeDefined();
    expect(racer.lastCrossingTicks).toBe(1000);
    expect(racer.laps.length).toBe(0); // Out lap doesn't count as a complete lap
  });

  it('should reject laps that are too fast', () => {
    const rejectSpy = vi.fn();
    bus.on('lapRejected', rejectSpy);

    raceEngine.initSession({ minLapTime: 5.0 });
    raceEngine.startSession();

    // Out lap
    raceEngine.processCrossing('XYZ', 1000, 1000000);

    // 2nd crossing, only 1000 ticks (1.0s) later. minLapTime is 5.0s.
    raceEngine.processCrossing('XYZ', 2000, 1001000);

    const racer = sessionStore.getRacer('XYZ');
    expect(racer.laps.length).toBe(0);
    expect(rejectSpy).toHaveBeenCalledWith({ reason: 'too_fast', transponder: 'XYZ', time: 1.0 });
  });

  it('should record a valid lap and calculate lap time', () => {
    const lapRecordedSpy = vi.fn();
    bus.on('lapRecorded', lapRecordedSpy);

    raceEngine.initSession({ minLapTime: 2.0 });
    raceEngine.startSession();

    // Out lap
    raceEngine.processCrossing('XYZ', 1000);

    // Valid lap: 10,000 ticks = 10.0 seconds
    raceEngine.processCrossing('XYZ', 11000);

    const racer = sessionStore.getRacer('XYZ');
    expect(racer.laps.length).toBe(1);
    expect(racer.laps[0].lapTime).toBe(10.0);
    expect(lapRecordedSpy).toHaveBeenCalled();
  });

  it('should handle 24-bit tick rollover correctly', () => {
    raceEngine.initSession({ minLapTime: 2.0 });
    raceEngine.startSession();

    // Out lap just before rollover: 16,777,000
    raceEngine.processCrossing('XYZ', 16777000);

    // Next lap after rollover: 8000
    // tickDelta = 8000 - 16777000 = -16769000
    // after +16777216 = 8216 ticks = 8.216 seconds
    raceEngine.processCrossing('XYZ', 8000);

    const racer = sessionStore.getRacer('XYZ');
    expect(racer.laps.length).toBe(1);
    expect(racer.laps[0].lapTime).toBeCloseTo(8.216);
  });

  it('should handle pause and resume correctly', () => {
    raceEngine.initSession({});
    raceEngine.startSession();

    // Mock performance.now for deterministic testing?
    // We can just verify state transitions for now.
    raceEngine.pauseSession();
    expect(sessionStore.getState().status).toBe('paused');

    raceEngine.startSession();
    expect(sessionStore.getState().status).toBe('active');
  });

  it('should stop session when limit is reached', () => {
    const stopSpy = vi.spyOn(raceEngine, 'stopSession');
    
    raceEngine.initSession({ limitType: 'laps', limitValue: 2, minLapTime: 1.0 });
    raceEngine.startSession();

    // Out lap
    raceEngine.processCrossing('LMT', 1000);
    // Lap 1
    raceEngine.processCrossing('LMT', 3000);
    // Lap 2 (Should trigger stop)
    raceEngine.processCrossing('LMT', 5000);

    expect(stopSpy).toHaveBeenCalled();
    expect(sessionStore.getState().status).toBe('finished');
  });

  it('should ignore crossings when session is finished', () => {
    raceEngine.initSession({});
    raceEngine.startSession();
    raceEngine.stopSession();

    raceEngine.processCrossing('XYZ', 1000);
    const racer = sessionStore.getRacer('XYZ');
    expect(racer).toBeUndefined(); // Should not register racer
  });
});
