# Pico Firmware Reference (pull variant)

Pairs with `mac/host/`. `main.py` is the entire firmware: a single-file MicroPython program, no external libraries, that polls an Adafruit IO feed and drives the NeoPixel ring. It runs no server and only makes outbound requests, so it works behind any network/NAT.

## Deploying

Upload `main.py` with Thonny (runs on boot). Create `secrets.py` on the Pico (gitignored):

```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
AIO_USERNAME = "<adafruit_io_username>"
AIO_KEY = "<adafruit_io_key>"
```

Until `mac/host` writes to the feed, test by setting the feed value by hand on the Adafruit IO dashboard — the Pico can't tell the two apart, which also makes the dashboard a manual override.

## Architecture

- **Feed polling** — every 3s, `GET /api/v2/{username}/feeds/on-air-sign/data/last` on `io.adafruit.com` with the `X-AIO-Key` header. HTTPS is done by hand (raw `socket` + `ssl`, manual chunked decoding)
- **Values** — `"off"`, `"yellow"`, or `"red"`; anything else is logged and ignored (sign holds its state)
- **Staleness + watchdog** — a datapoint whose `created_epoch` is older than 5 minutes (vs. the NTP-synced clock) is ignored, and the sign turns off if no fresh value arrives for 5 minutes. Covers Adafruit IO outages, Pico WiFi loss, and a host that went offline while the feed still says `"red"`. So the host must refresh the feed during a meeting well inside 5 minutes — throttled (e.g. ~60s) to respect Adafruit IO's rate limit
- **LEDs** — 12-LED WS2812 ring on **GP4** via PIO (8 MHz, GRB)
- **WiFi** — blinks green while connecting, solid green 3s on first boot, auto-reconnects; resets if the first connection fails after 20s
- **Logging** — `logs.log`/`errors.log` on flash (PST via NTP, re-synced every 24h, trimmed at 20KB); read via WebREPL (no HTTP endpoints)

## Key files

- `mac/pico/main.py` — entire firmware
- `mac/pico/secrets.py` — gitignored, lives only on the Pico