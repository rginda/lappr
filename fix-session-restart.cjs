const fs = require('fs');

let raceJs = fs.readFileSync('public/js/race.js', 'utf8');

raceJs = raceJs.replace(
  "return true;\n  } catch (err) {",
  "return { recovered: true, wasRunning: backup.status === 'running' };\n  } catch (err) {"
);
raceJs = raceJs.replace(
  "if (!data) return false;",
  "if (!data) return { recovered: false, wasRunning: false };"
);
raceJs = raceJs.replace(
  "return false;\n    }\n    \n    if (backup.assignments)",
  "return { recovered: false, wasRunning: false };\n    }\n    \n    if (backup.assignments)"
);
raceJs = raceJs.replace(
  "return false;\n  }",
  "return { recovered: false, wasRunning: false };\n  }"
);

fs.writeFileSync('public/js/race.js', raceJs);


let appJs = fs.readFileSync('public/js/app.js', 'utf8');

const oldAutoConnect = `  // Handle hardware auto-connect
  if (activeSettings.connectAtStartup) {
    recoverSessionState();
    if (activeSettings.hardwareType === 'mock') {`;

const newAutoConnect = `  // Handle hardware auto-connect
  if (activeSettings.connectAtStartup) {
    const recovery = recoverSessionState();
    if (recovery && recovery.wasRunning) {
      // Small timeout to allow DOM to settle
      setTimeout(() => {
        const btnSessionStart = document.getElementById('btn-session-start');
        if (btnSessionStart && btnSessionStart.textContent.includes('Start')) {
          btnSessionStart.click();
        }
      }, 100);
    }

    if (activeSettings.hardwareType === 'mock') {`;

appJs = appJs.replace(oldAutoConnect, newAutoConnect);

fs.writeFileSync('public/js/app.js', appJs);

console.log('Fixed auto-start session logic.');
