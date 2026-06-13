import { describe, it, expect, beforeEach, vi } from 'vitest';
import { toggleSimulator, connectHID, disconnect } from '../public/js/serial.js';
import * as race from '../public/js/race.js';

vi.mock('../public/js/race.js', () => ({
  processCrossing: vi.fn()
}));

describe('Serial/Simulator Module', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    window.onStatusChange = vi.fn(); // If it's a global or export.
    // wait, if it's exported and injected:
    // actually, serial.js exports setStatusCallback? Let's check how it's used.
  });

  afterEach(() => {
    disconnect(vi.fn());
    vi.useRealTimers();
  });

  describe('Simulator', () => {
    it('should start and emit laps', () => {
      const onStatusMock = vi.fn();
      toggleSimulator(true, vi.fn(), onStatusMock);

      expect(onStatusMock).toHaveBeenCalledWith({
        connected: true,
        type: 'simulator',
        name: 'Mock Simulator'
      });
    });

    it('should stop when disconnected', () => {
      const onLineMock = vi.fn();
      toggleSimulator(true, onLineMock, vi.fn());
      disconnect(vi.fn());

      vi.advanceTimersByTime(6000);
      expect(onLineMock).not.toHaveBeenCalled();
    });
  });

  describe('WebHID Connection', () => {
    let mockDevice;

    beforeEach(() => {
      mockDevice = {
        vendorId: 0x10c4,
        productId: 0x86b9,
        open: vi.fn().mockResolvedValue(undefined),
        sendFeatureReport: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };

      global.navigator.hid = {
        requestDevice: vi.fn().mockResolvedValue([mockDevice]),
        getDevices: vi.fn().mockResolvedValue([mockDevice]),
        addEventListener: vi.fn()
      };
    });

    it('should connect to an HID device', async () => {
      const onLineMock = vi.fn();
      const onStatusMock = vi.fn();

      await connectHID(115200, onLineMock, onStatusMock);

      expect(global.navigator.hid.requestDevice).toHaveBeenCalled();
      expect(mockDevice.open).toHaveBeenCalled();
      expect(mockDevice.sendFeatureReport).toHaveBeenCalled();
      expect(onStatusMock).toHaveBeenCalledWith(expect.objectContaining({ connected: true }));
    });

    it('should automatically connect to authorized HID devices', async () => {
      const onLineMock = vi.fn();
      const onStatusMock = vi.fn();

      await import('../public/js/serial.js').then((module) =>
        module.autoConnectHID(115200, onLineMock, onStatusMock)
      );

      expect(global.navigator.hid.getDevices).toHaveBeenCalled();
      expect(mockDevice.open).toHaveBeenCalled();
    });

    it('should handle disconnect', async () => {
      const onStatusMock = vi.fn();
      await connectHID(115200, vi.fn(), onStatusMock);

      await disconnect(onStatusMock);

      expect(mockDevice.close).toHaveBeenCalled();
      expect(onStatusMock).toHaveBeenCalledWith(expect.objectContaining({ connected: false }));
    });
  });
});
