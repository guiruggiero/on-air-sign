# On Air Sign Codebase Reference

Three completely separate components communicate over HTTP on the local network: the Windows host monitor (`host-win/`), the macOS host monitor (`host-mac/`), and the MicroPython firmware on the Raspberry Pi Pico 2 W (`pico/`). See [host-win/CLAUDE.md](host-win/CLAUDE.md), [host-mac/CLAUDE.md](host-mac/CLAUDE.md), and [pico/CLAUDE.md](pico/CLAUDE.md) for component-specific architecture and setup details.

## Sign states

| State  | Meaning                    |
|--------|----------------------------|
| OFF    | No meeting detected        |
| YELLOW | Meeting active, camera off |
| RED    | Meeting active, camera on  |

## Gotchas

- **Static IP**: The Pico has a DHCP reservation at `192.168.0.209`
- **WebREPL**: Connect to the Pico remotely at `http://micropython.org/webrepl` using `ws://192.168.0.209:8266` to retrieve logs or update files without USB
- **One monitor at a time**: only run one host monitor against the Pico at once (`host-win/` on Windows *or* `host-mac/` on macOS) - running both simultaneously causes duplicate/flapping transitions and heartbeats

## Key files
- `enclosures/` — 3D print STL files: Pico 2 W case (top+bottom) and NeoPixel ring sign box (top+bottom); designed by the repo owner on Tinkercad; print at 0.2 mm / 20% infill / no supports
