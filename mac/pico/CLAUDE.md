# Pico Firmware Reference (MQTT variant)

Pairs with `mac/host/`. `main.py` is the entire firmware: a single-file MicroPython program that receives the Adafruit IO feed over MQTT and drives the NeoPixel ring. Its only dependency is `umqtt.simple` (micropython-lib, not bundled in the firmware). Outbound connections only, so it works behind any NAT.

## Deploying

1. With the Pico on WiFi, install the MQTT client once (it lives in `/lib` and survives `main.py` updates): Thonny → Tools → Manage packages → `umqtt.simple`, or in the REPL `import mip; mip.install("umqtt.simple")`
2. Upload `main.py` with Thonny (runs on boot)
3. Create `secrets.py` on the Pico (gitignored):

```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
ADAFRUIT_IO_USERNAME = "<adafruit_io_username>"
ADAFRUIT_IO_KEY = "<adafruit_io_key>"
```

`mac/host` writes the feed over HTTP; setting its value by hand on the Adafruit IO dashboard works too (the Pico can't tell the two apart), which makes the dashboard a manual override. A manual value can add a hold in minutes, e.g. `red:60`: it stays that long instead of 5 minutes, unless the host changes state first.

## Architecture

- **MQTT** — one TLS connection to `io.adafruit.com:8883`, subscribed to `{username}/feeds/on-air-sign/json`. HTTP writes are pushed to it immediately. On every connect it publishes to `…/json/get` for the current value (1 data point; the 30/min limit only counts publishes)
- **Message shapes** — `/get` replies are the data record (`value`, `created_at`); live pushes are a feed object with the record under `data` (`created_at` with milliseconds). `on_message` handles both; unknown values and malformed messages are logged and ignored
- **Staleness** — `created_at` (UTC) becomes a timestamp via `time.mktime`, on the same UTC clock `ntptime` sets. A value older than 5 minutes shows as OFF: the host went offline, or it's OFF (never re-written; YELLOW/RED are every 60s). A dropped connection means no new values, so this also covers Adafruit IO or WiFi outages — no separate watchdog
- **Heartbeat** — on connect and every 60s it publishes `{"state", "uptime_s", "mem_free"}` to the `pico` feed, so the admin card can show online/offline (from the timestamp) and the color actually shown. Not on color changes: those follow the host's writes, and echoing them could push the combined writes past 30/min (over MQTT, a disconnect or ban)
- **Connection** — checked every 200ms (`check_msg`, non-blocking), pinged every 30s (60s keepalive). On errors it waits 10s and reconnects (Adafruit IO allows 20 attempts/min; only rejected subscribes/publishes cause bans)
- **Clock** — at boot, NTP is retried every 10s until it succeeds (staleness needs real time; the sign stays OFF until then), then re-synced daily
- **LEDs** — 12-LED WS2812 ring on **GP4** via PIO (8 MHz, GRB)
- **WiFi** — blinks green while connecting, solid green 3s on first boot, auto-reconnects; resets the Pico if any connection attempt fails after 20s
- **Logging** — `logs.log`/`errors.log` on flash (PST via NTP, trimmed at 20KB); read via WebREPL (no HTTP endpoints)

Accepted: TLS doesn't verify Adafruit IO's certificate (MicroPython default), and log times are fixed PST (an hour off during daylight saving time).