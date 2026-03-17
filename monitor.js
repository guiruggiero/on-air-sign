// Run with `PICO_IP="<IP>" HOME_SSID="<networkName>" node monitor.js`

// Imports
import {execSync} from "child_process";
import http from "http";

// Initializations
const PICO_IP = process.env.PICO_IP || "<IP>";
const HOME_SSID = process.env.HOME_SSID || "<networkName>";
const POLL_INTERVAL_MS = 5000; // 5 seconds
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
            `powershell -NoProfile -Command "(netsh wlan show interfaces) | Select-String '(?<!\\w)SSID\\s' | Select-Object -First 1"`,
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
            `powershell -NoProfile -EncodedCommand ${encoded}`,
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
        $meetingPatterns = @('Zoom Meeting', 'Huddle', 'Amazon Chime', 'Meet -', 'Meet –', 'Microsoft Teams')
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
            `powershell -NoProfile -EncodedCommand ${encoded}`,
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

// Monitor meeting and camera status
function poll() {
    const inMeeting = isInMeeting();
    // console.log("isInMeeting:", inMeeting);

    // Not in meeting, do nothing
    if (!inMeeting) {
        if (currentState !== STATES.OFF && currentState !== null) { // State changed, turn off
            currentState = STATES.OFF;
            callPico(STATE_ACTIONS[STATES.OFF].endpoint, STATE_ACTIONS[STATES.OFF].label);
        }
        return;
    }

    // In a meeting, check if at home
    const ssid = getCurrentSSID();
    // console.log("currentSSID:", ssid);
    if (ssid !== HOME_SSID) return; // Not at home, do nothing

    const cameraInUse = isCameraInUse();
    // console.log("isCameraInUse:", cameraInUse);
    const newState = cameraInUse ? STATES.RED : STATES.YELLOW;
    if (newState !== currentState) { // State changed, change colors
        currentState = newState;
        callPico(STATE_ACTIONS[newState].endpoint, STATE_ACTIONS[newState].label);
    }
}

// Chain polls so the next only starts after the current one finishes
function schedulePoll() {
    poll();
    setTimeout(schedulePoll, POLL_INTERVAL_MS);
}

// Graceful shutdown
function shutdown() {
    console.log("\nShutting down — turning sign off...");
    callPico(STATE_ACTIONS[STATES.OFF].endpoint, STATE_ACTIONS[STATES.OFF].label);
    setTimeout(() => process.exit(0), 1500); // Give the HTTP request time to fire
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] ♥ Alive — current state: ${currentState ?? "none"}`);
}, HEARTBEAT_INTERVAL_MS);

console.log("Webcam/meeting monitor started. Polling every", POLL_INTERVAL_MS / 1000, "seconds...");
schedulePoll();
