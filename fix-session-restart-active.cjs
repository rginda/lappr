const fs = require('fs');

let raceJs = fs.readFileSync('public/js/race.js', 'utf8');

raceJs = raceJs.replace(
  "if (sessionState.status === 'running' || Object.keys(sessionState.assignments).length > 0) {",
  "if (sessionState.status === 'active' || Object.keys(sessionState.assignments).length > 0) {"
);

raceJs = raceJs.replace(
  "return { recovered: true, wasRunning: backup.status === 'running' };",
  "return { recovered: true, wasRunning: backup.status === 'active' };"
);

fs.writeFileSync('public/js/race.js', raceJs);
console.log('Fixed race.js active status string');
