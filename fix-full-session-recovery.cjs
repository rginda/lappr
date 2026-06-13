const fs = require('fs');

let raceJs = fs.readFileSync('public/js/race.js', 'utf8');

const backupCode = `export function backupSessionState() {
  if (sessionState.status === 'active' || Object.keys(sessionState.assignments).length > 0) {
    localStorage.setItem(
      'lappr-session-backup',
      JSON.stringify({
        timestamp: Date.now(),
        status: sessionState.status,
        assignments: sessionState.assignments,
        racers: sessionState.racers,
        lapsLogged: sessionState.lapsLogged,
        sessionElapsedTime: sessionState.status === 'active' ? performance.now() - sessionState.startTime : null
      })
    );
  } else {
    localStorage.removeItem('lappr-session-backup');
  }
}`;

raceJs = raceJs.replace(/export function backupSessionState\(\) \{[\s\S]*?\}\n/m, backupCode + '\n');


const recoverCode = `export function recoverSessionState() {
  try {
    const data = localStorage.getItem('lappr-session-backup');
    if (!data) return { recovered: false, wasRunning: false };

    const backup = JSON.parse(data);
    if (Date.now() - backup.timestamp > 60000) {
      localStorage.removeItem('lappr-session-backup');
      return { recovered: false, wasRunning: false };
    }

    if (backup.assignments) {
      for (const [transponder, driverId] of Object.entries(backup.assignments)) {
        if (driverId) {
          assignSessionDriver(transponder, driverId);
        }
      }
    }

    if (backup.racers) {
      sessionState.racers = backup.racers;
      sessionState.lapsLogged = backup.lapsLogged || 0;
      if (backup.sessionElapsedTime != null) {
        sessionState.startTime = performance.now() - backup.sessionElapsedTime;
      }
      sortLeaderboard();
      triggerUpdate();
    }

    return { recovered: true, wasRunning: backup.status === 'active' };
  } catch (err) {
    console.error('Recovery failed:', err);
    return { recovered: false, wasRunning: false };
  }
}`;

raceJs = raceJs.replace(/export function recoverSessionState\(\) \{[\s\S]*?\n\}/m, recoverCode);

fs.writeFileSync('public/js/race.js', raceJs);
console.log('Fixed full session recovery');
