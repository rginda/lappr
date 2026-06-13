const fs = require('fs');

let appJs = fs.readFileSync('public/js/app.js', 'utf8');

const oldAutoConnect = `  // Handle hardware auto-connect
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

    if (activeSettings.hardwareType === 'mock') {
      toggleSimulator(true, onLineReceived, onStatusChange);
    } else {
      autoConnectHID(38400, onLineReceived, onStatusChange).then(connected => {
        if (!connected) {
          console.warn('Auto-connect HID failed. User gesture may be required first.');
        }
      });
    }
  }`;

const newAutoConnect = `  // Handle hardware auto-connect
  if (activeSettings.connectAtStartup) {
    const recovery = recoverSessionState();
    
    const resumeIfNeeded = () => {
      if (recovery && recovery.wasRunning) {
        startSession();
      }
    };

    if (activeSettings.hardwareType === 'mock') {
      toggleSimulator(true, onLineReceived, onStatusChange);
      resumeIfNeeded();
    } else {
      autoConnectHID(38400, onLineReceived, onStatusChange).then(connected => {
        if (!connected) {
          console.warn('Auto-connect HID failed. User gesture may be required first.');
        }
        resumeIfNeeded();
      });
    }
  }`;

appJs = appJs.replace(oldAutoConnect, newAutoConnect);

fs.writeFileSync('public/js/app.js', appJs);

console.log('Fixed auto-resume logic to bypass UI button.');
