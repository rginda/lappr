# IndexedDB Migration Plan

This document outlines the proposed architecture for migrating Lappr from synchronous `localStorage` to an asynchronous, scalable `IndexedDB` backend.

## 1. Architectural Approach (Hybrid Model)
To maintain the high-performance requirements of the real-time race engine while gaining the storage benefits of IndexedDB, we will use a **hybrid approach**:
- **Active Memory**: The live `sessionState` (including the current leaderboard and active lap times) will remain in memory for instant, synchronous access.
- **Background Persistence**: A background worker or periodic interval (e.g., every 5 seconds) will asynchronously flush new laps and session state changes to IndexedDB.
- **Relational Data**: Lap records will no longer be duplicated. A single master `laps` table will hold all laps, and queries will use indexes to retrieve laps for specific drivers, cars, or sessions.

---

## 2. Proposed Schema (Object Stores)

We will create an IndexedDB database named `lappr_db` with the following object stores (tables):

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
The master table for all lap data. Replaces the duplicated arrays previously stored in driver and car objects.
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



## 3. Data Access & Loading Strategy

Because IndexedDB is asynchronous, data will be loaded on-demand rather than comprehensively at startup:

- **App Initialization**:
  - Query the `drivers` and `cars` stores to populate the dropdown menus and lists.
  - Query the `sessions` store for any session where `status === 'active'` or `'paused'`.
- **Viewing a Driver Profile**:
  - Query the `laps` store using the `driverId` index.
  - Fetch all laps for the driver.
  - Dynamically calculate the Top 10 Personal Records (PRs) by sorting the lap records in memory by `lapTime` ascending.
- **Viewing a Car Profile**:
  - Query the `laps` store using the `carId` index.
  - Dynamically calculate the Top 10 PRs identically to drivers.

*Note on PRs and Session Bests: By completely eliminating the `personalrecords` table and dynamically deriving PRs and session bests directly from the master `laps` array, we eliminate duplicate data entirely and guarantee the UI is always perfectly synchronized with the user's lap history.*

---

## 4. Pruning Strategy

To prevent the database from growing indefinitely with standard/slow laps, we will implement a background pruning strategy:

**Adding New PRs**:
When a lap qualifies as a new PR, a record is added to the `personalrecords` table. If the list of PRs for that entity/type exceeds the limit (e.g., top 15), the slowest PR is culled from the `personalrecords` table. (The underlying lap record remains in the `laps` table until caught by the global cleanup.)

**Global Lap Cleanup Rules**:
1. **Preserve Milestones**: Any lap whose `id` exists in the `personalrecords` table is excluded from the normal lap pruning process.
2. **Preserve Recent History**: We retain the last `N` laps (e.g., 500) per-driver/car.
3. **Preserve Saved Sessions**: If a session is marked as "saved" or "locked" by the user, its associated laps are retained.

**Execution**:
Instead of relying on the user to properly "finish" a session (which is easily bypassed if they simply close the browser tab), the cleanup routine will fire asynchronously on **app startup**. While the UI initializes, the background worker will query the `laps` store for laps that do NOT meet the retention criteria. Before deleting a lap, the routine checks if its `id` exists in the `personalrecords` table; if it does, the lap is skipped. Unprotected laps are deleted in a batch transaction.

**Session Cleanup**:
After lap pruning is complete, the routine queries the `sessions` table. Any historical session (e.g., `status === 'finished'`) that no longer has any corresponding laps remaining in the `laps` table is deleted to prevent the database from filling up with empty "ghost" sessions.

---

## 5. Architectural Separation & Testing Strategy

Currently, Lappr tightly couples UI logic (DOM manipulation), business logic (lap timing, stat calculation), and database operations. To support the asynchronous nature of IndexedDB and achieve >90% test coverage, we will refactor the application into a cleanly separated, event-driven architecture.

### Architectural Layers

**A. The Data Layer (`src/db/`)**
A pure, asynchronous wrapper around IndexedDB (likely utilizing an existing lightweight promise wrapper like `idb`). 
- **Responsibilities**: Initializing the schema, executing CRUD operations, and running the background pruning tasks.
- **Rules**: Zero knowledge of the race engine or the UI.

**B. The Core Engine (`src/core/`)**
Pure JavaScript state machines and calculators that manage the race logic.
- **Responsibilities**: 
  - `RaceEngine`: Handles start/stop logic, transponder hits, and session timer ticks.
  - `StatCalculator`: Calculates streaks, PRs, consistency percentages.
  - `SessionStore`: Holds the real-time active session object in memory.
- **Rules**: **NO DOM MANIPULATION**. The engine communicates outward strictly by emitting events (e.g., a simple custom PubSub or `CustomEvent` bus) such as `onLapRecorded`, `onLeaderboardChanged`, and `onSessionStatusChanged`.

**C. The UI Controller (`src/ui/`)**
The presentation layer that connects the HTML DOM to the Core Engine.
- **Responsibilities**: 
  - Listens to DOM events (button clicks, form submissions) and calls methods on the Core Engine (e.g., `RaceEngine.start()`).
  - Subscribes to Core Engine events (e.g., `onLeaderboardChanged`) and updates the HTML.
- **Rules**: No business logic or database queries. It strictly renders data provided by the Core Engine.

### Testing Strategy

Because the Core Engine will no longer touch the DOM, it becomes trivially easy to test using standard Node.js test runners (like Jest or Vitest).

- **Unit Testing (The 90% Coverage Push)**:
  - **`RaceEngine` Tests**: We can instantiate a `RaceEngine` in memory, programmatically feed it mock transponder hits at specific intervals (`engine.processCrossing('CDFD4C', timestamp)`), and assert that the resulting `SessionStore` state contains the correct lap times, gap times, and leaderboard sorting.
  - **`StatCalculator` Tests**: We can feed predefined arrays of laps into the stat functions and assert that PRs, consistency strings, and longest streaks are calculated perfectly.
  - **`idb_service` Tests**: We can use a fake IndexedDB implementation (like `fake-indexeddb` for Node) to test our complex pruning queries and relational foreign-key logic without needing a real browser.

- **UI Testing**:
  - UI testing becomes secondary and much simpler. Since the business logic is proven, we only need a few integration tests (e.g., Cypress or Playwright) to ensure that clicking "Start Race" successfully triggers the `RaceEngine` and updates the timer text.
