#!/bin/bash
# Determines the current sign state on macOS, mirroring host-win/poll.ps1's outcomes.
# Prints "false|false" when not in a meeting (or locked, or away from home),
# or "true|<cameraInUse>" when in a meeting on the home network.
#
# Lock and SSID are checked here with permission-free shell tools; meeting-window
# and camera detection are delegated to the compiled `probe` binary (the two signals
# with no reliable permission-free CLI on macOS).
#
# monitor.js injects two env vars before running this: HOME_SSID and PROBE_BIN
# (path to the compiled probe). Run directly with:
#   HOME_SSID="<ssid>" PROBE_BIN="$PWD/host-mac/probe" ./host-mac/poll.sh

# Check computer lock (meeting shorthand) — locked screen means OFF regardless of open windows
# CGSSessionScreenIsLocked flips to "Yes" only on a real lock screen
if ioreg -n Root -d1 2>/dev/null | grep -q 'CGSSessionScreenIsLocked" = Yes'; then
    echo "false|false"; exit 0
fi

# Check WiFi SSID — read the joined network name off the Wi-Fi interface.
# ipconfig getsummary exposes the SSID without the deprecated `airport` tool;
# macOS returns it only when the running process holds Location Services permission.
wifiPort=$(networksetup -listallhardwareports 2>/dev/null | awk '/Wi-Fi|AirPort/{getline; print $2; exit}')
currentSSID=""
if [ -n "$wifiPort" ]; then
    currentSSID=$(ipconfig getsummary "$wifiPort" 2>/dev/null | awk -F ' SSID : ' '/ SSID : / {print $2; exit}')
fi
if [ "$currentSSID" != "$HOME_SSID" ]; then
    echo "false|false"; exit 0
fi

# Check meeting + camera via the compiled probe, which prints "<inMeeting>|<cameraInUse>".
# Without a usable probe there's no way to detect a meeting on macOS, so report OFF.
if [ -n "$PROBE_BIN" ] && [ -x "$PROBE_BIN" ]; then
    "$PROBE_BIN"
else
    echo "false|false"
fi
