# On Air sign

Automated "On Air" sign using a Raspberry Pi Pico 2 W — shows your meeting and webcam status:
- No meeting → OFF ⚫
- Meeting, camera off → YELLOW 🟡
- Meeting, camera on → RED 🔴

Works with Zoom, Google Meet, Slack Huddle, Amazon Chime, and Microsoft Teams. Only activates when connected to your home WiFi.

## Setup

### Pico
Wire the WS2812 NeoPixel ring data line to **GP4**.

Print and assemble the enclosures from `enclosures/` — a snap-fit box for the NeoPixel ring and a case for the Pico 2 W. See [`enclosures/README.md`](enclosures/README.md) for print settings.

The Pico firmware comes in two implementations — pick the one matching your host monitor (see below).

#### Pico (push variant, pairs with the Windows host monitor)
Upload `pico-push/main.py` and `pico-push/dashboard.html` to the Pico 2 W using Thonny. Create `pico-push/secrets.py` on the device:
```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
```
Assign the Pico a static IP via a DHCP reservation on your router so the hardcoded IP in `host-win/monitor.js` never changes. The Pico runs a local HTTP server and the host pushes state to it directly, so both must be on the same LAN.

Optionally, upload `pico-push/onairsign.html` to your personal website for easy access to the dashboard without remembering the IP.

#### Pico (pull variant, pairs with the macOS host monitor)
Upload `pico-pull/main.py` to the Pico 2 W using Thonny. Create a feed named `on-air-sign` on [Adafruit IO](https://io.adafruit.com), then create `pico-pull/secrets.py` on the device:
```python
SSID = "<wifi_name>"
PASSWORD = "<wifi_password>"
WEBREPL_PW = "<webrepl_password>"
AIO_USERNAME = "<adafruit_io_username>"
AIO_KEY = "<adafruit_io_key>"
```
The Pico polls this feed over HTTPS and drives the sign from its value (`off`/`yellow`/`red`) — no LAN adjacency with the host required, and no inbound connections accepted. `host-mac` writing to the feed automatically is still in progress (see [host-mac/CLAUDE.md](host-mac/CLAUDE.md)); until then you can set the feed's value manually from the Adafruit IO dashboard to test the Pico side.

### Host monitor (Windows)
Requires Node.js and PowerShell 7 (`pwsh`). Set the HOME_SSID environment variable:
```powershell
[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<your_ssid>", "User")
```
Then run:
```powershell
node host-win/monitor.js
```

#### Autostart
To run the monitor automatically on login via Windows Task Scheduler:
1. Copy `host-win/launch-monitor.vbs.example` → `host-win/launch-monitor.vbs` and fill in your Node.js path and repo path
2. Copy `host-win/On Air sign monitor.xml.example` → `host-win/On Air sign monitor.xml` and replace `DOMAIN\username`, `DATE`, and the paths in `<Actions>`
3. Open Task Scheduler → Action → Import Task, and select `host-win\On Air sign monitor.xml`

### Host monitor (macOS)
Requires Node.js and the Xcode Command Line Tools (for `swiftc` — usually already installed). Build the native probe once, then run:
```bash
cd host-mac
./build.sh
export HOME_SSID="<your_ssid>"
node monitor.js
```
On first run, grant these in System Settings → Privacy & Security: **Screen Recording** (so the probe can read meeting-app window titles — without it no meeting is detected) and **Location Services** for your terminal/Node (required by macOS to read the WiFi network name). Camera state needs no permission. See [host-mac/CLAUDE.md](host-mac/CLAUDE.md) for details.

#### Autostart
To run the monitor automatically on login via launchd:
1. Copy `host-mac/com.onairsign.monitor.plist.example` → `host-mac/com.onairsign.monitor.plist` and fill in your Node.js path, repo path, and HOME_SSID
2. Symlink or copy it into `~/Library/LaunchAgents/` and load it:
   ```bash
   cp "host-mac/com.onairsign.monitor.plist" ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.onairsign.monitor.plist
   ```

---

#### 📄 License
This project is licensed under the [MIT License](LICENSE). Attribution is required.

#### ⚠️ Disclaimer
This software is provided "as is" without any warranties. Use at your own risk. The author is not responsible for any consequences of using this software.
