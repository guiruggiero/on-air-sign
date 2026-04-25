# Host Monitor Reference

## Running the monitor

```powershell
# Set required environment variable (Windows, user scope)
[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<network_name>", "User")

# Run
node host/monitor.js
```

## Autostart via Task Scheduler

The monitor runs on login via Windows Task Scheduler. The real files are gitignored (contain username/SID); use the `.example` files as templates:

1. Copy `host/launch-monitor.vbs.example` → `host/launch-monitor.vbs` and fill in your Node path and repo path
2. Copy `host/On Air sign monitor.xml.example` → `host/On Air sign monitor.xml`; edit `DOMAIN\username`, `DATE`, and the paths in `<Arguments>` and `<WorkingDirectory>`
3. Open Task Scheduler → Action → Import Task, and select `host\On Air sign monitor.xml`

## Debugging

```powershell
# Test poll.ps1 directly (bypasses monitor.js)
pwsh -NoProfile -Command "& { `$HomeSSID = '<HOME_SSID>'; & .\host\poll.ps1 }"
```

## Architecture

`host/monitor.js` is a Node.js process that polls for meeting state and drives the Pico sign over HTTP.

- No npm dependencies; uses only Node.js built-ins (`child_process`, `fs`, `http`, `url`, `path`); requires PowerShell 7+ (`pwsh`)
- Injects `HOME_SSID` into `poll.ps1` at startup and base64-encodes it for `-EncodedCommand`
- Polls by running the PowerShell script every 15s (idle) or 5s (in meeting); uses chained `setTimeout` so polls don't overlap
- Sends HTTP GET to Pico on state changes and as heartbeat during active meetings (feeds Pico watchdog)
- `SIGINT`/`SIGTERM` turns the sign off before exiting
- Logs to `host/logs.log` (all events) and `host/errors.log` (errors only); timestamps include local timezone; both auto-trim at 200KB keeping the newest half

`host/poll.ps1` determines the current sign state:

- Checks (in order): computer lock state, WiFi SSID, meeting windows, webcam status
- Requires both `LockApp.exe` and `LogonUI.exe` to distinguish a real lock from credential popups
- `HOME_SSID` is injected by `monitor.js` at startup

## Key files
- `host/monitor.js` — host monitor (Node.js ES Modules), loads `poll.ps1` at startup
- `host/poll.ps1` — PowerShell script that detects lock state, WiFi SSID, meeting windows, and webcam status
- `host/launch-monitor.vbs.example` — template for the VBScript that launches the monitor silently; copy to `launch-monitor.vbs` and fill in paths
- `host/On Air sign monitor.xml.example` — template for the Task Scheduler task; copy to `On Air sign monitor.xml`, fill in `DOMAIN\username` and paths, then import via Task Scheduler → Action → Import Task
