/**
 * Apex Timing - Application Controller
 * Connects UI elements, handles events, handles serial parsing,
 * and renders the leaderboard.
 */

import {
  getDrivers,
  saveDriver,
  deleteDriver,
  getCars,
  saveCar,
  deleteCar,
  deleteLap,
  deleteDriverCarStats,
  getSettings,
  saveSettings
} from './database.js';

import { connectHID, toggleSimulator, disconnect, autoConnectHID } from './serial.js';

import {
  initSession,
  backupSessionState,
  recoverSessionState,
  startSession,
  stopSession,
  clearSession,
  processCrossing,
  onUnregisteredAlert,
  assignUnregisteredRacer,
  refreshActiveRacers
} from './race.js';

import { configureSpeech } from './speech.js';

const connectionBadge = document.getElementById('connection-badge');
const connectionStatusText = document.getElementById('connection-status-text');

const minLapTime = document.getElementById('setting-min-lap-time');
const maxLapTime = document.getElementById('setting-max-lap-time');
const btnSessionStart = document.getElementById('btn-session-start');
const btnSessionReset = document.getElementById('btn-session-reset');

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

// DOM Elements: Car Details Form
const editCarName = document.getElementById('edit-car-name');
const editCarTransponder = document.getElementById('edit-car-transponder');
const editCarChassis = document.getElementById('edit-car-chassis');
const editCarColor = document.getElementById('edit-car-color');
const editCarChips = document.querySelectorAll('#view-car-details .color-chip');
const deleteCarConfirm = document.getElementById('delete-car-confirm');
const btnDeleteCar = document.getElementById('btn-delete-car');
let selectedCarId = null;

// Application State
let activeSettings = {};

let currentSessionStatus = 'ready';

/**
 * Initialize application.
 */
document.addEventListener('DOMContentLoaded', () => {
  activeSettings = getSettings();
  loadSettingsUI();
  renderDriverList();
  renderCarList();

  // Register service worker for PWA support
  registerServiceWorker();

  // Init Session state machine
  reinitSessionState();

  // Event listeners
  bindEvents();

  // Handle hardware auto-connect
  if (activeSettings.connectAtStartup) {
    recoverSessionState();
    if (activeSettings.hardwareType === 'mock') {
      toggleSimulator(true, onLineReceived, onStatusChange);
    } else {
      autoConnectHID(38400, onLineReceived, onStatusChange).then((connected) => {
        if (!connected) {
          console.warn('Auto-connect HID failed. User gesture may be required first.');
        }
      });
    }
  }
});

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

  // Session Settings Events
  const handleSessionSettingChange = () => {
    saveActiveSettings();
    reinitSessionState();

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
  btnSessionReset.addEventListener('click', handleSessionReset);

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

  btnDeleteCar.addEventListener('click', () => {
    if (selectedCarId && !btnDeleteCar.disabled) {
      deleteCar(selectedCarId);
      selectedCarId = null;
      renderCarList();
      refreshActiveRacers();
      switchView('view-session');
    }
  });

  // Unregistered transponder callback hooks
  onUnregisteredAlert(displayUnregisteredNotification);

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

    // Also update activeSettings immediately for the session
    activeSettings.speechEnabled = settings.speechEnabled;
    activeSettings.speechVolume = settings.speechVolume;
    activeSettings.speechVoice = settings.speechVoice;
    activeSettings.speechPitch = settings.speechPitch;
    activeSettings.speechRate = settings.speechRate;

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
      driverBestEver: document.getElementById('setting-speech-best-ever').value.trim(),
      carRecord: document.getElementById('setting-speech-car-record').value.trim(),
      driverCarPR: document.getElementById('setting-speech-driver-car-pr').value.trim(),
      sessionFastest: document.getElementById('setting-speech-session-fastest').value.trim(),
      personalBest: document.getElementById('setting-speech-personal-best').value.trim(),
      normal: document.getElementById('setting-speech-normal').value.trim(),
      consistent: document.getElementById('setting-speech-consistent').value.trim()
    };
    settings.streak = {
      minLaps: parseInt(document.getElementById('setting-streak-min-laps').value) || 3,
      varianceThreshold:
        parseFloat(document.getElementById('setting-streak-variance').value) || 0.1,
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
  document.getElementById('setting-speech-best-ever').value = ann.driverBestEver || '';
  document.getElementById('setting-speech-car-record').value = ann.carRecord || '';
  document.getElementById('setting-speech-driver-car-pr').value = ann.driverCarPR || '';
  document.getElementById('setting-speech-session-fastest').value = ann.sessionFastest || '';
  document.getElementById('setting-speech-personal-best').value = ann.personalBest || '';
  document.getElementById('setting-speech-normal').value = ann.normal || '';
  document.getElementById('setting-speech-consistent').value = ann.consistent || '';

  const streak = settings.streak || {};
  document.getElementById('setting-streak-min-laps').value = streak.minLaps || 3;
  document.getElementById('setting-streak-variance').value = streak.varianceThreshold || 0.1;
  document.getElementById('setting-streak-fast-only').checked = streak.mustBeFast !== false;
}

/**
 * Initialize / Update Session parameters in the race engine.
 */
function reinitSessionState() {
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
 * Session Start/Stop Toggle.
 */
async function handleSessionStartToggle(e) {
  if (currentSessionStatus === 'active') {
    stopSession();
  } else {
    if (!connectionBadge.classList.contains('connected')) {
      await handleConnectClick(e);
      if (!connectionBadge.classList.contains('connected')) {
        return; // Abort starting session if connection failed
      }
    }
    startSession();
  }
}

/**
 * Session Reset.
 */
function handleSessionReset() {
  if (window.confirm('Are you sure you want to clear all lap times and reset the clock?')) {
    clearSession();
  }
}

/**
 * Render the live leaderboard grid.
 */
function renderLeaderboard({ state, leaderboard }) {
  currentSessionStatus = state.status;

  // Sync title and subtitle status
  if (state.status === 'active') {
    sessionSubtitle.textContent = 'Active Running';
    btnSessionStart.textContent = 'Stop Session';
    btnSessionStart.className = 'btn btn-danger';
  } else if (state.status === 'finished') {
    sessionSubtitle.textContent = 'Finished';
    btnSessionStart.textContent = 'Start Session';
    btnSessionStart.className = 'btn btn-success';
  } else {
    sessionSubtitle.textContent = 'Ready to run';
    btnSessionStart.textContent = 'Start Session';
    btnSessionStart.className = 'btn btn-success';
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
        else if (lastLapObj.isPersonalBest) lastLapBadgeClass += ' personal-best';
      }

      // Best lap classes
      let bestLapBadgeClass = 'lap-time-badge';
      const isOverallBestLap =
        racer.bestLap !== Infinity &&
        racer.laps.some((l) => l.isOverallBest && l.lapTime === racer.bestLap);
      if (isOverallBestLap) bestLapBadgeClass += ' overall-best';
      else if (racer.laps.some((l) => l.isPersonalBest && l.lapTime === racer.bestLap))
        bestLapBadgeClass += ' personal-best';

      const isUnknown = racer.carName === 'Unknown Car';
      const carDisplay = isUnknown
        ? `<div style="font-weight:600;">${racer.carName}</div><div style="font-size:0.75rem; color:var(--text-muted);">${racer.transponder}</div>`
        : `<div style="font-weight:600;">${racer.carName}</div>`;

      // Build driver display
      let driverCellContent = '';
      const assignedDriverId = state.assignments[racer.transponder];

      if (assignedDriverId) {
        driverCellContent = `
          <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
            <a href="#" class="leaderboard-driver-link" data-driverid="${assignedDriverId}" style="color: var(--accent-secondary); text-decoration: none; font-weight: 600; cursor: pointer;" title="View driver profile">${racer.name}</a>
            <button class="btn leaderboard-driver-unassign" data-transponder="${racer.transponder}" style="padding: 0; background: transparent; color: var(--color-error); border: none; font-size: 1rem; line-height: 1; cursor: pointer; margin-left: 0.5rem;" title="Unassign driver">&times;</button>
          </div>
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
          ${racer.laps.length >= 3 ? `<span style="color:var(--color-success); font-weight:bold;">&check;</span>` : '--'}
        </td>
        <td class="mono">${racer.laps.length > 1 ? `${racer.consistency}%` : '--'}</td>
        <td style="text-align: right;" class="mono ${isLeader ? 'gold' : ''}">${racer.gap}</td>
      `;

      // Bind driver column events
      if (assignedDriverId) {
        row.querySelector('.leaderboard-driver-link').addEventListener('click', (e) => {
          e.preventDefault();
          renderDriverDetails(assignedDriverId);
          switchView('view-driver-details');
        });

        row.querySelector('.leaderboard-driver-unassign').addEventListener('click', (e) => {
          import('./race.js').then((module) => {
            module.assignSessionDriver(racer.transponder, '');
          });
        });
      } else {
        row.querySelector('.leaderboard-driver-assign').addEventListener('change', (e) => {
          import('./race.js').then((module) => {
            module.assignSessionDriver(racer.transponder, e.target.value);
          });
        });
      }

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
    name,
    transponder,
    chassis,
    color,
    driverId: ''
  };

  saveCar(car);
  document.getElementById('add-car-form').reset();
  renderCarList();

  // Hot-reload profile in the active timing engine
  assignUnregisteredRacer(transponder, name, color, 'Mini-Z');
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
 * Float notifications for unregistered transponder tags.
 */
function displayUnregisteredNotification(transponderId) {
  const alertCard = document.createElement('div');
  alertCard.className = 'notification';
  alertCard.innerHTML = `
    <div>
      <div style="font-weight:bold; font-size:0.9rem;">New Transponder Detected</div>
      <div style="font-size:0.8rem; font-family:monospace; color:var(--accent-secondary);">${transponderId}</div>
    </div>
    <button class="btn btn-primary assign-btn" style="padding: 0.4rem 0.8rem; font-size:0.8rem;">
      Assign
    </button>
  `;

  // Bind assign click
  alertCard.querySelector('.assign-btn').addEventListener('click', () => {
    carTransponderInput.value = transponderId;
    carNameInput.focus();
    alertCard.remove();
  });

  // Autoclose notification after 15 seconds
  setTimeout(() => {
    alertCard.remove();
  }, 15000);

  notificationsContainer.appendChild(alertCard);
}

/**
 * Render Driver Details Panel (Stats, Laps, PRs)
 */
function renderDriverDetails(driverId) {
  const drivers = getDrivers();
  const driver = drivers.find((d) => d.id === driverId);
  if (!driver) return;

  selectedDriverId = driver.id;
  editDriverName.value = driver.name;

  deleteDriverConfirm.value = '';
  btnDeleteDriver.disabled = true;

  // Render Per-Car Stats
  const driverPerCarBody = document.getElementById('driver-per-car-body');
  driverPerCarBody.innerHTML = '';

  const laps = driver.laps || [];
  if (laps.length === 0) {
    driverPerCarBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No laps logged</td></tr>`;
  } else {
    const carStats = {};
    laps.forEach((lap) => {
      if (!carStats[lap.carTransponder]) {
        carStats[lap.carTransponder] = {
          carTransponder: lap.carTransponder,
          carName: lap.car,
          lapsRun: 0,
          totalTime: 0,
          pr: lap.lapTime
        };
      }
      const stat = carStats[lap.carTransponder];
      stat.lapsRun++;
      stat.totalTime += lap.lapTime;
      if (lap.lapTime < stat.pr) stat.pr = lap.lapTime;
    });

    // Convert to array and sort by most laps run
    const carStatsArray = Object.values(carStats).sort((a, b) => b.lapsRun - a.lapsRun);

    carStatsArray.forEach((stat) => {
      const avg = stat.totalTime / stat.lapsRun;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td style="text-align: left; font-weight: 500;">${stat.carName}</td>
        <td class="mono" style="color:var(--color-success); font-weight:bold; text-align: center;">${stat.pr.toFixed(3)}</td>
        <td style="text-align: center;">${stat.lapsRun}</td>
        <td class="mono" style="text-align: center;">${avg.toFixed(3)}</td>
        <td><button class="btn delete-car-stats-btn" data-cartransponder="${stat.carTransponder}" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-car-stats-btn').addEventListener('click', () => {
        if (
          window.confirm(
            `Delete all laps for ${stat.carName} by this driver? This action cannot be undone.`
          )
        ) {
          deleteDriverCarStats(driverId, stat.carTransponder);
          renderDriverDetails(driverId);
        }
      });
      driverPerCarBody.appendChild(tr);
    });
  }

  // Render PRs
  driverPrsBody.innerHTML = '';
  const prs = driver.prs || [];
  if (prs.length === 0) {
    driverPrsBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No records yet</td></tr>`;
  } else {
    // Show top 10
    prs.slice(0, 10).forEach((pr) => {
      const tr = document.createElement('tr');
      const dateStr = new Date(pr.timestamp).toLocaleString();
      tr.innerHTML = `
        <td class="mono" style="color:var(--color-success); font-weight:bold;">${pr.lapTime.toFixed(3)}</td>
        <td>${pr.car}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" data-lapid="${pr.id}" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', () => {
        if (window.confirm('Delete this lap entirely?')) {
          deleteLap(pr.id);
          renderDriverDetails(driverId);
        }
      });
      driverPrsBody.appendChild(tr);
    });
  }

  // Render Laps
  driverLapsBody.innerHTML = '';
  if (laps.length === 0) {
    driverLapsBody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--text-muted);">No laps logged</td></tr>`;
  } else {
    laps.forEach((lap) => {
      const tr = document.createElement('tr');
      const dateStr = new Date(lap.timestamp).toLocaleString();
      tr.innerHTML = `
        <td class="mono">${lap.lapTime.toFixed(3)}</td>
        <td>${lap.car}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', () => {
        if (window.confirm('Delete this lap entirely?')) {
          deleteLap(lap.id);
          renderDriverDetails(driverId);
        }
      });
      driverLapsBody.appendChild(tr);
    });
  }
}

/**
 * Render Car Details Panel
 */
function renderCarDetails(transponder) {
  const cars = getCars();
  const car = cars.find((c) => c.transponder === transponder);
  if (!car) return;

  selectedCarId = car.transponder;

  editCarName.value = car.name;
  editCarTransponder.value = car.transponder;
  document.getElementById('edit-car-chassis').value = car.chassis || '';
  editCarColor.value = car.color;

  deleteCarConfirm.value = '';
  btnDeleteCar.disabled = true;

  // Render Best Lap per Driver
  const carDriversBody = document.getElementById('car-drivers-body');
  carDriversBody.innerHTML = '';

  const laps = car.laps || [];

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
      const tr = document.createElement('tr');
      const dateStr = new Date(best.timestamp).toLocaleString();
      tr.innerHTML = `
        <td>${best.driverName}</td>
        <td class="mono" style="color:var(--color-success); font-weight:bold;">${best.lapTime.toFixed(3)}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', () => {
        if (window.confirm('Delete this lap entirely?')) {
          deleteLap(best.id);
          renderCarDetails(transponder);
        }
      });
      carDriversBody.appendChild(tr);
    });
  }

  // Render Top 10 Laps
  const carPrsBody = document.getElementById('car-prs-body');
  carPrsBody.innerHTML = '';
  const prs = car.prs || [];
  if (prs.length === 0) {
    carPrsBody.innerHTML = `<tr><td colspan="4" style="text-align:center; color:var(--text-muted);">No records yet</td></tr>`;
  } else {
    prs.slice(0, 10).forEach((pr) => {
      const tr = document.createElement('tr');
      const dateStr = new Date(pr.timestamp).toLocaleString();
      tr.innerHTML = `
        <td class="mono" style="color:var(--color-success); font-weight:bold;">${pr.lapTime.toFixed(3)}</td>
        <td>${pr.driverName}</td>
        <td style="font-size:0.75rem; color:var(--text-muted);">${dateStr}</td>
        <td><button class="btn delete-lap-btn" style="padding: 0.2rem 0.5rem; font-size: 0.7rem; background:transparent; color:var(--color-error);">&times;</button></td>
      `;
      tr.querySelector('.delete-lap-btn').addEventListener('click', () => {
        if (window.confirm('Delete this lap entirely?')) {
          deleteLap(pr.id);
          renderCarDetails(transponder);
        }
      });
      carPrsBody.appendChild(tr);
    });
  }
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
