# On Air sign Codebase Reference

Separate components communicate with the MicroPython firmware on the Raspberry Pi Pico 2 W. The host monitor has two platform-specific implementations that produce the same outcomes — `host-win/` (Windows) and `host-mac/` (macOS). The Pico firmware has two architectures, each paired with one host:

- **`pico-push/`** + `host-win/` — the host polls locally, then pushes state to the Pico over HTTP on the local network. Requires the host and Pico on the same LAN.
- **`pico-pull/`** + `host-mac/` — the host polls locally, then writes state to a cloud feed (Adafruit IO); the Pico polls that feed over the internet and drives the LEDs itself. No LAN adjacency required between host and Pico.

See [host-win/CLAUDE.md](host-win/CLAUDE.md), [host-mac/CLAUDE.md](host-mac/CLAUDE.md), [pico-push/CLAUDE.md](pico-push/CLAUDE.md), and [pico-pull/CLAUDE.md](pico-pull/CLAUDE.md) for component-specific architecture and setup details.

## Sign states

| State  | Meaning                    |
|--------|----------------------------|
| OFF    | No meeting detected        |
| YELLOW | Meeting active, camera off |
| RED    | Meeting active, camera on  |

## Gotchas

- **Static IP**: The Pico has a DHCP reservation at `192.168.0.209`
- **WebREPL**: Connect to the Pico remotely at `http://micropython.org/webrepl` using `ws://192.168.0.209:8266` to retrieve logs or update files without USB
- **One monitor at a time**: run only one host monitor against the Pico at once (`host-win/` on Windows *or* `host-mac/` on macOS) — running both causes duplicate/flapping transitions and heartbeats

## Key files
- `enclosures/` — 3D print STL files: Pico 2 W case (top+bottom) and NeoPixel ring sign box (top+bottom); designed by the repo owner on Tinkercad; print at 0.2 mm / 20% infill / no supports

## SonarQube Cloud

Project key `guiruggiero_on-air-sign`.
