import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as db from '../public/js/database.js';

describe('Database Module', () => {
  beforeEach(() => {
    const store = {};
    global.localStorage = {
      getItem: vi.fn((key) => store[key] || null),
      setItem: vi.fn((key, value) => {
        store[key] = value.toString();
      }),
      removeItem: vi.fn((key) => {
        delete store[key];
      }),
      clear: vi.fn(() => {
        for (const key in store) delete store[key];
      })
    };
    vi.clearAllMocks();
  });

  describe('Drivers', () => {
    it('should save and retrieve a driver', () => {
      const driver = { id: 'd1', name: 'Driver One' };
      db.saveDriver(driver);

      const drivers = db.getDrivers();
      expect(drivers.length).toBe(3); // 2 defaults + 1 new
      expect(drivers[2]).toEqual(driver);
    });

    it('should delete a driver', () => {
      db.saveDriver({ id: 'd1', name: 'Driver One' });
      db.saveDriver({ id: 'd2', name: 'Driver Two' });

      db.deleteDriver('d1');
      const drivers = db.getDrivers();
      expect(drivers.length).toBe(3); // 2 defaults + d2
      expect(drivers[2].id).toBe('d2');
    });
  });

  describe('Cars', () => {
    it('should save and retrieve a car', () => {
      const car = { transponder: '111', name: 'Car A' };
      db.saveCar(car);

      const cars = db.getCars();
      expect(cars.length).toBe(3); // 2 defaults + 1 new
      expect(cars[2]).toEqual(car);
    });

    it('should delete a car', () => {
      db.saveCar({ transponder: '111', name: 'Car A' });
      db.saveCar({ transponder: '222', name: 'Car B' });

      db.deleteCar('111');
      const cars = db.getCars();
      expect(cars.length).toBe(3); // 2 defaults + 1
      expect(cars[2].transponder).toBe('222');
    });
  });

  describe('Settings', () => {
    it('should return default settings if empty', () => {
      const settings = db.getSettings();
      expect(settings).toBeDefined();
      expect(settings.speechEnabled).toBe(true);
    });

    it('should save and retrieve settings', () => {
      const newSettings = { minLapTime: 5.0, newSetting: true };
      db.saveSettings(newSettings);

      const settings = db.getSettings();
      expect(settings.minLapTime).toBe(5.0);
      expect(settings.newSetting).toBe(true);
    });
  });

  describe('Laps & Stats', () => {
    it('should log a lap and update driver and car history', () => {
      db.saveDriver({ id: 'd1', name: 'Driver One' });
      db.saveCar({ transponder: '111', name: 'Car A' });

      const lapResult = db.logLap('d1', '111', 10.5);

      expect(lapResult.driverResult.isPR).toBe(true);
      expect(lapResult.carResult.isPR).toBe(true);

      const drivers = db.getDrivers();
      const cars = db.getCars();

      expect(drivers.find((d) => d.id === 'd1').laps.length).toBe(1);
      expect(cars.find((c) => c.transponder === '111').laps.length).toBe(1);
    });

    it('should delete a lap and recalculate PRs', () => {
      db.saveDriver({ id: 'd1', name: 'Driver One' });
      db.saveCar({ transponder: '111', name: 'Car A' });

      db.logLap('d1', '111', 10.5);
      const cars = db.getCars();
      const lapId = cars.find((c) => c.transponder === '111').laps[0].id;

      db.deleteLap(lapId);

      const d = db.getDrivers().find((d) => d.id === 'd1');
      expect(d.laps.length).toBe(0);
      expect(d.prs.length).toBe(0);
    });

    it('should delete driver car stats', () => {
      db.saveDriver({ id: 'd1', name: 'Driver One' });
      db.saveCar({ transponder: '111', name: 'Car A' });

      db.logLap('d1', '111', 10.5);
      db.deleteDriverCarStats('d1', '111');

      const d = db.getDrivers().find((d) => d.id === 'd1');
      expect(d.laps.length).toBe(0);
    });
  });

  describe('Sessions & Backup', () => {
    it('should save and retrieve sessions', () => {
      const session = { id: 's1', timestamp: Date.now() };
      db.saveSession(session);

      const sessions = db.getSessions();
      expect(sessions.length).toBe(1);
      expect(sessions[0].id).toBe('s1');
    });

    it('should export and import database', () => {
      db.saveDriver({ id: 'd1', name: 'Driver One' });
      const json = db.exportDatabase();

      // Clear db
      global.localStorage.clear();

      db.importDatabase(json);
      const drivers = db.getDrivers();
      expect(drivers.find((d) => d.id === 'd1')).toBeDefined();
    });
    it('should assign historical laps retroactively', () => {
      db.saveDriver({ id: 'd1', name: 'Driver One' });
      db.saveDriver({ id: 'd2', name: 'Driver Two' });
      db.saveCar({ transponder: '111', name: 'Car A' });

      const sessionStart = Date.now() - 10000;

      // Log an unassigned lap
      db.logLap(null, '111', 10.5);

      db.assignHistoricalLaps('111', 'd2', sessionStart);

      const d2 = db.getDrivers().find((d) => d.id === 'd2');
      expect(d2.laps.length).toBe(1);
      expect(d2.laps[0].lapTime).toBe(10.5);
    });
    it('should intelligently prune driver laps (keep 100 per car and protect PRs)', () => {
      const driver = {
        id: 'd1',
        laps: [],
        prs: []
      };

      // Add 105 laps for Car A (transponder 'A')
      for (let i = 0; i < 105; i++) {
        driver.laps.unshift({
          id: `lapA_${i}`,
          carTransponder: 'A',
          lapTime: 10 + i // oldest is fastest (lapA_0, 10.0s), will be at the end of array
        });
      }
      
      // Make the very first lap (lapA_0) the all-time PR
      driver.prs = [driver.laps.find(l => l.id === 'lapA_0')];

      // Add 5 laps for Car B (transponder 'B')
      for (let i = 0; i < 5; i++) {
        driver.laps.unshift({
          id: `lapB_${i}`,
          carTransponder: 'B',
          lapTime: 12 + i
        });
      }
      
      // Also make lapB_0 a PR
      driver.prs.push(driver.laps.find(l => l.id === 'lapB_0'));

      db.pruneDriverLaps(driver);

      // Car B should have exactly 5 laps (none pruned)
      const lapsB = driver.laps.filter(l => l.carTransponder === 'B');
      expect(lapsB.length).toBe(5);

      // Car A should have exactly 101 laps (100 recent + 1 protected PR if it was out of the 100 window)
      // Since lapA_0 is protected but is the oldest, it will be kept. 
      // The newest 100 laps are lapA_5 through lapA_104.
      const lapsA = driver.laps.filter(l => l.carTransponder === 'A');
      expect(lapsA.length).toBe(101);
      
      // Verify lapA_0 is still there
      expect(lapsA.find(l => l.id === 'lapA_0')).toBeDefined();
      
      // Verify lapA_4 was dropped
      expect(lapsA.find(l => l.id === 'lapA_4')).toBeUndefined();
    });

    it('should intelligently prune car laps (keep 100 per driver and protect PRs)', () => {
      const car = {
        transponder: 'C1',
        laps: [],
        prs: []
      };

      // Add 105 laps for Driver A
      for (let i = 0; i < 105; i++) {
        car.laps.unshift({
          id: `lapDA_${i}`,
          driverId: 'DA',
          lapTime: 10 + i
        });
      }
      
      // Add 5 laps for Driver B
      for (let i = 0; i < 5; i++) {
        car.laps.unshift({
          id: `lapDB_${i}`,
          driverId: 'DB',
          lapTime: 12 + i
        });
      }
      
      // Car PRs
      car.prs = [car.laps.find(l => l.id === 'lapDA_0'), car.laps.find(l => l.id === 'lapDB_0')];

      db.pruneCarLaps(car);

      const lapsDB = car.laps.filter(l => l.driverId === 'DB');
      expect(lapsDB.length).toBe(5);

      const lapsDA = car.laps.filter(l => l.driverId === 'DA');
      expect(lapsDA.length).toBe(101);
      
      expect(lapsDA.find(l => l.id === 'lapDA_0')).toBeDefined();
      expect(lapsDA.find(l => l.id === 'lapDA_4')).toBeUndefined();
    });
  });
});
