import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock race and database first
vi.mock('../public/js/storage/settings.js', () => ({
  getSettings: vi.fn(() => ({ minLapTime: 3.0 })),
  saveSettings: vi.fn(),
  DEFAULT_SETTINGS: {}
}));

vi.mock('../public/js/storage/idb_service.js', () => ({
  initDB: vi.fn(() => Promise.resolve()),
  getDrivers: vi.fn(() => []),
  getCars: vi.fn(() => []),
  saveDriver: vi.fn(),
  saveCar: vi.fn(),
  deleteDriver: vi.fn(),
  deleteCar: vi.fn(),
  saveSession: vi.fn(),
  memCache: { drivers: [], cars: [], activeSessions: [] }
}));

vi.mock('../public/js/hardware/serial.js', () => ({
  connectHID: vi.fn(),
  disconnect: vi.fn(),
  toggleSimulator: vi.fn()
}));

vi.mock('../public/js/ui/speech.js', () => ({
  configureSpeech: vi.fn(),
  speak: vi.fn()
}));

describe('App Controller (DOM)', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    // Mock speechSynthesis
    window.speechSynthesis = {
      getVoices: vi.fn(() => []),
      onvoiceschanged: null
    };

    window.bootstrap = {
      Modal: class {
        show() {}
        hide() {}
      }
    };

    // Setup DOM
    const htmlPath = path.resolve(__dirname, '../public/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');

    // Extract just the body content
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = bodyMatch ? bodyMatch[1] : html;

    // Dynamically import app.js
    await import('../public/js/app.js');
  });

  it('should switch views correctly', () => {
    // Manually trigger DOMContentLoaded
    document.dispatchEvent(new Event('DOMContentLoaded'));

    const settingsSessionPanel = document.getElementById('view-settings-session');
    expect(settingsSessionPanel.classList.contains('active')).toBe(false);

    // Find the settings session tab
    const settingsTab = document.querySelector('[data-target="view-settings-session"]');
    expect(settingsTab).not.toBeNull();

    settingsTab.click();

    expect(settingsSessionPanel.classList.contains('active')).toBe(true);
  });

  it('should handle driver form submission', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const driverForm = document.getElementById('add-driver-form');
    
    document.getElementById('driver-name').value = 'Test Driver';
    
    // Create and dispatch submit event
    const event = new Event('submit', { cancelable: true });
    driverForm.dispatchEvent(event);
    
    const db = await import('../public/js/storage/idb_service.js');
    expect(db.saveDriver).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Test Driver'
    }));
  });

  it('should handle car form submission', async () => {
    document.dispatchEvent(new Event('DOMContentLoaded'));
    const carForm = document.getElementById('add-car-form');
    
    document.getElementById('car-transponder').value = 'AAAAAA';
    document.getElementById('car-name').value = 'Test Car';
    document.getElementById('car-color').value = '#000000';
    
    const event = new Event('submit', { cancelable: true });
    carForm.dispatchEvent(event);
    
    const db = await import('../public/js/storage/idb_service.js');
    expect(db.saveCar).toHaveBeenCalledWith(expect.objectContaining({
      transponder: 'AAAAAA',
      name: 'Test Car',
      color: '#000000'
    }));
  });
});
