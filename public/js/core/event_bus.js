/**
 * EventBus.js
 * A pure JavaScript event emitter to decouple the Core Engine from the UI.
 * Runs in both browser and Node.js (for testing) environments.
 */

class EventBus {
  constructor() {
    this.listeners = {};
  }

  /**
   * Subscribe to an event
   * @param {string} event - The event name
   * @param {Function} callback - The callback function
   */
  on(event, callback) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
  }

  /**
   * Unsubscribe from an event
   * @param {string} event - The event name
   * @param {Function} callback - The callback function to remove
   */
  off(event, callback) {
    if (!this.listeners[event]) return;
    this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
  }

  /**
   * Emit an event with optional data payload
   * @param {string} event - The event name
   * @param {any} data - The payload to pass to subscribers
   */
  emit(event, data) {
    if (!this.listeners[event]) return;
    this.listeners[event].forEach(cb => cb(data));
  }
}

// Export a singleton instance for app-wide use
export const bus = new EventBus();
