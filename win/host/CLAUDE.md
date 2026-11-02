# Host Monitor Reference (Windows)

This is the Windows host. The macOS equivalent lives in `mac/host/`.

## Running the monitor

```powershell
# Set required environment variable (Windows, user scope)
[System.Environment]::SetEnvironmentVariable("HOME_SSID", "<network_name>", "User")

# Run
node win/host/monitor.mjs
```

## Autostart via Task Scheduler

The monitor runs on login via Windows Task Scheduler. The real files are gitignored (they contain username/SID); use the `.example` files as templates:

1. Copy `win/host/launch-monitor.vbs.example` → `win/host/launch-monitor.vbs` and fill in your Node path and repo path
2. Copy `win/host/On Air sign monitor.xml.example` → `win/host/On Air sign monitor.xml`; edit `DOMAIN\username`, `DATE`, and the paths in `<Arguments>` and `<WorkingDirectory>`
3. Open Task Scheduler → Action → Import Task, and select `win\host\On Air sign monitor.xml`

## Debugging

```powershell
# Test poll.ps1 directly (bypasses monitor.mjs)
pwsh -NoProfile -Command "& { `$HomeSSID = '<HOME_SSID>'; & .\win\host\poll.ps1 }"
```

## Architecture

`win/host/monitor.mjs` is a Node.js process that polls for meeting state and drives the Pico sign over HTTP.

- No npm dependencies; uses only Node.js built-ins (`child_process`, `fs`, `http`, `url`, `path`). Polling requires PowerShell 7+ (`pwsh`); the optional toast notification path uses Windows PowerShell 5.1 (`powershell.exe`) because `pwsh` cannot resolve WinRT toast types
- Toast notifications on state changes (controlled by `NOTIFY_ON_CHANGE` flag in `monitor.mjs`); fires only on HTTP 200 transitions, never on heartbeats, errors, or shutdown
- Injects `HOME_SSID` into `poll.ps1` at startup and base64-encodes it for `-EncodedCommand`
- Polls by running the PowerShell script every 15s (idle) or 5s (in meeting); uses chained `setTimeout` so polls don't overlap
- Sends HTTP GET to the Pico on state changes and as heartbeat during active meetings (feeds the Pico watchdog)
- `SIGINT`/`SIGTERM` turns the sign off before exiting
- Logs to `win/host/logs.log` (all events) and `win/host/errors.log` (errors only); timestamps include local timezone; both auto-trim at 200KB keeping the newest half

`win/host/poll.ps1` determines the current sign state:

- Checks (in order): computer lock state, WiFi SSID, meeting windows, webcam status
- Requires both `LockApp.exe` and `LogonUI.exe` to distinguish a real lock from credential popups
- `HOME_SSID` is injected by `monitor.mjs` at startup

## Key files

- `win/host/monitor.mjs` — host monitor (Node.js ES Module via the `.mjs` extension — no `package.json` needed), loads `poll.ps1` at startup
- `win/host/poll.ps1` — PowerShell script that detects lock state, WiFi SSID, meeting windows, and webcam status
- `win/host/launch-monitor.vbs.example` — template for the VBScript that launches the monitor silently; copy to `launch-monitor.vbs` and fill in paths
- `win/host/On Air sign monitor.xml.example` — template for the Task Scheduler task; copy to `On Air sign monitor.xml`, fill in `DOMAIN\username` and paths, then import via Task Scheduler → Action → Import Task
