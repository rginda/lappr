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
  assignDriverToCar,
  getSettings, 
  saveSettings 
} from './database.js';

import { 
  connectHID, 
  toggleSimulator, 
  disconnect 
} from './serial.js';

import { 
  initSession, 
  startSession, 
  stopSession, 
  clearSession, 
  processCrossing,
  onUnregisteredAlert,
  assignUnregisteredRacer
} from './race.js';

import { configureSpeech, speak } from './speech.js';

// DOM Elements
const btnConnect = document.getElementById('btn-connect');
const connectionBadge = document.getElementById('connection-badge');
const connectionStatusText = document.getElementById('connection-status-text');


const minLapTime = document.getElementById('min-lap-time');
const btnSessionStart = document.getElementById('btn-session-start');
const btnSessionReset = document.getElementById('btn-session-reset');

const addDriverForm = document.getElementById('add-driver-form');
const driverNameInput = document.getElementById('driver-name');
const driverList = document.getElementById('driver-list');

const addCarForm = document.getElementById('add-car-form');
const carNameInput = document.getElementById('car-name');
const carTransponderInput = document.getElementById('car-transponder');
const carColorSelect = document.getElementById('car-color');
const carList = document.getElementById('car-list');

const sessionTitle = document.getElementById('session-title');
const sessionSubtitle = document.getElementById('session-subtitle');
const timerDisplay = document.getElementById('session-timer-display');
const leaderboardBody = document.getElementById('leaderboard-body');
const countCarsDisplay = document.getElementById('leaderboard-count-cars');
const countLapsDisplay = document.getElementById('leaderboard-count-laps');

const btnHud = document.getElementById('btn-hud');
const speechToggle = document.getElementById('speech-toggle');
const speechVolume = document.getElementById('speech-volume');
const notificationsContainer = document.getElementById('notifications');

// Application State
let activeSettings = {};
let isHUDMode = false;
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
});

/**
 * Load settings from database and update UI components.
 */
function loadSettingsUI() {
  minLapTime.value = activeSettings.minLapTime;
  
  speechToggle.checked = activeSettings.speechEnabled;
  speechVolume.value = activeSettings.speechVolume;
  
  configureSpeech({
    enabled: activeSettings.speechEnabled,
    volume: activeSettings.speechVolume
  });

  handleSessionModeChange();
}

/**
 * Bind DOM Event Listeners.
 */
function bindEvents() {
  // Connection Events
  btnConnect.addEventListener('click', handleConnectClick);
  
  // Session Settings Events
  minLapTime.addEventListener('change', () => {
    saveActiveSettings();
    reinitSessionState();
  });
  
  // Session Action Events
  btnSessionStart.addEventListener('click', handleSessionStartToggle);
  btnSessionReset.addEventListener('click', handleSessionReset);
  
  // Form Events
  addDriverForm.addEventListener('submit', handleAddDriver);
  addCarForm.addEventListener('submit', handleAddCar);
  
  // Audio Controls
  speechToggle.addEventListener('change', (e) => {
    activeSettings.speechEnabled = e.target.checked;
    saveActiveSettings();
    configureSpeech({ enabled: e.target.checked });
  });
  
  speechVolume.addEventListener('input', (e) => {
    const vol = parseFloat(e.target.value);
    activeSettings.speechVolume = vol;
    saveActiveSettings();
    configureSpeech({ volume: vol });
  });
  
  // HUD mode
  btnHud.addEventListener('click', toggleHUDMode);

  // Unregistered transponder callback hooks
  onUnregisteredAlert(displayUnregisteredNotification);
}

/**
 * Initialize / Update Session parameters in the race engine.
 */
function reinitSessionState() {
  const config = {
    mode: 'practice',
    limitType: 'time',
    limitValue: 0,
    minLapTime: parseFloat(minLapTime.value)
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
    minLapTime: parseFloat(minLapTime.value),
    speechEnabled: speechToggle.checked,
    speechVolume: parseFloat(speechVolume.value)
  };
  activeSettings = saveSettings(settings);
}



/**
 * Hardware Connection Click.
 */
async function handleConnectClick(e) {
  if (btnConnect.textContent === 'Disconnect') {
    await disconnect(onStatusChange);
    return;
  }
  
  if (e.shiftKey) {
    toggleSimulator(true, onLineReceived, onStatusChange);
    return;
  }
  
  const baud = 38400; // Hardcoded default for EasyLap
  try {
    await connectHID(baud, onLineReceived, onStatusChange);
  } catch (err) {
    alert(`WebHID connection failed: ${err.message}`);
    btnConnect.disabled = false;
    btnConnect.textContent = 'Connect Lap Counter';
  }
}

/**
 * Connection Status update callback.
 * Synchronizes buttons and indicators based on active connections.
 */
function onStatusChange(status) {
  if (status.connected) {
    connectionBadge.className = 'status-indicator connected';
    connectionStatusText.textContent = status.name;
    btnSessionStart.disabled = false;
    
    btnConnect.textContent = 'Disconnect';
    btnConnect.className = 'btn btn-danger';
    btnConnect.disabled = false;
  } else {
    connectionBadge.className = 'status-indicator disconnected';
    connectionStatusText.textContent = 'Hardware Offline';
    btnSessionStart.disabled = true;
    
    btnConnect.textContent = 'Connect Lap Counter';
    btnConnect.className = 'btn btn-primary';
    btnConnect.disabled = false;
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
function handleSessionStartToggle() {
  if (currentSessionStatus === 'active') {
    stopSession();
  } else {
    startSession();
  }
}

/**
 * Session Reset.
 */
function handleSessionReset() {
  if (confirm('Are you sure you want to clear all lap times and reset the clock?')) {
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
        <td colspan="8" style="text-align: center; color: var(--text-muted); padding: 4rem 0;">
          No lap data recorded yet. Pass a transponder under the bridge or start the mock simulator!
        </td>
      </tr>`;
    countCarsDisplay.textContent = '0';
    countLapsDisplay.textContent = '0';
    return;
  }

  countCarsDisplay.textContent = leaderboard.length;
  countLapsDisplay.textContent = state.lapsLogged;

  // Build rows
  leaderboard.forEach((racer, index) => {
    const position = index + 1;
    const isFirst = position === 1;
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
    const isOverallBestLap = racer.bestLap !== Infinity && racer.laps.some(l => l.isOverallBest && l.lapTime === racer.bestLap);
    if (isOverallBestLap) bestLapBadgeClass += ' overall-best';
    else if (racer.laps.some(l => l.isPersonalBest && l.lapTime === racer.bestLap)) bestLapBadgeClass += ' personal-best';

    row.innerHTML = `
      <td><span class="pos-badge">${position}</span></td>
      <td>
        <div style="font-weight:700;">${racer.name}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">${racer.carName} (${racer.transponder})</div>
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
    
    row.style.cursor = 'pointer';
    row.title = 'Click to edit this car in the fleet manager';
    row.addEventListener('click', () => {
      carNameInput.value = racer.carName;
      carTransponderInput.value = racer.transponder;
      carColorSelect.value = racer.color;
      carNameInput.focus();
      carNameInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    
    leaderboardBody.appendChild(row);
  });
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
  
  const name = driverNameInput.value.trim();
  const id = 'd_' + Date.now().toString(36);
  
  saveDriver({ id, name });
  addDriverForm.reset();
  renderDriverList();
  renderCarList(); // Re-render cars so the new driver shows in dropdowns
}

/**
 * Form Submission -> Adds a new car.
 */
function handleAddCar(e) {
  e.preventDefault();
  
  const name = carNameInput.value.trim();
  const transponder = carTransponderInput.value.trim().toUpperCase();
  const color = carColorSelect.value;
  
  const car = {
    name,
    transponder,
    color,
    driverId: ''
  };
  
  saveCar(car);
  addCarForm.reset();
  renderCarList();
  
  // Hot-reload profile in the active timing engine
  assignUnregisteredRacer(transponder, name, color, 'Mini-Z');
  reinitSessionState();
}

/**
 * Render list of drivers.
 */
function renderDriverList() {
  driverList.innerHTML = '';
  const drivers = getDrivers();
  
  if (drivers.length === 0) {
    driverList.innerHTML = `<li style="font-size:0.85rem; color:var(--text-muted); text-align:center;">No drivers added.</li>`;
    return;
  }
  
  drivers.forEach(d => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.padding = '0.5rem 0.75rem';
    li.style.background = 'rgba(255,255,255,0.02)';
    li.style.border = '1px solid var(--border-color)';
    li.style.borderRadius = 'var(--radius-sm)';
    
    li.innerHTML = `
      <div style="font-weight:600; font-size:0.9rem;">${d.name}</div>
      <button class="btn btn-secondary delete-btn" data-id="${d.id}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--color-error); border-color: transparent;">Remove</button>
    `;
    
    li.querySelector('.delete-btn').addEventListener('click', (e) => {
      if (confirm('Delete this driver?')) {
        deleteDriver(e.target.getAttribute('data-id'));
        renderDriverList();
        renderCarList(); // Update dropdowns
        reinitSessionState();
      }
    });
    
    driverList.appendChild(li);
  });
}

/**
 * Render lists of cars in the configuration manager.
 */
function renderCarList() {
  carList.innerHTML = '';
  const cars = getCars();
  const drivers = getDrivers();
  
  if (cars.length === 0) {
    carList.innerHTML = `<li style="font-size:0.85rem; color:var(--text-muted); text-align:center;">No cars added.</li>`;
    return;
  }
  
  cars.forEach(c => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.padding = '0.5rem 0.75rem';
    li.style.background = 'rgba(255,255,255,0.02)';
    li.style.border = '1px solid var(--border-color)';
    li.style.borderRadius = 'var(--radius-sm)';
    li.style.borderLeft = `4px solid ${c.color}`;
    
    // Create Driver Dropdown Options
    let driverOptions = `<option value="">-- No Driver --</option>`;
    drivers.forEach(d => {
      const selected = (c.driverId === d.id) ? 'selected' : '';
      driverOptions += `<option value="${d.id}" ${selected}>${d.name}</option>`;
    });
    
    li.innerHTML = `
      <div style="flex: 1;">
        <div style="font-weight:600; font-size:0.9rem;">${c.name}</div>
        <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace; margin-bottom: 0.25rem;">${c.transponder}</div>
        <select class="driver-select" data-transponder="${c.transponder}" style="font-size: 0.75rem; padding: 0.1rem 0.25rem; width: 100%; max-width: 150px; background: rgba(0,0,0,0.2); border: 1px solid var(--border-color); color: var(--text-primary); border-radius: var(--radius-sm);">
          ${driverOptions}
        </select>
      </div>
      <button class="btn btn-secondary delete-btn" data-id="${c.transponder}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--color-error); border-color: transparent;">Remove</button>
    `;
    
    // Bind driver assignment change
    li.querySelector('.driver-select').addEventListener('change', (e) => {
      assignDriverToCar(c.transponder, e.target.value);
      reinitSessionState();
    });
    
    // Bind delete click
    li.querySelector('.delete-btn').addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      if (confirm('Delete this car?')) {
        deleteCar(id);
        renderCarList();
        reinitSessionState();
      }
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
 * Toggle Full-Screen Pit Lane HUD view.
 */
function toggleHUDMode() {
  const appRoot = document.getElementById('app-root');
  const mainGrid = document.querySelector('.app-grid');
  const sidebar = document.querySelector('.sidebar');
  
  isHUDMode = !isHUDMode;
  
  if (isHUDMode) {
    btnHud.textContent = 'Exit HUD';
    btnHud.className = 'btn btn-primary';
    sidebar.style.display = 'none';
    mainGrid.style.gridTemplateColumns = '1fr';
  } else {
    btnHud.textContent = 'HUD Mode';
    btnHud.className = 'btn btn-secondary';
    sidebar.style.display = 'flex';
    handleSessionModeChange(); // Restore columns layout
    mainGrid.style.gridTemplateColumns = '350px 1fr';
  }
}

/**
 * PWA Service Worker Registration.
 */
function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker registered successfully:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Service Worker registration failed:', err);
        });
    });
  }
}
