# Host Monitor Reference (macOS)

Pairs with `mac/pico/`. `monitor.mjs` decides the sign state; the compiled `probe` reads the signals that need native APIs.

## Setup

Requires Node.js and the Xcode Command Line Tools (`swiftc`).

```bash
cd mac/host
./build.sh   # compiles probe.swift → probe; re-run after editing probe.swift
# On your home network, create .env (gitignored) with the router's MAC and Adafruit IO credentials:
echo "HOME_ROUTER_MAC=$(arp -n "$(route -n get default | awk '/gateway:/ {print $2}')" | awk '{print $4}')" > .env
echo "ADAFRUIT_IO_USERNAME=<username>" >> .env
echo "ADAFRUIT_IO_KEY=<key>" >> .env   # Adafruit IO → My Key
node monitor.mjs
```

**Screen Recording** is the only permission — without it window titles are empty and no meeting is detected (`probe` then exits 1 and `monitor.mjs` logs why). macOS grants it to the app that launches `probe`: your terminal (e.g. Kiro) interactively, the `node` binary under launchd. So rebuilding `probe` never needs a re-grant.

Autostart: copy `com.onairsign.monitor.plist.example` → `com.onairsign.monitor.plist` (gitignored), fill in `<PATH_TO_NODE>` and `<PATH_TO_REPO>`, copy it to `~/Library/LaunchAgents/`, and `launchctl load` it; grant Screen Recording to that `node` (not yet verified — check `errors.log` after the first autostart). `KeepAlive SuccessfulExit=false` relaunches crashes only, so a graceful stop stays off — which is why config errors exit 0.

## Debugging

```bash
./probe                  # "<inMeeting>|<cameraInUse>", e.g. "true|false"
./probe --dump-windows   # every window's owner and title — run during a call to tune the meeting rules
node monitor.mjs & tail -f logs.log
```

## Architecture

`monitor.mjs` (Node.js built-ins only) polls every 5s:

1. **Home** — the default gateway's MAC (`route` + `arp`) must match `HOME_ROUTER_MAC`, ignoring case and leading zeros. The WiFi SSID is unreadable on modern macOS without a paid-developer entitlement. A full-tunnel VPN reads as "not home" (accepted — basically never used)
2. **`probe`** — only if home
3. **State** — OFF unless in a meeting; then RED if a camera is on, else YELLOW. The first poll always sends a state (clears a sign left on by a crash); each change is written to the Adafruit IO feed `on-air-sign` (`POST …/feeds/on-air-sign/data`), and during a meeting the value is re-written every 60s so the Pico's 5-minute staleness check never trips (~1 write/min, well under Adafruit IO's rate limit)
4. **Errors** — a failed poll holds the state; a failed feed write rolls the state back so the next poll retries. Each error is logged once until it changes, with a "recovered" line after. If writes keep failing mid-meeting, the Pico's staleness check turns the sign off

Also: notifications on transitions (`NOTIFY_ON_CHANGE`); `SIGINT`/`SIGTERM` stops polling, writes OFF, and exits; `logs.log`/`errors.log` trimmed at 200KB.

`probe` checks, in order: **lock** (`CGSSessionScreenIsLocked`; locked → OFF, checked first since it needs no permission), **Screen Recording** (exits 1 if missing), **meeting** (searches all windows, including minimized, with `isMeetingWindow`), **camera** (only in a meeting; any CoreMediaIO device running — the green-LED signal).

### Meeting rules (verified on real calls)

| Window owner | Rule | Notes |
|---|---|---|
| `Zoom` | title contains `Zoom Meeting` | the main `Zoom Workplace` window doesn't match |
| `Slack` | title contains `[Main]` | Slack tags its main window `[Main] 🏠` only while a huddle is open. Undocumented — re-check with `--dump-windows` if huddles stop registering |
| `Google Chrome` | title starts with `Meet - ` | the Meet tab, or its floating window when another tab is active |
| `Webex`, `Microsoft Teams` | any window | no fixed meeting title, and only ever opened for meetings — the sign stays on until the app is quit (Cmd+Q) |

Accepted gaps: Meet in a background tab with the floating window closed (OFF); the Meet tab left on "You left the meeting" (stays lit); virtual cameras (OBS, Continuity Camera) read RED.

## Key files

- `mac/host/monitor.mjs` — host monitor
- `mac/host/probe.swift` — native probe, compiled to `probe` by `build.sh`
- `mac/host/build.sh` — compiles the probe
- `mac/host/com.onairsign.monitor.plist.example` — launchd template
- `mac/host/.env` — gitignored config (`HOME_ROUTER_MAC`, `ADAFRUIT_IO_USERNAME`, `ADAFRUIT_IO_KEY`)