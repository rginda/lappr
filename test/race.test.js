import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initSession, processCrossing, startSession } from '../public/js/race.js';
import * as db from '../public/js/database.js';

// Mock database functions
vi.mock('../public/js/database.js', () => ({
  getCars: vi.fn(),
  getDrivers: vi.fn(),
  getSettings: vi.fn(),
  saveSession: vi.fn(),
}));

// Mock speech functions
vi.mock('../public/js/speech.js', () => ({
  speak: vi.fn(),
  configureSpeech: vi.fn(),
}));

describe('Race Engine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup default mock returns
    db.getSettings.mockReturnValue({ minLapTime: 2.0 });
    db.getCars.mockReturnValue([
      { transponder: '111111', name: 'Car A', color: '#ff0000', driverId: 'd1' }
    ]);
    db.getDrivers.mockReturnValue([
      { id: 'd1', name: 'Driver One' }
    ]);
    
    // Mock performance.now
    vi.spyOn(performance, 'now').mockReturnValue(10000);
    
    // Initialize session
    initSession({ mode: 'practice' });
    startSession(); // Status becomes 'active'
  });

  it('should ignore first crossing (starting the lap)', () => {
    let updateCalled = false;
    initSession({ mode: 'practice' }, () => { updateCalled = true; });
    startSession();
    
    // First crossing (ticks = 0)
    processCrossing('111111', 0);
    
    // We expect the racer to be added to sessionState, but no lap completed yet
    expect(updateCalled).toBe(true);
  });

  it('should calculate lap time correctly using 1.0 multiplier', () => {
    let stateRef;
    initSession({ mode: 'practice' }, ({ state }) => { stateRef = state; });
    startSession();
    
    // First crossing (baseline)
    processCrossing('111111', 1000);
    
    // Second crossing 5 seconds later
    // 5000 ticks * 1.0 multiplier = 5000ms = 5.0 seconds
    processCrossing('111111', 6000);
    
    const racer = stateRef.racers['d1_111111'];
    expect(racer).toBeDefined();
    expect(racer.laps.length).toBe(1);
    expect(racer.laps[0].lapTime).toBeCloseTo(5.0, 2);
  });
  
  it('should filter double triggers below minLapTime', () => {
    let stateRef;
    initSession({ mode: 'practice' }, ({ state }) => { stateRef = state; });
    startSession();
    
    // First crossing (baseline)
    processCrossing('111111', 1000);
    
    // Second crossing 1 second later (minLapTime is 2.0)
    // 1000 ticks * 1.0 = 1.0s < 2.0s
    processCrossing('111111', 2000);
    
    const racer = stateRef.racers['d1_111111'];
    expect(racer.laps.length).toBe(0); // Lap should be rejected
  });
});
