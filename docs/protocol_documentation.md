# EasyLap / Robitronic Lap Counter Protocol Specification

This document details the communication protocol and hardware interface layers used by the EasyLap and Robitronic RC lap counting decoders. It serves as a reference for writing interface drivers in various languages (JavaScript/WebHID, Python, C++, etc.).

---

## 1. Hardware Interface Layer (USB-HID / CP2110)

Most USB-based EasyLap and Robitronic decoders use a **Silicon Labs CP2110 HID-to-UART bridge** chip. Because the CP2110 is configured as a USB HID class device rather than a CDC Serial device, the operating system does not assign a virtual COM port. Instead, the host application must claim the HID interface and use specific HID **Feature Reports** to configure and enable the UART link.

### 1.1 USB Identifiers
- **Default CP2110 Vendor ID (VID)**: `0x10C4` (Silicon Labs)
- **Default CP2110 Product ID (PID)**: `0xEA80` (CP2110 Bridge)
- **EasyLap Vendor ID (VID)**: `0x10C4`
- **EasyLap Product ID (PID)**: `0x86B9`
- *Note*: Manufacturer-branded decoders like EasyLap write custom PIDs to the internal OTP memory, so drivers should specifically look for `0x10C4:0x86B9` or allow matching by device name.

### 1.2 Control Commands (Feature Reports)
To establish UART communication, the host must send two control messages via **USB HID Feature Reports**:

#### A. Enable UART Interface (Report ID `0x41`)
Activates the UART link to start receiving bytes from the decoder CPU.
- **Report ID**: `0x41`
- **Payload Size**: 1 byte
- **Payload Structure**:
  - **Byte 0**: UART Enable state (`0x01` = Enable, `0x00` = Disable).

#### B. Purge FIFOs (Report ID `0x43`)
Clears the hardware receive/transmit buffers.
- **Report ID**: `0x43`
- **Payload Size**: 1 byte
- **Payload Structure**:
  - **Byte 0**: Purge target (`0x01` = Purge TX, `0x02` = Purge RX, `0x03` = Purge Both).

### 1.3 Data Reception (Input Report `0x01`)
When the decoder CPU detects a transponder crossing, it sends the data over UART, which is bridged by the CP2110 and delivered to the host as a **USB HID Input Report**:
- **Report ID**: `0x01`
- **Payload Structure**:
  - **Byte 0**: Length of the incoming UART data chunk (1 to 63 bytes).
  - **Bytes 1–63**: Raw UART data bytes.

---

## 2. Serial Data Stream Layer (EasyLap Binary Protocol)

Once the UART link is active (default 38400 baud, 8N1), the decoder transmits data packets using a binary protocol. 
There are two primary packet types identified by the 3rd byte (`Byte 2`) and their total lengths (`Byte 0`).

### 2.1 Heartbeat Packet (Type `0x83`)
The decoder transmits a continuous stream of heartbeat packets approximately every 250ms to indicate that the device is active and the internal clock is running.
- **Length**: 11 bytes (`0x0B`)
- **Structure**:
  - `Byte 0`: Length (`0x0B`)
  - `Byte 1`: Sequence/Checksum
  - `Byte 2`: Packet Type (`0x83`)
  - `Bytes 3-6`: 32-bit Timestamp (Ticks, little-endian)
  - `Bytes 7-10`: Footer / Additional data (e.g., `14 D0 01 03`)

### 2.2 Crossing Packet (Type `0x84`)
When a transponder crosses the sensor loop, the decoder validates the signal and immediately transmits a 13-byte crossing packet.
- **Length**: 13 bytes (`0x0D`)
- **Structure**:
  - `Byte 0`: Length (`0x0D`)
  - `Byte 1`: Sequence/Checksum
  - `Byte 2`: Packet Type (`0x84`)
  - `Bytes 3-6`: 32-bit Transponder ID (little-endian)
  - `Bytes 7-10`: 32-bit Timestamp (Ticks, little-endian)
  - `Bytes 11-12`: Footer / Additional data

### 2.3 Clock Calculation & Rollover
- **Timer Frequency**: The hardware clock ticks once every **1 millisecond (1.0 ms)**.
- **Elapsed Time**:
  $$\text{Time (seconds)} = \text{Ticks} \times 0.001$$
- **Rollover**: The timer is a counter that eventually rolls over.
  - The serial protocol transmits 32 bits (4 bytes) for the timestamp.
  - However, in testing, the system appears to behave as if it overflows at 24 bits ($2^{24}$ or `16,777,216` ticks).
  - *Note: We are guessing about the rollover behavior. The current code assumes a 24-bit rollover.*
  - **Rollover Handling Formula (Assuming 24-bit)**:
    If $\text{Ticks}_{\text{current}} < \text{Ticks}_{\text{previous}}$, compute the tick delta as:
    $$\Delta\text{Ticks} = (\text{Ticks}_{\text{current}} - \text{Ticks}_{\text{previous}}) + 16,777,216$$
