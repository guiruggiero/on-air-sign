// Run with `PICO_IP="<IP>" HOME_SSID="<networkName>" node monitor.js`

// Imports
import {execSync} from "child_process";
import http from "http";

// Initializations
const PICO_IP = process.env.PICO_IP || "<IP>";
const HOME_SSID = process.env.HOME_SSID || "<networkName>";
const POLL_INTERVAL_MS = 3000;
let currentState = null;
const STATES = {
    OFF: "off",
    YELLOW: "yellow",
    RED: "red",
};
const STATE_ACTIONS = {
    [STATES.OFF]: {endpoint: "/off", label: "OFF ⚫"},
    [STATES.YELLOW]: {endpoint: "/yellow", label: "YELLOW 🟡"},
    [STATES.RED]: {endpoint: "/red", label: "RED 🔴"},
};

// Initial check if IP is set
if (!PICO_IP || PICO_IP === "<IP>") {
    console.error("PICO_IP is not set. Please set the PICO_IP env variable");
    process.exit(1);
}

// Get the current WiFi name
function getCurrentSSID() {
    try {
        const result = execSync(
            `powershell -NoProfile -Command "(netsh wlan show interfaces) | Select-String 'SSID' | Select-Object -First 1"`,
            {timeout: 5000}
        ).toString().trim();
        return result.split(":").slice(1).join(":").trim(); // Result looks like "  SSID  : MyNetwork"

    } catch (e) {
        console.error(`Error getting SSID: ${e.message}`);
        return null; // Assume not on the home network
    }
}

// Get if webcam is in use
function isCameraInUse() {
    const psCommand = `
        Get-ChildItem 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged' |
        ForEach-Object { Get-ItemProperty $_.PsPath } |
        Where-Object { $_.LastUsedTimeStop -eq 0 } |
        Measure-Object | Select-Object -ExpandProperty Count
    `;
    try {
        const result = execSync(
            `powershell -NoProfile -Command "${psCommand}"`,
            {timeout: 5000}
        ).toString().trim();
        return parseInt(result) > 0;
    
    } catch (e) {
        console.error(`Error checking camera status: ${e.message}`);
        return false; // Assume camera is off
    }
}

// Get if any meeting app is in an active call
function isInMeeting() {
    const psCommand = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        using System.Collections.Generic;
        public class WinAPI {
            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
            [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
            [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
            [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
            public static List<string> GetWindowTitles() {
            var titles = new List<string>();
            EnumWindows((hWnd, lParam) => {
                if (IsWindowVisible(hWnd)) {
                var sb = new StringBuilder(256);
                GetWindowText(hWnd, sb, 256);
                if (sb.Length > 0) titles.Add(sb.ToString());
                }
                return true;
            }, IntPtr.Zero);
            return titles;
            }
        }
    "@
        $titles = [WinAPI]::GetWindowTitles()
        $meetingPatterns = @(
        'Zoom Meeting',
        'Huddle',
        'Amazon Chime',
        'Meet -',
        'Meet –'
        )
        $found = $false
        foreach ($title in $titles) {
        foreach ($pattern in $meetingPatterns) {
            if ($title -like "*$pattern*") { $found = $true; break }
        }
        if ($found) { break }
        }
        if ($found) { "true" } else { "false" }
    `;
    try {
        const result = execSync(
            `powershell -NoProfile -Command "${psCommand}"`,
            {timeout: 8000}
        ).toString().trim();
        return result === "true";
    
    } catch (e) {
        console.error(`Error checking for meeting: ${e.message}`);
        return false; // Assume not in a meeting
    }
}

// Change colors of LEDs
function callPico(endpoint, label) {
    const options = {
        hostname: PICO_IP,
        port: 80,
        path: endpoint,
        method: "GET",
        timeout: 3000,
    };
    const req = http.request(options, (res) => {
        console.log(`[${new Date().toLocaleTimeString()}] Sign → ${label} (HTTP ${res.statusCode})`);
    });
    req.on("error", (e) => console.error("Pico unreachable:", e.message));
    req.end();
}

// Monitor meeting and camera status
function poll() {
    // Turn off and don't update if not at home
    const ssid = getCurrentSSID();
    if (ssid !== HOME_SSID) {
        if (currentState !== STATES.OFF) {
            currentState = STATES.OFF;
            callPico(STATE_ACTIONS[STATES.OFF].endpoint, STATE_ACTIONS[STATES.OFF].label);
        }
        return;
    }

    const inMeeting = isInMeeting();
    const camOn = inMeeting && isCameraInUse(); // No need to check cam if not in a meeting

    let newState;
    if (!inMeeting) newState = STATES.OFF;
    else if (camOn) newState = STATES.RED;
    else newState = STATES.YELLOW;

    if (newState !== currentState) {
        currentState = newState;
        const action = STATE_ACTIONS[newState];
        if (action) callPico(action.endpoint, action.label);
    }
}

console.log("Webcam/meeting monitor started. Polling every", POLL_INTERVAL_MS / 1000, "seconds...");
poll();
setInterval(poll, POLL_INTERVAL_MS);