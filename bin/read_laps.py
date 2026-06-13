#!/usr/bin/env python3
"""
Apex Timing - EasyLap CP2110 Diagnostic Tool
Simplified diagnostic utility for connecting to CP2110 devices using the cp2110 library.
"""

import sys
import time
import os
import ctypes

# Pre-load hidapi on macOS from Homebrew paths to assist ctypes loading in cp2110
if sys.platform == 'darwin':
  brew_paths = [
    '/opt/homebrew/lib/libhidapi.dylib',
    '/usr/local/lib/libhidapi.dylib',
    os.path.expanduser('~/lib/libhidapi.dylib')
  ]
  for path in brew_paths:
    if os.path.exists(path):
      try:
        # Load the dynamic library to register it in the process namespace
        ctypes.CDLL(path)
        print(f"[Setup] Pre-loaded native hidapi from Homebrew: {path}")
        break
      except Exception as e:
        print(f"[Setup] Failed to pre-load {path}: {e}")

import cp2110

# Global stats to calculate lap times
def parse_packet(packet):
  """
  Parses a binary packet and prints results.
  """
  pkt_len = packet[0]
  b1 = packet[1]
  pkt_type = packet[2]

  now = time.time()

  if pkt_type == 0x83 and pkt_len == 0x0B:
      # Heartbeat Packet
      ticks = int.from_bytes(packet[3:7], byteorder='little')
      tail = packet[7:].hex(' ').upper()
      # To avoid spam, only print heartbeats occasionally or if tail changes
      # print(f"[Heartbeat] B1: {b1:02X} | Ticks: {ticks} | Tail: {tail}")
      
  elif pkt_type == 0x84 and pkt_len == 0x0D:
      # Crossing Packet
      transponder_id = str(int.from_bytes(packet[3:7], byteorder='little'))
      ticks = int.from_bytes(packet[7:11], byteorder='little')
      tail = packet[11:].hex(' ').upper()
      
      print(f"[Crossing] Transponder: {transponder_id} | B1: {b1:02X} | Ticks: {ticks} | Tail: {tail} | Raw: {packet.hex(' ').upper()}")
  else:
      print(f"[Unknown Packet] {packet.hex(' ').upper()}")


if __name__ == '__main__':
  print("==================================================")
  print("  Apex Timing - EasyLap CP2110 Diagnostic Tool    ")
  print("==================================================")

  # Initialize CP2110 device (will throw standard exceptions if connection fails)
  d = cp2110.CP2110Device(vid=0x10C4, pid=0x86B9)
  print("Connected to CP2110 device.")

  # Configure and Enable UART
  d.enable_uart()
  config = d.get_uart_config()
  print(f"UART Enabled and configured to {config.baud} baud. Listening...")

  buffer = b""
  while True:
    data = d.read(100)
    if data:
      # print(f"RAW READ: {data.hex(' ').upper()}")
      buffer += data
      while len(buffer) > 0:
        pkt_len = buffer[0]
        # EasyLap packets start with length (0x0B for heartbeat, 0x0D for crossing)
        if pkt_len not in (0x0B, 0x0D):
          # Unknown length byte, drop first byte and re-sync
          buffer = buffer[1:]
          continue
          
        if len(buffer) < pkt_len:
          # Wait for more data
          break

        packet = buffer[:pkt_len]
        buffer = buffer[pkt_len:]
        parse_packet(packet)
