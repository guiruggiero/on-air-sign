# 🚦 On-Air sign

An automated "On Air" sign using a Raspberry Pi Pico 2 W and a Node.js monitoring script to show your meeting and webcam status:
- No meeting window detected → OFF ⚫
- Meeting window detected, camera off → YELLOW 🟡
- Meeting window detected, camera on → RED 🔴

### ✨ Features

- **Automatic status detection:** Automatically detects active meetings and webcam usage on your computer
- **Multi-app support:** Works with popular apps like Zoom, Google Meet, Slack Huddle, Amazon Chime, and Microsoft Teams
- **Clear visual indicator:** Uses a three-state LED system: OFF, In meeting/cam off (yellow), and In meeting/cam on (red)
- **WiFi-aware:** The monitoring script only runs when you're connected to your specified home WiFi
- **Low-cost hardware:** Built with a Raspberry Pi Pico 2 W and a WS2812 (NeoPixel) LED strip
- **Lightweight monitoring:** Uses a Node.js script with PowerShell 7 for efficient status checking on Windows

### 🏗️ Architecture

There are two main components:

#### Raspberry Pi Pico 2 W (`pico/`)
- A MicroPython script — no external libraries required
- NeoPixel data line on **GP4**, controlled via Pico's PIO state machine
- Connects to WiFi and runs an HTTP server with endpoints for LED control (`/off`, `/yellow`, `/red`) and a web dashboard (`/`)
- Reachable at [http://onairsign.local](http://onairsign.local) via a built-in mDNS responder (`mdns.py`)
- Requires a `secrets.py` on the Pico with `SSID`, `PASSWORD`, and `WEBREPL_PW`
- Logs to `log.txt` on flash (PST timestamps via NTP, re-synced every 24h); auto-trims at 20KB; retrievable via WebREPL
- Upload `main.py`, `mdns.py`, and `dashboard.html` with Thonny

#### Host monitor script (`host/`)
- A Node.js script for Windows — no npm packages required, uses PowerShell 7 (`pwsh`)
- Periodically runs a PowerShell script (`poll.ps1`) that checks lock state, WiFi SSID, active meeting windows by title, and webcam usage via the Windows Registry
- Sends HTTP GET requests to the Pico to update LED color on state changes
- Logs to `host/logs.log` (all events) and `host/errors.log` (errors only); auto-trims at 200KB
- Requires `PICO_IP` and `HOME_SSID` environment variables; assign the Pico a static IP via a DHCP reservation on your router so `PICO_IP` stays stable

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.
