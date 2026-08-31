#!/bin/bash
# Determines the current sign state on macOS, mirroring host-win/poll.ps1's outcomes.
# Prints "false|false" when not in a meeting (or locked, or away from home),
# or "true|<cameraInUse>" when in a meeting on the home network.
#
# Lock and home-network reachability are checked here with permission-free shell tools;
# meeting-window and camera detection are delegated to the compiled `probe` binary (the
# two signals with no reliable permission-free CLI on macOS).
#
# monitor.js injects PROBE_BIN (path to the compiled probe) before running this. Run
# directly with:
#   PROBE_BIN="$PWD/host-mac/probe" ./host-mac/poll.sh

# Check computer lock (meeting shorthand) — locked screen means OFF regardless of open windows
# CGSSessionScreenIsLocked flips to "Yes" only on a real lock screen
if ioreg -n Root -d1 2>/dev/null | grep -q 'CGSSessionScreenIsLocked" = Yes'; then
    echo "false|false"; exit 0
fi

# Check home network — reach the Pico's /stats endpoint instead of reading the WiFi SSID.
# The SSID approach (ipconfig/wdutil/system_profiler/CoreWLAN) is a dead end on modern macOS:
# shell tools get a redacted placeholder, and CoreWLAN's real SSID requires Apple's paid-developer
# "Access WiFi Information" entitlement, unavailable to an ad-hoc self-signed build. Reachability
# is a more direct proxy anyway — it's the actual thing we care about.
if ! curl --silent --fail --max-time 2 "http://192.168.0.209/stats" > /dev/null 2>&1; then
    echo "false|false"; exit 0
fi

# Check meeting + camera via the compiled probe, which prints "<inMeeting>|<cameraInUse>".
# Without a usable probe there's no way to detect a meeting on macOS, so report OFF.
if [[ -n "$PROBE_BIN" ]] && [[ -x "$PROBE_BIN" ]]; then
    "$PROBE_BIN"
else
    echo "false|false"
fi
