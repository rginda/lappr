/**
 * Apex Timing - Database / Storage Module
 * Uses LocalStorage for local-first, offline-ready state persistence.
 */

const STORAGE_KEYS = {
  RACERS: 'apex_timing_racers',
  SESSIONS: 'apex_timing_sessions',
  SETTINGS: 'apex_timing_settings',
  TRACKS: 'apex_timing_tracks'
};

// Default setup if no data exists
const DEFAULT_RACERS = [
  { name: 'Mock Driver A', transponder: 'CDFD4C', color: '#8b5cf6', vehicle: 'Mini-Z RWD' },
  { name: 'Mock Driver B', transponder: '00FFAB', color: '#06b6d4', vehicle: 'Mini-Z AWD' }
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
 * Get all registered racers.
 * @returns {Array} List of racer objects.
 */
export function getRacers() {
  const data = localStorage.getItem(STORAGE_KEYS.RACERS);
  if (!data) {
    localStorage.setItem(STORAGE_KEYS.RACERS, JSON.stringify(DEFAULT_RACERS));
    return DEFAULT_RACERS;
  }
  return JSON.parse(data);
}

/**
 * Save or update a racer.
 * @param {Object} racer - Racer object with name, transponder, color, vehicle.
 */
export function saveRacer(racer) {
  const racers = getRacers();
  const index = racers.findIndex(r => r.transponder.toUpperCase() === racer.transponder.toUpperCase());
  
  if (index !== -1) {
    racers[index] = racer;
  } else {
    racers.push(racer);
  }
  localStorage.setItem(STORAGE_KEYS.RACERS, JSON.stringify(racers));
  return racers;
}

/**
 * Delete a racer by transponder ID.
 * @param {string} transponder - The transponder hex ID.
 */
export function deleteRacer(transponder) {
  let racers = getRacers();
  racers = racers.filter(r => r.transponder.toUpperCase() !== transponder.toUpperCase());
  localStorage.setItem(STORAGE_KEYS.RACERS, JSON.stringify(racers));
  return racers;
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
 * Export all data (racers, settings, sessions) as a JSON string.
 * @returns {string} JSON string of database.
 */
export function exportDatabase() {
  const db = {
    racers: getRacers(),
    settings: getSettings(),
    sessions: getSessions()
  };
  return JSON.stringify(db, null, 2);
}

/**
 * Import and overwrite database with imported JSON string.
 * @param {string} jsonString - The database JSON string.
 */
export function importDatabase(jsonString) {
  try {
    const db = JSON.parse(jsonString);
    if (db.racers) localStorage.setItem(STORAGE_KEYS.RACERS, JSON.stringify(db.racers));
    if (db.settings) localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(db.settings));
    if (db.sessions) localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(db.sessions));
    return true;
  } catch (e) {
    console.error('Failed to import database:', e);
    return false;
  }
}
