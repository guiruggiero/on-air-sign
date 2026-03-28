# Imports
import secrets
import rp2
from machine import Pin
import array
import time
import network
import webrepl
import socket
import gc

# Initializations
DATA_PIN = 4
NUM_LEDS = 12
BRIGHTNESS = 0.4  # 0.0 (off) to 1.0 (full brightness)
SSID = secrets.SSID
PASSWORD = secrets.PASSWORD
RESPONSES = {
    "/off": b"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nOFF",
    "/yellow": b"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nYELLOW",
    "/red": b"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nRED",
}
NOT_FOUND = b"HTTP/1.0 404 Not Found\r\nContent-Type: text/plain\r\n\r\nNot Found"
HTML = b"""\
    HTTP/1.0 200 OK
    Content-Type: text/html

    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>On Air Sign</title>
    </head>
    <body>
        <h1>On Air Sign</h1>
        <button onclick="fetch('/red')">Red</button>
        <button onclick="fetch('/yellow')">Yellow</button>
        <button onclick="fetch('/off')">Off</button>
        </body>
    </html>
    """ # TODO: colored buttons (update also control.html)

# Colors (R, G, B)
OFF = (0, 0, 0)
YELLOW = (255, 150, 0)
RED = (255, 0, 0)

# PIO NeoPixel driver for Raspberry Pi Pico 2
@rp2.asm_pio(sideset_init=rp2.PIO.OUT_LOW, out_shiftdir=rp2.PIO.SHIFT_LEFT, autopull=True, pull_thresh=24)
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
sm = rp2.StateMachine(0, ws2812, freq=8_000_000, sideset_base=Pin(DATA_PIN))
sm.active(1)

pixel_data = array.array("I", [0] * NUM_LEDS) # Internal buffer

# Change color of LEDs
def set_sign(color):
    r, g, b = color
    
    # Apply brightness
    r = int(r * BRIGHTNESS)
    g = int(g * BRIGHTNESS)
    b = int(b * BRIGHTNESS)
    
    grb = (g << 16) | (r << 8) | b # Converts to GRB order (expected by WS2812)
    
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
        print("Connecting to WiFi", end="")
        while not wlan.isconnected():
            print(".", end="")
            time.sleep(0.5)
    
    ip = wlan.ifconfig()[0]
    print(f"\nConnected! IP: {ip}")
    return ip

# Main
ip = connect_wifi()
set_sign(OFF)
mdns = network.mDNS()
mdns.hostname("onairsign") # Manual control on http://onairsign.local, TODO: test
mdns.start()
webrepl.start() # Script update via wi-fi on http://micropython.org/webrepl, TODO: test

# Start server
addr = socket.getaddrinfo("0.0.0.0", 80)[0][-1]
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(addr)
s.listen(5)
s.settimeout(5.0)
print(f"Listening on http://{ip}")

while True: 
    gc.collect() # Periodically clean up memory
    
    conn = None
    try:
        # Check WiFi status and reconnect if needed
        if not wlan.isconnected():
            print("WiFi lost, reconnecting...")
            connect_wifi()

        conn, client_addr = s.accept()
        conn.settimeout(3.0) # Prevent hanging on unresponsive clients

        raw_request = conn.recv(256) # Get first line
        if not raw_request:
            continue

        try:
            request = raw_request.decode("utf-8")
        except UnicodeError:
            continue # Skip malformed binary requests

        # Extract path from HTTP request
        try:
            first_line = request.split("\r\n")[0]  # e.g. "GET /yellow HTTP/1.1"
            parts = first_line.split(" ")
            path = parts[1] if len(parts) >= 2 else ""
        except IndexError:
            path = ""

        # Send HTTP response
        response = RESPONSES.get(path, NOT_FOUND)

        if path == "/":
            conn.send(HTML) # TODO: test, conn.send(HTML.encode())
        elif path == "/off":
            set_sign(OFF)
        elif path == "/yellow":
            set_sign(YELLOW)
        elif path == "/red":
            set_sign(RED)

        conn.send(response)
    
    except OSError as e:
        if e.args[0] == 110: # ETIMEDOUT, no client connected, loop back
            pass
        else:
            print(f"Server error: {e}")

    except Exception as e:
        print(f"Server error: {e}") # TODO: Sentry?
    
    finally:
        if conn:
            conn.close()