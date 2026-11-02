# On Air sign Codebase Reference

A host monitor detects meetings and camera use, and a Raspberry Pi Pico 2 W (MicroPython) lights a NeoPixel ring to match. Two pairings exist:

| Pairing | How state travels | Status |
|---|---|---|
| `mac/host/` + `mac/pico/` | host writes state to an Adafruit IO feed; the Pico polls it over HTTPS — no LAN adjacency needed | active development |
| `win/host/` + `win/pico/` | host pushes state to the Pico over LAN HTTP | legacy — no Windows machine anymore, so it can't be run or tested |

Component details: [mac/host](mac/host/CLAUDE.md), [mac/pico](mac/pico/CLAUDE.md), [win/host](win/host/CLAUDE.md), [win/pico](win/pico/CLAUDE.md).

## Sign states

| State  | Meaning                    |
|--------|----------------------------|
| OFF    | No meeting detected        |
| YELLOW | Meeting active, camera off |
| RED    | Meeting active, camera on  |

## Roadmap

1. `mac/host/monitor.mjs` writes state to the Adafruit IO feed instead of the Pico's LAN IP
2. Live On Air card on the website's admin dashboard (`website/admin.html`, separate repo) — read the feed over HTTPS (public-read feed, no key); manual control would need a backend holding the key

## Gotchas

- **Pico IP**: DHCP reservation at `192.168.0.209`
- **WebREPL**: `http://micropython.org/webrepl` with `ws://192.168.0.209:8266` to read logs or update files without USB

## Key files

- `enclosures/` — 3D print STLs: Pico 2 W case and NeoPixel ring sign box; designed by the repo owner on Tinkercad; print at 0.2 mm / 20% infill / no supports

## SonarQube Cloud

Project key `guiruggiero_on-air-sign`.