/**
 * Apex Timing - Application Controller
 * Connects UI elements, handles events, handles serial parsing,
 * and renders the leaderboard.
 */

import { 
  getRacers, 
  saveRacer, 
  deleteRacer, 
  getSettings, 
  saveSettings 
} from './database.js';

import { 
  connectSerial, 
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
const baudRateSelect = document.getElementById('baud-rate-select');
const btnConnectSerial = document.getElementById('btn-connect-serial');
const btnConnectHID = document.getElementById('btn-connect-hid');
const simulatorToggle = document.getElementById('simulator-toggle');
const connectionBadge = document.getElementById('connection-badge');
const connectionStatusText = document.getElementById('connection-status-text');

const sessionModeSelect = document.getElementById('session-mode-select');
const raceSettingsSubpanel = document.getElementById('race-settings-subpanel');
const sessionLimitType = document.getElementById('session-limit-type');
const sessionLimitLabel = document.getElementById('session-limit-label');
const sessionLimitVal = document.getElementById('session-limit-val');
const minLapTime = document.getElementById('min-lap-time');
const btnSessionStart = document.getElementById('btn-session-start');
const btnSessionReset = document.getElementById('btn-session-reset');

const addRacerForm = document.getElementById('add-racer-form');
const racerNameInput = document.getElementById('racer-name');
const racerTransponderInput = document.getElementById('racer-transponder');
const racerColorSelect = document.getElementById('racer-color');
const racerList = document.getElementById('racer-list');

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
  renderRacerList();
  
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
  baudRateSelect.value = activeSettings.baudRate;
  sessionModeSelect.value = activeSettings.sessionMode;
  sessionLimitType.value = activeSettings.limitType;
  sessionLimitVal.value = activeSettings.limitValue;
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
  btnConnectSerial.addEventListener('click', handleConnectSerial);
  btnConnectHID.addEventListener('click', handleConnectHID);
  simulatorToggle.addEventListener('change', handleSimulatorToggle);
  
  // Session Settings Events
  sessionModeSelect.addEventListener('change', () => {
    handleSessionModeChange();
    saveActiveSettings();
    reinitSessionState();
  });
  sessionLimitType.addEventListener('change', () => {
    handleLimitTypeChange();
    saveActiveSettings();
    reinitSessionState();
  });
  sessionLimitVal.addEventListener('change', () => {
    saveActiveSettings();
    reinitSessionState();
  });
  minLapTime.addEventListener('change', () => {
    saveActiveSettings();
    reinitSessionState();
  });
  
  // Session Action Events
  btnSessionStart.addEventListener('click', handleSessionStartToggle);
  btnSessionReset.addEventListener('click', handleSessionReset);
  
  // Racer Form Events
  addRacerForm.addEventListener('submit', handleAddRacer);
  
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
    mode: sessionModeSelect.value,
    limitType: sessionLimitType.value,
    limitValue: parseFloat(sessionLimitVal.value),
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
    baudRate: parseInt(baudRateSelect.value),
    sessionMode: sessionModeSelect.value,
    limitType: sessionLimitType.value,
    limitValue: parseFloat(sessionLimitVal.value),
    minLapTime: parseFloat(minLapTime.value),
    speechEnabled: speechToggle.checked,
    speechVolume: parseFloat(speechVolume.value)
  };
  activeSettings = saveSettings(settings);
}

/**
 * Handles UI layout updates when session mode changes.
 */
function handleSessionModeChange() {
  const mode = sessionModeSelect.value;
  if (mode === 'practice') {
    raceSettingsSubpanel.style.display = 'none';
  } else {
    raceSettingsSubpanel.style.display = 'block';
  }
}

/**
 * Handles UI layout updates when limit type changes (Time vs Laps).
 */
function handleLimitTypeChange() {
  const type = sessionLimitType.value;
  if (type === 'time') {
    sessionLimitLabel.textContent = 'Duration (Minutes)';
    sessionLimitVal.value = 5;
  } else {
    sessionLimitLabel.textContent = 'Target Laps';
    sessionLimitVal.value = 50;
  }
}

/**
 * Hardware Serial Connection Click.
 */
async function handleConnectSerial() {
  if (btnConnectSerial.textContent === 'Disconnect') {
    await disconnect(onStatusChange);
    return;
  }
  
  const baud = parseInt(baudRateSelect.value);
  btnConnectSerial.disabled = true;
  btnConnectSerial.textContent = 'Connecting...';
  
  try {
    await connectSerial(baud, onLineReceived, onStatusChange);
  } catch (err) {
    alert(`Web Serial failed: ${err.message}`);
    btnConnectSerial.disabled = false;
    btnConnectSerial.textContent = 'Web Serial';
  }
}

/**
 * Hardware WebHID Connection Click.
 */
async function handleConnectHID() {
  if (btnConnectHID.textContent === 'Disconnect') {
    await disconnect(onStatusChange);
    return;
  }
  
  btnConnectHID.disabled = true;
  btnConnectHID.textContent = 'Connecting...';
  
  const baud = parseInt(baudRateSelect.value);
  try {
    await connectHID(baud, onLineReceived, onStatusChange);
  } catch (err) {
    alert(`WebHID connection failed: ${err.message}`);
    btnConnectHID.disabled = false;
    btnConnectHID.textContent = 'WebHID (CP2110)';
  }
}

/**
 * Simulator Checkbox toggle logic.
 */
function handleSimulatorToggle(e) {
  const isChecked = e.target.checked;
  toggleSimulator(isChecked, onLineReceived, onStatusChange);
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
    
    if (status.type === 'serial') {
      btnConnectSerial.textContent = 'Disconnect';
      btnConnectSerial.className = 'btn btn-danger';
      btnConnectSerial.disabled = false;
      btnConnectHID.disabled = true;
      simulatorToggle.checked = false;
    } else if (status.type === 'hid') {
      btnConnectHID.textContent = 'Disconnect';
      btnConnectHID.className = 'btn btn-danger';
      btnConnectHID.disabled = false;
      btnConnectSerial.disabled = true;
      simulatorToggle.checked = false;
    } else if (status.type === 'simulator') {
      btnConnectSerial.disabled = true;
      btnConnectHID.disabled = true;
      simulatorToggle.checked = true;
    }
  } else {
    connectionBadge.className = 'status-indicator disconnected';
    connectionStatusText.textContent = 'Hardware Offline';
    btnSessionStart.disabled = true;
    
    btnConnectSerial.textContent = 'Web Serial';
    btnConnectSerial.className = 'btn btn-primary';
    btnConnectSerial.disabled = false;
    
    btnConnectHID.textContent = 'WebHID (CP2110)';
    btnConnectHID.className = 'btn btn-secondary';
    btnConnectHID.disabled = false;
    
    simulatorToggle.checked = false;
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
        <div style="font-size:0.75rem; color:var(--text-muted);">${racer.vehicle} (${racer.transponder})</div>
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
    
    leaderboardBody.appendChild(row);
  });
}

/**
 * Clock UI update.
 * Format: MM:SS.CC (Minutes, Seconds, Centiseconds)
 */
function updateTimerDisplay(elapsedMs) {
  let displayMs = elapsedMs;

  // If session is a Time-limited Race/Qualifying, show count-down instead of count-up
  const mode = sessionModeSelect.value;
  const limitType = sessionLimitType.value;
  const limitVal = parseFloat(sessionLimitVal.value);
  
  if (mode !== 'practice' && limitType === 'time') {
    const maxMs = limitVal * 60 * 1000;
    displayMs = Math.max(0, maxMs - elapsedMs);
  }

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
function handleAddRacer(e) {
  e.preventDefault();
  
  const name = racerNameInput.value.trim();
  const transponder = racerTransponderInput.value.trim().toUpperCase();
  const color = racerColorSelect.value;
  
  const racer = {
    name,
    transponder,
    color,
    vehicle: 'Mini-Z'
  };
  
  saveRacer(racer);
  
  addRacerForm.reset();
  renderRacerList();
  
  // Hot-reload profile in the active timing engine
  assignUnregisteredRacer(transponder, name, color, racer.vehicle);
  reinitSessionState();
}

/**
 * Render lists of drivers in the configuration manager.
 */
function renderRacerList() {
  racerList.innerHTML = '';
  const racers = getRacers();
  
  if (racers.length === 0) {
    racerList.innerHTML = `<li style="font-size:0.85rem; color:var(--text-muted); text-align:center;">No racers added.</li>`;
    return;
  }
  
  racers.forEach(r => {
    const li = document.createElement('li');
    li.style.display = 'flex';
    li.style.justifyContent = 'space-between';
    li.style.alignItems = 'center';
    li.style.padding = '0.5rem 0.75rem';
    li.style.background = 'rgba(255,255,255,0.02)';
    li.style.border = '1px solid var(--border-color)';
    li.style.borderRadius = 'var(--radius-sm)';
    li.style.borderLeft = `4px solid ${r.color}`;
    
    li.innerHTML = `
      <div>
        <div style="font-weight:600; font-size:0.9rem;">${r.name}</div>
        <div style="font-size:0.75rem; color:var(--text-muted); font-family:monospace;">${r.transponder}</div>
      </div>
      <button class="btn btn-secondary delete-btn" data-id="${r.transponder}" style="padding: 0.25rem 0.5rem; font-size: 0.75rem; color: var(--color-error); border-color: transparent;">
        Remove
      </button>
    `;
    
    // Bind delete click
    li.querySelector('.delete-btn').addEventListener('click', (e) => {
      const id = e.target.getAttribute('data-id');
      if (confirm('Delete this racer?')) {
        deleteRacer(id);
        renderRacerList();
        reinitSessionState();
      }
    });
    
    racerList.appendChild(li);
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
    racerTransponderInput.value = transponderId;
    racerNameInput.focus();
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
