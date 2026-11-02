#!/bin/bash
# Compiles probe.swift → probe
set -e
cd "$(dirname "$0")"
swiftc probe.swift -O -o probe
echo "Built mac/host/probe"