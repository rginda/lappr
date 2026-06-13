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
  { id: 'driver-1', name: 'Mock Driver A' },
  { id: 'driver-2', name: 'Mock Driver B' }
];

const DEFAULT_CARS = [
  { transponder: 'CDFD4C', name: 'Red Mini-Z RWD', color: '#ef4444', driverId: 'driver-1' },
  { transponder: '00FFAB', name: 'Blue Mini-Z AWD', color: '#06b6d4', driverId: 'driver-2' }
];

const DEFAULT_SETTINGS = {
  minLapTime: 3.0,
  speechEnabled: true,
  speechVolume: 0.8,
  baudRate: 115200,
  limitType: 'time',
  limitValue: 5,
  sessionMode: 'practice'
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
  
  // Clear assignments for deleted driver
  const cars = getCars();
  let carsUpdated = false;
  cars.forEach(c => {
    if (c.driverId === id) {
      c.driverId = '';
      carsUpdated = true;
    }
  });
  if (carsUpdated) {
    localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(cars));
  }
  
  return drivers;
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
 * Assign a driver to a car.
 */
export function assignDriverToCar(transponder, driverId) {
  const cars = getCars();
  const car = cars.find(c => c.transponder.toUpperCase() === transponder.toUpperCase());
  if (car) {
    car.driverId = driverId;
    localStorage.setItem(STORAGE_KEYS.CARS, JSON.stringify(cars));
  }
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
