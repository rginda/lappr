/**
 * Lappr - Hardware Simulator Module
 * Mocks the Robitronic/EasyLap serial protocol to generate simulated crossings.
 */

let isRunning = false;
let onDataCallback = null;
let simulatedDrivers = [];
let driverIntervals = [];

// A set of default transponders for simulation
const MOCK_TRANSPONDERS = ['CDFD4C', '00FFAB', 'EE1234'];

/**
 * Configure the simulator with active racers.
 * @param {Array} racers - List of racers.
 */
export function setSimulatedRacers(racers) {
  simulatedDrivers =
    racers.length > 0 ? racers.map((r) => r.transponder.toUpperCase()) : MOCK_TRANSPONDERS;
}

/**
 * Start simulating transponder crossings.
 * @param {Function} callback - Triggered when a new simulated data line is generated.
 */
export function startSimulator(callback) {
  if (isRunning) return;
  isRunning = true;
  onDataCallback = callback;

  if (simulatedDrivers.length === 0) {
    simulatedDrivers = MOCK_TRANSPONDERS;
  }

  console.log('[Simulator] Starting with transponders:', simulatedDrivers);

  // For each driver, start an independent loop to simulate cars passing the sensor loop
  driverIntervals = simulatedDrivers.map((transponder) => {
    // Generate a random initial delay so they don't cross at the same time
    const initialDelay = Math.random() * 8000 + 2000;

    const timeoutId = setTimeout(function loop() {
      if (!isRunning) return;

      triggerCrossing(transponder);

      // Schedule next crossing (typical lap time: 8-14 seconds)
      const nextLap = Math.random() * 6000 + 8000;
      const index = driverIntervals.findIndex((d) => d.transponder === transponder);
      if (index !== -1) {
        driverIntervals[index].timeoutId = setTimeout(loop, nextLap);
      }
    }, initialDelay);

    return { transponder, timeoutId };
  });
}

/**
 * Stop the simulator.
 */
export function stopSimulator() {
  if (!isRunning) return;
  isRunning = false;

  console.log('[Simulator] Stopping');

  driverIntervals.forEach((d) => clearTimeout(d.timeoutId));
  driverIntervals = [];
  onDataCallback = null;
}

/**
 * Generate a simulated Robitronic serial string and send it to the callback.
 * Format: ID[6 chars]Timestamp[8 chars]\r\n
 * @param {string} transponderId
 */
function triggerCrossing(transponderId) {
  if (!onDataCallback) return;

  // Robitronic timestamp is in 1/4 ms ticks (0.25 ms) since decoder boot.
  // We use the current high-resolution performance timer to mimic this.
  const elapsedMs = performance.now();
  const ticks = Math.floor(elapsedMs / 0.25);

  // Format ID and ticks as hex uppercase, padded
  const idHex = transponderId.padStart(6, '0').slice(-6).toUpperCase();
  const ticksHex = ticks.toString(16).padStart(8, '0').slice(-8).toUpperCase();

  const serialLine = `${idHex}${ticksHex}\r\n`;

  // console.log(`[Simulator TX] ${serialLine.trim()}`);
  onDataCallback(serialLine);
}
