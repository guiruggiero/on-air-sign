# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the monitor

```powershell
# Set required environment variable (Windows, user scope)
[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<network_name>", "User")

# Run
node host/monitor.js
```

## Autostart via Task Scheduler

The monitor runs on login via Windows Task Scheduler. The real files are gitignored (contain username/SID); use the `.example` files as templates:

1. Copy `host/launch-monitor.vbs.example` → `host/launch-monitor.vbs` and fill in your Node path and repo path
2. Copy `host/On Air sign monitor.xml.example` → `host/On Air sign monitor.xml`; edit `DOMAIN\username`, `DATE`, and the paths in `<Arguments>` and `<WorkingDirectory>`
3. Open Task Scheduler → Action → Import Task, and select `host\On Air sign monitor.xml`

## Deploying to the Pico

Upload `main.py` and `dashboard.html` from `pico/` to the Pico 2 W using Thonny. `main.py` runs automatically on boot. A `secrets.py` must exist on the Pico (gitignored) with:
```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
```

## Architecture

Two completely separate components that communicate over HTTP on the local network:

### `pico/main.py` — MicroPython on Raspberry Pi Pico 2 W
- Runs a bare HTTP server on port 80 (no framework, no external libraries)
- Accepts `GET /off`, `GET /yellow`, `GET /red` to set LED color; `GET /` serves a control dashboard (streamed from `dashboard.html` on flash); `GET /stats` returns JSON with memory usage and uptime; `GET /logs` and `GET /errors` serve log files over HTTP
- Drives a 12-LED WS2812 NeoPixel ring on **GP4** using Pico's PIO state machine (bit-banged at 8 MHz, GRB color order)
- On boot: blinks green while connecting to WiFi, shows solid green for 3s when connected, then turns off; on WiFi reconnect, blinks green but skips the 3s pause to resume serving faster
- Auto-reconnects and restarts server if WiFi is lost; resets the Pico if initial connection fails after 20s
- Uses a 5-second socket accept timeout to keep the main loop non-blocking
- Watchdog: turns off the sign if no command is received within 5 minutes (covers monitor crash, PC sleep, etc.)
- Logs to `logs.log` and `errors.log` on flash with timestamps (PST via NTP sync, UTC-8 offset); auto-trims at 20KB keeping the newest half; retrievable via `/logs`, `/errors` endpoints or WebREPL
- Re-syncs NTP every 24 hours to correct clock drift

### `host/monitor.js` — Node.js on Windows host
- No npm dependencies; uses only Node.js built-ins (`child_process`, `fs`, `http`, `url`, `path`); requires PowerShell 7+ (`pwsh`)
- Injects `HOME_SSID` into `poll.ps1` at startup and base64-encodes it for `-EncodedCommand`
- Polls by running the PowerShell script every 15s (idle) or 5s (in meeting); uses chained `setTimeout` so polls don't overlap
- Sends HTTP GET to Pico on state changes and as heartbeat during active meetings (feeds Pico watchdog)
- `SIGINT`/`SIGTERM` turns the sign off before exiting
- Logs to `host/logs.log` (all events) and `host/errors.log` (errors only); timestamps include local timezone; both auto-trim at 200KB keeping the newest half

### Sign states
| State  | Meaning                    |
|--------|----------------------------|
| OFF    | No meeting detected        |
| YELLOW | Meeting active, camera off |
| RED    | Meeting active, camera on  |   

## Debugging

```powershell
# Test poll.ps1 directly (bypasses monitor.js)
pwsh -NoProfile -Command "& { `$HomeSSID = '<HOME_SSID>'; & .\host\poll.ps1 }"
```

## Gotchas

- **Static IP**: The Pico has a DHCP reservation at `192.168.0.209`
- **WebREPL**: Connect to the Pico remotely at `http://micropython.org/webrepl` using `ws://192.168.0.209:8266` to retrieve logs or update files without USB

## Key files
- `pico/main.py` — entire Pico firmware (single file, MicroPython)
- `pico/dashboard.html` — web control panel, served by Pico at `/` and also usable as a local file
- `pico/onairsign.html` — redirect page hosted on a personal website; navigates to the Pico's dashboard so you don't need to remember the IP
- `pico/secrets.py` — gitignored, lives only on the Pico
- `host/monitor.js` — host monitor (Node.js ES Modules), loads `poll.ps1` at startup
- `host/poll.ps1` — PowerShell script that checks computer lock state (requires both `LockApp.exe` and `LogonUI.exe` to distinguish real lock from credential popups), WiFi SSID, meeting windows, and webcam status (in that order); `HOME_SSID` is injected by `monitor.js`
- `host/launch-monitor.vbs.example` — template for the VBScript that launches the monitor silently; copy to `launch-monitor.vbs` and fill in paths
- `host/On Air sign monitor.xml.example` — template for the Task Scheduler task; copy to `On Air sign monitor.xml`, fill in `DOMAIN\username` and paths, then import via Task Scheduler → Action → Import Task
