const fs = require('fs');

let db = fs.readFileSync('public/js/database.js', 'utf8');
db = db.replace('export function deleteDriverCarStats(driverId, carId) {', 'export function deleteDriverCarStats(driverId, carTransponder) {');
db = db.replace('const lapIdsToDelete = driver.laps.filter((l) => l.carId === carId).map((l) => l.id);', 'const lapIdsToDelete = driver.laps.filter((l) => l.carTransponder === carTransponder).map((l) => l.id);');
fs.writeFileSync('public/js/database.js', db);

let app = fs.readFileSync('public/js/app.js', 'utf8');
const oldAppLogic = `      if (!carStats[lap.carId]) {
        carStats[lap.carId] = {
          carName: lap.car,
          lapsRun: 0,
          totalTime: 0,
          pr: lap.lapTime
        };
      }
      const stat = carStats[lap.carId];`;

const newAppLogic = `      if (!carStats[lap.carTransponder]) {
        carStats[lap.carTransponder] = {
          carTransponder: lap.carTransponder,
          carName: lap.car,
          lapsRun: 0,
          totalTime: 0,
          pr: lap.lapTime
        };
      }
      const stat = carStats[lap.carTransponder];`;

app = app.replace(oldAppLogic, newAppLogic);
app = app.replace('data-carid="${stat.carId}"', 'data-cartransponder="${stat.carTransponder}"');
app = app.replace('stat.carId', 'stat.carTransponder'); // For the delete confirm callback
app = app.replace("btn.addEventListener('click', (e) => {", "btn.addEventListener('click', (e) => {"); // Dummmy
app = app.replace("const tr = document.createElement('tr');", "const tr = document.createElement('tr');");

// Wait, the querySelector listener might use dataset.carid
// Let's replace 'dataset.carid' with 'dataset.cartransponder' where it exists, or just leave it as event delegation?
// Wait, the delete button listener is added immediately, so it doesn't use dataset in the callback:
// `deleteDriverCarStats(driverId, stat.carId);` becomes `deleteDriverCarStats(driverId, stat.carTransponder);`
app = app.replace("deleteDriverCarStats(driverId, stat.carId);", "deleteDriverCarStats(driverId, stat.carTransponder);");

fs.writeFileSync('public/js/app.js', app);

console.log('Fixed per-car stats aggregation issue.');
