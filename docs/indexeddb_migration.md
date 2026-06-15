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
- **Key Path**: `transponder`
- **Fields**:
  - `transponder`: `String` (Hex string, Primary Key)
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
  - `assignments`: `Object` (Record mapping `String` transponders to `String` driver IDs)

### 4. `laps`
The master table for all lap data. Replaces the duplicated arrays previously stored in driver and car objects.
- **Key Path**: `id`
- **Indexes**:
  - `driverId`: To query laps by driver
  - `carTransponder`: To query laps by car
  - `sessionId`: To query laps by session
  - `lapTime`: To query absolute best laps (PRs)
  - `timestamp`: To sort laps chronologically
- **Fields**:
  - `id`: `String` (Unique UUID, Primary Key)
  - `sessionId`: `String` (UUID of the session)
  - `driverId`: `String` | `null` (UUID of the driver)
  - `carTransponder`: `String` (Hex ID of the car)
  - `timestamp`: `Number` (Integer, Epoch ms of the crossing)
  - `lapTime`: `Number` (Float, seconds)
  - `isMilestone`: `Boolean` (true if this lap is a PR or session best)

---

## 3. Data Access & Loading Strategy

Because IndexedDB is asynchronous, data will be loaded on-demand rather than comprehensively at startup:

- **App Initialization**:
  - Query the `drivers` and `cars` stores to populate the dropdown menus and lists.
  - Query the `sessions` store for any session where `status === 'active'` or `'paused'`.
- **Viewing a Driver Profile**:
  - Open a cursor on the `laps` store using the `driverId` index.
  - Fetch the most recent 100 laps (sorting by `timestamp` descending).
  - Fetch personal records by querying the `isMilestone` laps for that driver, sorted by `lapTime`.
- **Viewing a Car Profile**:
  - Open a cursor on the `laps` store using the `carTransponder` index.
  - Fetch the most recent laps and milestones identically to drivers.

---

## 4. Pruning Strategy

To prevent the database from growing indefinitely with standard/slow laps, we will implement a background pruning strategy:

**Rules for Pruning**:
1. **Preserve Milestones**: Any lap where `isMilestone === true` is permanently retained.
2. **Preserve Recent History**: We retain the last `N` laps (e.g., 500) globally or per-driver/car.
3. **Preserve Saved Sessions**: If a session is marked as "saved" or "locked" by the user, its associated laps are retained.

**Execution**:
When a session finishes, a cleanup routine queries the `laps` store for laps that do NOT meet the retention criteria (e.g., `isMilestone === false`, `timestamp < [Threshold]`). These laps are deleted in a batch transaction.
