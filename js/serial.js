/**
 * Apex Timing - Hardware Connection Module
 * Handles Web Serial API and WebHID API (CP2110) connections, byte decoding, and line accumulation.
 */

import { startSimulator, stopSimulator } from './simulator.js';

let serialPort = null;
let serialReader = null;
let hidDevice = null;
let isConnected = false;
let inputBuffer = '';

let binaryBuffer = new Uint8Array(0);

/**
 * Handle incoming binary data from Serial or HID.
 * Buffers bytes, extracts EasyLap packets, and synthesizes legacy ASCII strings.
 * @param {Uint8Array} data - Raw byte chunk.
 * @param {Function} onLineCallback - Triggered with synthesized ASCII string.
 */
function handleBinaryData(data, onLineCallback) {
  // Append new data to buffer
  const newBuffer = new Uint8Array(binaryBuffer.length + data.length);
  newBuffer.set(binaryBuffer);
  newBuffer.set(data, binaryBuffer.length);
  binaryBuffer = newBuffer;

  while (binaryBuffer.length > 0) {
    const pktLen = binaryBuffer[0];
    
    // EasyLap packets start with length (0x0B for heartbeat, 0x0D for crossing)
    if (pktLen !== 0x0B && pktLen !== 0x0D) {
      // Unknown length byte, drop first byte and re-sync
      binaryBuffer = binaryBuffer.slice(1);
      continue;
    }

    if (binaryBuffer.length < pktLen) {
      // Wait for more data
      break;
    }

    const packet = binaryBuffer.slice(0, pktLen);
    binaryBuffer = binaryBuffer.slice(pktLen);

    const pktType = packet[2];

    if (pktType === 0x84 && pktLen === 0x0D) {
      // Parse Crossing Packet
      // Transponder ID (Bytes 3-6)
      const transponderId = (packet[3] | (packet[4] << 8) | (packet[5] << 16) | (packet[6] << 24)) >>> 0;
      // Ticks (Bytes 7-10)
      // Using DataView to safely read 32-bit unsigned int
      const dv = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
      const ticks = dv.getUint32(7, true); // true = little-endian
      
      // Synthesize legacy Robitronic ASCII format: ID[6 hex chars]Timestamp[8 hex chars]
      const idHex = transponderId.toString(16).toUpperCase().padStart(6, '0');
      const ticksHex = ticks.toString(16).toUpperCase().padStart(8, '0');
      
      console.log(`[Binary Parser] Detected Crossing! Emitting legacy string: ${idHex}${ticksHex}`);
      onLineCallback(idHex + ticksHex);
    }
  }
}

/**
 * Handle simulator lines (already legacy ASCII format).
 */
function handleLegacyAsciiLine(text, onLineCallback) {
  inputBuffer += text;
  let lineBreakIndex;
  while ((lineBreakIndex = inputBuffer.indexOf('\\n')) !== -1) {
    const line = inputBuffer.slice(0, lineBreakIndex + 1);
    inputBuffer = inputBuffer.slice(lineBreakIndex + 1);
    const cleanLine = line.trim();
    if (cleanLine.length > 0) {
      onLineCallback(cleanLine);
    }
  }
}

/**
 * Connect to decoder via Web Serial API.
 * @param {number} baudRate - The baud rate (e.g. 115200).
 * @param {Function} onLineCallback - Callback for received lines.
 * @param {Function} onStatusChange - Callback for connection status updates.
 */
export async function connectSerial(baudRate, onLineCallback, onStatusChange) {
  if (!navigator.serial) {
    throw new Error('Web Serial API is not supported in this browser. Try Chrome, Edge, or Opera.');
  }

  try {
    serialPort = await navigator.serial.requestPort();
    await serialPort.open({ baudRate });
    
    isConnected = true;
    onStatusChange({ connected: true, type: 'serial', name: 'Serial Port' });
    
    // Start reading loop
    readSerialLoop(onLineCallback, onStatusChange);
  } catch (err) {
    console.error('Serial connection failed:', err);
    disconnect(onStatusChange);
    throw err;
  }
}

/**
 * Reading loop for Web Serial.
 */
async function readSerialLoop(onLineCallback, onStatusChange) {
  const decoder = new TextDecoder();
  
  while (serialPort && serialPort.readable && isConnected) {
    try {
      serialReader = serialPort.readable.getReader();
      
      while (isConnected) {
        const { value, done } = await serialReader.read();
        if (done) {
          break;
        }
        if (value) {
          handleBinaryData(value, onLineCallback);
        }
      }
    } catch (err) {
      console.error('Error reading serial stream:', err);
      break;
    } finally {
      if (serialReader) {
        serialReader.releaseLock();
        serialReader = null;
      }
    }
  }
  
  // If we exit loop but were supposed to be connected, it means hardware was pulled
  if (isConnected) {
    disconnect(onStatusChange);
  }
}

/**
 * Connect to Silicon Labs CP2110 via WebHID.
 * @param {Function} onLineCallback - Callback for received lines.
 * @param {Function} onStatusChange - Callback for connection status updates.
 */
export async function connectHID(baudRate, onLineCallback, onStatusChange) {
  if (!navigator.hid) {
    throw new Error('WebHID API is not supported in this browser. Try Chrome, Edge, or Opera.');
  }

  try {
    const devices = await navigator.hid.requestDevice({
      filters: [{ vendorId: 0x10c4, productId: 0x86b9 }] // EasyLap hardware VID/PID
    });

    if (devices.length === 0) {
      throw new Error('No compatible CP2110 HID devices selected.');
    }

    hidDevice = devices[0];
    await hidDevice.open();

    // 1. Configure UART parameters (Report ID 0x50)
    // Format: baudRate (4 bytes big-endian), parity (1 byte: 0=None), flowControl (1 byte: 0=None), dataBits (1 byte: 3=8bits), stopBits (1 byte: 0=1 stop)
    const configData = new Uint8Array(8);
    configData[0] = (baudRate >> 24) & 0xFF;
    configData[1] = (baudRate >> 16) & 0xFF;
    configData[2] = (baudRate >> 8) & 0xFF;
    configData[3] = baudRate & 0xFF;
    configData[4] = 0x00; // Parity: None
    configData[5] = 0x00; // Flow Control: None
    configData[6] = 0x03; // Data Bits: 8
    configData[7] = 0x00; // Stop Bits: 1
    
    await hidDevice.sendFeatureReport(0x50, configData);

    // 2. Enable UART interface (Report ID 0x41, Value 0x01)
    const enableReport = new Uint8Array([0x01]);
    await hidDevice.sendFeatureReport(0x41, enableReport);

    isConnected = true;
    onStatusChange({ connected: true, type: 'hid', name: hidDevice.productName || 'CP2110 HID' });

    hidDevice.oninputreport = (event) => {
      const { reportId, data } = event;
      
      // CP2110 transmits UART RX data in Input Reports 0x01 to 0x3F.
      if (reportId >= 0x01 && reportId <= 0x3F) {
        const actualLen = reportId;
        const available = data.byteLength;
        
        if (actualLen > 0 && available > 0) {
          const uartBytes = new Uint8Array(data.buffer, data.byteOffset, Math.min(actualLen, available));
          console.log(`[WebHID] Received Report ID ${reportId}. Bytes:`, Array.from(uartBytes).map(b => b.toString(16).padStart(2, '0')).join(' '));
          handleBinaryData(uartBytes, onLineCallback);
        }
      } else {
        console.warn(`[WebHID] Ignored Report ID ${reportId}`);
      }
    };

    // Listen to unexpected disconnects
    navigator.hid.addEventListener('disconnect', (event) => {
      if (event.device === hidDevice) {
        console.log('[HID] Device disconnected');
        disconnect(onStatusChange);
      }
    });

  } catch (err) {
    console.error('HID connection failed:', err);
    disconnect(onStatusChange);
    throw err;
  }
}

/**
 * Toggle Mock Simulator Mode.
 * @param {boolean} enable - Start or stop simulator.
 * @param {Function} onLineCallback - Callback for simulated lines.
 * @param {Function} onStatusChange - Callback for status updates.
 */
export function toggleSimulator(enable, onLineCallback, onStatusChange) {
  if (enable) {
    // Disconnect active hardware first
    disconnect(onStatusChange);
    
    isConnected = true;
    onStatusChange({ connected: true, type: 'simulator', name: 'Mock Simulator' });
    startSimulator((line) => {
      handleLegacyAsciiLine(line, onLineCallback);
    });
  } else {
    stopSimulator();
    disconnect(onStatusChange);
  }
}

/**
 * Disconnect active connections.
 * @param {Function} onStatusChange - Callback to notify.
 */
export async function disconnect(onStatusChange) {
  isConnected = false;
  inputBuffer = '';
  
  // Stop simulator if active
  stopSimulator();

  // Close Web Serial port
  if (serialReader) {
    try {
      await serialReader.cancel();
    } catch (e) {}
    serialReader = null;
  }
  if (serialPort) {
    try {
      await serialPort.close();
    } catch (e) {}
    serialPort = null;
  }

  // Close WebHID device
  if (hidDevice) {
    try {
      // Disable UART interface (Report ID 0x41, Value 0x00)
      const disableReport = new Uint8Array([0x00]);
      await hidDevice.sendFeatureReport(0x41, disableReport);
      await hidDevice.close();
    } catch (e) {}
    hidDevice = null;
  }

  onStatusChange({ connected: false, type: 'offline', name: 'Hardware Offline' });
}
