// Imports
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {statSync, readFileSync, writeFileSync, appendFileSync, existsSync} from "node:fs";
import {execFileSync, spawn} from "node:child_process";
import http from "node:http";

// Initializations
const PICO_IP = "192.168.0.209";
const HOME_SSID = process.env.HOME_SSID;
const NOTIFY_ON_CHANGE = true;
const IDLE_POLL_INTERVAL_MS = 5000; // 5 seconds when no meeting
const ACTIVE_POLL_INTERVAL_MS = 5000; // 5 seconds during a meeting (camera responsiveness)
let currentState = null;
let shuttingDown = false;
const STATES = {
    OFF:    {endpoint: "/off",    label: "OFF ⚫"},
    YELLOW: {endpoint: "/yellow", label: "YELLOW 🟡"},
    RED:    {endpoint: "/red",    label: "RED 🔴"},
};
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

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
    const date = now.toLocaleDateString([], {month: "2-digit", day: "2-digit"});
    const time = now.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
    const line = `[${date} ${time} ${TIMEZONE}] ${msg}`;
    console.log(line);
    try {
        trimLog(LOG_PATH);
        appendFileSync(LOG_PATH, `${line}\n`);
    } catch {}
    return line;
}

function logError(msg) {
    const line = log(msg);
    try {
        trimLog(ERR_PATH);
        appendFileSync(ERR_PATH, `${line}\n`);
    } catch {}
}

// Initial check if env variables are set
if (!HOME_SSID) {
    logError("HOME_SSID environment variable not set. Terminating");
    process.exit(1);
}

// The native probe (meeting-window + camera detection) is compiled once by build.sh, not here:
// swiftc is usually not on launchd's PATH, so compiling at startup would silently fail on autostart.
const PROBE_BIN = join(HOST_DIR, "probe");
if (!existsSync(PROBE_BIN)) {
    logError(`Probe binary not found at ${PROBE_BIN}. Run ./build.sh first — without it meetings can't be detected (sign stays OFF)`);
}

// Send a macOS notification via osascript (built-in, no dependency)
function notify(label) {
    try {
        const child = spawn("osascript", ["-e", `display notification ${JSON.stringify(label)} with title "On Air Sign"`], {
            detached: false,
        });
        child.stdout.resume();
        child.stderr.resume();
        child.on("error", (e) => logError(`Notification spawn failed: ${e.message}`));
        child.unref();
    } catch (e) {
        logError(`Notification spawn threw: ${e.message}`);
    }
}

// Run poll.sh with HOME_SSID and the camera probe path injected via env
const POLL_SCRIPT = join(HOST_DIR, "poll.sh");
function runPoll(timeout) {
    return execFileSync("bash", [POLL_SCRIPT], {
        timeout,
        env: {...process.env, HOME_SSID, PROBE_BIN},
    }).toString().trim();
}

// Change sign color
function callPico(state, onError, isTransition = false) {
    const {endpoint, label} = state;
    const req = http.request({hostname: PICO_IP, port: 80, path: endpoint, method: "GET"}, (res) => {
        res.resume(); // Drain response body to free socket
        log(`Sign → ${label} (HTTP ${res.statusCode})`);
        if (isTransition && NOTIFY_ON_CHANGE && res.statusCode === 200) notify(label);
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

// Poll meeting and camera status in one shell call
function poll() {
    let inMeeting, cameraInUse;
    try {
        const output = runPoll(10000);
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
            callPico(STATES.OFF, () => {currentState = prevState;}, true);
        }
        return;
    }

    // In a meeting at home — set state based on camera
    const newState = cameraInUse === "true" ? STATES.RED : STATES.YELLOW;
    if (newState !== currentState) {
        const prevState = currentState;
        currentState = newState;
        callPico(newState, () => {currentState = prevState}, true);
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
