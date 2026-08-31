# Imports
import secrets
import time
import os
import rp2
import machine
import array
import network
import socket
import ssl
import json
import gc

# Initializations
SSID = secrets.SSID
PASSWORD = secrets.PASSWORD
WEBREPL_PW = secrets.WEBREPL_PW
AIO_USERNAME = secrets.AIO_USERNAME
AIO_KEY = secrets.AIO_KEY

# Adafruit IO feed ("red", "yellow", or "off")
AIO_HOST = "io.adafruit.com"
AIO_FEED = "on-air-sign"
AIO_PATH = f"/api/v2/{AIO_USERNAME}/feeds/{AIO_FEED}/data/last"
POLL_INTERVAL_MS = 3_000 # 3s
WATCHDOG_TIMEOUT_MS = 300_000 # 5m; turn off if feed unreachable or stale info
UNIX_EPOCH_OFFSET = 946_684_800 # seconds between Adafruit IO's created_epoch and MicroPython's time.time() epoch

# Persistent logging to flash
LOG_PATH = "logs.log"
ERR_PATH = "errors.log"
LOG_MAX_BYTES = 20_000

def trim_log(path):
    try:
        size = os.stat(path)[6]
        if size > LOG_MAX_BYTES:
            with open(path, "r") as f:
                f.seek(size // 2)
                f.readline() # Discard the partial line at the seek point
                keep = f.read()
            with open(path, "w") as f:
                f.write(keep)
    except OSError:
        pass

def log(msg):
    t = time.localtime(time.time() - 8 * 3600)
    line = f"[{t[1]:02}-{t[2]:02} {t[3]:02}:{t[4]:02}:{t[5]:02}] {msg}"
    print(line)
    try:
        trim_log(LOG_PATH)
        with open(LOG_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass
    return line

def log_error(msg):
    line = log(msg)
    try:
        trim_log(ERR_PATH)
        with open(ERR_PATH, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass

# GRB values (brightness-adjusted, GRB byte order for WS2812)
BRIGHTNESS = 0.4  # 0.0 (off) to 1.0 (full brightness)
def _to_grb(r, g, b):
    return (int(g * BRIGHTNESS) << 16) | (int(r * BRIGHTNESS) << 8) | int(b * BRIGHTNESS)
GRB_OFF    = _to_grb(0, 0, 0)
GRB_YELLOW = _to_grb(204, 153, 0)
GRB_RED    = _to_grb(255, 0, 0)
GRB_GREEN  = _to_grb(0, 255, 0)

STATE_MAP = {
    "off": GRB_OFF,
    "o": GRB_OFF,
    "yellow": GRB_YELLOW,
    "y": GRB_YELLOW,
    "red": GRB_RED,
    "r": GRB_RED,
}

# PIO NeoPixel driver for Raspberry Pi Pico 2
@rp2.asm_pio(sideset_init = rp2.PIO.OUT_LOW, out_shiftdir = rp2.PIO.SHIFT_LEFT, autopull = True, pull_thresh = 24)
def ws2812():
    T1, T2, T3 = 2, 5, 3
    wrap_target()
    label("bitloop")
    out(x, 1).side(0)[T3 - 1]
    jmp(not_x, "do_zero").side(1)[T1 - 1]
    jmp("bitloop").side(1)[T2 - 1]
    label("do_zero")
    nop().side(0)[T2 - 1]
    wrap()

# Initialize StateMachine on the data pin
DATA_PIN = 4
NUM_LEDS = 12
sm = rp2.StateMachine(0, ws2812, freq = 8_000_000, sideset_base = machine.Pin(DATA_PIN))
sm.active(1)
pixel_data = array.array("I", [0] * NUM_LEDS) # Internal buffer

# Change color of LEDs
def set_sign(grb):
    for i in range(NUM_LEDS):
        pixel_data[i] = grb
    sm.put(pixel_data, 8) # Send to PIO
    time.sleep_ms(10) # Brief settle time to ensure the PIO FIFO buffer is cleared

# Sync local clock to NTP time
def sync_ntp():
    try:
        import ntptime
        ntptime.settime()
        log("NTP time synced")
    except Exception:
        log_error("NTP sync failed")

# Connect to WiFi
wlan = network.WLAN(network.STA_IF)
def connect_wifi(initial=False):
    wlan.active(True)
    if not wlan.isconnected():
        wlan.connect(SSID, PASSWORD)
        log("Connecting to WiFi...")
        on = False
        for _ in range(40): # 20s timeout
            if wlan.isconnected():
                break
            on = not on
            set_sign(GRB_GREEN if on else GRB_OFF) # Blink green while connecting
            time.sleep(0.5)
        else:
            set_sign(GRB_OFF)
            log_error("WiFi connection failed, resetting...")
            machine.reset()

    ip = wlan.ifconfig()[0]
    log(f"Connected! IP: {ip}")
    sync_ntp()
    if initial:
        set_sign(GRB_GREEN) # Solid green on first boot
        time.sleep(3)
        set_sign(GRB_OFF)
    return ip

ip = connect_wifi(initial=True)

# WebREPL for updating files over WiFi
try:
    import webrepl
    webrepl.start(password = WEBREPL_PW) # Update via WiFi on http://micropython.org/webrepl with ws://<PICO_IP>:8266
except Exception:
    log_error("WebREPL not available")

# Dechunk an HTTP/1.1 chunked-transfer-encoded body
def dechunk(data):
    out = b""
    while data:
        size_end = data.index(b"\r\n")
        size = int(data[:size_end], 16)
        if size == 0:
            break
        chunk_start = size_end + 2
        out += data[chunk_start:chunk_start + size]
        data = data[chunk_start + size + 2:] # Skip the chunk's trailing \r\n
    return out

# Minimal HTTPS GET; reads until the server closes the connection
def https_get(host, path, headers):
    addr = socket.getaddrinfo(host, 443)[0][-1]
    raw = socket.socket()
    raw.settimeout(8.0)
    raw.connect(addr)
    s = ssl.wrap_socket(raw, server_hostname=host)
    try:
        req_lines = [f"GET {path} HTTP/1.1", f"Host: {host}", "Connection: close"]
        for k, v in headers.items():
            req_lines.append(f"{k}: {v}")
        req_lines.append("\r\n")
        s.write("\r\n".join(req_lines).encode())

        data = b""
        while True:
            chunk = s.read(1024)
            if not chunk:
                break
            data += chunk
    finally:
        s.close()

    header_end = data.index(b"\r\n\r\n")
    header_text = data[:header_end].decode()
    body = data[header_end + 4:]

    status_code = int(header_text.split("\r\n", 1)[0].split(" ")[1])
    resp_headers = {}
    for line in header_text.split("\r\n")[1:]:
        if ":" in line:
            k, v = line.split(":", 1)
            resp_headers[k.strip().lower()] = v.strip()

    if resp_headers.get("transfer-encoding") == "chunked":
        body = dechunk(body)

    return status_code, body

# Fetch current state and last update time from Adafruit IO
def fetch_state():
    status, body = https_get(AIO_HOST, AIO_PATH, {"X-AIO-Key": AIO_KEY})
    if status != 200:
        raise Exception(f"Adafruit IO returned HTTP {status}")
    data = json.loads(body)
    return data["value"], int(data["created_epoch"])

log(f"Polling Adafruit IO every {POLL_INTERVAL_MS // 1000}s")
last_fresh_time = time.ticks_ms()
last_ntp_sync = time.ticks_ms()
NTP_SYNC_INTERVAL = 24 * 60 * 60 * 1000 # 24 hours
STALE_MSG_LOGGED = False

while True:
    gc.collect() # Periodically clean up memory

    # Periodic NTP re-sync to correct clock drift
    if time.ticks_diff(time.ticks_ms(), last_ntp_sync) > NTP_SYNC_INTERVAL:
        sync_ntp()
        last_ntp_sync = time.ticks_ms()

    try:
        if not wlan.isconnected():
            log_error("WiFi lost, reconnecting...")
            connect_wifi()

        value, created_epoch = fetch_state()
        age_s = (time.time() + UNIX_EPOCH_OFFSET) - created_epoch

        if age_s <= WATCHDOG_TIMEOUT_MS // 1000:
            last_fresh_time = time.ticks_ms()
            STALE_MSG_LOGGED = False

            grb = STATE_MAP.get(value)
            if grb is None:
                log_error(f"Unknown feed value: {value}")
            elif grb != pixel_data[0]:
                log(f"State changed: {value}")
                set_sign(grb)
        elif not STALE_MSG_LOGGED:
            log(f"Feed value is stale ({age_s}s old), ignoring until it updates")
            STALE_MSG_LOGGED = True

    except Exception as e:
        log_error(f"Poll failed: {e}")

    # Watchdog: turn off sign if feed unreachable or stale info
    if pixel_data[0] != GRB_OFF and time.ticks_diff(time.ticks_ms(), last_fresh_time) > WATCHDOG_TIMEOUT_MS:
        log("No fresh feed value in 5 minutes, turning off sign")
        set_sign(GRB_OFF)

    time.sleep_ms(POLL_INTERVAL_MS)