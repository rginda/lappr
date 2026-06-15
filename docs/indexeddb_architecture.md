# IndexedDB Architecture & Data Model

This document outlines the architecture for Lappr's persistence layer, which uses a hybrid approach combining synchronous memory for real-time race engine performance and asynchronous `IndexedDB` for long-term storage.

## 1. Architectural Approach (Hybrid Model)
To maintain the high-performance requirements of the real-time race engine while gaining the storage benefits of IndexedDB, Lappr uses a **hybrid approach**:
- **Active Memory**: The live `sessionStore` (including the current leaderboard and active lap times) is managed in memory for instant, synchronous access.
- **Background Persistence**: The system asynchronously flushes new laps and session state changes to IndexedDB behind the scenes.
- **Relational Data**: Lap records are not duplicated. A single master `laps` table holds all laps, and the UI queries this table to derive stats, personal records (PRs), and histories for specific drivers, cars, or sessions on the fly.

---

## 2. Schema (Object Stores)

Lappr uses an IndexedDB database named `lappr_db` with the following object stores (tables):

### 1. `drivers`
Stores user profiles.
- **Key Path**: `id`
- **Fields**:
  - `id`: `String` (Unique UUID, Primary Key)
  - `name`: `String`
  - `createdAt`: `Number` (Integer, Epoch ms)

### 2. `cars`
Stores vehicle profiles.
- **Key Path**: `id`
- **Indexes**:
  - `transponder`: To map hardware hits to cars
- **Fields**:
  - `id`: `String` (Unique UUID, Primary Key)
  - `transponder`: `String` (Hex string)
  - `name`: `String`
  - `color`: `String` (Hex color string)
  - `createdAt`: `Number` (Integer, Epoch ms)

### 3. `sessions`
Stores both historical completed sessions and the currently active/paused session snapshot.
- **Key Path**: `id`
- **Indexes**:
  - `status`: To quickly find 'active' or 'paused' sessions for recovery.
- **Fields**:
  - `id`: `String` (Unique UUID, Primary Key)
  - `mode`: `String` ('practice')
  - `status`: `String` ('active', 'paused', 'finished')
  - `startTime`: `Number` (Integer, Epoch ms)
  - `endTime`: `Number` | `null` (Integer, Epoch ms)
  - `assignments`: `Object` (Record mapping `String` car IDs to `String` driver IDs)

### 4. `laps`
The master table for all lap data. 
- **Key Path**: `id`
- **Indexes**:
  - `driverId`: To query laps by driver
  - `carId`: To query laps by car
  - `sessionId`: To query laps by session
  - `lapTime`: To query absolute best laps (PRs)
  - `timestamp`: To sort laps chronologically
- **Fields**:
  - `id`: `String` (Unique UUID, Primary Key)
  - `sessionId`: `String` (UUID of the session)
  - `driverId`: `String` | `null` (UUID of the driver)
  - `carId`: `String` (UUID of the car)
  - `timestamp`: `Number` (Integer, Epoch ms of the crossing)
  - `lapTime`: `Number` (Float, seconds)


## 3. In-Memory Runtime State (`sessionStore`)

While a session is actively running, race data is held in-memory within the `sessionStore`. This allows for extremely fast updates (every 10ms for the clock/UI) without constantly blocking on database I/O.

### `sessionStore` State Object
```javascript
{
  id: 'uuid...',             // Session ID
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

### Driver Assignments & Retroactive Crediting
During a session, a car (transponder) can be dynamically assigned to a driver.
When an assignment occurs:
1. The `assignments` map is updated in the `sessionStore`.
2. The runtime `racers` object updates the display name for that transponder.
3. Any laps already completed by that car in the current session are *retroactively* credited to the newly assigned driver, both in the memory store and in the persistent `laps` table via `assignHistoricalLaps`.

---

## 4. Crash Recovery & Session Resume

To protect against accidental page reloads or browser crashes during an active race, Lappr uses continuous asynchronous persistence rather than relying on brittle `beforeunload` events.

1. **Continuous Persistence**: As a race runs, the Core Engine emits events for every new lap and session status change (e.g. paused, resumed). The Data Layer listens to these events and instantly saves the individual `laps` and the updated `session` metadata directly to IndexedDB in the background.
2. **Recovery Phase**: Upon reloading, `app.js` calls `recoverSessionState()`. It queries IndexedDB for any session where `status === 'active'` or `'paused'`. If an interrupted session is found, it loads all of the laps for that session, recalculates the elapsed time, reconstitutes the live memory `racers` map, and flags the session as `paused`. The user can then hit "Resume" to seamlessly continue the race exactly where they left off with zero data loss.

---

## 5. Data Access & Dynamic Stats Derivation

Because IndexedDB is asynchronous, data is loaded on-demand rather than comprehensively at startup. 

**Dynamic PRs and Session Bests**:
Instead of managing a brittle secondary table for "Personal Records", Lappr dynamically derives PRs and session bests directly from the master `laps` array. This eliminates duplicate data entirely and guarantees the UI is always perfectly synchronized with the user's lap history.

- **App Initialization**:
  - Query the `drivers` and `cars` stores to populate dropdown menus and global caches.
  - Query the `sessions` store for any session where `status === 'active'` or `'paused'` to recover ongoing race states.
- **Viewing a Driver Profile**:
  - Query the `laps` store using the `driverId` index.
  - Dynamically calculate the Top 10 Personal Records (PRs) by sorting the fetched lap records in memory by `lapTime` ascending.
- **Viewing a Car Profile**:
  - Query the `laps` store using the `carId` index.
  - Dynamically calculate the Top 10 PRs identically to drivers.

---

## 6. Pruning Strategy

To prevent the database from growing indefinitely with standard/slow laps, a background pruning strategy runs on app startup.

**Dynamic PR Protection**:
To protect a user's fastest historical laps from being deleted simply because they are old, the pruner first identifies the absolute fastest laps across the system. It dynamically groups all existing laps by `driverId` and `carId`, sorts them by `lapTime`, and adds the IDs of the top 10 fastest laps for *each* driver and *each* car into a protected `Set`.

**Global Lap Cleanup Rules**:
1. **Preserve Milestones**: Any lap whose `id` exists in the protected `Set` (meaning it is a top 10 PR for its driver or car) is skipped during deletion.
2. **Preserve Recent History**: The database retains a global pool of the most recent `maxHistoryPerEntity * 10` laps (e.g., the last 5000 laps across all drivers). Any lap older than this threshold that is *not* protected as a PR is permanently deleted.

**Session Cleanup**:
After lap pruning is complete, the routine queries the `sessions` table. Any historical session (e.g., `status === 'finished'`) that no longer has any corresponding laps remaining in the `laps` table is deleted to prevent the database from filling up with empty "ghost" sessions.

---

## 7. Architectural Separation & Testing Strategy

Lappr uses a cleanly separated, event-driven architecture to support the asynchronous nature of IndexedDB and maintain high test coverage.

### Architectural Layers

**A. The Data Layer (`public/js/db/`)**
A pure, asynchronous wrapper around IndexedDB (utilizing the `idb` promise wrapper).
- **Responsibilities**: Initializing the schema, executing CRUD operations, and running the background pruning tasks.
- **Rules**: Zero knowledge of the race engine or the UI.

**B. The Core Engine (`public/js/core/`)**
Pure JavaScript state machines and calculators that manage the race logic.
- **Responsibilities**: 
  - `RaceEngine`: Handles start/stop logic, transponder hits, lap validation, and session timer ticks.
  - `StatCalculator`: Calculates streaks, consistency percentages, and advanced statistics.
  - `SessionStore`: Holds the real-time active session object in memory and handles session snapshot backups.
  - `EventBus`: A custom PubSub bus (`on`, `emit`) used for engine-wide communication.
- **Rules**: **NO DOM MANIPULATION**. The engine communicates outward strictly by emitting events such as `lapRecorded`, `leaderboardUpdated`, and `sessionStatusChanged`.

**C. The UI Controller (`public/js/app.js` & `public/js/race.js`)**
The presentation layer that connects the HTML DOM to the Core Engine.
- **Responsibilities**: 
  - Listens to DOM events (button clicks, form submissions) and calls methods on the Core Engine (e.g., `raceEngine.startSession()`).
  - Subscribes to `EventBus` events (e.g., `leaderboardUpdated`) and updates the HTML to reflect the new state.
- **Rules**: No complex business logic or database queries during active races. It strictly renders data provided by the Core Engine.

### Testing Strategy

Because the Core Engine does not touch the DOM, it is tested entirely using the Vitest Node.js test runner.

- **Unit Testing**:
  - **`RaceEngine` Tests**: Instantiates a `RaceEngine` in memory, programmatically feeds it mock transponder hits (`engine.processCrossing('CDFD4C', timestamp)`), and asserts that the resulting `SessionStore` state contains the correct laps and lap times.
  - **`idb_service` Tests**: Uses the `fake-indexeddb` package to simulate the browser environment, testing complex logic such as PR protection during database pruning without needing a real browser.
