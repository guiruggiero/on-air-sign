// Imports
import {execSync} from "child_process";
import http from "http";

// Initializations
const PICO_IP = process.env.PICO_IP;
const HOME_SSID = process.env.HOME_SSID;
const IDLE_POLL_INTERVAL_MS = 15000; // 15 seconds when no meeting
const ACTIVE_POLL_INTERVAL_MS = 5000; // 5 seconds during a meeting (camera responsiveness)
let currentState = null;
const STATES = {
    OFF:    {endpoint: "/off",    label: "OFF ⚫"},
    YELLOW: {endpoint: "/yellow", label: "YELLOW 🟡"},
    RED:    {endpoint: "/red",    label: "RED 🔴"},
};
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Initial check if env variables are set
if (!PICO_IP || !HOME_SSID) {
    console.error("Environment variables not set. Terminating");
    process.exit(1);
}

// Run a base64-encoded PowerShell script
function runPS(encoded, timeout) {
    return execSync(`pwsh -NoProfile -EncodedCommand ${encoded}`, {timeout}).toString().trim();
}

// Combined PowerShell script: checks meeting, SSID, and camera in one process spawn
// Returns "false||false" if not in a meeting, or "true|<ssid>|<cameraInUse>" if in a meeting
const POLL_PS = Buffer.from(`
    $ProgressPreference = 'SilentlyContinue'

    # Check meeting
    $titles = Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -ExpandProperty MainWindowTitle
    $meetingPatterns = @('Zoom Meeting', 'Huddle', 'Amazon Chime:', 'Meet -', 'Meet \u2013', 'Microsoft Teams')
    $inMeeting = $false
    foreach ($title in $titles) {
        foreach ($pattern in $meetingPatterns) {
            if ($title -like "*$pattern*") { $inMeeting = $true; break }
        }
        if ($inMeeting) { break }
    }
    if (-not $inMeeting) { "false||false"; exit }

    # Check SSID
    $ssidLine = (netsh wlan show interfaces) | Select-String '(?<!\w)SSID\s' | Select-Object -First 1
    $ssid = if ($ssidLine) { ($ssidLine -split ':', 2)[1].Trim() } else { '' }

    # Check camera
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
    $cameraInUse = if ($count -gt 0) { 'true' } else { 'false' }

    "true|$ssid|$cameraInUse"
`, "utf16le").toString("base64");

// Change sign color
function callPico(state, onError) {
    const {endpoint, label} = state;
    const req = http.request({hostname: PICO_IP, port: 80, path: endpoint, method: "GET"}, (res) => {
        console.log(`[${new Date().toLocaleTimeString()}] Sign → ${label} (HTTP ${res.statusCode})`);
    });
    req.setTimeout(3000, () => {
        req.destroy(new Error("Request timed out"));
    });
    req.on("error", (e) => {
        console.error("Pico unreachable:", e.message);
        if (onError) onError();
    });
    req.end();
}

// Poll meeting, SSID, and camera status in one PowerShell call
function poll() {
    let inMeeting, ssid, cameraInUse;
    try {
        [inMeeting, ssid, cameraInUse] = runPS(POLL_PS, 10000).split("|");
    } catch (e) {
        console.error(`Error polling status: ${e.message}`);
        return;
    }

    // Not in a meeting
    if (inMeeting !== "true") {
        if (currentState !== STATES.OFF && currentState !== null) { // Left a meeting
            const prevState = currentState;
            currentState = STATES.OFF;
            callPico(STATES.OFF, () => {currentState = prevState;});
        }
        return;
    }

    if (ssid !== HOME_SSID) return; // Not at home, do nothing

    // In a meeting at home — set state based on camera
    const newState = cameraInUse === "true" ? STATES.RED : STATES.YELLOW;
    if (newState !== currentState) {
        const prevState = currentState;
        currentState = newState;
        callPico(newState, () => { currentState = prevState; });
    }
}

// Chain polls - next only starts after current one finishes
function schedulePoll() {
    poll();
    const interval = currentState !== STATES.OFF && currentState !== null
        ? ACTIVE_POLL_INTERVAL_MS
        : IDLE_POLL_INTERVAL_MS;
    setTimeout(schedulePoll, interval); // Schedules itself to run again 
}

// Graceful shutdown
function shutdown() {
    console.log("\nShutting down - turning off sign...");
    callPico(STATES.OFF);
    setTimeout(() => process.exit(0), 1500); // Give the HTTP request time to fire
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Heartbeat
setInterval(() => {
    console.log(`[${new Date().toLocaleTimeString()}] ♥ Alive - current state: ${currentState?.label ?? "none"}`);
}, HEARTBEAT_INTERVAL_MS);

console.log(`Poll interval: idle ${IDLE_POLL_INTERVAL_MS / 1000}s, active ${ACTIVE_POLL_INTERVAL_MS / 1000}s\nMeeting/webcam monitor started...\n`);
schedulePoll();