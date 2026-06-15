/**
 * idb_service.js
 * The pure asynchronous data layer for Lappr.
 * Wraps IndexedDB operations using the 'idb' library.
 */

import { openDB } from 'idb';

const DB_NAME = 'lappr_db';
const DB_VERSION = 1;

// ==========================================
// Memory Cache for Synchronous UI Access
// ==========================================
export const memCache = {
  drivers: [],
  cars: [],
  activeSessions: []
};

let dbPromise;

/**
 * Initialize the database and its schema.
 */
export async function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      if (oldVersion < 1) {
        if (!db.objectStoreNames.contains('drivers')) db.createObjectStore('drivers', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('cars')) {
          const carStore = db.createObjectStore('cars', { keyPath: 'id' });
          carStore.createIndex('transponder', 'transponder', { unique: false });
        }
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('status', 'status', { unique: false });
        }
        if (!db.objectStoreNames.contains('laps')) {
          const lapStore = db.createObjectStore('laps', { keyPath: 'id' });
          lapStore.createIndex('driverId', 'driverId', { unique: false });
          lapStore.createIndex('carId', 'carId', { unique: false });
          lapStore.createIndex('sessionId', 'sessionId', { unique: false });
          lapStore.createIndex('lapTime', 'lapTime', { unique: false });
          lapStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        if (!db.objectStoreNames.contains('personalrecords')) {
          const prStore = db.createObjectStore('personalrecords', { keyPath: 'id' });
          prStore.createIndex('entityId', 'entityId', { unique: false });
          prStore.createIndex('lapId', 'lapId', { unique: false });
          prStore.createIndex('prType', 'prType', { unique: false });
        }
      }
    }
  });

  const db = await dbPromise;

  // Hydrate Cache
  memCache.drivers = await db.getAll('drivers');
  memCache.cars = await db.getAll('cars');
  
  const tx = db.transaction('sessions', 'readonly');
  const index = tx.store.index('status');
  const active = await index.getAll('active');
  const paused = await index.getAll('paused');
  memCache.activeSessions = [...active, ...paused];

  return dbPromise;
}

// ==========================================
// Drivers
// ==========================================

export function getDrivers() {
  return memCache.drivers;
}

export async function getDriver(id) {
  const db = await initDB();
  return db.get('drivers', id);
}

export async function saveDriver(driver) {
  const idx = memCache.drivers.findIndex(d => d.id === driver.id);
  if (idx > -1) memCache.drivers[idx] = driver;
  else memCache.drivers.push(driver);

  const db = await initDB();
  await db.put('drivers', driver);
  return driver;
}

export async function deleteDriver(id) {
  memCache.drivers = memCache.drivers.filter(d => d.id !== id);
  const db = await initDB();
  await db.delete('drivers', id);
}

// ==========================================
// Cars
// ==========================================

export function getCars() {
  return memCache.cars;
}

export async function getCar(id) {
  const db = await initDB();
  return db.get('cars', id);
}

export async function getCarByTransponder(transponder) {
  const db = await initDB();
  return db.getFromIndex('cars', 'transponder', transponder);
}

export async function saveCar(car) {
  const idx = memCache.cars.findIndex(c => c.id === car.id);
  if (idx > -1) memCache.cars[idx] = car;
  else memCache.cars.push(car);

  const db = await initDB();
  await db.put('cars', car);
  return car;
}

export async function deleteCar(id) {
  memCache.cars = memCache.cars.filter(c => c.id !== id);
  const db = await initDB();
  await db.delete('cars', id);
}

// ==========================================
// Sessions
// ==========================================

export async function getSession(id) {
  const db = await initDB();
  return db.get('sessions', id);
}

export async function getActiveSessions() {
  const db = await initDB();
  const tx = db.transaction('sessions', 'readonly');
  const index = tx.store.index('status');
  const active = await index.getAll('active');
  const paused = await index.getAll('paused');
  return [...active, ...paused];
}

export async function saveSession(session) {
  const db = await initDB();
  await db.put('sessions', session);
  return session;
}

export async function deleteSession(id) {
  const db = await initDB();
  await db.delete('sessions', id);
}

// ==========================================
// Laps
// ==========================================

export async function saveLap(lap) {
  const db = await initDB();
  await db.put('laps', lap);
  return lap;
}

export async function getLap(id) {
  const db = await initDB();
  return db.get('laps', id);
}

export async function deleteLap(id) {
  const db = await initDB();
  await db.delete('laps', id);
}

export async function getLapsForSession(sessionId) {
  const db = await initDB();
  return db.getAllFromIndex('laps', 'sessionId', sessionId);
}

export async function deleteDriverCarStats(driverId, carId) {
  const db = await initDB();
  const tx = db.transaction('laps', 'readwrite');
  const index = tx.store.index('driverId');
  let cursor = await index.openCursor(driverId);
  while (cursor) {
    if (cursor.value.carId === carId) {
      await cursor.delete();
    }
    cursor = await cursor.continue();
  }
}

/**
 * Get recent laps for a driver, sorted by timestamp descending
 */
export async function getRecentLapsForDriver(driverId, limit = 100) {
  const db = await initDB();
  const tx = db.transaction('laps', 'readonly');
  const index = tx.store.index('driverId');
  let cursor = await index.openCursor(driverId, 'prev'); // prev = descending
  const laps = [];
  while (cursor && laps.length < limit) {
    laps.push(cursor.value);
    cursor = await cursor.continue();
  }
  return laps;
}

/**
 * Get recent laps for a car, sorted by timestamp descending
 */
export async function getRecentLapsForCar(carId, limit = 100) {
  const db = await initDB();
  const tx = db.transaction('laps', 'readonly');
  const index = tx.store.index('carId');
  let cursor = await index.openCursor(carId, 'prev');
  const laps = [];
  while (cursor && laps.length < limit) {
    laps.push(cursor.value);
    cursor = await cursor.continue();
  }
  return laps;
}

// ==========================================
// Personal Records
// ==========================================

export async function savePersonalRecord(pr) {
  const db = await initDB();
  await db.put('personalrecords', pr);
  return pr;
}

export async function getPersonalRecordsForEntity(entityId) {
  const db = await initDB();
  return db.getAllFromIndex('personalrecords', 'entityId', entityId);
}

export async function deletePersonalRecord(id) {
  const db = await initDB();
  await db.delete('personalrecords', id);
}

// ==========================================
// Pruning Worker
// ==========================================

/**
 * Background routine to prune old laps while protecting personal records.
 * Deletes any laps that are older than the Nth recent lap for their driver/car,
 * unless their ID exists in the personalrecords table.
 * Also deletes empty historical sessions.
 */
export async function pruneDatabase(maxHistoryPerEntity = 500) {
  const db = await initDB();

  // 1. Load all protected PR lap IDs into a Set for O(1) lookup
  const allPRs = await db.getAll('personalrecords');
  const protectedLapIds = new Set(allPRs.map((pr) => pr.lapId));

  // 2. Identify all laps that exceed the maxHistoryPerEntity threshold
  // This is a naive global pruning for simplicity in V1: we just keep the last X laps globally
  // (A more advanced version would use cursors per driverId/carId)
  const txLaps = db.transaction('laps', 'readwrite');
  const lapsIndex = txLaps.store.index('timestamp');
  let lapCursor = await lapsIndex.openCursor(null, 'prev'); // Newest to oldest
  
  let globalLapCount = 0;
  const GLOBAL_LAP_LIMIT = 5000; // E.g., keep 5000 laps max globally

  while (lapCursor) {
    globalLapCount++;
    if (globalLapCount > GLOBAL_LAP_LIMIT) {
      if (!protectedLapIds.has(lapCursor.value.id)) {
        await lapCursor.delete();
      }
    }
    lapCursor = await lapCursor.continue();
  }
  await txLaps.done;

  // 3. Clean up empty ghost sessions
  const txSessions = db.transaction('sessions', 'readwrite');
  let sessionCursor = await txSessions.store.openCursor();
  while (sessionCursor) {
    const session = sessionCursor.value;
    if (session.status === 'finished') {
      const sessionLaps = await db.getAllFromIndex('laps', 'sessionId', session.id);
      if (sessionLaps.length === 0) {
        await sessionCursor.delete();
      }
    }
    sessionCursor = await sessionCursor.continue();
  }
  await txSessions.done;
}
