# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Two completely separate components communicate over HTTP on the local network: the Windows host monitor (`host/`) and the MicroPython firmware on the Raspberry Pi Pico 2 W (`pico/`). See [host/CLAUDE.md](host/CLAUDE.md) and [pico/CLAUDE.md](pico/CLAUDE.md) for component-specific architecture and setup details.

## Sign states

| State  | Meaning                    |
|--------|----------------------------|
| OFF    | No meeting detected        |
| YELLOW | Meeting active, camera off |
| RED    | Meeting active, camera on  |

## Gotchas

- **Static IP**: The Pico has a DHCP reservation at `192.168.0.209`
- **WebREPL**: Connect to the Pico remotely at `http://micropython.org/webrepl` using `ws://192.168.0.209:8266` to retrieve logs or update files without USB

## Key files
- `enclosures/` — 3D print STL files: Pico 2 W case (top+bottom) and NeoPixel ring sign box (top+bottom); designed by the repo owner on Tinkercad; print at 0.2 mm / 20% infill / no supports
