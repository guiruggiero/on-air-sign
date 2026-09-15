# Pico Firmware Reference (push variant)

Pairs with `host-win/`. See [pico-pull/CLAUDE.md](../pico-pull/CLAUDE.md) for the pull variant that pairs with `host-mac/` — the two share the same WiFi/LED/logging code, but differ in how they learn the sign state.

## Deploying to the Pico

Upload `main.py` and `dashboard.html` from `pico-push/` to the Pico 2 W using Thonny; `main.py` runs automatically on boot. A `secrets.py` must exist on the Pico (gitignored) with:

```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
```

## Architecture

`pico-push/main.py` is the entire Pico firmware — a single-file MicroPython program that runs an HTTP server and drives the NeoPixel ring.

### HTTP server

- Bare HTTP server on port 80 (no framework, no external libraries), with a 5-second socket accept timeout to keep the main loop non-blocking
- `GET /off`, `GET /yellow`, `GET /red` — set LED color
- `GET /` — control dashboard (streamed from `dashboard.html` on flash)
- `GET /stats` — JSON with memory usage and uptime
- `GET /logs`, `GET /errors` — log files over HTTP

### NeoPixel/LED control

Drives a 12-LED WS2812 NeoPixel ring on **GP4** using the Pico's PIO state machine (bit-banged at 8 MHz, GRB color order).

### WiFi and reconnect

- On boot: blinks green while connecting to WiFi, shows solid green for 3s when connected, then turns off
- On reconnect: blinks green but skips the 3s pause to resume serving faster
- Auto-reconnects and restarts the server if WiFi is lost; resets the Pico if the initial connection fails after 20s

### Watchdog

Turns off the sign if no command is received within 5 minutes (covers monitor crash, PC sleep, etc.).

### Logging and NTP

Logs to `logs.log` and `errors.log` on flash with timestamps (PST via NTP sync, UTC-8 offset). Auto-trims at 20KB keeping the newest half; retrievable via the `/logs`/`/errors` endpoints or WebREPL. Re-syncs NTP every 24 hours to correct clock drift.

## Key files

- `pico-push/main.py` — entire Pico firmware (single file, MicroPython)
- `pico-push/dashboard.html` — web control panel, served by the Pico at `/` and also usable as a local file
- `pico-push/onairsign.html` — redirect page hosted on a personal website; navigates to the Pico's dashboard so you don't need to remember the IP
- `pico-push/secrets.py` — gitignored, lives only on the Pico; must contain `SSID`, `PASSWORD`, and `WEBREPL_PW`

## Pending — admin dashboard integration

The `guiruggiero.com/admin.html` service health dashboard wants a live On Air card, punted until this firmware work lands. Two separate pieces, both still open:

- **`/stats` needs a `state` field.** Track the active color in a variable and expose it as `"state": "off"|"yellow"|"red"` alongside the existing `mem_free`/`mem_alloc`/`uptime_s`
- **Mixed content blocks the browser fetch regardless.** The Pico serves plain HTTP on the LAN (`192.168.0.209`) and the admin page is HTTPS, so `fetch("http://192.168.0.209/stats")` from that page is blocked as mixed content — a scheme problem, not CORS, so no header on the Pico side fixes it. Top-level navigation still works fine, which is why the dashboard's link-out card and `onairsign.html`'s redirect both work today. Options when picking this back up: keep it link-out only, add an HTTPS proxy on the home LAN that fetches the Pico server-side, or attempt the fetch and gracefully fall back to links if a browser ever permits it

The website side of this is described in `website/CLAUDE.md` (Service Health Dashboard) — keep the two in sync if the approach changes.
