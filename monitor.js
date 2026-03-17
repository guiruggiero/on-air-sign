// Run with
//     $env:PICO_IP="<ip_address>"; $env:HOME_SSID="<network_name>"; node .\monitor.js
// or set env variables with user scope with
//     [System.Environment]::SetEnvironmentVariable("PICO_IP", "<ip_address>", "User")
//     [System.Environment]::SetEnvironmentVariable("HOME_SSID", "<network_name>", "User")

// Imports
import {execSync} from "child_process";
import http from "http";

// Initializations
const PICO_IP = process.env.PICO_IP;
const HOME_SSID = process.env.HOME_SSID;
const MEETING_POLL_INTERVAL_MS = 15000; // 15 seconds
const CAMERA_POLL_INTERVAL_MS = 4000; // 4 seconds
let cameraPollInterval = null;
let currentState = null;
let isAtHome = false;
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
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Initial check if IP is set
if (!PICO_IP || PICO_IP === "<IP>") {
    console.error("PICO_IP is not set. Please set the PICO_IP env variable");
    process.exit(1);
}

// Get the current WiFi name
function getCurrentSSID() {
    try {
        const result = execSync(
            `pwsh -NoProfile -Command "(netsh wlan show interfaces) | Select-String '(?<!\\w)SSID\\s' | Select-Object -First 1"`,
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
        $ProgressPreference = 'SilentlyContinue'
        $paths = @(
            'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam',
            'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\webcam\\NonPackaged'
        )
        $count = 0
        foreach ($path in $paths) {
            if (Test-Path $path) {
                $count += (Get-ChildItem $path |
                    ForEach-Object { Get-ItemProperty $_.PsPath } |
                    Where-Object { $_.LastUsedTimeStop -eq 0 } |
                    Measure-Object).Count
            }
        }
        $count
    `;
    try {
        const encoded = Buffer.from(psCommand, "utf16le").toString("base64");
        const result = execSync(
            `pwsh -NoProfile -EncodedCommand ${encoded}`,
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
        $ProgressPreference = 'SilentlyContinue'
        $titles = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty MainWindowTitle
        $meetingPatterns = @('Zoom Meeting', 'Huddle', 'Amazon Chime:', 'Meet -', 'Meet –', 'Microsoft Teams')
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
        const encoded = Buffer.from(psCommand, "utf16le").toString("base64");
        const result = execSync(
            `pwsh -NoProfile -EncodedCommand ${encoded}`,
            {timeout: 8000}
        ).toString().trim();
        return result === "true";
    
    } catch (e) {
        console.error(`Error checking for meeting: ${e.message}`);
        return false; // Assume not in a meeting
    }
}

// Change sign color
function callPico(endpoint, label) {
    const options = {
        hostname: PICO_IP,
        port: 80,
        path: endpoint,
        method: "GET",
    };
    const req = http.request(options, (res) => {
        console.log(`[${new Date().toLocaleTimeString()}] Sign → ${label} (HTTP ${res.statusCode})`);
    });
    req.setTimeout(3000, () => {
        req.destroy(new Error("Request timed out"));
    });
    req.on("error", (e) => console.error("Pico unreachable:", e.message));
    req.end();
}

// Monitor camera status
function pollCamera() {
    const cameraInUse = isCameraInUse();
    // console.log("isCameraInUse:", cameraInUse);
    const newState = cameraInUse ? STATES.RED : STATES.YELLOW;
    if (newState !== currentState) { // State changed, change colors
        currentState = newState;
        callPico(STATE_ACTIONS[newState].endpoint, STATE_ACTIONS[newState].label);
        // console.log(STATE_ACTIONS[newState].label);
    }
}

// Monitor meeting status
function poll() {
    const inMeeting = isInMeeting();
    // console.log("isInMeeting:", inMeeting);

    // Not in a meeting
    if (!inMeeting) {
        if (currentState !== STATES.OFF && currentState !== null) { // Left a meeting
            currentState = STATES.OFF;
            isAtHome = false;
            if (cameraPollInterval) {
                clearInterval(cameraPollInterval);
                cameraPollInterval = null;
            }
            callPico(STATE_ACTIONS[STATES.OFF].endpoint, STATE_ACTIONS[STATES.OFF].label);
            // console.log(STATE_ACTIONS[STATES.OFF].label);
        }
        return;
    }

    // First poll of a new meeting, check if at home and spin up camera polling
    if (currentState === STATES.OFF || currentState === null) {
        isAtHome = getCurrentSSID() === HOME_SSID;
        // console.log("isAtHome:", isAtHome);
        if (isAtHome && !cameraPollInterval) {
            pollCamera(); // Immediate first camera check
            cameraPollInterval = setInterval(pollCamera, CAMERA_POLL_INTERVAL_MS);
        }
    }

    if (!isAtHome) return; // Not at home, do nothing
}

// Chain polls so the next only starts after the current one finishes
function schedulePoll() {
    poll();
    setTimeout(schedulePoll, MEETING_POLL_INTERVAL_MS);
}

// Graceful shutdown
function shutdown() {
    console.log("\nShutting down - turning off sign...");
    callPico(STATE_ACTIONS[STATES.OFF].endpoint, STATE_ACTIONS[STATES.OFF].label);
    setTimeout(() => process.exit(0), 1500); // Give the HTTP request time to fire
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Heartbeat - TODO: where to store it?
setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] ♥ Alive - current state: ${currentState ?? "none"}`);
}, HEARTBEAT_INTERVAL_MS);

console.log("Meeting/webcam monitor started. Polling every", MEETING_POLL_INTERVAL_MS  / 1000, "seconds...\n");
schedulePoll();
