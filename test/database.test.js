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
});
