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

Optionally, upload `pico/onairsign.html` to your personal website for easy access to the dashboard without remembering the IP.

### Host monitor (Windows)
Requires Node.js and PowerShell 7 (`pwsh`). Set the HOME_SSID environment variable:
```powershell
[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<your_ssid>", "User")
```
Then run:
```powershell
node host/monitor.js
```
Assign the Pico a static IP via a DHCP reservation on your router so the hardcoded IP in `monitor.js` never changes.

### Autostart
To run the monitor automatically on login via Windows Task Scheduler:
1. Copy `host/launch-monitor.vbs.example` → `host/launch-monitor.vbs` and fill in your Node.js path and repo path
2. Copy `host/On Air sign monitor.xml.example` → `host/On Air sign monitor.xml` and replace `DOMAIN\username`, `DATE`, and the paths in `<Actions>`
3. Open Task Scheduler → Action → Import Task, and select `host\On Air sign monitor.xml`

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.
