import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { bus } from '../public/js/core/event_bus.js';
import { speak } from '../public/js/ui/speech.js';
import { getLapsByCarId, getLapsByDriverId, getDrivers } from '../public/js/storage/idb_service.js';

vi.mock('../public/js/ui/speech.js', () => ({
  speak: vi.fn()
}));

vi.mock('../public/js/storage/idb_service.js', () => ({
  getLapsByCarId: vi.fn(),
  getLapsByDriverId: vi.fn(),
  getDrivers: vi.fn(),
  getCars: vi.fn().mockReturnValue([]),
  saveLap: vi.fn(),
  memCache: { cars: [] },
  saveCar: vi.fn(),
  saveSession: vi.fn(),
  getLapsBySessionId: vi.fn()
}));

vi.mock('../public/js/storage/settings.js', () => ({
  getSettings: vi.fn().mockReturnValue({
    announcements: {
      driverOverallPR: '{driver} Overall PR {time}',
      overallCarBest: 'Overall {car} record {time}',
      driverCarPR: '{driver} {car} PR {time}',
      overallSessionBest: 'Overall session best {driver}, {time}',
      driverSessionBest: '{driver} session best, {time}',
      normalLap: '{driver}, {time}'
    }
  })
}));

vi.mock('../public/js/core/session_store.js', () => ({
  sessionStore: {
    getState: () => ({ id: 'session1', racers: {} })
  }
}));

vi.mock('../public/js/core/race_engine.js', () => ({
  raceEngine: {
    registerCars: vi.fn()
  }
}));

describe('Speech Announcements', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    
    getDrivers.mockReturnValue([{ id: 'd1', name: 'Test Driver' }]);
    getLapsByCarId.mockResolvedValue([]);
    getLapsByDriverId.mockResolvedValue([]);

    await import('../public/js/ui/race.js');
  });

  afterEach(() => {
    // Do not clear bus.listeners since race.js is only imported once
  });

  it('should announce normal lap', async () => {
    getLapsByCarId.mockResolvedValue([{ lapTime: 4.0 }]);
    getLapsByDriverId.mockResolvedValue([{ lapTime: 4.0, carId: 'c1' }]);

    const eventData = {
      racer: { name: 'Test Driver', carName: 'Car 1' },
      lap: {
        carId: 'c1',
        lapTime: 5.0,
        isOverallBest: false,
        isDriverSessionBest: false
      }
    };

    bus.emit('lapRecorded', eventData);
    await new Promise(r => setTimeout(r, 10));

    expect(speak).toHaveBeenCalledWith('Test Driver, 5.0');
  });

  it('should announce driver session best', async () => {
    getLapsByCarId.mockResolvedValue([{ lapTime: 4.0 }]);
    getLapsByDriverId.mockResolvedValue([{ lapTime: 4.0, carId: 'c1' }]);

    const eventData = {
      racer: { name: 'Test Driver', carName: 'Car 1' },
      lap: {
        carId: 'c1',
        lapTime: 4.5,
        isOverallBest: false,
        isDriverSessionBest: true
      }
    };

    bus.emit('lapRecorded', eventData);
    await new Promise(r => setTimeout(r, 10));

    expect(speak).toHaveBeenCalledWith('Test Driver session best, 4.5');
  });

  it('should announce overall session best', async () => {
    getLapsByCarId.mockResolvedValue([{ lapTime: 4.0 }]);
    getLapsByDriverId.mockResolvedValue([{ lapTime: 4.0, carId: 'c1' }]);

    const eventData = {
      racer: { name: 'Test Driver', carName: 'Car 1' },
      lap: {
        carId: 'c1',
        lapTime: 4.2,
        isOverallBest: true, // This should take precedence over driver session best
        isDriverSessionBest: true
      }
    };

    bus.emit('lapRecorded', eventData);
    await new Promise(r => setTimeout(r, 10));

    expect(speak).toHaveBeenCalledWith('Overall session best Test Driver, 4.2');
  });

  it('should announce driver car PR', async () => {
    getLapsByCarId.mockResolvedValue([{ lapTime: 3.0 }]);
    getLapsByDriverId.mockResolvedValue([
      { lapTime: 3.5, carId: 'c2' }, // Faster in a different car
      { lapTime: 4.5, carId: 'c1' }  // Slower in this car
    ]);

    const eventData = {
      racer: { name: 'Test Driver', carName: 'Car 1' },
      lap: {
        carId: 'c1',
        lapTime: 4.0, // PR for this car, but not overall driver PR
        isOverallBest: true,
        isDriverSessionBest: true
      }
    };

    bus.emit('lapRecorded', eventData);
    await new Promise(r => setTimeout(r, 10));

    expect(speak).toHaveBeenCalledWith('Test Driver Car 1 PR 4.0');
  });

  it('should announce driver overall PR', async () => {
    getLapsByCarId.mockResolvedValue([{ lapTime: 2.0 }]); // Someone else is faster in this car
    getLapsByDriverId.mockResolvedValue([{ lapTime: 3.5, carId: 'c2' }]);

    const eventData = {
      racer: { name: 'Test Driver', carName: 'Car 1' },
      lap: {
        carId: 'c1',
        lapTime: 3.0, // PR for driver across all cars!
        isOverallBest: true,
        isDriverSessionBest: true
      }
    };

    bus.emit('lapRecorded', eventData);
    await new Promise(r => setTimeout(r, 10));

    expect(speak).toHaveBeenCalledWith('Test Driver Overall PR 3.0');
  });

  it('should announce overall car best', async () => {
    getLapsByCarId.mockResolvedValue([{ lapTime: 3.0 }]);
    getLapsByDriverId.mockResolvedValue([{ lapTime: 3.0, carId: 'c1' }]);

    const eventData = {
      racer: { name: 'Test Driver', carName: 'Car 1' },
      lap: {
        carId: 'c1',
        lapTime: 2.5, // Fastest lap EVER for this car
        isOverallBest: true,
        isDriverSessionBest: true
      }
    };

    bus.emit('lapRecorded', eventData);
    await new Promise(r => setTimeout(r, 10));

    expect(speak).toHaveBeenCalledWith('Overall Car 1 record 2.5');
  });
});
