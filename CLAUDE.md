# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the monitor

```powershell
# Set required environment variables (Windows, user scope)
[System.Environment]::SetEnvironmentVariable("PICO_IP", "<ip_address>", "User")
[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<network_name>", "User")

# Run
node host/monitor.js
```

## Deploying to the Pico

Upload the files from `pico/` (`main.py`, `mdns.py`, and `dashboard.html`) to the Pico 2 W using Thonny. `main.py` runs automatically on boot. A `secrets.py` must exist on the Pico (gitignored) with:
```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
```

## Architecture

Two completely separate components that communicate over HTTP on the local network:

### `pico/main.py` — MicroPython on Raspberry Pi Pico 2 W
- Runs a bare HTTP server on port 80 (no framework, no external libraries)
- Accepts `GET /off`, `GET /yellow`, `GET /red` to set LED color; `GET /` serves a control dashboard (loaded from `dashboard.html`)
- Reachable at `http://onairsign.local` via a custom mDNS responder (`pico/mdns.py`)
- Drives a 12-LED WS2812 NeoPixel ring on **GP4** using Pico's PIO state machine (bit-banged at 8 MHz, GRB color order)
- On boot: blinks green while connecting to WiFi, shows solid green for 3s when connected, then turns off
- Auto-reconnects and restarts server if WiFi is lost; resets the Pico if initial connection fails after 20s
- Uses a 5-second socket accept timeout to keep the main loop non-blocking
- Watchdog: turns off the sign if no command is received within 5 minutes (covers monitor crash, PC sleep, etc.)

### `host/monitor.js` — Node.js on Windows host
- No npm dependencies; uses only Node.js built-ins (`child_process`, `fs`, `http`); requires PowerShell 7+ (`pwsh`)
- Injects `HOME_SSID` into `poll.ps1` at startup and base64-encodes it for `-EncodedCommand`
- Polls by running the PowerShell script every 15s (idle) or 5s (in meeting); uses chained `setTimeout` so polls don't overlap
- Sends HTTP GET to Pico on state changes and as heartbeat during active meetings (feeds Pico watchdog)
- `SIGINT`/`SIGTERM` turns the sign off before exiting

### Sign states
| State | Meaning |
|-------|---------|
| OFF | No meeting detected |
| YELLOW | Meeting active, camera off |
| RED | Meeting active, camera on |

## Key files
- `pico/main.py` — entire Pico firmware (single file, MicroPython)
- `pico/mdns.py` — minimal mDNS responder, makes the Pico reachable at `onairsign.local`
- `pico/dashboard.html` — web control panel, served by Pico at `/` and also usable as a local file
- `pico/secrets.py` — gitignored, lives only on the Pico
- `host/monitor.js` — host monitor (Node.js ES Modules), loads `poll.ps1` at startup
- `host/poll.ps1` — PowerShell script that checks computer lock state, WiFi SSID, meeting windows, and webcam status (in that order); `HOME_SSID` is injected by `monitor.js`
