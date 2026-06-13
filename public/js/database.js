/**
 * Apex Timing - Database / Storage Module
 * Uses LocalStorage for local-first, offline-ready state persistence.
 */

const STORAGE_KEYS = {
  DRIVERS: 'lappr_drivers',
  CARS: 'lappr_cars',
  SESSIONS: 'apex_timing_sessions',
  SETTINGS: 'apex_timing_settings',
  TRACKS: 'apex_timing_tracks'
};

// Default setup if no data exists
const DEFAULT_DRIVERS = [
  { id: 'driver-1', name: 'Mock Driver A', laps: [], prs: [] },
  { id: 'driver-2', name: 'Mock Driver B', laps: [], prs: [] }
];

const DEFAULT_CARS = [
  { transponder: 'CDFD4C', name: 'Red Mini-Z RWD', color: '#ef4444', laps: [], prs: [] },
  { transponder: '00FFAB', name: 'Blue Mini-Z AWD', color: '#06b6d4', laps: [], prs: [] }
];

const DEFAULT_SETTINGS = {
  minLapTime: 3.0,
  speechEnabled: true,
  speechVolume: 0.8,
  baudRate: 115200
};

/**
 * Get all registered drivers.
 */
export function getDrivers() {
  const data = localStorage.getItem(STORAGE_KEYS.DRIVERS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(DEFAULT_DRIVERS));
    return DEFAULT_DRIVERS;
  }
  return JSON.parse(data);
}

/**
 * Save or update a driver.
 */
export function saveDriver(driver) {
  const drivers = getDrivers();
  const index = drivers.findIndex(d => d.id === driver.id);
  if (index !== -1) {
    drivers[index] = driver;
  } else {
    drivers.push(driver);
  }
  localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(drivers));
  return drivers;
}

/**
 * Delete a driver by ID.
 */
export function deleteDriver(id) {
  let drivers = getDrivers();
  drivers = drivers.filter(d => d.id !== id);
  localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(drivers));
  
  return drivers;
}

/**
 * Log a lap to both driver and car history. Maintains last 100 laps and a history of PRs for both.
 */
export function logLap(driverId, transponder, lapTime) {
  const now = Date.now();
  const lapId = 'lap_' + now.toString(36) + Math.random().toString(36).substr(2, 5);
  
  let driverResult = { driver: null, isPR: false };
  let carResult = { car: null, isPR: false };
  
  const drivers = getDrivers();
  const cars = getCars();
  
  const carIndex = cars.findIndex(c => c.transponder.toUpperCase() === transponder.toUpperCase());
  const driverIndex = drivers.findIndex(d => d.id === driverId);
  
  const car = carIndex !== -1 ? cars[carIndex] : null;
  const driver = driverIndex !== -1 ? drivers[driverIndex] : null;

  // 1. Log for Driver (if assigned and known)
  if (driver && car) {
    if (!driver.laps) driver.laps = [];
    if (!driver.prs) driver.prs = [];
    
    const driverLapEntry = { car: car.name, carTransponder: transponder, timestamp: now, lapTime: lapTime, id: lapId };
    
    driver.laps.unshift(driverLapEntry);
    if (driver.laps.length > 100) driver.laps.pop();
    
    let isPR = false;
    if (driver.prs.length === 0) {
      isPR = true;
    } else {
      const currentBest = driver.prs[0].lapTime;
      if (lapTime < currentBest) isPR = true;
    }
    
    if (isPR) {
      driver.prs.unshift(driverLapEntry);
      if (driver.prs.length > 15) driver.prs.pop();
    }
    
    let isDriverCarPR = false;
    // previous laps on this specific car excluding the one we just unshifted
    const previousDriverCarLaps = driver.laps.filter(l => l.carTransponder === transponder && l.id !== lapId);
    if (previousDriverCarLaps.length === 0) {
      isDriverCarPR = true;
    } else {
      const bestDriverCarLap = Math.min(...previousDriverCarLaps.map(l => l.lapTime));
      if (lapTime < bestDriverCarLap) isDriverCarPR = true;
    }
    
    driverResult = { driver, isPR, isDriverCarPR };
    localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(drivers));
  }

  // 2. Log for Car (always logged even if no driver, but here we require transponder to be valid)
  if (car) {
    if (!car.laps) car.laps = [];
    if (!car.prs) car.prs = [];
    
    // We store driverId to be able to group by driver on the car profile
    const carLapEntry = { driverId: driver ? driver.id : null, driverName: driver ? driver.name : 'Unknown', timestamp: now, lapTime: lapTime, id: lapId };
    
    car.laps.unshift(carLapEntry);
    if (car.laps.length > 100) car.laps.pop();
    
    let isPR = false;
    if (car.prs.length === 0) {
      isPR = true;
    } else {
      const currentBest = car.prs[0].lapTime;
      if (lapTime < currentBest) isPR = true;
    }
    
    if (isPR) {
      car.prs.unshift(carLapEntry);
      if (car.prs.length > 15) car.prs.pop();
    }
    
    carResult = { car, isPR };
    localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(cars));
  }
  
  return { driverResult, carResult };
}

/**
 * Delete a PR by its ID and recalculate the next best if needed.
 */
export function deleteDriverPr(driverId, prId) {
  const drivers = getDrivers();
  const driverIndex = drivers.findIndex(d => d.id === driverId);
  if (driverIndex === -1) return;
  
  const driver = drivers[driverIndex];
  if (!driver.prs) return;
  
  // Also delete from laps if it was an erroneous lap completely
  if (driver.laps) {
    driver.laps = driver.laps.filter(l => l.id !== prId);
  }
  
  // Remove from PR list
  driver.prs = driver.prs.filter(p => p.id !== prId);
  
  // Actually, if we deleted a PR, do we need to recalculate PRs from history?
  // We have a stored history of PRs. If I run 4.0, 3.8, 3.5. `prs` = [3.5, 3.8, 4.0]
  // If I delete 3.5, `prs` = [3.8, 4.0]. The next PR is naturally 3.8, which is already there!
  // So just removing it is sufficient.
  
  localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(drivers));
  return driver;
}

/**
 * Get all registered cars.
 */
export function getCars() {
  const data = localStorage.getItem(STORAGE_KEYS.CARS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(DEFAULT_CARS));
    return DEFAULT_CARS;
  }
  return JSON.parse(data);
}

/**
 * Save or update a car.
 */
export function saveCar(car) {
  const cars = getCars();
  const index = cars.findIndex(c => c.transponder.toUpperCase() === car.transponder.toUpperCase());
  if (index !== -1) {
    cars[index] = car;
  } else {
    cars.push(car);
  }
  localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(cars));
  return cars;
}

/**
 * Delete a car by transponder ID.
 */
export function deleteCar(transponder) {
  let cars = getCars();
  cars = cars.filter(c => c.transponder.toUpperCase() !== transponder.toUpperCase());
  localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(cars));
  return cars;
}



/**
 * Save settings to storage.
 * @param {Object} settings 
 */
export function saveSettings(settings) {
  const current = getSettings();
  const updated = { ...current, ...settings };
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(updated));
  return updated;
}

/**
 * Get active configuration settings.
 * @returns {Object} Settings object.
 */
export function getSettings() {
  const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(DEFAULT_SETTINGS));
    return DEFAULT_SETTINGS;
  }
  return JSON.parse(data);
}

/**
 * Save a completed race or practice session to history.
 * @param {Object} session - Completed session details.
 */
export function saveSession(session) {
  const sessions = getSessions();
  sessions.unshift(session); // Add to the beginning of the list
  // Limit to last 50 sessions to conserve localStorage space
  if (sessions.length > 50) {
    sessions.pop();
  }
  localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
  return sessions;
}

/**
 * Get session history.
 * @returns {Array} List of completed sessions.
 */
export function getSessions() {
  const data = localStorage.getItem(STORAGE_KEYS.SESSIONS);
  return data ? JSON.parse(data) : [];
}

/**
 * Export all data as a JSON string.
 */
export function exportDatabase() {
  const db = {
    drivers: getDrivers(),
    cars: getCars(),
    settings: getSettings(),
    sessions: getSessions()
  };
  return JSON.stringify(db, null, 2);
}

/**
 * Import and overwrite database with imported JSON string.
 */
export function importDatabase(jsonString) {
  try {
    const db = JSON.parse(jsonString);
    if (db.drivers) localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(db.drivers));
    if (db.cars) localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(db.cars));
    if (db.settings) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(db.settings));
    if (db.sessions) localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(db.sessions));
    return true;
  } catch (e) {
    console.error('Failed to import database:', e);
    return false;
  }
}
