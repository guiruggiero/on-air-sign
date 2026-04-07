# Imports
import secrets
import time
import os
import rp2
import machine
import array
import network
import socket
import gc

# Initializations
SSID = secrets.SSID
PASSWORD = secrets.PASSWORD
WEBREPL_PW = secrets.WEBREPL_PW

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

# Route map: path -> (GRB color, body text)
HEADER_TEXT = b"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
HEADER_HTML = b"HTTP/1.0 200 OK\r\nContent-Type: text/html\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
HEADER_JSON = b"HTTP/1.0 200 OK\r\nContent-Type: application/json\r\nAccess-Control-Allow-Origin: *\r\n\r\n"
HEADER_404  = b"HTTP/1.0 404 Not Found\r\nContent-Type: text/plain\r\nAccess-Control-Allow-Origin: *\r\n\r\nNot Found"
ROUTES = {
    "/off":    (GRB_OFF,    HEADER_TEXT + b"OFF"),
    "/yellow": (GRB_YELLOW, HEADER_TEXT + b"YELLOW"),
    "/red":    (GRB_RED,    HEADER_TEXT + b"RED"),
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

# Start server
def start_server():
    global s
    try:
        s.close()
    except Exception:
        pass
    s = socket.socket()
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(socket.getaddrinfo("0.0.0.0", 80)[0][-1])
    s.listen(5)
    s.settimeout(5.0)
s = None
start_server()
log(f"Server started. Listening")
last_command_time = time.ticks_ms()
last_ntp_sync = time.ticks_ms()
boot_time = time.ticks_ms()
NTP_SYNC_INTERVAL = 24 * 60 * 60 * 1000 # 24 hours

while True:
    gc.collect() # Periodically clean up memory

    # Periodic NTP re-sync to correct clock drift
    if time.ticks_diff(time.ticks_ms(), last_ntp_sync) > NTP_SYNC_INTERVAL:
        sync_ntp()
        last_ntp_sync = time.ticks_ms()

    # Watchdog: turn off sign if monitor stopped sending commands
    if pixel_data[0] != GRB_OFF and time.ticks_diff(time.ticks_ms(), last_command_time) > 300_000: # 5m timeout
        log("No command received in 5 minutes, turning off sign")
        set_sign(GRB_OFF)

    conn = None
    try:
        # Check WiFi status and reconnect if needed
        if not wlan.isconnected():
            log_error("WiFi lost, reconnecting...")
            connect_wifi()
            start_server()

        conn, _ = s.accept()
        conn.settimeout(3.0) # Prevent hanging on unresponsive clients

        raw_request = conn.recv(512) # Get first line
        if not raw_request:
            continue

        try:
            request = raw_request.decode("utf-8")
        except UnicodeError:
            continue # Skip malformed binary requests

        # Extract path from HTTP request
        first_line = request.split("\r\n", 1)[0] # e.g., "GET /yellow HTTP/1.1"
        parts = first_line.split(" ")
        path = parts[1] if len(parts) >= 2 else ""

        # Handle request
        if path in ROUTES:
            grb, response = ROUTES[path]
            log(f"Request: {path}")
            set_sign(grb)
            last_command_time = time.ticks_ms()
            conn.send(response)
        elif path == "/stats":
            gc.collect()
            uptime_s = time.ticks_diff(time.ticks_ms(), boot_time) // 1000
            conn.send(HEADER_JSON)
            conn.send(f'{{"mem_free":{gc.mem_free()},"mem_alloc":{gc.mem_alloc()},"uptime_s":{uptime_s}}}')
        elif path == "/":
            conn.send(HEADER_HTML)
            with open("dashboard.html", "r") as f:
                conn.send(f.read())
        else:
            conn.send(HEADER_404)

    except OSError as e:
        if e.args[0] == 110: # ETIMEDOUT, no client connected, loop back
            pass
        else:
            log_error(f"Server error: {e}")
            start_server() # Recover from socket corruption

    except Exception as e:
        log_error(f"Server error: {e}")

    finally:
        if conn:
            conn.close()