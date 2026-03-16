# Imports
import secrets
import rp2
from machine import Pin
import array
import time
import network
import socket

# Initializations
DATA_PIN = 4
NUM_LEDS = 12
BRIGHTNESS = 0.3  # 0.0 (off) to 1.0 (full brightness)
SSID = secrets.SSID
PASSWORD = secrets.PASSWORD

# Colors (R, G, B)
OFF = (0, 0, 0)
YELLOW = (255, 150, 0)
RED = (255, 0, 0)

# PIO NeoPixel Driver, optimized for Raspberry Pi Pico 2
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

# Internal buffer
pixel_data = array.array("I", [0 for _ in range(NUM_LEDS)])

# Set color and brightness
def set_sign(color):
    r, g, b = color
    
    # Apply brightness
    r = int(r * BRIGHTNESS)
    g = int(g * BRIGHTNESS)
    b = int(b * BRIGHTNESS)
    
    grb = (g << 16) | (r << 8) | b # WS2812 expects GRB order
    
    for i in range(NUM_LEDS):
        pixel_data[i] = grb
    
    sm.put(pixel_data, 8)
    time.sleep_ms(10) # Brief settle time to ensure the PIO FIFO buffer is cleared

# Network logic
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
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

addr = socket.getaddrinfo("0.0.0.0", 80)[0][-1]
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(addr)
s.listen(5)
print(f"Listening on http://{ip}")

while True: 
    conn = None
    try:
        conn, client_addr = s.accept()
        request = conn.recv(1024).decode() # Non-blocking receive with a timeout or small buffer size
        
        if not request:
            continue

        # Parse HTTP request
        try:
            path = request.split(" ")[1] if len(request.split(" ")) > 1 else ""
        except IndexError:
            path = ""

        response_text = "Not Found"
        status = "404 Not Found"

        if path == "/off":
            set_sign(OFF)
            response_text = "OFF"
            status = "200 OK"
        elif path == "/yellow":
            set_sign(YELLOW)
            response_text = "YELLOW"
            status = "200 OK"
        elif path == "/red":
            set_sign(RED)
            response_text = "RED"
            status = "200 OK"

        # Send HTTP response
        response = f"HTTP/1.0 {status}\r\nContent-Type: text/plain\r\n\r\n{response_text}"
        conn.send(response)
    
    except Exception as e:
        print(f"Server error: {e}") # TODO: Sentry?
    
    finally:
        if conn:
            conn.close()