# Imports
import secrets
import os
import time
import rp2
import machine
import array
import network
import json
from umqtt.simple import MQTTClient
import gc

# Initializations
# Adafruit IO feed over MQTT; the /json topic includes created_at
ADAFRUIT_IO_HOST = "io.adafruit.com"
ADAFRUIT_IO_TOPIC = f"{secrets.ADAFRUIT_IO_USERNAME}/feeds/on-air-sign/json"
HEARTBEAT_TOPIC = f"{secrets.ADAFRUIT_IO_USERNAME}/feeds/pico" # Status for the admin card: online if recent
STALE_AFTER_S = 300 # 5m; older means the host stopped refreshing it, so OFF (a manual "red:60" holds 60m)
HEARTBEAT_S = 60 # Not on color changes, to stay inside the 30 writes/min limit
KEEPALIVE_S = 60 # Pinged at half this
LOOP_MS = 200 # Message check interval
RECONNECT_S = 10 # Adafruit IO allows 20 attempts/min
NTP_SYNC_INTERVAL = 24 * 60 * 60 * 1000 # 24 hours

# Persistent logging to flash
LOG_PATH = "logs.log"
ERR_PATH = "errors.log"
LOG_MAX_BYTES = 20_000

# Append a line, trimming to the newest half past LOG_MAX_BYTES
def append_line(path, line):
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
        pass # No file yet
    try:
        with open(path, "a") as f:
            f.write(line + "\n")
    except Exception:
        pass # Logging must never crash the firmware

def log(msg):
    t = time.localtime(time.time() - 8 * 3600)
    line = f"[{t[1]:02}-{t[2]:02} {t[3]:02}:{t[4]:02}:{t[5]:02}] {msg}"
    print(line)
    append_line(LOG_PATH, line)
    return line

def log_error(msg):
    append_line(ERR_PATH, log(msg))

# GRB values (brightness-adjusted, GRB byte order for WS2812)
BRIGHTNESS = 0.4  # 0.0 (off) to 1.0 (full brightness)
def _to_grb(r, g, b):
    return (int(g * BRIGHTNESS) << 16) | (int(r * BRIGHTNESS) << 8) | int(b * BRIGHTNESS)
GRB_OFF    = _to_grb(0, 0, 0)
GRB_GREEN  = _to_grb(0, 255, 0)
STATE_MAP = {
    "off":    GRB_OFF,
    "yellow": _to_grb(204, 153, 0),
    "red":    _to_grb(255, 0, 0),
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
    time.sleep_ms(10) # Let the PIO FIFO drain

# Sync local clock to NTP time (UTC)
def sync_ntp():
    try:
        import ntptime
        ntptime.settime()
        log("NTP time synced")
        return True
    except Exception as e:
        log_error(f"NTP sync failed: {e}")
        return False

# Connect to WiFi
wlan = network.WLAN(network.STA_IF)
def connect_wifi(initial = False):
    wlan.active(True)
    if not wlan.isconnected():
        wlan.connect(secrets.SSID, secrets.PASSWORD)
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

    log(f"Connected! IP: {wlan.ifconfig()[0]}")
    if initial:
        set_sign(GRB_GREEN) # Solid green on first boot
        time.sleep(3)
        set_sign(GRB_OFF)

connect_wifi(initial = True)

# WebREPL for updating files over WiFi
try:
    import webrepl
    webrepl.start(password = secrets.WEBREPL_PW) # micropython.org/webrepl, ws://<PICO_IP>:8266
except Exception:
    log_error("WebREPL not available")

# Staleness needs real time, so wait for the first sync
while not sync_ntp():
    time.sleep(RECONNECT_S)
    connect_wifi() # Reconnects if WiFi dropped
last_ntp_sync = time.ticks_ms()
boot_time = time.time() - time.ticks_ms() // 1000 # For uptime; ticks_ms wraps after ~12 days, the clock doesn't

# Latest feed color, its UTC write time, and how long it holds; stale until the first message
feed_value = "off"
feed_created = 0
feed_hold_s = STALE_AFTER_S
shown = "off" # For the heartbeat; the ring itself can be green while WiFi reconnects

# /get replies are the record itself; live pushes nest it under "data"
def on_message(topic, msg):
    global feed_value, feed_created, feed_hold_s
    try:
        message = json.loads(msg)
        record = message.get("data", message)
        color, _, hold_min = record["value"].partition(":") # "red" from the host, or "red:60" for a manual 60-minute hold
        if color not in STATE_MAP or (hold_min and not hold_min.isdigit()):
            log_error(f"Unknown feed value: {record['value']}")
            return
        t = record["created_at"] # e.g. "2026-11-02T07:31:51Z" (live pushes add milliseconds)
        feed_created = time.mktime((int(t[0:4]), int(t[5:7]), int(t[8:10]), int(t[11:13]), int(t[14:16]), int(t[17:19]), 0, 0))
        feed_value = color
        feed_hold_s = int(hold_min) * 60 if hold_min else STALE_AFTER_S
    except Exception as e:
        log_error(f"Bad feed message: {e}")

# TLS connection; /get asks for the current value (counts as 1 data point)
mqtt = MQTTClient("on-air-sign-pico", ADAFRUIT_IO_HOST, user = secrets.ADAFRUIT_IO_USERNAME, password = secrets.ADAFRUIT_IO_KEY,
                  keepalive = KEEPALIVE_S, ssl = True, ssl_params = {"server_hostname": ADAFRUIT_IO_HOST})
mqtt.set_callback(on_message)
def connect_mqtt():
    mqtt.connect()
    mqtt.subscribe(ADAFRUIT_IO_TOPIC)
    mqtt.publish(f"{ADAFRUIT_IO_TOPIC}/get", b"")
    log("Connected to Adafruit IO")

# Heartbeat: the color actually shown, uptime, and memory in bytes (publishing also serves as the keepalive)
def send_heartbeat():
    gc.collect()
    mqtt.publish(HEARTBEAT_TOPIC, json.dumps({"state": shown, "uptime_s": time.time() - boot_time, "mem_used": gc.mem_alloc(), "mem_free": gc.mem_free()}))

mqtt_connected = False
last_ping = time.ticks_ms()
last_heartbeat = time.ticks_ms()

while True:
    # Daily NTP re-sync for clock drift
    if time.ticks_diff(time.ticks_ms(), last_ntp_sync) > NTP_SYNC_INTERVAL:
        sync_ntp()
        last_ntp_sync = time.ticks_ms()

    try:
        if not wlan.isconnected():
            log_error("WiFi lost, reconnecting...")
            mqtt_connected = False
            connect_wifi()

        if not mqtt_connected:
            connect_mqtt()
            mqtt_connected = True
            send_heartbeat()
            last_ping = last_heartbeat = time.ticks_ms()

        if mqtt.check_msg() is not None: # Non-blocking; calls on_message
            gc.collect() # Only messages and reconnects allocate
        if time.ticks_diff(time.ticks_ms(), last_heartbeat) > HEARTBEAT_S * 1000:
            send_heartbeat()
            last_ping = last_heartbeat = time.ticks_ms()
        elif time.ticks_diff(time.ticks_ms(), last_ping) > KEEPALIVE_S * 500:
            mqtt.ping()
            last_ping = time.ticks_ms()

    except Exception as e:
        log_error(f"MQTT error, reconnecting in {RECONNECT_S}s: {e}")
        mqtt_connected = False
        try:
            mqtt.sock.close()
        except Exception:
            pass
        time.sleep(RECONNECT_S)

    # Stale means OFF: host offline, OFF (never re-written), or connection down
    value = feed_value if time.time() - feed_created <= feed_hold_s else "off"
    if STATE_MAP[value] != pixel_data[0]:
        log(f"State changed: {value}")
        set_sign(STATE_MAP[value])
        shown = value

    time.sleep_ms(LOOP_MS)