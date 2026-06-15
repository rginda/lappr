import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDB,
  saveDriver,
  saveCar,
  saveLap,
  getLapsByDriverId,
  pruneDatabase
} from '../public/js/db/idb_service.js';

describe('IndexedDB Service', () => {
  beforeEach(async () => {
    // Clear the fake-indexeddb database before each test
    const req = indexedDB.deleteDatabase('lappr_db');
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
    });
  });

  describe('pruneDatabase', () => {
    it('should protect top 10 laps per driver and car during pruning', async () => {
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
  });
});
