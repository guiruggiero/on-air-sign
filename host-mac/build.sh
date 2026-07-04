#!/bin/sh
set -e
cd "$(dirname "$0")"

swiftc main.swift -O -o monitor -framework CoreGraphics -framework CoreMediaIO

# Pin a stable code identity so TCC permission grants (Screen Recording, Camera)
# have a better chance of surviving rebuilds - verify this empirically.
codesign --force -s - --identifier com.onairsign.monitor monitor

echo "Built host-mac/monitor"
