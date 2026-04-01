# Imports
import secrets
import rp2
import machine
import array
import time
import network
import socket
import gc

# Initializations
DATA_PIN = 4
NUM_LEDS = 12
BRIGHTNESS = 0.4  # 0.0 (off) to 1.0 (full brightness)
SSID = secrets.SSID
PASSWORD = secrets.PASSWORD
WEBREPL_PW = secrets.WEBREPL_PW

# GRB values (brightness-adjusted, GRB byte order for WS2812)
def _to_grb(r, g, b):
    return (int(g * BRIGHTNESS) << 16) | (int(r * BRIGHTNESS) << 8) | int(b * BRIGHTNESS)
GRB_OFF    = _to_grb(0, 0, 0)
GRB_YELLOW = _to_grb(204, 153, 0)
GRB_RED    = _to_grb(255, 0, 0)
GRB_GREEN  = _to_grb(0, 255, 0)

# Route map: path -> (GRB color, response bytes)
ROUTES = {
    "/off":    (GRB_OFF,    b"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nOFF"),
    "/yellow": (GRB_YELLOW, b"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nYELLOW"),
    "/red":    (GRB_RED,    b"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nRED"),
}
NOT_FOUND = b"HTTP/1.0 404 Not Found\r\nContent-Type: text/plain\r\n\r\nNot Found"
with open("dashboard.html", "r") as f:
    INDEX_PAGE = b"HTTP/1.0 200 OK\r\nContent-Type: text/html\r\n\r\n" + f.read().encode()

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
sm = rp2.StateMachine(0, ws2812, freq = 8_000_000, sideset_base = machine.Pin(DATA_PIN))
sm.active(1)

pixel_data = array.array("I", [0] * NUM_LEDS) # Internal buffer

# Change color of LEDs
def set_sign(grb):
    for i in range(NUM_LEDS):
        pixel_data[i] = grb
    sm.put(pixel_data, 8) # Send to PIO
    time.sleep_ms(10) # Brief settle time to ensure the PIO FIFO buffer is cleared

# Connect to WiFi
wlan = network.WLAN(network.STA_IF)
def connect_wifi():
    wlan.active(True)
    if not wlan.isconnected():
        wlan.connect(SSID, PASSWORD)
        print("Connecting to WiFi", end = "")
        on = False
        for _ in range(40):  # 20s timeout
            if wlan.isconnected():
                break
            on = not on
            set_sign(GRB_GREEN if on else GRB_OFF) # Blink green while connecting
            print(".", end = "")
            time.sleep(0.5)
        else:
            set_sign(GRB_OFF)
            print("\nWiFi connection failed, resetting...")
            machine.reset()

    set_sign(GRB_GREEN) # Solid green when connected
    ip = wlan.ifconfig()[0]
    print(f"\nConnected! IP: {ip}")
    time.sleep(3)
    set_sign(GRB_OFF)
    return ip
ip = connect_wifi()

# mDNS responder for http://onairsign.local
from mdns import MDNSResponder
mdns = MDNSResponder("onairsign", ip)
mdns.start()

# WebREPL for updating files over WiFi
try:
    import webrepl
    webrepl.start(password = WEBREPL_PW) # Update via WiFi on http://micropython.org/webrepl with ws://<PICO_IP>:8266, TODO: test
except Exception:
    print("WebREPL not available")

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
print(f"Listening on http://{ip}")
last_command_time = time.ticks_ms()

while True:
    gc.collect() # Periodically clean up memory
    mdns.process() # Handle mDNS queries

    # Watchdog: turn off sign if monitor stopped sending commands
    if pixel_data[0] != GRB_OFF and time.ticks_diff(time.ticks_ms(), last_command_time) > 300_000: # 5m timeout
        print("No command received in 5 minutes, turning off sign")
        set_sign(GRB_OFF)

    conn = None
    try:
        # Check WiFi status and reconnect if needed
        if not wlan.isconnected():
            print("WiFi lost, reconnecting...")
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
        first_line = request.split("\r\n", 1)[0]  # e.g., "GET /yellow HTTP/1.1"
        parts = first_line.split(" ")
        path = parts[1] if len(parts) >= 2 else ""

        # Handle request
        if path in ROUTES:
            grb, response = ROUTES[path]
            set_sign(grb)
            last_command_time = time.ticks_ms()
            conn.send(response)
        elif path == "/":
            conn.send(INDEX_PAGE)
        else:
            conn.send(NOT_FOUND)

    except OSError as e:
        if e.args[0] == 110: # ETIMEDOUT, no client connected, loop back
            pass
        else:
            print(f"Server error: {e}")
            start_server() # Recover from socket corruption

    except Exception as e:
        print(f"Server error: {e}") # TODO: some logging?

    finally:
        if conn:
            conn.close()