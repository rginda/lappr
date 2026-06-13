const fs = require('fs');

let raceJs = fs.readFileSync('public/js/race.js', 'utf8');

const backupCode = `
/**
 * Backs up the current session assignments to localStorage.
 */
export function backupSessionState() {
  if (sessionState.status === 'running' || Object.keys(sessionState.assignments).length > 0) {
    localStorage.setItem('lappr-session-backup', JSON.stringify({
      timestamp: Date.now(),
      status: sessionState.status,
      assignments: sessionState.assignments
    }));
  } else {
    localStorage.removeItem('lappr-session-backup');
  }
}

/**
 * Recovers session assignments if less than a minute old.
 */
export function recoverSessionState() {
  try {
    const data = localStorage.getItem('lappr-session-backup');
    if (!data) return false;
    
    const backup = JSON.parse(data);
    if (Date.now() - backup.timestamp > 60000) {
      localStorage.removeItem('lappr-session-backup');
      return false;
    }
    
    if (backup.assignments) {
      for (const [transponder, driverId] of Object.entries(backup.assignments)) {
        if (driverId) {
          assignSessionDriver(transponder, driverId);
        }
      }
    }
    
    // We only recovered assignments. Do not auto-start the timer, let user do that.
    return true;
  } catch (err) {
    console.error('Recovery failed:', err);
    return false;
  }
}
`;

// Insert the exported functions into race.js
raceJs += backupCode;
fs.writeFileSync('public/js/race.js', raceJs);


let appJs = fs.readFileSync('public/js/app.js', 'utf8');

// Import the new functions
appJs = appJs.replace(
  "import {\n  initSession,",
  "import {\n  initSession,\n  backupSessionState,\n  recoverSessionState,"
);

// Add beforeunload event
const unloadCode = `
window.addEventListener('beforeunload', () => {
  backupSessionState();
});
`;
appJs = appJs.replace("document.addEventListener('DOMContentLoaded', async () => {", unloadCode + "\ndocument.addEventListener('DOMContentLoaded', async () => {");

// Call recoverSessionState if autoConnect is enabled
const autoConnectInit = `  // Handle hardware auto-connect
  if (activeSettings.connectAtStartup) {
    recoverSessionState();
    if (activeSettings.hardwareType === 'mock') {`;

appJs = appJs.replace("  // Handle hardware auto-connect\n  if (activeSettings.connectAtStartup) {\n    if (activeSettings.hardwareType === 'mock') {", autoConnectInit);

fs.writeFileSync('public/js/app.js', appJs);

console.log('Session recovery added.');
