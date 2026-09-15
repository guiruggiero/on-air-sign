# Pico Firmware Reference (pull variant)

Pairs with `host-mac/`. See [pico-push/CLAUDE.md](../pico-push/CLAUDE.md) for the push variant that pairs with `host-win/` — the two share the same WiFi/LED/logging code, but differ in how they learn the sign state.

## Deploying to the Pico

Upload `main.py` from `pico-pull/` to the Pico 2 W using Thonny; it runs automatically on boot. A `secrets.py` must exist on the Pico (gitignored) with:

```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
AIO_USERNAME = "<adafruit_io_username>"
AIO_KEY = "<adafruit_io_key>"
```

## Architecture

`pico-pull/main.py` is the entire Pico firmware — a single-file MicroPython program that polls an Adafruit IO feed over HTTPS and drives the NeoPixel ring. Unlike `pico-push`, it runs no server and accepts no inbound connections — the Pico only ever makes outbound requests, so it needs no LAN adjacency with the host and can sit behind any network/NAT.

### Feed polling

- Polls `GET /api/v2/{username}/feeds/on-air-sign/data/last` on `io.adafruit.com` every 3s, authenticated via the `X-AIO-Key` header
- Expects the feed's `value` to be `"off"`, `"yellow"`, or `"red"`; any other value is logged as an error and ignored (sign holds its last state)
- Checks the datapoint's `created_epoch` against the Pico's NTP-synced clock; a value older than `WATCHDOG_TIMEOUT_MS` (5m) is treated as stale and ignored, same as an unreachable feed. This is what catches a `host-mac` that went offline while the feed still held `"red"`/`"yellow"` — a stale value would otherwise keep "succeeding" on every poll forever
- HTTPS request/response handled by hand (raw `socket` + `ssl`, manual chunked-transfer decoding) to avoid pulling in an HTTP client library — consistent with `pico-push`'s "no external libraries" approach
- `host-mac` will write to the same feed on state changes (**not yet implemented** — see `README.md`); until then, set the feed's value manually from the Adafruit IO dashboard to test the Pico side. The dashboard can also write to it directly for manual override once `host-mac` is wired up — the Pico can't tell the two apart, and doesn't need to

### Shared with `pico-push`

- **NeoPixel/LED control** — drives a 12-LED WS2812 NeoPixel ring on **GP4** using the Pico's PIO state machine (bit-banged at 8 MHz, GRB color order)
- **WiFi and reconnect** — blinks green while connecting, solid green for 3s on first boot, auto-reconnects on WiFi loss; resets the Pico if the initial connection fails after 20s
- **Logging and NTP** — logs to `logs.log`/`errors.log` on flash (PST via NTP, re-synced every 24h, auto-trimmed at 20KB)

### Watchdog

Turns off the sign if no *fresh* feed value has been seen in 5 minutes — covers Adafruit IO outages, Pico WiFi loss, and (via the staleness check above) a `host-mac` that stopped updating the feed. This is the inverse of `pico-push`'s watchdog, which times out on no *command received* (there the host pushes rather than the Pico pulling).

5 minutes is chosen to match `HEARTBEAT_INTERVAL_MS` in `host-mac/monitor.js`, which already re-sends state on that cadence during an active meeting (currently to the Pico's old local IP) — once `host-mac` writes to this feed instead, the same heartbeat keeps a long-running RED/YELLOW state from going stale on its own.

Unlike `pico-push`, there are no `/logs`/`/errors` HTTP endpoints (no server to serve them) — retrieve via WebREPL only.

## Key files

- `pico-pull/main.py` — entire Pico firmware (single file, MicroPython)
- `pico-pull/secrets.py` — gitignored, lives only on the Pico; must contain `SSID`, `PASSWORD`, `WEBREPL_PW`, `AIO_USERNAME`, `AIO_KEY`
