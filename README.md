# On Air sign

Automated "On Air" sign using a Raspberry Pi Pico 2 W — shows your meeting and webcam status:
- No meeting → OFF ⚫
- Meeting, camera off → YELLOW 🟡
- Meeting, camera on → RED 🔴

Works with Zoom, Google Meet, Slack Huddle, Amazon Chime, and Microsoft Teams. Only activates when connected to your home WiFi.

## Setup

### Pico
Upload `pico/main.py` and `pico/dashboard.html` to the Pico 2 W using Thonny. Create `pico/secrets.py` on the device:
```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
```
Wire the WS2812 NeoPixel ring data line to **GP4**.

Print and assemble the enclosures from `enclosures/` — a snap-fit box for the NeoPixel ring and a case for the Pico 2 W. See [`enclosures/README.md`](enclosures/README.md) for print settings.

Optionally, upload `pico/onairsign.html` to your personal website for easy access to the dashboard without remembering the IP.

### Host monitor (Windows)
Requires Node.js and PowerShell 7 (`pwsh`). Set the HOME_SSID environment variable:
```powershell
[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<your_ssid>", "User")
```
Then run:
```powershell
node host-win/monitor.js
```
Assign the Pico a static IP via a DHCP reservation on your router so the hardcoded IP in `monitor.js` never changes.

### Autostart (Windows)
To run the monitor automatically on login via Windows Task Scheduler:
1. Copy `host-win/launch-monitor.vbs.example` → `host-win/launch-monitor.vbs` and fill in your Node.js path and repo path
2. Copy `host-win/On Air sign monitor.xml.example` → `host-win/On Air sign monitor.xml` and replace `DOMAIN\username`, `DATE`, and the paths in `<Actions>`
3. Open Task Scheduler → Action → Import Task, and select `host-win\On Air sign monitor.xml`

### Host monitor (macOS)
Requires Xcode Command Line Tools (for `swiftc`/`codesign`) — no other dependencies. Set the HOME_SSID environment variable and build:
```sh
export HOME_SSID="<your_ssid>"
cd host-mac
./build.sh
```
Then run:
```sh
./monitor
```
Assign the Pico a static IP via a DHCP reservation on your router so the hardcoded IP in `main.swift` never changes. On first run, grant `host-mac/monitor` **Screen Recording** permission in System Settings → Privacy & Security so it can detect meeting-app windows (and Camera permission too, if camera detection doesn't pick up an active call — see `host-mac/CLAUDE.md` for details).

### Autostart (macOS)
To run the monitor automatically on login via a `launchd` LaunchAgent:
1. Copy `host-mac/com.onairsign.monitor.plist.example` → `host-mac/com.onairsign.monitor.plist` and fill in the absolute paths and `HOME_SSID`
2. `cp host-mac/com.onairsign.monitor.plist ~/Library/LaunchAgents/`
3. `launchctl load -w ~/Library/LaunchAgents/com.onairsign.monitor.plist`

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.
