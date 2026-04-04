// Imports
import {dirname, join} from "path";
import {fileURLToPath} from "url";
import {statSync, readFileSync, writeFileSync, appendFileSync} from "fs";
import {execSync} from "child_process";
import http from "http";

// Logging
const HOST_DIR = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(HOST_DIR, "logs.log");
const ERR_PATH = join(HOST_DIR, "errors.log");
const LOG_MAX_BYTES = 200_000;
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

function trimLog(path) {
    try {
        const size = statSync(path).size;
        if (size > LOG_MAX_BYTES) {
            const content = readFileSync(path, "utf-8");
            const mid = content.indexOf("\n", Math.floor(content.length / 2));
            writeFileSync(path, mid !== -1 ? content.slice(mid + 1) : content);
        }
    } catch {}
}

function log(msg) {
    const now = new Date();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const line = `[${mm}-${dd} ${now.toLocaleTimeString()} ${TIMEZONE}] ${msg}`;
    console.log(line);
    try {
        trimLog(LOG_PATH);
        appendFileSync(LOG_PATH, line + "\n");
    } catch {}
    return line;
}

function logError(msg) {
    const line = log(msg);
    try {
        trimLog(ERR_PATH);
        appendFileSync(ERR_PATH, line + "\n");
    } catch {}
}

// Initializations
const PICO_IP = process.env.PICO_IP;
const HOME_SSID = process.env.HOME_SSID;
const IDLE_POLL_INTERVAL_MS = 15000; // 15 seconds when no meeting
const ACTIVE_POLL_INTERVAL_MS = 5000; // 5 seconds during a meeting (camera responsiveness)
let currentState = null;
let shuttingDown = false;
const STATES = {
    OFF:    {endpoint: "/off",    label: "OFF ⚫"},
    YELLOW: {endpoint: "/yellow", label: "YELLOW 🟡"},
    RED:    {endpoint: "/red",    label: "RED 🔴"},
};
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// Initial check if env variables are set
if (!PICO_IP || !HOME_SSID) {
    logError("Environment variables not set. Terminating");
    process.exit(1);
}

// Run a base64-encoded PowerShell script
function runPS(encoded, timeout) {
    return execSync(`pwsh -NoProfile -EncodedCommand ${encoded}`, {timeout}).toString().trim();
}

// Load PowerShell script with HOME_SSID, returns "false|false" if not in a meeting, or "true|<cameraInUse>" if in a meeting at home
const POLL_PS = Buffer.from(`$HomeSSID = '${HOME_SSID}'\n` + readFileSync(new URL("poll.ps1", import.meta.url), "utf-8"), "utf16le").toString("base64");

// Change sign color
function callPico(state, onError) {
    const {endpoint, label} = state;
    const req = http.request({hostname: PICO_IP, port: 80, path: endpoint, method: "GET"}, (res) => {
        res.resume(); // Drain response body to free socket
        log(`Sign → ${label} (HTTP ${res.statusCode})`);
    });
    req.setTimeout(3000, () => {
        req.destroy(new Error("Request timed out"));
    });
    req.on("error", (e) => {
        logError(`Pico unreachable: ${e.message}`);
        if (onError) onError();
    });
    req.end();
}

// Poll meeting and camera status in one PowerShell call
function poll() {
    let inMeeting, cameraInUse;
    try {
        const output = runPS(POLL_PS, 10000);
        const parts = output.split("|");
        if (parts.length !== 2) {
            logError(`Unexpected poll output: ${output}`);
            return;
        }
        [inMeeting, cameraInUse] = parts;
    } catch (e) {
        if (shuttingDown) return; // Killed by shutdown signal, not an error
        logError(`Error polling status: ${e.message}`);
        return;
    }

    // Not in a meeting (or computer locked, or not at home)
    if (inMeeting !== "true") {
        if (currentState !== STATES.OFF && currentState !== null) { // Left a meeting
            const prevState = currentState;
            currentState = STATES.OFF;
            callPico(STATES.OFF, () => {currentState = prevState;});
        }
        return;
    }

    // In a meeting at home — set state based on camera
    const newState = cameraInUse === "true" ? STATES.RED : STATES.YELLOW;
    if (newState !== currentState) {
        const prevState = currentState;
        currentState = newState;
        callPico(newState, () => { currentState = prevState; });
    } else {
        callPico(newState); // Heartbeat for Pico watchdog
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
    shuttingDown = true;
    log("Shutting down - turning off sign...");
    callPico(STATES.OFF);
    setTimeout(() => process.exit(0), 3500); // Give the HTTP request time to complete (3s timeout)
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Heartbeat
setInterval(() => {
    log(`♥ Alive - current state: ${currentState?.label ?? "none"}`);
}, HEARTBEAT_INTERVAL_MS);

log(`Poll interval: idle ${IDLE_POLL_INTERVAL_MS / 1000}s, active ${ACTIVE_POLL_INTERVAL_MS / 1000}s\nMeeting/webcam monitor started...`);
schedulePoll();