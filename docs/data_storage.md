# Data Storage & Architecture

This document outlines how Lappr stores and manages entity data (Drivers, Cars, Laps, and Sessions) both in-memory during active sessions and persistently in the browser's LocalStorage.

## 1. Persistent Storage (LocalStorage)
Lappr is designed as an offline-first, local application. All permanent data is stored in the browser's `localStorage` using the `database.js` module. Data is stringified into JSON and parsed back into plain JavaScript objects upon retrieval.

### LocalStorage Keys
- `lappr_drivers`: Array of all registered drivers and their individual lap histories.
- `lappr_cars`: Array of all registered cars (transponders) and their individual lap histories.
- `apex_timing_sessions`: Array of completed historical sessions.
- `apex_timing_settings`: Global user settings and preferences.
- `lappr-session-backup`: Temporary snapshot of the currently active or paused session.

### Drivers (`lappr_drivers`)
Drivers represent the human users. The data model for a driver contains their identity, overall lap history, and personal records (PRs).
```json
{
  "id": "driver-uuid-123",
  "name": "Jane Doe",
  "laps": [
    {
      "id": "lap_...",
      "timestamp": 1698765432100,
      "lapTime": 10.453,
      "car": "Red Mini-Z RWD",
      "carTransponder": "CDFD4C"
    }
  ],
  "prs": [ /* Top 15 absolute best laps for this driver */ ]
}
```

### Cars (`lappr_cars`)
Cars represent the physical hardware (bound to a unique transponder ID). Car profiles store the hardware transponder, display color, and the lap history associated specifically with that vehicle, regardless of who was driving it.
```json
{
  "transponder": "CDFD4C",
  "name": "Red Mini-Z RWD",
  "color": "#ef4444",
  "laps": [
    {
      "id": "lap_...",
      "timestamp": 1698765432100,
      "lapTime": 10.453,
      "driverId": "driver-uuid-123",
      "driverName": "Jane Doe"
    }
  ],
  "prs": [ /* Top 15 absolute best laps for this car */ ]
}
```

*Note: Whenever a lap is completed during a session, it is double-logged via `logLap()` into **both** the active Driver's profile and the active Car's profile. These are **independent copies**, not references to a single object. The driver's copy tracks which car was used, while the car's copy tracks who was driving. Furthermore, because all data is serialized to JSON for LocalStorage, any object references would be lost anyway.*

### Historical Sessions (`apex_timing_sessions`)
When a session is formally finished and saved, a snapshot of the leaderboard and session metadata is saved to the sessions database.

---

## 2. In-Memory Runtime State (`race.js`)

While a session is actively running, data is held in-memory within the `sessionState` object in `race.js`. This allows for extremely fast updates (every 10ms for the clock/UI) without constantly blocking on database I/O.

### `sessionState` Object
```javascript
{
  mode: 'practice',          // Session type
  status: 'active',          // 'ready', 'active', 'paused', 'finished'
  startTime: 12345.678,      // High-resolution performance.now() timestamp
  elapsedTime: 0,            // Total elapsed time if paused
  assignments: {             // Transponder -> Driver ID mappings
    "CDFD4C": "driver-uuid-123"
  },
  racers: {                  // Live statistical tracking per car
    "CDFD4C": {
      name: "Jane Doe",
      carName: "Red Mini-Z RWD",
      transponder: "CDFD4C",
      color: "#ef4444",
      laps: [ /* Array of lap objects recorded in THIS session */ ],
      bestLap: 10.453,
      averageLap: 10.985,
      consistency: 94.5,
      longestStreak: 5,
      isActive: true
    }
  }
}
```

### Driver Assignments
During a session, a car (transponder) can be dynamically assigned to a driver.
When an assignment occurs (`assignSessionDriver`):
1. The `assignments` map is updated.
2. The runtime `racers` object updates the display name.
3. Any laps already completed by that car in the current session are *retroactively* credited to the newly assigned driver, both in memory and in the persistent LocalStorage (`assignHistoricalLaps`).

---

## 3. Crash Recovery & Session Resume

To protect against accidental page reloads or browser crashes during an active race, Lappr maintains a rolling backup.

1. **Backup Phase**: Whenever the session is `active` or `paused`, an event listener on the window (`beforeunload`) fires before the page refreshes. The `backupSessionState()` function serializes the entire `sessionState` (including all runtime laps and assignments) into the `lappr-session-backup` LocalStorage key.
2. **Recovery Phase**: Upon reloading, `app.js` runs `recoverSessionState()`. If a recent backup is found, it injects the serialized `racers` and `assignments` back into memory, calculates the offset for `sessionElapsedTime`, and flags the session as `paused`. The user can then hit "Resume" to seamlessly continue the session with zero data loss.
