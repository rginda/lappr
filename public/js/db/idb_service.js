/**
 * idb_service.js
 * The pure asynchronous data layer for Lappr.
 * Wraps IndexedDB operations using the 'idb' library.
 */

// In browser environments we might need to load from a CDN or static bundle.
// Assuming we are using ES Modules via vite or static serve.
import { openDB } from 'idb';

const DB_NAME = 'lappr_db';
const DB_VERSION = 1;

let dbPromise;

/**
 * Initialize the database and its schema.
 */
export async function initDB() {
  if (dbPromise) return dbPromise;

  dbPromise = openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, newVersion, transaction) {
      if (oldVersion < 1) {
        // 1. Drivers Store
        if (!db.objectStoreNames.contains('drivers')) {
          db.createObjectStore('drivers', { keyPath: 'id' });
        }

        // 2. Cars Store
        if (!db.objectStoreNames.contains('cars')) {
          const carStore = db.createObjectStore('cars', { keyPath: 'id' });
          carStore.createIndex('transponder', 'transponder', { unique: false });
        }

        // 3. Sessions Store
        if (!db.objectStoreNames.contains('sessions')) {
          const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
          sessionStore.createIndex('status', 'status', { unique: false });
        }

        // 4. Laps Store
        if (!db.objectStoreNames.contains('laps')) {
          const lapStore = db.createObjectStore('laps', { keyPath: 'id' });
          lapStore.createIndex('driverId', 'driverId', { unique: false });
          lapStore.createIndex('carId', 'carId', { unique: false });
          lapStore.createIndex('sessionId', 'sessionId', { unique: false });
          lapStore.createIndex('lapTime', 'lapTime', { unique: false });
          lapStore.createIndex('timestamp', 'timestamp', { unique: false });
        }

        // 5. Personal Records Store
        if (!db.objectStoreNames.contains('personalrecords')) {
          const prStore = db.createObjectStore('personalrecords', { keyPath: 'id' });
          prStore.createIndex('entityId', 'entityId', { unique: false });
          prStore.createIndex('lapId', 'lapId', { unique: false });
          prStore.createIndex('prType', 'prType', { unique: false });
        }
      }
    }
  });

  return dbPromise;
}

// ==========================================
// CRUD Operations Placeholder
// ==========================================

export async function getDrivers() {
  const db = await initDB();
  return db.getAll('drivers');
}

export async function getCars() {
  const db = await initDB();
  return db.getAll('cars');
}

export async function saveDriver(driver) {
  const db = await initDB();
  await db.put('drivers', driver);
  return driver;
}

export async function saveCar(car) {
  const db = await initDB();
  await db.put('cars', car);
  return car;
}
