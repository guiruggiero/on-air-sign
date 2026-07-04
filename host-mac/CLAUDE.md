# macOS Host Monitor Reference

## Running the monitor

```sh
xcode-select -p || xcode-select --install   # need Swift compiler + codesign

export HOME_SSID="<network_name>"
cd host-mac
./build.sh
./monitor
```

## Autostart via launchd

The monitor runs on login via a `launchd` LaunchAgent (macOS's equivalent of Windows Task Scheduler). The real plist is gitignored (embeds an absolute machine path); use the `.example` file as a template:

1. Copy `host-mac/com.onairsign.monitor.plist.example` → `host-mac/com.onairsign.monitor.plist`; fill in the absolute paths (`ProgramArguments`, `WorkingDirectory`, `StandardOutPath`, `StandardErrorPath`) and `HOME_SSID`
2. `cp host-mac/com.onairsign.monitor.plist ~/Library/LaunchAgents/`
3. `launchctl load -w ~/Library/LaunchAgents/com.onairsign.monitor.plist`
4. Check it's running: `launchctl list | grep onairsign`
5. To stop/uninstall: `launchctl unload ~/Library/LaunchAgents/com.onairsign.monitor.plist`

## Debugging

```sh
# Print every on-screen window's owner and title (no HOME_SSID needed) -
# use this to confirm the exact title strings meeting apps use on this Mac
./monitor --dump-windows

# Run in the foreground and watch state transitions live
export HOME_SSID="<network_name>"
./monitor
tail -f logs.log
```

## Architecture

`host-mac/main.swift` is a single-file Swift program, compiled with a plain `swiftc` (no Swift Package Manager, no Xcode project) into a standalone binary with zero runtime dependencies - no Node/Python/PowerShell needed to run it.

- Screen lock via `CGSessionCopyCurrentDictionary()` (undocumented but stable CoreGraphics export), checking `CGSSessionScreenIsLocked`
- Home WiFi SSID via `ipconfig getsummary <iface>` (interface name resolved from `networksetup -listallhardwareports`), not CoreWLAN - `CWWiFiClient` requires Location Services authorization even for headless CLI tools
- Meeting-app detection via `CGWindowListCopyWindowInfo`, matching on-screen window titles against the same pattern list as `host-win/poll.ps1`; requires the **Screen Recording** permission (see below) or other apps' window titles come back empty
- Camera-in-use via CoreMediaIO's `kCMIODevicePropertyDeviceIsRunningSomewhere` device property - the same public-API technique used by open-source camera-indicator tools
- Talks to the Pico over **raw POSIX sockets**, not `URLSession`: CFNetwork's App Transport Security blocks plain `http://` loads by default, and a bare `swiftc` binary has no Info.plist to declare an exception
- Sends HTTP GET to the Pico on state changes and as a heartbeat during active meetings (feeds the Pico's 5-minute watchdog), with the same debounce/rollback-on-failure semantics as `host-win/monitor.js`
- Notifications on state changes via `osascript -e 'display notification ...'` (no entitlements/bundle ID needed, unlike `UserNotifications`)
- `SIGINT`/`SIGTERM` turn the sign off before exiting
- Logs to `host-mac/logs.log` (all events) and `host-mac/errors.log` (errors only); same format and 200KB rotation-keep-newer-half behavior as `host-win/monitor.js`

### Required permissions

| Permission | Why | Where |
|---|---|---|
| Screen Recording | `CGWindowListCopyWindowInfo` needs it to see other apps' window titles | System Settings → Privacy & Security → Screen Recording → add `host-mac/monitor` |
| Camera (maybe) | Unverified whether the CoreMediaIO device-state query needs it | System Settings → Privacy & Security → Camera, only if camera detection under-reports |

Because `monitor` is an unsigned/ad-hoc-signed, bundle-less binary, permission grants are tied to its code identity at a stable path. `build.sh` pins `--identifier com.onairsign.monitor` to help grants survive rebuilds, but moving the binary to a different path will require re-granting regardless.

## Known unknowns & next steps

This was built without access to a Mac to test on, so a few things need to be verified empirically and the results folded back into this doc:

- **Meeting window titles (Slack Huddle, Amazon Chime)**: unverified for macOS. Run `./monitor --dump-windows` during a real Huddle/Chime call. If the printed title doesn't contain `"Huddle"` / `"Amazon Chime:"`, update `meetingPatterns` in `main.swift` to match what was actually printed, then `./build.sh` again. Zoom/Meet/Teams patterns are higher-confidence carryovers from the Windows version and less likely to need changes.
- **Screen Recording permission survives rebuild?**: after granting it once, rebuild (`./build.sh`) and re-run `--dump-windows` *without* re-granting. If window titles still come through, the `codesign --identifier` pinning worked - note that here. If they don't, re-granting after every rebuild is just the accepted cost; note that too.
- **Does camera detection need Camera TCC permission?**: toggle the camera during a test call with **no** Camera permission granted and confirm YELLOW↔RED flips in `logs.log`. If it doesn't:
  1. Add `host-mac/monitor` under System Settings → Privacy & Security → Camera (if that entry exists on this macOS version) and retest.
  2. If there's no such entry, or it doesn't help, the fallback is heavier: embed a minimal Info.plist with `NSCameraUsageDescription` into the binary via linker `-sectcreate` in `build.sh`, add a one-off flag to `main.swift` that calls `AVCaptureDevice.requestAccess(for: .video)` once to trigger the OS consent dialog, run that once, then retest plain CoreMediaIO detection.
- **Does `ipconfig getsummary` still print an `SSID :` line on this macOS version?**: run it manually (`ipconfig getsummary <iface>`) and compare against what `currentSSID()` parses. If Apple has tightened this in a way that breaks it, the fallback is CoreWLAN (`CWWiFiClient`) instead, accepting the Location Services permission prompt that comes with it.
- **`kCMIOObjectPropertyElementMain` compile check**: if `main.swift` fails to compile on an older Xcode/SDK with an "unresolved identifier" on that constant, swap it for `kCMIOObjectPropertyElementMaster` (both are defined as `0`; only the name changed in a recent SDK).

Once verified, replace each bullet above with the confirmed fact (e.g. "confirmed: Slack Huddle windows are titled `X` on macOS 15.x") so this section converges into a settled reference instead of staying speculative.

## Key files
- `host-mac/main.swift` — the entire monitor (single-file Swift), compiled to `monitor`
- `host-mac/build.sh` — compiles `main.swift` and ad-hoc code-signs the result
- `host-mac/com.onairsign.monitor.plist.example` — template for the launchd LaunchAgent; copy to `com.onairsign.monitor.plist`, fill in paths and `HOME_SSID`, then load via `launchctl`
