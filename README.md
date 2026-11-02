# On Air sign

Automated "On Air" sign using a Raspberry Pi Pico 2 W — shows your meeting and webcam status:
- No meeting → OFF ⚫
- Meeting, camera off → YELLOW 🟡
- Meeting, camera on → RED 🔴

Works with Zoom, Google Meet, Slack Huddle, Webex, and Microsoft Teams on macOS (the legacy Windows host also covers Amazon Chime, but not Webex). Only activates on your home network.

## Hardware
Wire the WS2812 NeoPixel ring data line to **GP4**. Print and assemble the enclosures from `enclosures/` — a snap-fit box for the NeoPixel ring and a case for the Pico 2 W (print settings in [`enclosures/README.md`](enclosures/README.md)).

## Setup (macOS)
The Mac writes the sign state to an [Adafruit IO](https://io.adafruit.com) feed, and Adafruit IO pushes it to the Pico over MQTT, so the two don't need to share a network.

### Pico
Create a feed named `on-air-sign` on Adafruit IO. In Thonny, with the Pico on WiFi, install the `umqtt.simple` package once (Tools → Manage packages), upload `mac/pico/main.py`, and create `secrets.py` on the device:
```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
ADAFRUIT_IO_USERNAME = "<adafruit_io_username>"
ADAFRUIT_IO_KEY = "<adafruit_io_key>"
```
Setting the feed's value (`off`/`yellow`/`red`) on the Adafruit IO dashboard changes the sign by hand.

### Host monitor
Requires Node.js and the Xcode Command Line Tools (`swiftc`).
```bash
cd mac/host
./build.sh
# On your home network, create .env with your router's MAC and Adafruit IO credentials:
echo "HOME_ROUTER_MAC=$(arp -n "$(route -n get default | awk '/gateway:/ {print $2}')" | awk '{print $4}')" > .env
echo "ADAFRUIT_IO_USERNAME=<username>" >> .env
echo "ADAFRUIT_IO_KEY=<key>" >> .env   # Adafruit IO → My Key
node monitor.mjs
```
Grant **Screen Recording** (System Settings → Privacy & Security) to the app running the monitor — your terminal, or under launchd the real `node` binary (`realpath "$(which node)"`). Without it no meeting is detected; the monitor logs it and shows a notification. Homebrew Node upgrades need a re-grant.

To start on login, copy `mac/host/com.onairsign.monitor.plist.example` → `mac/host/com.onairsign.monitor.plist`, fill in your Node.js and repo paths, then:
```bash
cp "mac/host/com.onairsign.monitor.plist" ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.onairsign.monitor.plist
```

## Setup (Windows, legacy)
No longer maintained. The host pushes state to the Pico over the local network, so both must be on the same LAN.

- **Pico** — upload `win/pico/main.py` and `win/pico/dashboard.html`, and create `secrets.py` with `SSID`, `PASSWORD`, and `WEBREPL_PW`. Give the Pico a DHCP reservation matching the IP in `win/host/monitor.mjs`. Optionally host `win/pico/onairsign.html` on your website as a shortcut to the Pico's dashboard
- **Host** — requires Node.js and PowerShell 7. Set `HOME_SSID` (`[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<your_ssid>", "User")`) and run `node win/host/monitor.mjs`. For autostart, fill in `launch-monitor.vbs.example` and `On Air sign monitor.xml.example` (drop `.example`), then import the XML in Task Scheduler

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.
