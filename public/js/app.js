/**
 * Apex Timing - Application Controller
 * Connects UI elements, handles events, handles serial parsing,
 * and renders the leaderboard.
 */

import {
  getSettings,
  saveSettings,
  DEFAULT_SETTINGS
} from './database.js';

import {
  initDB,
  getDrivers,
  saveDriver,
  deleteDriver,
  getCars,
  saveCar,
  deleteCar
} from './db/idb_service.js';

import { connectHID, toggleSimulator, disconnect, autoConnectHID } from './serial.js';

import {
  initSession,
  recoverSessionState,
  startSession,
  stopSession,
  clearSession,
  processCrossing,
  assignUnregisteredRacer,
  refreshActiveRacers
} from './race.js';

import { configureSpeech } from './speech.js';

const connectionBadge = document.getElementById('connection-badge');
const connectionStatusText = document.getElementById('connection-status-text');

const minLapTime = document.getElementById('setting-min-lap-time');
const maxLapTime = document.getElementById('setting-max-lap-time');

// Mock Hardware DOM Elements
const mockHardwareDropdown = document.getElementById('mock-hardware-dropdown');
const mockTranspondersList = document.getElementById('mock-transponders-list');
const btnAddMock = document.getElementById('btn-add-mock');
const btnCloseMock = document.getElementById('btn-close-mock');
let mockTransponderCount = 0;
const btnSessionStart = document.getElementById('btn-session-start');
const btnSessionStop = document.getElementById('btn-session-stop');

const addDriverForm = document.getElementById('add-driver-form');
const driverNameInput = document.getElementById('driver-name');
const driverList = document.getElementById('driver-list');

// DOM Elements: Car Form
const addCarForm = document.getElementById('add-car-form');
const carTransponderInput = document.getElementById('car-transponder');
const carNameInput = document.getElementById('car-name');
const carChassisInput = document.getElementById('car-chassis');
const carColorInput = document.getElementById('car-color');
const carChips = document.querySelectorAll('#add-car-form .color-chip');

const sessionTitle = document.getElementById('session-title');
const sessionSubtitle = document.getElementById('session-subtitle');
const timerDisplay = document.getElementById('session-timer-display');
const leaderboardBody = document.getElementById('leaderboard-body');
const countCarsDisplay = document.getElementById('leaderboard-count-cars');
const countLapsDisplay = document.getElementById('leaderboard-count-laps');

const speechToggle = document.getElementById('speech-toggle');
const speechVolume = document.getElementById('speech-volume');
const speechVolumeSlider = document.getElementById('speech-volume-slider');
const modalSpeechVoice = document.getElementById('modal-speech-voice');
const modalSpeechPitch = document.getElementById('modal-speech-pitch');
const modalSpeechPitchSlider = document.getElementById('modal-speech-pitch-slider');
const modalSpeechRate = document.getElementById('modal-speech-rate');
const modalSpeechRateSlider = document.getElementById('modal-speech-rate-slider');

const notificationsContainer = document.getElementById('notifications');

// Driver Details
const editDriverName = document.getElementById('edit-driver-name');
const driverPrsBody = document.getElementById('driver-prs-body');
const driverLapsBody = document.getElementById('driver-laps-body');
const deleteDriverConfirm = document.getElementById('delete-driver-confirm');
const btnDeleteDriver = document.getElementById('btn-delete-driver');
let selectedDriverId = null;
let activeDriverChart = null;

// DOM Elements: Car Details Form
const editCarName = document.getElementById('edit-car-name');
const editCarTransponder = document.getElementById('edit-car-transponder');
const editCarChassis = document.getElementById('edit-car-chassis');
const editCarColor = document.getElementById('edit-car-color');
const editCarChips = document.querySelectorAll('#view-car-details .color-chip');
const deleteCarConfirm = document.getElementById('delete-car-confirm');
const btnDeleteCar = document.getElementById('btn-delete-car');
let selectedCarId = null;
let activeCarChart = null;
let activeSessionChart = null;
let driverRecentLapsPage = 1;

// Application State
let activeSettings = {};

let currentSessionStatus = 'ready';

/**
 * Initialize application.
 */

const initApp = async () => {
  activeSettings = getSettings();
  loadSettingsUI();
  renderDriverList();
  renderCarList();

  // Register service worker for PWA support
  registerServiceWorker();

  // Initialize UI callbacks and blank session first
  reinitSessionState();

  // Attempt to recover an interrupted session (overwrites blank session if found)
  const recovery = await recoverSessionState();
  if (recovery) {
    // Set UI to match recovered state
    sessionTitle.textContent = recovery.mode.toUpperCase() + ' SESSION';
    sessionSubtitle.textContent = recovery.status === 'active' ? 'RUNNING' : 'PAUSED';
    currentSessionStatus = recovery.status;
    btnSessionStart.textContent = recovery.status === 'active' ? 'Pause Session' : 'Start Session';
    btnSessionStart.className = recovery.status === 'active' ? 'btn btn-warning' : 'btn btn-success';

    if (recovery.status === 'active') {
      startSession();
    }
  } else {
    // Initialize a new default practice session
    const config = {
      mode: 'practice',
      limitType: 'time',
      limitValue: 0,
      minLapTime: parseFloat(minLapTime.value) || 3.0,
      maxLapTime: parseFloat(maxLapTime.value) || 25.0
    };

    initSession(config, renderLeaderboard, updateTimerDisplay);

    sessionTitle.textContent = config.mode.toUpperCase() + ' SESSION';
    sessionSubtitle.textContent = 'READY TO RUN';
    currentSessionStatus = 'ready';
    btnSessionStart.textContent = 'Start Session';
    btnSessionStart.className = 'btn btn-success';
  }

  // Event listeners
  bindEvents();

  // Speech Interaction Banner Logic
  const banner = document.getElementById('speech-interaction-banner');
  if (banner) {
    const dismissBanner = () => {
      if (banner && banner.parentNode) {
        banner.parentNode.removeChild(banner);
      }
      
      // Unlock speech synthesis engine quietly
      if (window.speechSynthesis && window.SpeechSynthesisUtterance) {
        const utterance = new window.SpeechSynthesisUtterance('');
        utterance.volume = 0;
        window.speechSynthesis.speak(utterance);
        window.speechSynthesis.cancel();
      }

      window.removeEventListener('click', dismissBanner, { capture: true });
      window.removeEventListener('keydown', dismissBanner, { capture: true });
      window.removeEventListener('touchstart', dismissBanner, { capture: true });
    };
    window.addEventListener('click', dismissBanner, { capture: true });
    window.addEventListener('keydown', dismissBanner, { capture: true });
    window.addEventListener('touchstart', dismissBanner, { capture: true });
  }

  // Handle hardware auto-connect
  const resumeIfNeeded = () => {
    if (recovery && recovery.status === 'active') {
      startSession();
    }
  };

  if (activeSettings.hardwareType === 'mock') {
    onStatusChange({ connected: true, type: 'mock', name: 'MOCK HARDWARE' });
    resumeIfNeeded();
  } else if (activeSettings.connectAtStartup) {
    autoConnectHID(38400, onLineReceived, onStatusChange).then((connected) => {
        if (!connected) {
          console.warn('Auto-connect HID failed. User gesture may be required first.');
          if (recovery && recovery.status === 'active') {
            stopSession();
            alert('Hardware auto-connect failed. The recovered session has been paused. Please connect hardware and resume.');
          }
        } else {
          resumeIfNeeded();
        }
      });
  }
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', async () => {
    await initDB();
    initApp();
  });
} else {
  initDB().then(() => initApp());
}

/**
 * Load settings from database and update UI components.
 */
function loadSettingsUI() {
  minLapTime.value = activeSettings.minLapTime || 3.0;
  maxLapTime.value = activeSettings.maxLapTime || 25.0;

  speechToggle.checked = activeSettings.speechEnabled;
  speechVolume.value = activeSettings.speechVolume || 0.8;
  if (speechVolumeSlider) speechVolumeSlider.value = activeSettings.speechVolume || 0.8;

  const hardwareType = document.getElementById('setting-hardware-type');
  if (hardwareType) hardwareType.value = activeSettings.hardwareType || 'robotronic';

  const autoconnect = document.getElementById('setting-hardware-autoconnect');
  if (autoconnect) autoconnect.checked = !!activeSettings.connectAtStartup;

  if (modalSpeechVoice) modalSpeechVoice.value = activeSettings.speechVoice || '';
  if (modalSpeechPitch) modalSpeechPitch.value = activeSettings.speechPitch || 1.0;
  if (modalSpeechPitchSlider) modalSpeechPitchSlider.value = activeSettings.speechPitch || 1.0;
  if (modalSpeechRate) modalSpeechRate.value = activeSettings.speechRate || 1.1;
  if (modalSpeechRateSlider) modalSpeechRateSlider.value = activeSettings.speechRate || 1.1;

  const overlayToggle = document.getElementById('speech-overlay-toggle');
  if (overlayToggle) overlayToggle.checked = activeSettings.overlayEnabled !== false;

  const overlayTimeout = document.getElementById('speech-overlay-timeout');
  if (overlayTimeout) overlayTimeout.value = activeSettings.overlayTimeout || 12;
  configureSpeech({
    enabled: activeSettings.speechEnabled,
    volume: activeSettings.speechVolume,
    voiceName: activeSettings.speechVoice,
    pitch: activeSettings.speechPitch,
    rate: activeSettings.speechRate
  });
}

/**
 * Populate Speech Voice dropdowns with available voices
 */
function populateVoiceDropdowns() {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return;

  const optionsHtml =
    `<option value="">Default (Auto)</option>` +
    voices.map((v) => `<option value="${v.name}">${v.name} (${v.lang})</option>`).join('');

  if (modalSpeechVoice) {
    const prevVal = modalSpeechVoice.value || activeSettings.speechVoice;
    modalSpeechVoice.innerHTML = optionsHtml;
    modalSpeechVoice.value = prevVal;
  }
}

// Initial populate of voices, and re-populate when loaded
populateVoiceDropdowns();
window.speechSynthesis.onvoiceschanged = populateVoiceDropdowns;

/**
 * Bind DOM Event Listeners.
 */
function bindEvents() {
  // Connection Events
  connectionBadge.addEventListener('click', handleConnectClick);
  
  // Mock Hardware Events
  btnCloseMock.addEventListener('click', () => {
    mockHardwareDropdown.style.display = 'none';
  });
  
  btnAddMock.addEventListener('click', () => {
    mockTransponderCount++;
    const transponderId = `MOCK${mockTransponderCount.toString().padStart(2, '0')}`;
    
    const btn = document.createElement('button');
    btn.className = 'btn';
    btn.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.5rem; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: var(--text-primary); cursor: pointer;';
    btn.innerHTML = `<span>${transponderId}</span> <span style="font-size: 0.75rem; color: var(--accent-primary);">Trigger &rarr;</span>`;
    
    btn.addEventListener('click', () => {
      // Simulate crossing format: ID[6 chars]Timestamp[8 chars]
      const ts = Math.floor(Date.now() / 10).toString(16).padStart(8, '0');
      onLineReceived(transponderId + ts);
      
      // Visual feedback
      btn.style.background = 'var(--accent-primary)';
      btn.style.color = '#000';
      setTimeout(() => {
        btn.style.background = 'rgba(255,255,255,0.05)';
        btn.style.color = '#text-primary';
      }, 150);
    });
    
    mockTranspondersList.appendChild(btn);
  });

  // Session Settings Events
  const handleSessionSettingChange = () => {
    saveActiveSettings();
    reinitSessionState();

    if (activeSettings.hardwareType === 'mock') {
      onStatusChange({ connected: true, type: 'mock', name: 'MOCK HARDWARE' });
    } else if (connectionBadge.classList.contains('connected') && connectionStatusText.textContent === 'MOCK HARDWARE') {
      onStatusChange({ connected: false });
    }

    // Quick inline notification
    const notif = document.createElement('div');
    notif.style.cssText =
      'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: var(--success-color); color: #000; padding: 0.75rem 1.5rem; border-radius: var(--radius-md); font-weight: 600; z-index: 9999; transition: opacity 0.5s ease;';
    notif.textContent = 'Settings Saved';
    document.body.appendChild(notif);
    setTimeout(() => {
      notif.style.opacity = '0';
      setTimeout(() => notif.remove(), 500);
    }, 2000);
  };

  minLapTime.addEventListener('change', handleSessionSettingChange);
  maxLapTime.addEventListener('change', handleSessionSettingChange);

  // Session Action Events
  btnSessionStart.addEventListener('click', handleSessionStartToggle);
  btnSessionStop.addEventListener('click', handleSessionStop);

  // Settings Reset Events
  document.querySelectorAll('.btn-reset-settings').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      handleSettingsReset(e.currentTarget.dataset.category);
    });
  });

  // Form Events
  addDriverForm.addEventListener('submit', handleAddDriver);
  addCarForm.addEventListener('submit', handleAddCar);

  // Audio Controls migrated

  // Link sliders to inputs for Speech Engine
  function linkSliderAndInput(slider, input) {
    if (!slider || !input) return;
    slider.addEventListener('input', () => (input.value = slider.value));
    input.addEventListener('input', () => (slider.value = input.value));
  }

  linkSliderAndInput(speechVolumeSlider, speechVolume);
  linkSliderAndInput(modalSpeechPitchSlider, modalSpeechPitch);
  linkSliderAndInput(modalSpeechRateSlider, modalSpeechRate);

  // Preview Buttons
  document.querySelectorAll('.preview-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const context = btn.getAttribute('data-context');
      const input = document.getElementById(targetId);
      if (input && input.value) {
        const previewText = input.value
          .replace(/{driver}/g, 'John Doe')
          .replace(/{car}/g, 'Red Racer')
          .replace(/{time}/g, '9.5')
          .replace(/{streak}/g, '5');

        let speechOpts = {
          voiceName: activeSettings.speechVoice,
          pitch: activeSettings.speechPitch,
          rate: activeSettings.speechRate
        };

        if (context === 'driver' && selectedDriverId) {
          const driver = getDrivers().find((d) => d.id === selectedDriverId);
          if (driver && driver.speechOverride) {
            speechOpts = driver.speechOverride;
          }
        }

        import('./speech.js').then((speech) => {
          speech.speak(previewText, true, speechOpts);
        });
      }
    });
  });

  // View Routing
  const navTabs = document.querySelectorAll('.nav-tab[data-target], .nav-item[data-target]');
  navTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tree-list li').forEach((el) => el.classList.remove('active'));
      if (tab.tagName === 'LI') tab.classList.add('active');
      switchView(tab.getAttribute('data-target'));
    });
  });

  // Tree Toggles
  const treeHeaders = document.querySelectorAll('.tree-header');
  treeHeaders.forEach((header) => {
    header.addEventListener('click', () => {
      const targetId = header.getAttribute('data-tree');
      const content = document.getElementById(targetId);
      header.classList.toggle('collapsed');
      content.classList.toggle('collapsed');
    });
  });

  // Nav Action Buttons (+ New Driver, + New Car)
  const navActionBtns = document.querySelectorAll('.nav-action-btn');
  navActionBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      switchView(btn.getAttribute('data-target'));
    });
  });

  // Color Chips
  const colorChips = document.querySelectorAll('.color-chip');
  colorChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const color = chip.getAttribute('data-color');
      // For car details color picker
      const picker = chip.closest('.form-group').querySelector('input[type="color"]');
      if (picker) {
        picker.value = color;
        picker.dispatchEvent(new Event('change'));
      }
    });
  });

  const handleDriverUpdate = () => {
    if (selectedDriverId) {
      const newName = editDriverName.value.trim();

      if (newName) {
        const drivers = getDrivers();
        const driverIndex = drivers.findIndex((d) => d.id === selectedDriverId);
        if (driverIndex !== -1) {
          drivers[driverIndex].name = newName;
          saveDriver(drivers[driverIndex]);
          renderDriverList();
          refreshActiveRacers();

          const notif = document.createElement('div');
          notif.style.cssText =
            'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: var(--success-color); color: #000; padding: 0.75rem 1.5rem; border-radius: var(--radius-md); font-weight: 600; z-index: 9999; transition: opacity 0.5s ease;';
          notif.textContent = 'Profile Saved';
          document.body.appendChild(notif);
          setTimeout(() => {
            notif.style.opacity = '0';
            setTimeout(() => notif.remove(), 500);
          }, 2000);
        }
      }
    }
  };

  editDriverName.addEventListener('input', handleDriverUpdate);

  deleteDriverConfirm.addEventListener('input', (e) => {
    const driver = getDrivers().find((d) => d.id === selectedDriverId);
    if (driver && e.target.value === driver.name) {
      btnDeleteDriver.disabled = false;
    } else {
      btnDeleteDriver.disabled = true;
    }
  });

  btnDeleteDriver.addEventListener('click', () => {
    if (selectedDriverId && !btnDeleteDriver.disabled) {
      deleteDriver(selectedDriverId);
      selectedDriverId = null;
      renderDriverList();
      renderCarList();
      refreshActiveRacers();
      switchView('view-session');
    }
  });

  document.getElementById('driver-laps-first').addEventListener('click', () => {
    driverRecentLapsPage = 1;
    renderDriverDetails(selectedDriverId);
  });
  
  document.getElementById('driver-laps-prev').addEventListener('click', () => {
    if (driverRecentLapsPage > 1) {
      driverRecentLapsPage--;
      renderDriverDetails(selectedDriverId);
    }
  });
  
  document.getElementById('driver-laps-next').addEventListener('click', () => {
    const driver = getDrivers().find(d => d.id === selectedDriverId);
    if (!driver) return;
    const totalPages = Math.ceil((driver.laps || []).length / 15);
    if (driverRecentLapsPage < totalPages) {
      driverRecentLapsPage++;
      renderDriverDetails(selectedDriverId);
    }
  });
  
  document.getElementById('driver-laps-last').addEventListener('click', () => {
    const driver = getDrivers().find(d => d.id === selectedDriverId);
    if (!driver) return;
    const totalPages = Math.ceil((driver.laps || []).length / 15);
    if (totalPages > 0) {
      driverRecentLapsPage = totalPages;
      renderDriverDetails(selectedDriverId);
    }
  });

  const handleCarUpdate = () => {
    if (!selectedCarId) return;
    const cars = getCars();
    const carIndex = cars.findIndex((c) => c.transponder === selectedCarId);
    if (carIndex === -1) return;

    const newName = editCarName.value.trim();
    const newChassis = editCarChassis.value.trim();
    const newColor = editCarColor.value;

    if (newName) {
      cars[carIndex].name = newName;
      cars[carIndex].chassis = newChassis;
      cars[carIndex].color = newColor;
      saveCar(cars[carIndex]);
      renderCarList();
      refreshActiveRacers();

      const notif = document.createElement('div');
      notif.style.cssText =
        'position: fixed; bottom: 80px; left: 50%; transform: translateX(-50%); background: var(--success-color); color: #000; padding: 0.75rem 1.5rem; border-radius: var(--radius-md); font-weight: 600; z-index: 9999; transition: opacity 0.5s ease;';
      notif.textContent = 'Car Saved';
      document.body.appendChild(notif);
      setTimeout(() => {
        notif.style.opacity = '0';
        setTimeout(() => notif.remove(), 500);
      }, 2000);
    }
  };

  editCarName.addEventListener('input', handleCarUpdate);
  editCarChassis.addEventListener('input', handleCarUpdate);
  editCarColor.addEventListener('input', handleCarUpdate);

  deleteCarConfirm.addEventListener('input', (e) => {
    const car = getCars().find((c) => c.transponder === selectedCarId);
    if (car && e.target.value === car.name) {
      btnDeleteCar.disabled = false;
    } else {
      btnDeleteCar.disabled = true;
    }
  });

  btnDeleteCar.addEventListener('click', async () => {
    if (selectedCarId && !btnDeleteCar.disabled) {
      const car = getCars().find(c => c.transponder === selectedCarId);
      if (car) {
        await deleteCar(car.id);
      }
      
      // Remove it from the live race engine
      import('./race.js').then((module) => {
        module.removeCarFromSession(selectedCarId);
        selectedCarId = null;
        renderCarList();
        refreshActiveRacers();
        switchView('view-session');
      });
    }
  });

  // Settings Events
  const handleSettingsUpdate = () => {
    const settings = getSettings();

    // Save new speech engine values
    settings.speechEnabled = speechToggle.checked;
    settings.speechVolume = parseFloat(speechVolume.value);
    const hardwareType = document.getElementById('setting-hardware-type');
    if (hardwareType) settings.hardwareType = hardwareType.value;

    const autoconnect = document.getElementById('setting-hardware-autoconnect');
    if (autoconnect) settings.connectAtStartup = autoconnect.checked;

    settings.speechVoice = modalSpeechVoice.value;
    settings.speechPitch = parseFloat(modalSpeechPitch.value);
    settings.speechRate = parseFloat(modalSpeechRate.value);
    
    const overlayToggle = document.getElementById('speech-overlay-toggle');
    if (overlayToggle) settings.overlayEnabled = overlayToggle.checked;
    
    const overlayTimeout = document.getElementById('speech-overlay-timeout');
    if (overlayTimeout) settings.overlayTimeout = parseInt(overlayTimeout.value) || 12;

    // Also update activeSettings immediately for the session
    activeSettings.speechEnabled = settings.speechEnabled;
    activeSettings.speechVolume = settings.speechVolume;
    activeSettings.speechVoice = settings.speechVoice;
    activeSettings.speechPitch = settings.speechPitch;
    activeSettings.speechRate = settings.speechRate;
    activeSettings.overlayEnabled = settings.overlayEnabled;
    activeSettings.overlayTimeout = settings.overlayTimeout;

    // Configure speech engine immediately
    import('./speech.js').then((m) =>
      m.configureSpeech({
        enabled: settings.speechEnabled,
        volume: settings.speechVolume,
        voiceName: settings.speechVoice,
        pitch: settings.speechPitch,
        rate: settings.speechRate
      })
    );

    settings.announcements = {
      driverOverallPR: document.getElementById('setting-speech-driver-overall-pr').value.trim(),
      overallCarBest: document.getElementById('setting-speech-overall-car-best').value.trim(),
      driverCarPR: document.getElementById('setting-speech-driver-car-pr').value.trim(),
      overallSessionBest: document.getElementById('setting-speech-overall-session-best').value.trim(),
      driverSessionBest: document.getElementById('setting-speech-driver-session-best').value.trim(),
      normalLap: document.getElementById('setting-speech-normal-lap').value.trim(),
      consistentStreak: document.getElementById('setting-speech-consistent-streak').value.trim()
    };
    settings.streak = {
      minLaps: parseInt(document.getElementById('setting-streak-min-laps').value) || 3,
      varianceThreshold:
        parseFloat(document.getElementById('setting-streak-variance').value) || 10,
      mustBeFast: document.getElementById('setting-streak-fast-only').checked
    };

    saveSettings(settings);
    saveActiveSettings();

    const notif = document.createElement('div');
    notif.style.position = 'fixed';
    notif.style.bottom = '80px';
    notif.style.left = '50%';
    notif.style.transform = 'translateX(-50%)';
    notif.style.background = 'var(--success-color)';
    notif.style.color = '#000';
    notif.style.padding = '0.75rem 1.5rem';
    notif.style.borderRadius = 'var(--radius-md)';
    notif.style.fontWeight = '600';
    notif.style.zIndex = '9999';
    notif.textContent = 'Settings Saved';

    document.body.appendChild(notif);
    setTimeout(() => {
      notif.style.opacity = '0';
      notif.style.transition = 'opacity 0.5s ease';
      setTimeout(() => notif.remove(), 500);
    }, 2000);
  };

  const settingsInputs = document.querySelectorAll(
    '#view-settings-speech input, #view-settings-speech select, #view-settings-streaks input, #view-settings-session input, #view-settings-hardware input, #view-settings-hardware select'
  );
  settingsInputs.forEach((input) => {
    input.addEventListener('input', handleSettingsUpdate);
    input.addEventListener('change', handleSettingsUpdate); // catch checkbox/select changes too
  });
}

function switchView(viewId) {
  const viewPanels = document.querySelectorAll('.view-panel');
  viewPanels.forEach((p) => p.classList.remove('active'));
  document.getElementById(viewId).classList.add('active');

  // Reset active state on nav elements
  document.querySelectorAll('.nav-tab[data-target]').forEach((t) => t.classList.remove('active'));
  document.querySelectorAll('.tree-list li').forEach((t) => t.classList.remove('active'));

  // Add active state to matching nav tab if it's a top level
  const tab = document.querySelector(`.nav-tab[data-target="${viewId}"]`);
  if (tab) tab.classList.add('active');

  // Populate settings view if entering a settings panel
  if (viewId.startsWith('view-settings-')) {
    populateSettingsView();
  }
}

function populateSettingsView() {
  const settings = getSettings();

  const ann = settings.announcements || {};
  document.getElementById('setting-speech-driver-overall-pr').value = ann.driverOverallPR || '';
  document.getElementById('setting-speech-overall-car-best').value = ann.overallCarBest || '';
  document.getElementById('setting-speech-driver-car-pr').value = ann.driverCarPR || '';
  document.getElementById('setting-speech-overall-session-best').value = ann.overallSessionBest || '';
  document.getElementById('setting-speech-driver-session-best').value = ann.driverSessionBest || '';
  document.getElementById('setting-speech-normal-lap').value = ann.normalLap || '';
  document.getElementById('setting-speech-consistent-streak').value = ann.consistentStreak || '';

  const streak = settings.streak || {};
  document.getElementById('setting-streak-min-laps').value = streak.minLaps || 3;
  document.getElementById('setting-streak-variance').value = streak.varianceThreshold || 10;
  document.getElementById('setting-streak-fast-only').checked = streak.mustBeFast !== false;
}

/**
 * Initialize / Update Session parameters in the race engine.
 */
function reinitSessionState() {
  const config = {
    mode: 'practice',
    minLapTime: parseFloat(minLapTime.value) || 3.0,
    maxLapTime: parseFloat(maxLapTime.value) || 25.0
  };

  initSession(config, renderLeaderboard, updateTimerDisplay);

  sessionTitle.textContent = config.mode.toUpperCase() + ' SESSION';
  sessionSubtitle.textContent = 'READY TO RUN';
  currentSessionStatus = 'ready';
  btnSessionStart.textContent = 'Start Session';
  btnSessionStart.className = 'btn btn-success';
}

/**
 * Save active configurations to database.
 */
function saveActiveSettings() {
  const settings = {
    minLapTime: parseFloat(minLapTime.value) || 3.0,
    maxLapTime: parseFloat(maxLapTime.value) || 25.0,
    speechEnabled: speechToggle.checked,
    speechVolume: parseFloat(speechVolume.value),
    speechVoice: activeSettings.speechVoice,
    speechPitch: activeSettings.speechPitch,
    speechRate: activeSettings.speechRate
  };
  activeSettings = saveSettings(settings);
}

/**
 * Hardware Connection Click.
 */
async function handleConnectClick(e) {
  if (activeSettings.hardwareType === 'mock') {
    mockHardwareDropdown.style.display = mockHardwareDropdown.style.display === 'none' ? 'block' : 'none';
    return;
  }

  if (connectionBadge.classList.contains('connected')) {
    await disconnect(onStatusChange);
    return;
  }

  if (e && e.shiftKey) {
    toggleSimulator(true, onLineReceived, onStatusChange);
    return;
  }

  const baud = 38400; // Hardcoded default for EasyLap
  try {
    await connectHID(baud, onLineReceived, onStatusChange);
  } catch (err) {
    alert(`WebHID connection failed: ${err.message}`);
  }
}

/**
 * Connection Status update callback.
 * Synchronizes buttons and indicators based on active connections.
 */
function onStatusChange(status) {
  if (status.connected) {
    connectionBadge.className = 'status-indicator connected';
    connectionBadge.title = 'Click to Disconnect';
    connectionStatusText.textContent = status.name;
  } else {
    connectionBadge.className = 'status-indicator disconnected';
    connectionBadge.title = 'Click to Connect';
    connectionStatusText.textContent = 'CONNECT TO HARDWARE';
  }
}

/**
 * Parse raw ASCII serial lines.
 * Protocol packet format: ID[6 chars]Timestamp[8 chars]\r\n
 */
function onLineReceived(line) {
  // Validate format (Robitronic output is 14 hex characters: 6 ID + 8 Timestamp)
  if (line.length !== 14) {
    console.warn(`[Protocol] Invalid serial packet length (${line.length}):`, line);
    return;
  }

  const transponderId = line.substring(0, 6);
  const timestampHex = line.substring(6, 14);
  const ticks = parseInt(timestampHex, 16);

  if (isNaN(ticks)) {
    console.warn('[Protocol] Failed to parse hardware ticks as hex:', timestampHex);
    return;
  }

  processCrossing(transponderId, ticks);
}

/**
 * Session Start/Pause Toggle.
 */
async function handleSessionStartToggle(e) {
  if (currentSessionStatus === 'active') {
    import('./race.js').then((module) => module.pauseSession());
  } else if (currentSessionStatus === 'finished') {
    const config = {
      mode: 'practice',
      limitType: 'time',
      limitValue: 0,
      minLapTime: parseFloat(minLapTime.value) || 3.0,
      maxLapTime: parseFloat(maxLapTime.value) || 25.0
    };
    const module = await import('./race.js');
    module.initSession(config, renderLeaderboard, updateTimerDisplay);
    module.startSession();
  } else {
    if (currentSessionStatus !== 'paused' && !connectionBadge.classList.contains('connected')) {
      if (activeSettings.hardwareType !== 'mock') {
        await handleConnectClick(e);
        if (!connectionBadge.classList.contains('connected')) {
          return; // Abort starting session if connection failed
        }
      }
    }
    import('./race.js').then((module) => module.startSession());
  }
}

/**
 * Session Stop.
 */
function handleSessionStop() {
  import('./race.js').then((module) => module.stopSession());
}

/**
 * Handle Resetting specific settings category
 */
function handleSettingsReset(category) {
  if (!window.confirm(`Are you sure you want to reset the ${category} settings to defaults?`)) {
    return;
  }

  if (category === 'session') {
    activeSettings.minLapTime = DEFAULT_SETTINGS.minLapTime;
    activeSettings.maxLapTime = DEFAULT_SETTINGS.maxLapTime;
  } else if (category === 'speech') {
    activeSettings.speechEnabled = DEFAULT_SETTINGS.speechEnabled;
    activeSettings.speechVolume = DEFAULT_SETTINGS.speechVolume;
    activeSettings.speechVoice = DEFAULT_SETTINGS.speechVoice;
    activeSettings.speechPitch = DEFAULT_SETTINGS.speechPitch;
    activeSettings.speechRate = DEFAULT_SETTINGS.speechRate;
    activeSettings.announcements = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.announcements));
  } else if (category === 'hardware') {
    activeSettings.hardwareType = DEFAULT_SETTINGS.hardwareType;
    activeSettings.connectAtStartup = DEFAULT_SETTINGS.connectAtStartup;
  } else if (category === 'streaks') {
    activeSettings.streak = JSON.parse(JSON.stringify(DEFAULT_SETTINGS.streak));
  }

  activeSettings = saveSettings(activeSettings);

  // Redraw the entire settings UI
  loadSettingsUI();
  populateSettingsView();
}

/**
 * Render the live leaderboard grid.
 */
function renderLeaderboard({ state, leaderboard }) {
  currentSessionStatus = state.status;

  // Sync title and subtitle status
  if (state.status === 'active') {
    sessionSubtitle.textContent = 'Active Running';
    btnSessionStart.innerHTML = '&#10074;&#10074;';
    btnSessionStart.className = 'btn btn-warning';
    btnSessionStart.title = 'Pause Session';
    btnSessionStop.style.display = 'inline-block';
  } else if (state.status === 'paused') {
    sessionSubtitle.textContent = 'Paused';
    btnSessionStart.innerHTML = '&#9658;';
    btnSessionStart.className = 'btn btn-success';
    btnSessionStart.title = 'Resume Session';
    btnSessionStop.style.display = 'inline-block';
  } else if (state.status === 'finished') {
    sessionSubtitle.textContent = 'Finished';
    btnSessionStart.innerHTML = '&#9658;';
    btnSessionStart.className = 'btn btn-success';
    btnSessionStart.title = 'Start Session';
    btnSessionStop.style.display = 'none';
  } else {
    sessionSubtitle.textContent = 'Ready to run';
    btnSessionStart.innerHTML = '&#9658;';
    btnSessionStart.className = 'btn btn-success';
    btnSessionStart.title = 'Start Session';
    btnSessionStop.style.display = 'none';
  }

  // Clear tables
  leaderboardBody.innerHTML = '';

  if (leaderboard.length === 0) {
    leaderboardBody.innerHTML = `
      <tr id="empty-leaderboard-row">
        <td colspan="9" style="text-align: center; color: var(--text-muted); padding: 4rem 0;">
          No lap data recorded yet. Pass a transponder under the bridge or start the mock simulator!
        </td>
      </tr>`;
    countCarsDisplay.textContent = '0';
    countLapsDisplay.textContent = '0';
  } else {
    countCarsDisplay.textContent = leaderboard.length;
    countLapsDisplay.textContent = state.lapsLogged;

    // Build rows
    leaderboard.forEach((racer, index) => {
      const position = index + 1;

      const isLeader = racer.gap === 'Leader';

      const row = document.createElement('tr');
      row.className = `leaderboard-row position-${position}`;

      // Style left border color of row based on racer theme color
      row.style.borderLeft = `4px solid ${racer.color}`;

      // Last lap classes (PB / Overall Best highlights)
      const lastLapObj = racer.laps.slice(-1)[0];
      let lastLapBadgeClass = 'lap-time-badge';
      if (lastLapObj) {
        if (lastLapObj.isOverallBest) lastLapBadgeClass += ' overall-best';
        else if (lastLapObj.isDriverSessionBest) lastLapBadgeClass += ' driver-session-best';
      }

      // Best lap classes
      let bestLapBadgeClass = 'lap-time-badge';
      const isOverallBestLap =
        racer.bestLap !== Infinity &&
        racer.laps.some((l) => l.isOverallBest && l.lapTime === racer.bestLap);
      if (isOverallBestLap) bestLapBadgeClass += ' overall-best';
      else if (racer.laps.some((l) => l.isDriverSessionBest && l.lapTime === racer.bestLap))
        bestLapBadgeClass += ' driver-session-best';

      const isUnknown = racer.carName === 'Unknown Car';
      const carDisplay = isUnknown
        ? `<div style="font-weight:600;">${racer.carName}</div><div style="font-size:0.75rem; color:var(--text-muted);">${racer.transponder}</div>`
        : `<div style="font-weight:600;">${racer.carName}</div>`;

      // Build driver display
      let driverCellContent = '';
      const assignedDriverId = state.assignments[racer.transponder];

      if (assignedDriverId) {
        driverCellContent = `
          <a href="#" class="leaderboard-driver-link" data-driverid="${assignedDriverId}" style="color: var(--accent-secondary); text-decoration: none; font-weight: 600; cursor: pointer;" title="View driver profile">${racer.name}</a>
        `;
      } else {
        let driverOptions = `<option value="">-- Unassigned --</option>`;
        getDrivers().forEach((d) => {
          driverOptions += `<option value="${d.id}">${d.name}</option>`;
        });
        driverCellContent = `
          <select class="leaderboard-driver-assign" data-transponder="${racer.transponder}" style="background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm); padding: 0.2rem; font-size: 0.85rem; width: 100%;">
            ${driverOptions}
          </select>
        `;
      }

      row.innerHTML = `
        <td><span class="pos-badge">${position}</span></td>
        <td>
          ${driverCellContent}
        </td>
        <td>
          ${carDisplay}
        </td>
        <td style="text-align: center;" class="mono">${racer.laps.length}</td>
        <td class="mono">
          ${lastLapObj ? `<span class="${lastLapBadgeClass}">${lastLapObj.lapTime.toFixed(2)}</span>` : '--'}
        </td>
        <td class="mono">
          ${racer.bestLap !== Infinity ? `<span class="${bestLapBadgeClass}">${racer.bestLap.toFixed(3)}</span>` : '--'}
        </td>
        <td style="text-align: center;">
          ${racer.longestStreak || '--'}
        </td>
        <td class="mono">${racer.laps.length > 0 ? racer.averageLap.toFixed(3) : '--'}</td>
        <td class="mono">${racer.laps.length > 0 ? racer.medianLap.toFixed(3) : '--'}</td>
        <td class="mono">${racer.laps.length > 1 ? racer.stdDev.toFixed(3) : '--'}</td>
        <td style="text-align: center;">
          <button class="btn leaderboard-car-remove" data-transponder="${racer.transponder}" style="padding: 0; background: transparent; color: var(--color-error); border: none; font-size: 1rem; line-height: 1; cursor: pointer;" title="Remove car from session">&times;</button>
        </td>
      `;

      // Bind driver column events
      if (assignedDriverId) {
        row.querySelector('.leaderboard-driver-link').addEventListener('click', (e) => {
          e.preventDefault();
          renderDriverDetails(assignedDriverId);
          switchView('view-driver-details');
        });
      } else {
        row.querySelector('.leaderboard-driver-assign').addEventListener('change', (e) => {
          import('./race.js').then((module) => {
            module.assignSessionDriver(racer.transponder, e.target.value);
          });
        });
      }

      row.querySelector('.leaderboard-car-remove').addEventListener('click', (e) => {
        import('./race.js').then((module) => {
          module.removeCarFromSession(racer.transponder);
        });
      });

      // Make car cell clickable to edit
      const carCell = row.children[2];
      carCell.style.cursor = 'pointer';
      carCell.title = 'Click to edit car';
      carCell.addEventListener('click', () => {
        const cars = getCars();
        const existingCar = cars.find((c) => c.transponder === racer.transponder);

        // Deselect tree items
        document.querySelectorAll('.tree-list li').forEach((el) => el.classList.remove('active'));

        if (existingCar) {
          renderCarDetails(racer.transponder);
          switchView('view-car-details');
        } else {
          document.getElementById('car-transponder').value = racer.transponder;
          document.getElementById('car-name').value = '';
          document.getElementById('car-name').focus();
          switchView('view-car-form');
        }
      });

      leaderboardBody.appendChild(row);
    });
  }

  // Live update details panels if visible
  if (
    document.getElementById('view-driver-details').classList.contains('active') &&
    selectedDriverId
  ) {
    renderDriverDetails(selectedDriverId);
  }
  if (document.getElementById('view-car-details').classList.contains('active') && selectedCarId) {
    renderCarDetails(selectedCarId);
  }

  // Update session chart
  renderSessionLapChart(leaderboard);
}

/**
 * Clock UI update.
 * Format: MM:SS.CC (Minutes, Seconds, Centiseconds)
 */
function updateTimerDisplay(elapsedMs) {
  let displayMs = elapsedMs;

  // Practice mode shows count-up timer

  const minutes = Math.floor(displayMs / 60000);
  const seconds = Math.floor((displayMs % 60000) / 1000);
  const centiseconds = Math.floor((displayMs % 1000) / 10);

  const minStr = minutes.toString().padStart(2, '0');
  const secStr = seconds.toString().padStart(2, '0');
  const csStr = centiseconds.toString().padStart(2, '0');

  timerDisplay.textContent = `${minStr}:${secStr}.${csStr}`;
}

/**
 * Form Submission -> Adds a new driver.
 */
function handleAddDriver(e) {
  e.preventDefault();

  const name = document.getElementById('driver-name').value.trim();
  const id = 'd_' + Date.now().toString(36);

  saveDriver({ id, name });
  document.getElementById('add-driver-form').reset();
  renderDriverList();
  renderCarList(); // Re-render cars so the new driver shows in dropdowns
  refreshActiveRacers(); // Update the leaderboard dropdowns
  switchView('view-session');
}

/**
 * Form Submission -> Adds a new car.
 */
function handleAddCar(e) {
  e.preventDefault();

  const name = document.getElementById('car-name').value.trim();
  const transponder = document.getElementById('car-transponder').value.trim().toUpperCase();
  const chassis = document.getElementById('car-chassis').value.trim();
  const color = document.getElementById('car-color').value;

  const car = {
    id: 'car_' + Date.now(),
    name,
    transponder,
    chassis,
    color,
    createdAt: Date.now()
  };

  saveCar(car);
  document.getElementById('add-car-form').reset();
  renderCarList();

  // Hot-reload profile in the active timing engine
  assignUnregisteredRacer(transponder, null, car.id);
  refreshActiveRacers();
  switchView('view-session');
}

/**
 * Render list of drivers.
 */
function renderDriverList() {
  const driverList = document.getElementById('driver-list');
  driverList.innerHTML = '';
  const drivers = getDrivers();

  if (drivers.length === 0) {
    driverList.innerHTML = `<li style="font-size:0.85rem; color:var(--text-muted); cursor:default; pointer-events:none;">No drivers added.</li>`;
    return;
  }

  drivers.forEach((d) => {
    const li = document.createElement('li');
    li.textContent = d.name;

    li.addEventListener('click', () => {
      document.querySelectorAll('.tree-list li').forEach((el) => el.classList.remove('active'));
      li.classList.add('active');
      renderDriverDetails(d.id);
      switchView('view-driver-details');
    });

    driverList.appendChild(li);
  });
}

/**
 * Render lists of cars in the configuration manager.
 */
function renderCarList() {
  const carList = document.getElementById('car-list');
  carList.innerHTML = '';
  const cars = getCars();

  if (cars.length === 0) {
    carList.innerHTML = `<li style="font-size:0.85rem; color:var(--text-muted); cursor:default; pointer-events:none;">No cars added.</li>`;
    return;
  }

  cars.forEach((c) => {
    const li = document.createElement('li');
    li.textContent = c.name;

    li.addEventListener('click', () => {
      document.querySelectorAll('.tree-list li').forEach((el) => el.classList.remove('active'));
      li.classList.add('active');
      renderCarDetails(c.transponder);
      switchView('view-car-details');
    });

    carList.appendChild(li);
  });
}



/**
 * Render Driver Details Panel (Stats, Laps, PRs)
 */
import { getLapsByDriverId, getLapsByCarId, deleteLap } from './db/idb_service.js';

async function renderDriverDetails(driverId) {
  const drivers = getDrivers();
  const cars = getCars();
  const driver = drivers.find((d) => d.id === driverId);
  if (!driver) return;
  if (selectedDriverId !== driver.id) {
    driverRecentLapsPage = 1;
    selectedDriverId = driver.id;
  }
  editDriverName.value = driver.name;

  deleteDriverConfirm.value = '';
  btnDeleteDriver.disabled = true;

  // Render Per-Car Stats
  const driverPerCarBody = document.getElementById('driver-per-car-body');
  driverPerCarBody.innerHTML = '';

  const laps = await getLapsByDriverId(driver.id);
  laps.sort((a, b) => a.timestamp - b.timestamp);
  
  if (laps.length === 0) {
    driverPerCarBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:var(--text-muted);">No laps logged</td></tr>`;
  } else {
    const getMedian = (times) => {
      if (times.length === 0) return 0;
      const sorted = [...times].sort((a, b) => a - b);
      const half = Math.floor(sorted.length / 2);
      if (sorted.length % 2 === 0) return (sorted[half - 1] + sorted[half]) / 2.0;
      return sorted[half];
    };

    const getStdDev = (times, avg) => {
      if (times.length < 2) return 0;
      const variance = times.reduce((sum, t) => sum + Math.pow(t - avg, 2), 0) / times.length;
      return Math.sqrt(variance);
    };

    const carStats = {};
    const overallTimes = [];
    let overallPr = Infinity;

    laps.forEach((lap) => {
      // lap.carId is now a UUID
      const car = cars.find(c => c.id === lap.carId);
      const carName = car ? car.name : 'Unknown Car';
      const carTransponder = car ? car.transponder : 'Unknown';
      
      if (!carStats[lap.carId]) {
        carStats[lap.carId] = {
          carId: lap.carId,
          carTransponder: carTransponder,
          carName: carName,
          lapTimes: [],
          pr: lap.lapTime
        };
      }
      const stat = carStats[lap.carId];
      stat.lapTimes.push(lap.lapTime);
      if (lap.lapTime < stat.pr) stat.pr = lap.lapTime;

      overallTimes.push(lap.lapTime);
      if (lap.lapTime < overallPr) overallPr = lap.lapTime;
    });

    // Overall Row
    const overallAvg = overallTimes.reduce((a, b) => a + b, 0) / overallTimes.length;
    const overallMedian = getMedian(overallTimes);
    const overallStdDev = getStdDev(overallTimes, overallAvg);

    const overallTr = document.createElement('tr');
    overallTr.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
    overallTr.innerHTML = `
      <td style="text-align: left; font-weight: 700; color: var(--accent-primary);">Overall</td>
      <td class="mono" style="color:var(--color-success); font-weight:bold; text-align: center;">${overallPr.toFixed(3)}</td>
      <td style="text-align: center;">${overallTimes.length}</td>
      <td class="mono" style="text-align: center;">${overallAvg.toFixed(3)}</td>
      <td class="mono" style="text-align: center;">${overallMedian.toFixed(3)}</td>
      <td class="mono" style="text-align: center; color: var(--text-muted);">&plusmn;${overallStdDev.toFixed(3)}</td>
      <td></td>
    `;
    driverPerCarBody.appendChild(overallTr);

    // Convert to array and sort by most laps run
    const carStatsArray = Object.values(carStats).sort((a, b) => b.lapTimes.length - a.lapTimes.length);

    carStatsArray.forEach((stat) => {
      const avg = stat.lapTimes.reduce((a, b) => a + b, 0) / stat.lapTimes.length;
      const median = getMedian(stat.lapTimes);
      const stdDev = getStdDev(stat.lapTimes, avg);

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align: left; font-weight: 500;">${stat.carName}</td>
        <td class="mono" style="color:var(--color-success); font-weight:bold; text-align: center;">${stat.pr.toFixed(3)}</td>
        <td style="text-align: center;">${stat.lapTimes.length}</td>
        <td class="mono" style="text-align: center;">${avg.toFixed(3)}</td>
        <td class="mono" style="text-align: center;">${median.toFixed(3)}</td>
        <td class="mono" style="text-align: center; color: var(--text-muted);">&plusmn;${stdDev.toFixed(3)}</td>
        <td><button class="btn delete-car-stats-btn" data-carid="${stat.carId}" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-car-stats-btn').addEventListener('click', () => {
        if (
          window.confirm(
            `Delete all laps for ${stat.carName} by this driver? This action cannot be undone.`
          )
        ) {
          deleteDriverCarStats(driverId, stat.carId);
          renderDriverDetails(driverId);
        }
      });
      driverPerCarBody.appendChild(tr);
    });
  }

  // Render the chart
  renderDriverLapChart(driver, laps);

  // Render PRs (Top 10 Fastest Laps)
  driverPrsBody.innerHTML = '';
  const prs = [...laps].sort((a, b) => a.lapTime - b.lapTime).slice(0, 10);
  
  if (prs.length === 0) {
    driverPrsBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No records yet</td></tr>`;
  } else {
    // Show top 10
    prs.slice(0, 10).forEach((pr) => {
      const tr = document.createElement('tr');
      const dateStr = new Date(pr.timestamp).toLocaleString();
      const car = cars.find(c => c.id === pr.carId);
      const carName = car ? car.name : 'Unknown Car';
      tr.innerHTML = `
        <td class="mono" style="color:var(--color-success); font-weight:bold;">${pr.lapTime.toFixed(3)}</td>
        <td>${carName}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" data-lapid="${pr.id}" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', async () => {
        if (window.confirm('Delete this lap entirely?')) {
          await deleteLap(pr.id);
          renderDriverDetails(driverId);
        }
      });
      driverPrsBody.appendChild(tr);
    });
  }

  // Render Laps
  driverLapsBody.innerHTML = '';
  if (laps.length === 0) {
    driverLapsBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No laps logged</td></tr>`;
    document.getElementById('driver-laps-page-info').textContent = `1 / 1`;
    document.getElementById('driver-laps-first').disabled = true;
    document.getElementById('driver-laps-prev').disabled = true;
    document.getElementById('driver-laps-next').disabled = true;
    document.getElementById('driver-laps-last').disabled = true;
  } else {
    const totalPages = Math.ceil(laps.length / 15);
    if (driverRecentLapsPage > totalPages) driverRecentLapsPage = totalPages;
    if (driverRecentLapsPage < 1) driverRecentLapsPage = 1;

    document.getElementById('driver-laps-page-info').textContent = `${driverRecentLapsPage} / ${totalPages}`;
    document.getElementById('driver-laps-first').disabled = driverRecentLapsPage === 1;
    document.getElementById('driver-laps-prev').disabled = driverRecentLapsPage === 1;
    document.getElementById('driver-laps-next').disabled = driverRecentLapsPage === totalPages;
    document.getElementById('driver-laps-last').disabled = driverRecentLapsPage === totalPages;

    const startIndex = (driverRecentLapsPage - 1) * 15;
    const paginatedLaps = laps.slice(startIndex, startIndex + 15);

    paginatedLaps.forEach((lap) => {
      const car = cars.find(c => c.id === lap.carId);
      const carName = car ? car.name : 'Unknown Car';
      const tr = document.createElement('tr');
      const dateStr = new Date(lap.timestamp).toLocaleString();
      tr.innerHTML = `
        <td class="mono">${lap.lapTime.toFixed(3)}</td>
        <td>${carName}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', async () => {
        if (window.confirm('Delete this lap entirely?')) {
          await deleteLap(lap.id);
          renderDriverDetails(driverId);
        }
      });
      driverLapsBody.appendChild(tr);
    });
  }
}

/**
 * Render a combined lap time distribution chart for the driver
 */
function renderDriverLapChart(driver, laps = []) {
  if (activeDriverChart) {
    activeDriverChart.destroy();
    activeDriverChart = null;
  }

  const canvas = document.getElementById('driver-overall-chart');
  if (!canvas) return;

  if (laps.length === 0) {
    return;
  }

  // Calculate median to trim long tail outliers
  const sortedTimes = laps.map((l) => l.lapTime).sort((a, b) => a - b);
  const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)];
  const maxAllowedTime = Math.max(medianTime * 1.5, medianTime + 5);

  // Find global min and max
  let minTime = Infinity;
  let maxTime = -Infinity;
  laps.forEach((lap) => {
    if (lap.lapTime < minTime) minTime = lap.lapTime;
    if (lap.lapTime > maxTime && lap.lapTime <= maxAllowedTime) {
      maxTime = lap.lapTime;
    }
  });

  if (maxTime === -Infinity) maxTime = sortedTimes[sortedTimes.length - 1];

  // Calculate sensible bucket size based on the spread
  const spread = maxTime - minTime;
  let bucketSize = 0.5;
  if (spread > 20) bucketSize = 1.0;
  if (spread > 50) bucketSize = 5.0;
  if (spread <= 5) bucketSize = 0.2;

  // Round boundaries
  minTime = Math.floor(minTime / bucketSize) * bucketSize;
  maxTime = Math.ceil(maxTime / bucketSize) * bucketSize;

  const labels = [];
  for (let t = minTime; t <= maxTime + bucketSize; t += bucketSize) {
    labels.push(t.toFixed(1) + 's');
  }

  // Helper to bucket laps
  const getFrequencies = (lapList) => {
    const freqs = new Array(labels.length).fill(0);
    lapList.forEach((lap) => {
      const bucketIndex = Math.floor((lap.lapTime - minTime) / bucketSize);
      if (bucketIndex >= 0 && bucketIndex < freqs.length) {
        freqs[bucketIndex]++;
      } else if (bucketIndex >= freqs.length) {
        freqs[freqs.length - 1]++;
      }
    });
    return freqs;
  };

  const datasets = [];

  // Overall dataset
  datasets.push({
    label: 'Overall',
    data: getFrequencies(laps),
    borderColor: 'rgba(255, 255, 255, 0.8)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    borderDash: [5, 5],
    fill: true,
    tension: 0.4
  });

  // Per-car datasets
  const carGroups = {};
  laps.forEach((lap) => {
    if (!carGroups[lap.carTransponder]) {
      carGroups[lap.carTransponder] = {
        name: lap.car,
        laps: []
      };
    }
    carGroups[lap.carTransponder].laps.push(lap);
  });

  const cars = getCars();

  for (const transponder in carGroups) {
    // if there's only 1 car, don't show an extra overlapping dataset
    if (Object.keys(carGroups).length === 1) break;

    const group = carGroups[transponder];
    const carObj = cars.find((c) => c.transponder === transponder);
    
    let hexColor = '#888888'; // Fallback gray
    if (carObj && carObj.color) {
      hexColor = carObj.color;
    }

    // Convert hex to rgba for background
    let r = 136, g = 136, b = 136;
    if (hexColor.startsWith('#') && hexColor.length === 7) {
      r = parseInt(hexColor.slice(1, 3), 16);
      g = parseInt(hexColor.slice(3, 5), 16);
      b = parseInt(hexColor.slice(5, 7), 16);
    }
    const bgStr = `rgba(${r}, ${g}, ${b}, 0.2)`;

    datasets.push({
      label: group.name,
      data: getFrequencies(group.laps),
      borderColor: hexColor,
      backgroundColor: bgStr,
      borderWidth: 2,
      fill: true,
      tension: 0.4
    });
  }

  // Create chart
  activeDriverChart = new window.Chart(canvas, {
    type: 'line',
    data: {
      labels: labels,
      datasets: datasets
    },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: '#94a3b8' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          title: { display: true, text: 'Number of Laps', color: '#94a3b8' }
        },
        x: {
          ticks: { color: '#94a3b8' },
          grid: { display: false },
          title: { display: true, text: 'Lap Time', color: '#94a3b8' }
        }
      },
      plugins: {
        legend: {
          labels: { color: '#e2e8f0' }
        }
      }
    }
  });
}

/**
 * Render Car Details Panel
 */
async function renderCarDetails(transponder) {
  const cars = getCars();
  const drivers = getDrivers();
  const car = cars.find((c) => c.transponder === transponder);
  if (!car) return;
  if (selectedCarId !== car.transponder) {
    selectedCarId = car.transponder;
  }

  editCarName.value = car.name;
  editCarTransponder.value = car.transponder;
  document.getElementById('edit-car-chassis').value = car.chassis || '';
  editCarColor.value = car.color;

  deleteCarConfirm.value = '';
  btnDeleteCar.disabled = true;

  // Render Best Lap per Driver
  const carDriversBody = document.getElementById('car-drivers-body');
  carDriversBody.innerHTML = '';

  const laps = await getLapsByCarId(car.transponder);
  laps.sort((a, b) => a.timestamp - b.timestamp);

  if (laps.length === 0) {
    carDriversBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No records yet</td></tr>`;
  } else {
    // Group by driverId
    const driverBests = {};
    laps.forEach((lap) => {
      const dId = lap.driverId || 'unknown';
      if (!driverBests[dId] || lap.lapTime < driverBests[dId].lapTime) {
        driverBests[dId] = lap;
      }
    });

    // Sort drivers by best time
    const sortedBests = Object.values(driverBests).sort((a, b) => a.lapTime - b.lapTime);

    sortedBests.forEach((best) => {
      const driver = drivers.find(d => d.id === best.driverId);
      const driverName = driver ? driver.name : 'Unknown Driver';
      const tr = document.createElement('tr');
      const dateStr = new Date(best.timestamp).toLocaleString();
      tr.innerHTML = `
        <td>${driverName}</td>
        <td class="mono" style="color:var(--color-success); font-weight:bold;">${best.lapTime.toFixed(3)}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', async () => {
        if (window.confirm('Delete this lap entirely?')) {
          await deleteLap(best.id);
          renderCarDetails(transponder);
        }
      });
      carDriversBody.appendChild(tr);
    });
  }

  // Render the chart
  renderCarLapChart(car, laps);

  // Render Top 10 Laps
  const carPrsBody = document.getElementById('car-prs-body');
  carPrsBody.innerHTML = '';
  const prs = [...laps].sort((a, b) => a.lapTime - b.lapTime).slice(0, 10);

  if (prs.length === 0) {
    carPrsBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No records yet</td></tr>`;
  } else {
    prs.slice(0, 10).forEach((pr) => {
      const driver = drivers.find(d => d.id === pr.driverId);
      const driverName = driver ? driver.name : 'Unknown Driver';
      const tr = document.createElement('tr');
      const dateStr = new Date(pr.timestamp).toLocaleString();
      tr.innerHTML = `
        <td class="mono" style="color:var(--color-success); font-weight:bold;">${pr.lapTime.toFixed(3)}</td>
        <td>${driverName}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', async () => {
        if (window.confirm('Delete this lap entirely?')) {
          await deleteLap(pr.id);
          renderCarDetails(transponder);
        }
      });
      carPrsBody.appendChild(tr);
    });
  }
}

/**
 * Render a combined lap time distribution chart for the car
 */
function renderCarLapChart(car, laps = []) {
  if (activeCarChart) {
    activeCarChart.destroy();
    activeCarChart = null;
  }

  const canvas = document.getElementById('car-overall-chart');
  if (!canvas) return;

  if (laps.length === 0) return;

  // Calculate median to trim long tail outliers
  const sortedTimes = laps.map((l) => l.lapTime).sort((a, b) => a - b);
  const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)];
  const maxAllowedTime = Math.max(medianTime * 1.5, medianTime + 5);

  let minTime = Infinity;
  let maxTime = -Infinity;
  laps.forEach((lap) => {
    if (lap.lapTime < minTime) minTime = lap.lapTime;
    if (lap.lapTime > maxTime && lap.lapTime <= maxAllowedTime) maxTime = lap.lapTime;
  });
  if (maxTime === -Infinity) maxTime = sortedTimes[sortedTimes.length - 1];

  const spread = maxTime - minTime;
  let bucketSize = 0.5;
  if (spread > 20) bucketSize = 1.0;
  if (spread > 50) bucketSize = 5.0;
  if (spread <= 5) bucketSize = 0.2;

  minTime = Math.floor(minTime / bucketSize) * bucketSize;
  maxTime = Math.ceil(maxTime / bucketSize) * bucketSize;

  const labels = [];
  for (let t = minTime; t <= maxTime + bucketSize; t += bucketSize) {
    labels.push(t.toFixed(1) + 's');
  }

  const getFrequencies = (lapList) => {
    const freqs = new Array(labels.length).fill(0);
    lapList.forEach((lap) => {
      const bucketIndex = Math.floor((lap.lapTime - minTime) / bucketSize);
      if (bucketIndex >= 0 && bucketIndex < freqs.length) freqs[bucketIndex]++;
      else if (bucketIndex >= freqs.length) freqs[freqs.length - 1]++;
    });
    return freqs;
  };

  const datasets = [];

  let hexColor = '#ffffff';
  if (car && car.color) {
    hexColor = car.color;
  }
  let r = 255, g = 255, b = 255;
  if (hexColor.startsWith('#') && hexColor.length === 7) {
    r = parseInt(hexColor.slice(1, 3), 16);
    g = parseInt(hexColor.slice(3, 5), 16);
    b = parseInt(hexColor.slice(5, 7), 16);
  }

  datasets.push({
    label: 'Overall',
    data: getFrequencies(laps),
    borderColor: hexColor,
    backgroundColor: `rgba(${r}, ${g}, ${b}, 0.1)`,
    borderWidth: 2,
    borderDash: [5, 5],
    fill: true,
    tension: 0.4
  });

  const drivers = getDrivers();
  const driverGroups = {};
  laps.forEach((lap) => {
    const driver = drivers.find(d => d.id === lap.driverId);
    const driverName = driver ? driver.name : 'Unknown Driver';
    if (!driverGroups[driverName]) driverGroups[driverName] = [];
    driverGroups[driverName].push(lap);
  });

  const colors = [
    { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
    { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
    { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
    { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' },
    { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' }
  ];

  let colorIdx = 0;
  for (const driverName in driverGroups) {
    if (Object.keys(driverGroups).length === 1) break;

    const groupLaps = driverGroups[driverName];
    const c = colors[colorIdx % colors.length];

    datasets.push({
      label: driverName,
      data: getFrequencies(groupLaps),
      borderColor: c.border,
      backgroundColor: c.bg,
      borderWidth: 2,
      fill: true,
      tension: 0.4
    });
    colorIdx++;
  }

  activeCarChart = new window.Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: '#94a3b8' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          title: { display: true, text: 'Number of Laps', color: '#94a3b8' }
        },
        x: {
          ticks: { color: '#94a3b8' },
          grid: { display: false },
          title: { display: true, text: 'Lap Time', color: '#94a3b8' }
        }
      },
      plugins: { legend: { labels: { color: '#e2e8f0' } } }
    }
  });
}

/**
 * Render a combined lap time distribution chart for the active session
 */
function renderSessionLapChart(leaderboard) {
  if (activeSessionChart) {
    activeSessionChart.destroy();
    activeSessionChart = null;
  }

  const canvas = document.getElementById('session-overall-chart');
  if (!canvas) return;

  // Flatten all laps from the leaderboard
  const laps = [];
  leaderboard.forEach(racer => {
    if (!racer.laps) return;
    racer.laps.forEach(lap => {
      laps.push({
        ...lap,
        driverName: racer.name || 'Unknown',
        carTransponder: racer.transponder
      });
    });
  });

  if (laps.length === 0) return;

  // Calculate median to trim long tail outliers
  const sortedTimes = laps.map((l) => l.lapTime).sort((a, b) => a - b);
  const medianTime = sortedTimes[Math.floor(sortedTimes.length / 2)];
  const maxAllowedTime = Math.max(medianTime * 1.5, medianTime + 5);

  let minTime = Infinity;
  let maxTime = -Infinity;
  laps.forEach((lap) => {
    if (lap.lapTime < minTime) minTime = lap.lapTime;
    if (lap.lapTime > maxTime && lap.lapTime <= maxAllowedTime) maxTime = lap.lapTime;
  });
  if (maxTime === -Infinity) maxTime = sortedTimes[sortedTimes.length - 1];

  const spread = maxTime - minTime;
  let bucketSize = 0.5;
  if (spread > 20) bucketSize = 1.0;
  if (spread > 50) bucketSize = 5.0;
  if (spread <= 5) bucketSize = 0.2;

  minTime = Math.floor(minTime / bucketSize) * bucketSize;
  maxTime = Math.ceil(maxTime / bucketSize) * bucketSize;

  const labels = [];
  for (let t = minTime; t <= maxTime + bucketSize; t += bucketSize) {
    labels.push(t.toFixed(1) + 's');
  }

  const getFrequencies = (lapList) => {
    const freqs = new Array(labels.length).fill(0);
    lapList.forEach((lap) => {
      const bucketIndex = Math.floor((lap.lapTime - minTime) / bucketSize);
      if (bucketIndex >= 0 && bucketIndex < freqs.length) freqs[bucketIndex]++;
      else if (bucketIndex >= freqs.length) freqs[freqs.length - 1]++;
    });
    return freqs;
  };

  const datasets = [];

  datasets.push({
    label: 'Overall Session',
    data: getFrequencies(laps),
    borderColor: 'rgba(255, 255, 255, 0.8)',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 2,
    borderDash: [5, 5],
    fill: true,
    tension: 0.4
  });

  const drivers = getDrivers();
  const driverGroups = {};
  laps.forEach((lap) => {
    const driver = drivers.find(d => d.id === lap.driverId);
    const driverName = driver ? driver.name : 'Unknown Driver';
    if (!driverGroups[driverName]) driverGroups[driverName] = [];
    driverGroups[driverName].push(lap);
  });

  const colors = [
    { border: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
    { border: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
    { border: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
    { border: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' },
    { border: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' }
  ];

  let colorIdx = 0;
  for (const driverName in driverGroups) {
    if (Object.keys(driverGroups).length === 1) break;

    const groupLaps = driverGroups[driverName];
    const c = colors[colorIdx % colors.length];

    datasets.push({
      label: driverName,
      data: getFrequencies(groupLaps),
      borderColor: c.border,
      backgroundColor: c.bg,
      borderWidth: 2,
      fill: true,
      tension: 0.4
    });
    colorIdx++;
  }

  activeSessionChart = new window.Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      animation: false,
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: '#94a3b8' },
          grid: { color: 'rgba(255, 255, 255, 0.1)' },
          title: { display: true, text: 'Number of Laps', color: '#94a3b8' }
        },
        x: {
          ticks: { color: '#94a3b8' },
          grid: { display: false },
          title: { display: true, text: 'Lap Time', color: '#94a3b8' }
        }
      },
      plugins: { legend: { labels: { color: '#e2e8f0' } } }
    }
  });
}

/**
 * PWA Service Worker Registration.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered successfully:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }
}

/**
 * Speech Notification Overlay Logic
 */
const speechOverlay = document.getElementById('speech-overlay');
let speechOverlayTimeout;

window.addEventListener('speech-started', (e) => {
  if (!speechOverlay || activeSettings.overlayEnabled === false) return;
  const text = e.detail.text;
  
  const toast = document.createElement('div');
  toast.className = 'speech-toast';
  toast.textContent = text;
  
  speechOverlay.appendChild(toast);
  
  // Keep only last 4
  while (speechOverlay.children.length > 4) {
    speechOverlay.removeChild(speechOverlay.firstChild);
  }
  
  speechOverlay.style.opacity = '1';
  
  const timeoutSecs = activeSettings.overlayTimeout || 12;
  
  clearTimeout(speechOverlayTimeout);
  speechOverlayTimeout = setTimeout(() => {
    speechOverlay.style.opacity = '0';
    setTimeout(() => {
      if (speechOverlay.style.opacity === '0') {
        speechOverlay.innerHTML = '';
      }
    }, 500); // Wait for transition to complete before clearing
  }, timeoutSecs * 1000); // Hide after configurable seconds of no speech
});
