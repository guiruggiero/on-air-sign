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

**Screen Recording** is the only permission — without it window titles are empty and no meeting is detected (`probe` then exits 1 and `monitor.mjs` logs why). macOS grants it to the app that launches `probe` (your terminal, or `node` under launchd), so rebuilding `probe` never needs a re-grant.

Autostart: copy `com.onairsign.monitor.plist.example` → `com.onairsign.monitor.plist` (gitignored), fill in `<PATH_TO_NODE>` and `<PATH_TO_REPO>`, copy it to `~/Library/LaunchAgents/`, and `launchctl load` it; grant Screen Recording to the real binary behind it (`realpath "$(which node)"`, e.g. `/opt/homebrew/Cellar/node@24/…/bin/node`; re-grant after Node upgrades — the monitor notifies when it's lost). `KeepAlive SuccessfulExit=false` relaunches crashes only, so a graceful stop stays off — which is why config errors exit 0.

## Debugging

```bash
./probe                  # "<inMeeting>|<cameraInUse>", e.g. "true|false"
./probe --dump-windows   # every window's owner and title — run during a call to tune the meeting rules
node monitor.mjs & tail -f logs.log
```

## Architecture

`monitor.mjs` (Node.js built-ins only) polls every 3s; each poll writes the feed at most once, capping writes at 20/min (Adafruit IO free limit: 30):

1. **Home** — the default gateway's MAC (`route` + `arp`) must match `HOME_ROUTER_MAC`, ignoring case and leading zeros. (The WiFi SSID is unreadable on modern macOS without a paid-developer entitlement.) A full-tunnel VPN reads as "not home" — accepted
2. **`probe`** — only if home
3. **State** — OFF unless in a meeting; then RED if a camera is on, else YELLOW. Each change is written to the feed `on-air-sign` (`POST …/feeds/on-air-sign/data`), including on the first poll (clears a sign left on by a crash). During a meeting the value is re-written every 60s so the Pico's 5-minute staleness check never trips
4. **Errors** — a failed poll holds the state; a failed write rolls it back so the next poll retries. Each error is logged once until it changes

Also: a macOS notification on each new polling error, saying what to do for the fixable ones (Screen Recording names the exact `node` binary to grant; a missing probe says to run `./build.sh`). Screen Recording is typically lost after a Node upgrade — Homebrew's `node` is ad-hoc signed, so every upgrade needs a re-grant. Optional notifications on transitions (`NOTIFY_ON_CHANGE`, off); `SIGINT`/`SIGTERM` stops polling, writes OFF, and exits; `logs.log`/`errors.log` trimmed at 200KB.

`probe` checks, in order: **lock** (`CGSSessionScreenIsLocked`; locked → OFF, checked first since it needs no permission), **Screen Recording** (exits 1 if missing), **meeting** (searches all windows, including minimized, with `isMeetingWindow`), **camera** (only in a meeting; any CoreMediaIO device running — the green-LED signal).

### Meeting rules

| Window owner | Rule | Notes |
|---|---|---|
| `Zoom` | title contains `Zoom Meeting` | the main `Zoom Workplace` window doesn't match |
| `Slack` | title contains `[Main]` | Slack tags its main window `[Main] 🏠` only while a huddle is open. Undocumented — re-check with `--dump-windows` if huddles stop registering |
| `Google Chrome` | title starts with `Meet - ` | the Meet tab, or its floating window when another tab is active |
| `Webex`, `Microsoft Teams` | any window | no fixed meeting title, and only ever opened for meetings — the sign stays on until the app is quit (Cmd+Q) |

Accepted gaps: Meet in a background tab with the floating window closed (OFF); the Meet tab left on "You left the meeting" (stays lit); virtual cameras (OBS, Continuity Camera) read RED.