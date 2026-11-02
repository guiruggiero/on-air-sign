# Host Monitor Reference (Windows, legacy)

Pairs with `win/pico/`. No Windows machine is available anymore, so this can't be run or tested — kept for reference.

## Running

See the root `README.md` (Setup → Windows, legacy). The autostart files are gitignored (username/SID), so start from the `.example` templates.

Test the poll script on its own:

```powershell
pwsh -NoProfile -Command "& { `$HomeSSID = '<HOME_SSID>'; & .\win\host\poll.ps1 }"
```

## Architecture

- `monitor.mjs` (Node.js built-ins only) runs `poll.ps1` every 15s idle / 5s in a meeting, with `HOME_SSID` injected via `-EncodedCommand`; sends `GET /off|/yellow|/red` to the Pico on transitions and as a heartbeat during meetings; turns the sign off on `SIGINT`/`SIGTERM`; logs to `logs.log`/`errors.log` (trimmed at 200KB)
- `poll.ps1` (PowerShell 7+) checks, in order: lock state (needs both `LockApp.exe` and `LogonUI.exe`, to ignore credential popups), WiFi SSID, meeting window titles, webcam
- Toast notifications on transitions (`NOTIFY_ON_CHANGE`) use Windows PowerShell 5.1, since `pwsh` can't load the WinRT toast types

## Key files

- `win/host/monitor.mjs` — host monitor
- `win/host/poll.ps1` — lock, SSID, meeting, and webcam detection
- `win/host/launch-monitor.vbs.example` — template for the silent launcher
- `win/host/On Air sign monitor.xml.example` — template for the Task Scheduler task