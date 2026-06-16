import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock serial and speech to prevent errors
vi.mock('../public/js/hardware/serial.js', () => ({
  connectHID: vi.fn(),
  disconnect: vi.fn(),
  toggleSimulator: vi.fn()
}));

vi.mock('../public/js/ui/speech.js', () => ({
  configureSpeech: vi.fn(),
  speak: vi.fn()
}));

describe('Lappr Full Integration', () => {
  let dbModule;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();

    global.localStorage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      clear: vi.fn()
    };
    
    global.window.Chart = class {
      constructor() {}
      destroy() {}
      update() {}
    };

    // Reset IndexedDB
    const req = indexedDB.deleteDatabase('lappr_db');
    await new Promise((resolve) => {
      req.onsuccess = resolve;
      req.onerror = resolve;
      req.onblocked = resolve;
    });

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

    // Load HTML
    const htmlPath = path.resolve(__dirname, '../public/index.html');
    const html = fs.readFileSync(htmlPath, 'utf-8');
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = bodyMatch ? bodyMatch[1] : html;

    // We must manually import idb_service to ensure DB initializes
    dbModule = await import('../public/js/storage/idb_service.js');
    await dbModule.initDB();

    // Import app.js (which dynamically imports race.js)
    await import('../public/js/app.js');
    
    // Wait for DOMContentLoaded to run initApp()
    document.dispatchEvent(new Event('DOMContentLoaded'));
    
    // Wait a tick for async initialization
    await new Promise(r => setTimeout(r, 50));
  });

  afterEach(async () => {
    if (dbModule) {
      await dbModule.closeDB();
    }
  });

  const getDriverListNames = () => {
    const items = document.querySelectorAll('#driver-list li');
    return Array.from(items).map(i => i.textContent.trim());
  };

  const getCarListNames = () => {
    const items = document.querySelectorAll('#car-list li');
    return Array.from(items).map(i => i.textContent.trim());
  };

  it('should add and remove drivers correctly in UI', async () => {
    const driverForm = document.getElementById('add-driver-form');
    const nameInput = document.getElementById('driver-name');
    
    // Add Driver
    nameInput.value = 'Ayrton Senna';
    driverForm.dispatchEvent(new Event('submit', { cancelable: true }));
    
    await new Promise(r => setTimeout(r, 50)); // DB write + UI update
    
    let drivers = getDriverListNames();
    console.log('DRIVERS FOUND IN UI:', drivers);
    expect(drivers).toContain('Ayrton Senna');
    
    // Click the driver to select it
    const driverItems = Array.from(document.querySelectorAll('#driver-list li'));
    const sennaItem = driverItems.find(li => li.textContent.includes('Ayrton Senna'));
    sennaItem.click();
    
    await new Promise(r => setTimeout(r, 50)); // Render profile
    
    // Type name to confirm deletion
    const confirmInput = document.getElementById('delete-driver-confirm');
    confirmInput.value = 'Ayrton Senna';
    confirmInput.dispatchEvent(new Event('input'));
    
    // Click delete
    const deleteBtn = document.getElementById('btn-delete-driver');
    expect(deleteBtn.disabled).toBe(false);
    deleteBtn.click();
    
    await new Promise(r => setTimeout(r, 50)); // DB delete + UI update
    
    drivers = getDriverListNames();
    expect(drivers).not.toContain('Ayrton Senna');
  });

  it('should add and remove cars correctly in UI', async () => {
    const carForm = document.getElementById('add-car-form');
    
    document.getElementById('car-transponder').value = 'MOCK99';
    document.getElementById('car-name').value = 'Ferrari F1';
    carForm.dispatchEvent(new Event('submit', { cancelable: true }));
    
    await new Promise(r => setTimeout(r, 50));
    
    let cars = getCarListNames();
    expect(cars.some(c => c.includes('Ferrari F1'))).toBe(true);
    
    const carItems = Array.from(document.querySelectorAll('#car-list li'));
    const ferrariItem = carItems.find(li => li.textContent.includes('Ferrari F1'));
    ferrariItem.click();
    
    await new Promise(r => setTimeout(r, 50));
    
    const confirmInput = document.getElementById('delete-car-confirm');
    confirmInput.value = 'Ferrari F1';
    confirmInput.dispatchEvent(new Event('input'));
    
    const deleteBtn = document.getElementById('btn-delete-car');
    expect(deleteBtn.disabled).toBe(false);
    deleteBtn.click();
    
    await new Promise(r => setTimeout(r, 50));
    cars = getCarListNames();
    expect(cars.some(c => c.includes('Ferrari F1'))).toBe(false);
  });

  it('should handle live session mock triggers, auto-creation, and PRs', async () => {
    // 1. Set Hardware to Mock
    const hardwareSelect = document.getElementById('setting-hardware-type');
    hardwareSelect.value = 'mock';
    hardwareSelect.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));

    // 2. Start Session
    const startBtn = document.getElementById('btn-session-start');
    startBtn.dispatchEvent(new Event('click'));
    await new Promise(r => setTimeout(r, 100));

    expect(document.getElementById('session-subtitle').textContent.toUpperCase()).toContain('RUNNING');

    // 2. Trigger Mock Transponder (Unregistered)
    // We can simulate a mock crossing by programmatically invoking processCrossing
    const { processCrossing } = await import('../public/js/ui/race.js');
    
    processCrossing('MOCK01', 1000); // Hit at 1 second
    await new Promise(r => setTimeout(r, 50));
    
    // Auto-creation should add it to the car list
    let cars = getCarListNames();
    expect(cars.some(c => c.includes('Car MOCK01'))).toBe(true);

    // Leaderboard should have it
    const activeRows = document.querySelectorAll('#leaderboard-body tr');
    expect(activeRows.length).toBe(1);
    expect(activeRows[0].textContent).toContain('Car MOCK01');

    // 3. Trigger again for a lap (ensure > 3.0s minLapTime)
    const { bus } = await import('../public/js/core/event_bus.js');
    bus.on('lapRejected', data => console.log('LAP REJECTED:', data));
    bus.on('lapRecorded', data => console.log('LAP RECORDED:', data));
    
    processCrossing('MOCK01', 6000); // Hit at 6 seconds (Lap is 5.0s)
    await new Promise(r => setTimeout(r, 50));

    // Leaderboard should show 1 lap and 5.000s best
    const newActiveRows = document.querySelectorAll('#leaderboard-body tr');
    expect(newActiveRows[0].textContent).toContain('1'); // Laps
    expect(newActiveRows[0].textContent).toContain('5.000'); // Best
    
    // 4. Assign a driver
    const driverForm = document.getElementById('add-driver-form');
    document.getElementById('driver-name').value = 'Max Verstappen';
    driverForm.dispatchEvent(new Event('submit', { cancelable: true }));
    await new Promise(r => setTimeout(r, 50));
    
    // Assign max to the car in the leaderboard
    const newActiveRows2 = document.querySelectorAll('#leaderboard-body tr');
    const driverSelect = newActiveRows2[0].querySelector('.leaderboard-driver-assign');
    
    // Find Max's ID
    const { getDrivers } = await import('../public/js/storage/idb_service.js');
    const drivers = await getDrivers();
    const maxDriver = drivers.find(d => d.name === 'Max Verstappen');
    
    driverSelect.value = maxDriver.id;
    driverSelect.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));

    // 5. Check Driver PRs show up
    // Select Max
    const driverItems = Array.from(document.querySelectorAll('#driver-list li'));
    const maxItem = driverItems.find(li => li.textContent.includes('Max Verstappen'));
    maxItem.click(); // View driver details
    await new Promise(r => setTimeout(r, 50));

    // Wait for laps to be fetched
    const prBody = document.getElementById('driver-prs-body');
    expect(prBody.textContent).toContain('5.000');
    expect(prBody.textContent).toContain('Car MOCK01');

    // 6. Delete Lap
    const deleteLapBtn = prBody.querySelector('.delete-lap-btn');
    expect(deleteLapBtn).not.toBeNull();
    
    // Mock window.confirm
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteLapBtn.click();
    await new Promise(r => setTimeout(r, 50));
    
    // Lap should be gone from PRs
    expect(prBody.textContent).not.toContain('5.000');
    expect(prBody.textContent).toContain('No records yet');
    confirmSpy.mockRestore();
  });
});
