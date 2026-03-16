# 🚦 On-Air sign

An automated "On-Air" sign using a Raspberry Pi Pico 2 W and a Node.js monitoring script to show your meeting and webcam status:
- No meeting window detected → OFF ⚫
- Meeting window detected, camera off → YELLOW 🟡
- Meeting window detected, camera on → RED 🔴

### ✨ Features

- **Automatic status detection:** Automatically detects active meetings and webcam usage on your computer
- **Multi-app support:** Works with popular meeting applications Zoom, Google Meet, Slack Huddle, and Amazon Chime
- **Clear visual indicator:** Uses a three-state LED system: OFF, In meeting/cam off (yellow), and In meeting/cam on (red)
- **WiFi-aware:** The monitoring script only runs when you're connected to your specified home WiFi
- **Low-cost hardware:** Built with an affordable Raspberry Pi Pico 2 W and a WS2812 (NeoPixel) LED strip
- **Lightweight monitoring:** Uses a simple Node.js script with PowerShell commands for efficient status checking on Windows

### 🏗️ Architecture

There are two main components:

#### Raspberry Pi Pico 2 W (`main.py`)
- A MicroPython script that runs on the Pico 2 W
- No external libraries required
- Connects to the local WiFi network to receive commands
- Hosts a simple web server with three endpoints (`/off`, `/yellow`, and `/red`).
- Controls a WS2812 (NeoPixel) LED strip using Pico's Programmable I/O (PIO) for high performance

#### Host monitor script (`monitor.js`)
- A Node.js script that runs on a Windows computer
- No external npm packages required
- Periodically checks for active meeting application windows by title
- Checks if the webcam is currently in use via the Windows Registry
- Verifies the computer is connected to the correct WiFi network (SSID) before sending commands
- Sends HTTP GET requests to Raspberry Pi Pico 2 W to update the LED color based on the detected status

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.