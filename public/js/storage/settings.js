/**
 * Lappr - Database / Storage Module
 * Uses LocalStorage for local-first, offline-ready state persistence for application settings.
 */

const STORAGE_KEYS = {
  SETTINGS: 'apex_timing_settings'
};

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
 * Default configuration settings.
 */
export const DEFAULT_SETTINGS = {
  speechEnabled: true,
  speechVolume: 0.8,
  speechVoice: '',
  speechPitch: 1.0,
  speechRate: 1.1,
  overlayEnabled: true,
  overlayTimeout: 12,
  announcements: {
    driverOverallPR: '{driver} Overall PR {time}',
    overallCarBest: 'Overall {car} record {time}',
    driverCarPR: '{driver} {car} PR {time}',
    overallSessionBest: 'Overall session best {driver}, {time}',
    driverSessionBest: '{driver} session best, {time}',
    normalLap: '{driver}, {time}',
    consistentStreak: 'times {streak}'
  },
  streak: {
    minLaps: 3,
    varianceThreshold: 10,
    mustBeFast: true
  },
  minLapTime: 3.0,
  maxLapTime: 25.0,
  hardwareType: 'robotronic',
  connectAtStartup: false
};

/**
 * Fetch settings.
 * @returns {Object} Settings object.
 */
export function getSettings() {
  try {
    const data = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!data) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(data);
    // Merge deeply
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      announcements: { ...DEFAULT_SETTINGS.announcements, ...(parsed.announcements || {}) },
      streak: { ...DEFAULT_SETTINGS.streak, ...(parsed.streak || {}) }
    };
  } catch (e) {
    return DEFAULT_SETTINGS;
  }
}
