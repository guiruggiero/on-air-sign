# Pico Firmware Reference (push variant, legacy)

Pairs with `win/host/`. `main.py` is the entire firmware: a single-file MicroPython program, no external libraries, that runs an HTTP server and drives the NeoPixel ring. Shares its LED, WiFi, and logging code with `mac/pico/`.

## Deploying

Upload `main.py` and `dashboard.html` with Thonny (`main.py` runs on boot). Create `secrets.py` on the Pico (gitignored) with `SSID`, `PASSWORD`, and `WEBREPL_PW`.

## Architecture

- **HTTP server** on port 80 (5s accept timeout keeps the loop non-blocking): `GET /off`, `/yellow`, `/red` set the color; `/` serves the control dashboard; `/stats` returns memory and uptime JSON; `/logs` and `/errors` return the log files
- **Watchdog** — turns the sign off if no command arrives for 5 minutes (host crash, PC sleep)
- **LEDs** — 12-LED WS2812 ring on **GP4** via PIO (8 MHz, GRB)
- **WiFi** — blinks green while connecting, solid green 3s on first boot (skipped on reconnect), auto-reconnects and restarts the server; resets if the first connection fails after 20s
- **Logging** — `logs.log`/`errors.log` on flash (PST via NTP, re-synced every 24h, trimmed at 20KB)

The website's admin dashboard can't fetch `/stats` live: the page is HTTPS and the Pico is plain HTTP on the LAN, so the browser blocks it as mixed content. Link-outs (and `onairsign.html`'s redirect) still work, since top-level navigation isn't mixed content. The `mac/` pairing avoids this (the card reads Adafruit IO over HTTPS) — see the roadmap in the root `CLAUDE.md`.

## Key files

- `win/pico/main.py` — entire firmware
- `win/pico/dashboard.html` — control panel served at `/` (also works as a local file)
- `win/pico/onairsign.html` — redirect page for the personal website, so the Pico's IP needn't be remembered
- `win/pico/secrets.py` — gitignored, lives only on the Pico