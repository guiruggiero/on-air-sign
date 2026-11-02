# On Air sign Codebase Reference

Separate components communicate with the MicroPython firmware on the Raspberry Pi Pico 2 W. The host monitor has two platform-specific implementations that produce the same outcomes — `win/host/` (Windows) and `mac/host/` (macOS). The Pico firmware has two architectures, each paired with one host:

| Pairing | How state travels | Requires |
|---|---|---|
| `win/pico/` + `win/host/` | host polls locally, then pushes state to the Pico over HTTP on the local network | host and Pico on the same LAN |
| `mac/pico/` + `mac/host/` | host polls locally, then writes state to a cloud feed (Adafruit IO); the Pico polls that feed over the internet and drives the LEDs itself | no LAN adjacency between host and Pico |

See [win/host/CLAUDE.md](win/host/CLAUDE.md), [mac/host/CLAUDE.md](mac/host/CLAUDE.md), [win/pico/CLAUDE.md](win/pico/CLAUDE.md), and [mac/pico/CLAUDE.md](mac/pico/CLAUDE.md) for component-specific architecture and setup details.

## Sign states

| State  | Meaning                    |
|--------|----------------------------|
| OFF    | No meeting detected        |
| YELLOW | Meeting active, camera off |
| RED    | Meeting active, camera on  |

## Gotchas

- **Windows pairing is legacy**: there's no Windows machine available anymore, so `win/` can't be run or tested — active development happens in `mac/`

- **Static IP**: the Pico has a DHCP reservation at `192.168.0.209`
- **WebREPL**: connect to the Pico remotely at `http://micropython.org/webrepl` using `ws://192.168.0.209:8266` to retrieve logs or update files without USB
- **One monitor at a time**: run only one host monitor against the Pico at once (`win/host/` on Windows *or* `mac/host/` on macOS) — running both causes duplicate/flapping transitions and heartbeats

## Key files

- `enclosures/` — 3D print STL files: Pico 2 W case (top+bottom) and NeoPixel ring sign box (top+bottom); designed by the repo owner on Tinkercad; print at 0.2 mm / 20% infill / no supports

## SonarQube Cloud

Project key `guiruggiero_on-air-sign`.
