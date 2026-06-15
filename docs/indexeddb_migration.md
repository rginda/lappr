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

### 5. `personalrecords`
Maintains a list of top N milestone laps (PRs) for drivers and cars to decouple milestone status from the lap record itself.
- **Key Path**: `id`
- **Indexes**:
  - `entityId`: To quickly query PRs for a specific driver or car
  - `lapId`: To join back to the master `laps` table
  - `prType`: To categorize PRs (e.g., 'overall_driver', 'overall_car', 'driver_car_combo')
- **Fields**:
  - `id`: `String` (Unique UUID, Primary Key)
  - `lapId`: `String` (Foreign key referencing a lap `id`)
  - `entityId`: `String` (Driver UUID or Car Hex ID)
  - `prType`: `String` (Type of milestone)

---

## 3. Data Access & Loading Strategy

Because IndexedDB is asynchronous, data will be loaded on-demand rather than comprehensively at startup:

- **App Initialization**:
  - Query the `drivers` and `cars` stores to populate the dropdown menus and lists.
  - Query the `sessions` store for any session where `status === 'active'` or `'paused'`.
- **Viewing a Driver Profile**:
  - Open a cursor on the `laps` store using the `driverId` index.
  - Fetch the most recent 100 laps (sorting by `timestamp` descending).
  - Fetch personal records by querying the `personalrecords` store for that driver's `entityId`, then fetch the corresponding lap details from the `laps` store using the `lapId`s.
- **Viewing a Car Profile**:
  - Open a cursor on the `laps` store using the `carId` index.
  - Fetch the most recent laps and milestones identically to drivers.

*Note on Session Bests: When a page reloads and recovers an active session (or when viewing a historical session), we simply query the `laps` table using the `sessionId` index. Because we pull all laps for that session into memory, the race engine can instantly reconstitute the "Overall Session Best" and "Driver Session Best" laps on the fly. Therefore, we do not need to pollute the `personalrecords` table with transient session milestones.*

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
When a session finishes, a cleanup routine queries the `laps` store for laps that do NOT meet the retention criteria. Before deleting a lap, the routine checks if its `id` exists in the `personalrecords` table; if it does, the lap is skipped. Unprotected laps are deleted in a batch transaction.
