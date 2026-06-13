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
 * Helper to recalculate historical PRs from a laps array
 */
function recalculatePRs(lapsArray) {
  if (!lapsArray || lapsArray.length === 0) return [];
  // lapsArray is sorted newest first. Reverse to chronological
  const chronological = [...lapsArray].reverse();
  const prs = [];
  let best = Infinity;
  for (const lap of chronological) {
    if (lap.lapTime < best) {
      best = lap.lapTime;
      prs.unshift(lap); // newest PR stays at index 0
      if (prs.length > 15) prs.pop();
    }
  }
  return prs;
}

/**
 * Delete a lap by its ID from all cars and drivers and recalculate PRs.
 */
export function deleteLap(lapId) {
  const drivers = getDrivers();
  const cars = getCars();
  let changed = false;
  
  // Clean Drivers
  for (const driver of drivers) {
    if (driver.laps) {
      const originalLen = driver.laps.length;
      driver.laps = driver.laps.filter(l => l.id !== lapId);
      if (driver.laps.length !== originalLen) {
        changed = true;
        driver.prs = recalculatePRs(driver.laps);
      }
    }
  }
  
  // Clean Cars
  for (const car of cars) {
    if (car.laps) {
      const originalLen = car.laps.length;
      car.laps = car.laps.filter(l => l.id !== lapId);
      if (car.laps.length !== originalLen) {
        changed = true;
        car.prs = recalculatePRs(car.laps);
      }
    }
  }
  
  if (changed) {
    localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(drivers));
    localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(cars));
  }
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
  const defaultSettings = {
    speechEnabled: true,
    speechVolume: 0.8,
    announcements: {
      driverBestEver: '{driver} best lap ever! {time}',
      carRecord: '{car} record! {time}',
      driverCarPR: '{driver} {car} p.r.! {time}',
      sessionFastest: 'Session fastest lap! {driver}, {time} seconds',
      personalBest: 'Personal best for {driver}, {time} seconds',
      normal: '{driver}, {time}',
      consistent: '{streak} laps consistent!'
    },
    streak: {
      minLaps: 3,
      varianceThreshold: 0.1,
      mustBeFast: true
    }
  };
  
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!data) return defaultSettings;
    const parsed = JSON.parse(data);
    // Merge deeply
    return {
      ...defaultSettings,
      ...parsed,
      announcements: { ...defaultSettings.announcements, ...(parsed.announcements || {}) },
      streak: { ...defaultSettings.streak, ...(parsed.streak || {}) }
    };
  } catch (e) {
    return defaultSettings;
  }
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

/**
 * Retroactively assigns unassigned laps on a car to a new driver,
 * provided the laps occurred within the current session timeframe.
 */
export function assignHistoricalLaps(carTransponder, driverId, sessionStartTime) {
  const drivers = getDrivers();
  const cars = getCars();
  
  const car = cars.find(c => c.transponder === carTransponder);
  const driver = drivers.find(d => d.id === driverId);
  
  if (!car || !driver) return;
  if (!car.laps) car.laps = [];
  if (!driver.laps) driver.laps = [];
  
  let lapsToAssign = [];
  
  // Scan car laps for unassigned laps in this session
  for (let i = 0; i < car.laps.length; i++) {
    const lap = car.laps[i];
    // Stop if we hit an older lap before this session
    if (lap.timestamp < sessionStartTime) {
      break;
    }
    // Stop if we hit a lap that is ALREADY assigned
    if (lap.driverId) {
      break;
    }
    
    // Unassigned lap in this session -> Reassign it!
    lap.driverId = driver.id;
    lap.driverName = driver.name;
    
    // Make a copy for the driver
    const driverLapEntry = {
      id: lap.id,
      car: car.name,
      carTransponder: car.transponder,
      timestamp: lap.timestamp,
      lapTime: lap.lapTime
    };
    lapsToAssign.push(driverLapEntry);
  }
  
  // Also update any PRs on the car that belong to these laps
  if (car.prs && lapsToAssign.length > 0) {
    const assignedLapIds = new Set(lapsToAssign.map(l => l.id));
    car.prs.forEach(pr => {
      if (assignedLapIds.has(pr.id)) {
        pr.driverId = driver.id;
        pr.driverName = driver.name;
      }
    });
  }
  
  if (lapsToAssign.length > 0) {
    // Inject the new laps into the driver's lap history and sort
    driver.laps.push(...lapsToAssign);
    driver.laps.sort((a, b) => b.timestamp - a.timestamp);
    if (driver.laps.length > 100) {
      driver.laps = driver.laps.slice(0, 100);
    }
    
    // Recalculate PRs for the driver
    driver.prs = recalculatePRs(driver.laps);
    
    localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(cars));
    localStorage.setItem(STORAGE_KEYS.DRIVERS, JSON.stringify(drivers));
  }
}
