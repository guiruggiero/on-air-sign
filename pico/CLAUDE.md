# pico/CLAUDE.md

Component-specific guidance for the MicroPython firmware on the Raspberry Pi Pico 2 W.

## Deploying to the Pico

Upload `main.py` and `dashboard.html` from `pico/` to the Pico 2 W using Thonny. `main.py` runs automatically on boot. A `secrets.py` must exist on the Pico (gitignored) with:
```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
```

## Architecture

`pico/main.py` is the entire Pico firmware — a single-file MicroPython program that runs an HTTP server and drives the NeoPixel ring.

### HTTP server
- Runs a bare HTTP server on port 80 (no framework, no external libraries)
- Accepts `GET /off`, `GET /yellow`, `GET /red` to set LED color
- `GET /` serves a control dashboard (streamed from `dashboard.html` on flash)
- `GET /stats` returns JSON with memory usage and uptime
- `GET /logs` and `GET /errors` serve log files over HTTP
- Uses a 5-second socket accept timeout to keep the main loop non-blocking

### NeoPixel/LED control
- Drives a 12-LED WS2812 NeoPixel ring on **GP4** using Pico's PIO state machine (bit-banged at 8 MHz, GRB color order)

### WiFi and reconnect
- On boot: blinks green while connecting to WiFi, shows solid green for 3s when connected, then turns off
- On WiFi reconnect: blinks green but skips the 3s pause to resume serving faster
- Auto-reconnects and restarts server if WiFi is lost; resets the Pico if initial connection fails after 20s

### Watchdog
- Turns off the sign if no command is received within 5 minutes (covers monitor crash, PC sleep, etc.)

### Logging and NTP
- Logs to `logs.log` and `errors.log` on flash with timestamps (PST via NTP sync, UTC-8 offset)
- Auto-trims log files at 20KB keeping the newest half; retrievable via `/logs`, `/errors` endpoints or WebREPL
- Re-syncs NTP every 24 hours to correct clock drift

## Key files
- `pico/main.py` — entire Pico firmware (single file, MicroPython)
- `pico/dashboard.html` — web control panel, served by Pico at `/` and also usable as a local file
- `pico/onairsign.html` — redirect page hosted on a personal website; navigates to the Pico's dashboard so you don't need to remember the IP
- `pico/secrets.py` — gitignored, lives only on the Pico; must contain `SSID`, `PASSWORD`, and `WEBREPL_PW`
