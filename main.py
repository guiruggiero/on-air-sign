# Imports
import secrets
import neopixel
from machine import Pin
import network
import time
import socket

# Initializations
DATA_PIN = 4
NUM_LEDS = 12
SSID = secrets.SSID
PASSWORD = secrets.PASSWORD

# Colors
OFF = (0, 0, 0)
YELLOW = (255, 180, 0)
RED = (255, 0, 0)

# Setup
np = neopixel.NeoPixel(Pin(DATA_PIN), NUM_LEDS)

# Set color of all LEDs
def set_sign(color):
    for i in range(NUM_LEDS):
        np[i] = color
    np.write()

# Connect to WiFi
def connect_wifi():
    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)
    wlan.connect(SSID, PASSWORD)
    print("Connecting to WiFi", end="")
    while not wlan.isconnected():
        print(".", end="")
        time.sleep(0.5)
    print("\nConnected! IP:", wlan.ifconfig()[0])
    return wlan.ifconfig()[0]

# Main
ip = connect_wifi()
set_sign(OFF)

addr = socket.getaddrinfo("0.0.0.0", 80)[0][-1]
s = socket.socket()
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
s.bind(addr)
s.listen(5)
print("Listening on", ip)

while True: 
    conn = None
    try:
        conn, addr = s.accept()
        request = conn.recv(1024).decode()
        
        path = ""
        if request:
            try:
                path = request.split("\r\n")[0].split(" ")[1]
            except IndexError:
                pass # Malformed request, results in 404

        if path == "/off":
            set_sign(OFF)
            conn.send("HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nOFF")
        elif path == "/yellow":
            set_sign(YELLOW)
            conn.send("HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nYELLOW")
        elif path == "/red":
            set_sign(RED)
            conn.send("HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\n\r\nRED")
        else:
            conn.send("HTTP/1.0 404 Not Found\r\nContent-Type: text/plain\r\n\r\nNot Found")
    
    finally:
        if conn:
            conn.close()