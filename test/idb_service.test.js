import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  initDB,
  closeDB,
  saveDriver,
  saveCar,
  saveLap,
  getLapsByDriverId,
  pruneDatabase
} from '../public/js/db/idb_service.js';

describe('IndexedDB Service', () => {
  afterEach(async () => {
    // Properly close the DB connection after each test
    await closeDB();
  });

  beforeEach(async () => {
    // Clear the fake-indexeddb database before each test
    const req = indexedDB.deleteDatabase('lappr_db');
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });
  });

  describe('Deletions (Cascade)', () => {
    it('should delete all associated laps when a driver is deleted', async () => {
      await saveDriver({ id: 'driver1', name: 'Test Driver' });
      await saveLap({ id: 'lap1', driverId: 'driver1', carId: 'car1' });
      await saveLap({ id: 'lap2', driverId: 'driver1', carId: 'car2' });
      await saveLap({ id: 'lap3', driverId: 'driver2', carId: 'car1' }); // Different driver

      let driverLaps = await getLapsByDriverId('driver1');
      expect(driverLaps.length).toBe(2);

      const { deleteDriver } = await import('../public/js/db/idb_service.js');
      await deleteDriver('driver1');

      driverLaps = await getLapsByDriverId('driver1');
      expect(driverLaps.length).toBe(0); // Laps deleted
      
      const otherDriverLaps = await getLapsByDriverId('driver2');
      expect(otherDriverLaps.length).toBe(1); // Other driver's lap untouched
    });

    it('should delete all associated laps when a car is deleted', async () => {
      await saveCar({ id: 'car1', transponder: 'T1', name: 'Test Car' });
      await saveLap({ id: 'lap1', driverId: 'driver1', carId: 'T1' });
      await saveLap({ id: 'lap2', driverId: 'driver2', carId: 'T1' });
      await saveLap({ id: 'lap3', driverId: 'driver1', carId: 'T2' }); // Different car

      const { getLapsByCarId, deleteCar } = await import('../public/js/db/idb_service.js');
      let carLaps = await getLapsByCarId('T1');
      expect(carLaps.length).toBe(2);

      await deleteCar('car1');

      carLaps = await getLapsByCarId('T1');
      expect(carLaps.length).toBe(0); // Laps deleted
      
      const otherCarLaps = await getLapsByCarId('T2');
      expect(otherCarLaps.length).toBe(1); // Other car's lap untouched
    });
  });

  describe('pruneDatabase', () => {
    it('should protect top 10 laps per driver and car during pruning', async () => {
      const { saveSession } = await import('../public/js/db/idb_service.js');
      await saveSession({ id: 'session1', status: 'finished' });
      
      // Create a test driver and car
      await saveDriver({ id: 'driver1', name: 'Test Driver' });
      await saveCar({ id: 'car1', transponder: '111', name: 'Test Car' });

      // Generate 25 laps for driver1/car1 combo.
      // We'll make the first lap extremely fast (PR), and the rest slower.
      // With maxHistoryPerEntity = 1, the GLOBAL_LAP_LIMIT is 10 laps.
      // Pruner should delete 15 laps, but KEEP the fastest lap even if it is the oldest lap!
      
      const lapsToSave = [];
      for (let i = 0; i < 25; i++) {
        lapsToSave.push({
          id: `lap_${i}`,
          driverId: 'driver1',
          carId: '111',
          sessionId: 'session1',
          lapTime: i === 0 ? 5.0 : 10.0 + i, // Lap 0 is 5.0s (fastest), others are 10.0s+
          timestamp: Date.now() + i * 1000 // Ascending timestamp
        });
      }

      // Save all laps
      for (const lap of lapsToSave) {
        await saveLap(lap);
      }

      // Verify we have 25 laps
      let laps = await getLapsByDriverId('driver1');
      expect(laps.length).toBe(25);

      // Prune database with maxHistoryPerEntity = 1 
      // This sets GLOBAL_LAP_LIMIT to 10 laps.
      await pruneDatabase(1);

      // Fetch laps again
      laps = await getLapsByDriverId('driver1');
      
      // Since GLOBAL_LAP_LIMIT is 10, the pruner protects the newest 10 laps.
      // Additionally, it protects the top 10 fastest laps per driver/car.
      // Top 10 fastest: lap_0 through lap_9
      // Newest 10: lap_15 through lap_24
      // Total kept: 20 laps
      expect(laps.length).toBe(20);

      // Verify the absolute fastest lap (lap_0) survived
      const protectedLap = laps.find(l => l.id === 'lap_0');
      expect(protectedLap).toBeDefined();
      expect(protectedLap.lapTime).toBe(5.0);
    });

    it('should delete finished sessions that have no laps', async () => {
      const { saveSession, getSession } = await import('../public/js/db/idb_service.js');
      // Create empty session
      await saveSession({ id: 'emptySession', status: 'finished' });
      // Create populated session
      await saveSession({ id: 'populatedSession', status: 'finished' });
      await saveLap({ id: 'lap1', sessionId: 'populatedSession', driverId: 'driver1', lapTime: 12.0, timestamp: Date.now() });

      await pruneDatabase();

      expect(await getSession('emptySession')).toBeUndefined();
      expect(await getSession('populatedSession')).toBeDefined();
    });

    it('should delete laps from finished sessions with unknown drivers', async () => {
      const { saveSession, getSession, getLapsBySessionId } = await import('../public/js/db/idb_service.js');
      
      // Active session shouldn't prune unknown driver laps
      await saveSession({ id: 'activeSession', status: 'active' });
      await saveLap({ id: 'lapActive', sessionId: 'activeSession', driverId: null, lapTime: 10, timestamp: Date.now() });
      
      // Finished session should prune unknown driver laps
      await saveSession({ id: 'finishedSession', status: 'finished' });
      await saveLap({ id: 'lapUnknown', sessionId: 'finishedSession', driverId: null, lapTime: 10, timestamp: Date.now() });
      await saveLap({ id: 'lapKnown', sessionId: 'finishedSession', driverId: 'driver1', lapTime: 12, timestamp: Date.now() });

      await pruneDatabase();

      const activeLaps = await getLapsBySessionId('activeSession');
      expect(activeLaps.length).toBe(1);

      const finishedLaps = await getLapsBySessionId('finishedSession');
      expect(finishedLaps.length).toBe(1);
      expect(finishedLaps[0].id).toBe('lapKnown'); // Only the known driver lap survives
    });

    it('should delete laps with invalid or non-existent session IDs', async () => {
      const { saveSession, getLapsBySessionId } = await import('../public/js/db/idb_service.js');
      
      // Create lap pointing to missing session
      await saveLap({ id: 'lapOrphan', sessionId: 'missingSession', driverId: 'driver1', lapTime: 10, timestamp: Date.now() });

      // Valid session
      await saveSession({ id: 'validSession', status: 'active' });
      await saveLap({ id: 'lapValid', sessionId: 'validSession', driverId: 'driver1', lapTime: 10, timestamp: Date.now() });

      await pruneDatabase();

      const orphanedLaps = await getLapsBySessionId('missingSession');
      expect(orphanedLaps.length).toBe(0); // Pruned

      const validLaps = await getLapsBySessionId('validSession');
      expect(validLaps.length).toBe(1); // Kept
    });
  });
});
