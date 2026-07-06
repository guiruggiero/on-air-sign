# Host Monitor Reference (macOS)

This is the macOS host. The Windows equivalent lives in `host-win/`. Both produce the same outcomes (same sign states, same meeting patterns, same `inMeeting|cameraInUse` poll contract) using each platform's native tools — this is not a literal port of the PowerShell logic. `monitor.js` deliberately mirrors `host-win/monitor.js` (same logging, trim, rollback, heartbeat, shutdown) so the two hosts stay in sync.

## Setup

Requires Node.js and the Xcode Command Line Tools (for `swiftc`/`codesign` — usually already present, as running `git` triggers their install). Build the native probe once, then run:

```bash
cd host-mac
./build.sh                    # compiles probe.swift → probe (re-run after editing probe.swift)
export HOME_SSID="<network_name>"
node monitor.js
```

## Permissions

Grant these on first run (or pre-approve in System Settings → Privacy & Security):

- **Screen Recording** — `CGWindowListCopyWindowInfo` needs it to read *other* apps' window titles (meeting detection); without it, titles come back empty and no meeting is ever detected. Add the binary that runs the probe: for `node monitor.js` that's your terminal/Node; for autostart it's the process launchd runs. See the code-identity note below.
- **Location Services** — required by macOS for `ipconfig getsummary` to return the WiFi SSID; grant it to your terminal app (interactive runs) and/or Node (launchd runs)
- Lock state (`ioreg`) and camera state (CoreMediaIO) need no permission

`build.sh` ad-hoc code-signs `probe` with a stable identifier (`com.onairsign.probe`) so the Screen Recording grant is tied to a fixed code identity and has a better chance of surviving rebuilds. Moving the binary to a different path still requires re-granting.

## Autostart via launchd

The real plist is gitignored (contains an absolute Node path and HOME_SSID); use the `.example` as a template:

1. Copy `host-mac/com.onairsign.monitor.plist.example` → `host-mac/com.onairsign.monitor.plist` and fill in `<PATH_TO_NODE>`, `<PATH_TO_REPO>`, and `<YOUR_SSID>`
2. Copy it into `~/Library/LaunchAgents/` and load it:
   ```bash
   cp "host-mac/com.onairsign.monitor.plist" ~/Library/LaunchAgents/
   launchctl load ~/Library/LaunchAgents/com.onairsign.monitor.plist
   ```
3. To stop/reload: `launchctl unload ~/Library/LaunchAgents/com.onairsign.monitor.plist`

`KeepAlive` is set to `SuccessfulExit=false` so a graceful shutdown (which turns the sign off) is not relaunched, while a crash still is.

## Debugging

```bash
# List every on-screen window's owner and title — use during a real call to confirm
# the exact meeting-window title strings on this Mac (needs Screen Recording permission)
./probe --dump-windows

# Test poll.sh directly (bypasses monitor.js)
HOME_SSID="<HOME_SSID>" PROBE_BIN="$PWD/probe" ./poll.sh

# Watch state transitions live
node monitor.js & tail -f logs.log
```

## Architecture

`host-mac/monitor.js` is a Node.js process that polls for meeting state and drives the Pico sign over HTTP.

- No npm dependencies; uses only Node.js built-ins (`child_process`, `fs`, `http`, `url`, `path`) plus built-in macOS tools (`bash`, `ioreg`, `networksetup`, `ipconfig`) and the compiled `probe`
- Expects `probe` to exist (built by `build.sh`); does NOT compile at startup because `swiftc` is usually absent from launchd's `PATH`. Logs an error if the binary is missing
- Notifications on state changes (controlled by `NOTIFY_ON_CHANGE` flag in `monitor.js`) via `osascript display notification`; fires only on HTTP 200 transitions, never on heartbeats, errors, or shutdown
- Injects `HOME_SSID` and `PROBE_BIN` into `poll.sh` via environment variables
- Polls by running the shell script every 5s; uses chained `setTimeout` so polls don't overlap
- Sends HTTP GET to Pico on state changes and as heartbeat during active meetings (feeds Pico watchdog)
- `SIGINT`/`SIGTERM` turns the sign off before exiting
- Logs to `host-mac/logs.log` (all events) and `host-mac/errors.log` (errors only); timestamps include local timezone; both auto-trim at 200KB keeping the newest half

`host-mac/poll.sh` determines the current sign state:

- Checks (in order): computer lock state, WiFi SSID, then meeting + camera — same order and same outcomes as the Windows host
- Lock via `ioreg` `CGSSessionScreenIsLocked` and SSID via `ipconfig getsummary` are permission-free shell checks handled here; meeting-window and camera detection are delegated to `probe` (the two signals with no reliable permission-free CLI on macOS)
- `HOME_SSID` and `PROBE_BIN` are injected by `monitor.js` at startup

`host-mac/probe.swift` (compiled to `probe`) covers the two native-only signals:

- **Meeting windows** via `CGWindowListCopyWindowInfo` — the macOS analog of Windows' EnumWindows; sees meeting windows regardless of focus. Matches on-screen titles against the same pattern list as `host-win/poll.ps1` (keep the two in sync)
- **Camera** via CoreMediaIO's `kCMIODevicePropertyDeviceIsRunningSomewhere` across all cameras — the same signal behind the green camera LED
- Prints `<inMeeting>|<cameraInUse>`; `--dump-windows` lists all window titles for pattern confirmation

## Known unknowns & next steps

Built without a Mac to test on — verify these on real hardware and fold results back into this doc:

- **Meeting-window titles (Slack Huddle, Amazon Chime)**: unverified on macOS. Run `./probe --dump-windows` during a real Huddle/Chime call; if the printed title doesn't contain `"Huddle"` / `"Amazon Chime:"`, update `meetingPatterns` in `probe.swift` and re-run `./build.sh`. Zoom/Meet/Teams patterns are higher-confidence carryovers from the Windows host
- **Does Screen Recording grant survive a rebuild?**: after granting once, run `./build.sh` and re-run `--dump-windows` *without* re-granting. If titles still come through, the `codesign --identifier` pinning worked; if not, re-granting after each rebuild is the accepted cost
- **Does camera detection need the Camera permission?**: toggle the camera mid-call and confirm YELLOW↔RED flips in `logs.log`. CoreMediaIO's device-state query is generally permission-free, but verify
- **Does `ipconfig getsummary` still print an `SSID :` line on this macOS version?**: run it manually and compare against what `poll.sh` parses. If Apple tightened this, the fallback is CoreWLAN (`CWWiFiClient`), which brings its own Location Services prompt
- **`kCMIOObjectPropertyElementMain` compile check**: if `probe.swift` fails to compile on an older SDK with an "unresolved identifier", swap it for `kCMIOObjectPropertyElementMaster` (both are `0`; only the name changed)

## Code-review findings to address while debugging

A static review (no Mac available) flagged these before first real run. The unifying problem: on macOS almost every failure mode collapses into a benign-looking `false|false`, so a **broken detector is indistinguishable from "no meeting"** — the sign just stays dark with nothing in the logs. Watch for these while debugging on hardware; ranked most to least important:

1. **Screen Recording denied → always OFF (most likely first-run failure)**: without the grant, `CGWindowListCopyWindowInfo` returns empty titles, so `isInMeeting()` is always false, the probe prints `false|false`, and the sign never lights — with no error logged. If the sign stays dark, check this permission first. Suggested deep fix (addresses findings 1-3 at once): have `probe.swift` distinguish failure from "no meeting" — emit an `error|error` sentinel (or non-zero exit + stderr reason) on empty window list / API failure, and have `monitor.js` log that on a throttle instead of treating it as OFF
2. **Missing/non-executable probe warned only once**: `monitor.js` checks `existsSync` at startup (one log line), but `poll.sh` checks `-x`. A probe that exists but lost its execute bit logs *nothing* and silently reports OFF forever. Align the two checks
3. **Probe crash/timeout freezes the sign**: on a probe hang (>10s) or crash mid-meeting, `poll()`'s catch logs and returns without forcing OFF — the sign stays stuck at its last state until the Pico's 5-minute watchdog clears it. Consider a recovery-to-OFF path in the catch
4. **SSID parse fails silently → OFF while at home**: if Location Services isn't granted or `ipconfig getsummary` output changed, `currentSSID` is empty and every poll reports away-from-home. Overlaps with the known-unknown above; the symptom is "OFF even at my desk"
5. **Virtual cameras trigger RED**: `isCameraInUse()` enumerates *all* CoreMediaIO devices. An active OBS/Continuity/screen-capture pseudo-device reports RED even with the physical webcam off. If screen-sharing shows RED instead of YELLOW, filter the device list to physical cameras
6. **launchd relaunch loop on `exit(1)`**: `KeepAlive SuccessfulExit=false` can't tell an intentional termination (HOME_SSID unset → `exit(1)`) from a crash, so a misconfigured plist relaunches every ~10s forever, filling the logs. If autostart spins, check `HOME_SSID` is actually set in the plist
7. **Lock grep is format-fragile**: lock detection depends on the exact `ioreg` string `CGSSessionScreenIsLocked" = Yes`. Confirm the format on this macOS version — if it varies, a real lock goes undetected and the sign stays lit while the machine is locked
8. **Dead poll-interval branch (cleanup)**: `IDLE_POLL_INTERVAL_MS` and `ACTIVE_POLL_INTERVAL_MS` are both `5000`, so the interval-selection branch in `schedulePoll` is inert and the "idle 5s, active 5s" startup log is misleading. Inherited from `host-win/monitor.js` — collapse in both or leave as-is

Not flagged as defects (deliberate design): the ~130-line overlap between `host-mac/monitor.js` and `host-win/monitor.js`, and the duplicated `meetingPatterns` list across `probe.swift` and `poll.ps1` — both are the intended two-host parity split. Just be aware the pattern lists can drift silently; a meeting detected on Windows but not macOS points here.

## Key files
- `host-mac/monitor.js` — host monitor (Node.js ES Modules), runs `poll.sh` and drives the Pico
- `host-mac/poll.sh` — bash script: lock + SSID checks, delegates meeting + camera to `probe`
- `host-mac/probe.swift` — native probe (meeting windows + camera), compiled to `probe` by `build.sh`
- `host-mac/build.sh` — compiles `probe.swift` and ad-hoc code-signs the result
- `host-mac/com.onairsign.monitor.plist.example` — template for the launchd agent; copy to `com.onairsign.monitor.plist`, fill in paths and SSID, then load with `launchctl`
