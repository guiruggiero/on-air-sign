#!/bin/bash
# Compiles the native probe (meeting-window + camera detection) once.
# Run this before first launch and after editing probe.swift.
set -e
cd "$(dirname "$0")"

# CoreGraphics for the window list, CoreMediaIO for camera state
swiftc probe.swift -O -o probe -framework CoreGraphics -framework CoreMediaIO

# Ad-hoc code-sign with a stable identifier so the Screen Recording (TCC) permission grant
# is tied to a fixed code identity and has a better chance of surviving rebuilds.
# Moving the binary to a different path still requires re-granting.
codesign --force --sign - --identifier com.onairsign.probe probe

echo "Built host-mac/probe"
