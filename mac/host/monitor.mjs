// Imports
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {statSync, readFileSync, writeFileSync, appendFileSync} from "node:fs";
import {execFileSync, execFile} from "node:child_process";
import http from "node:http";

// Initializations
const PICO_IP = "192.168.0.209";
const NOTIFY_ON_CHANGE = true;
const POLL_INTERVAL_MS = 5000; // 5 seconds
const ALIVE_LOG_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const STATES = {
    OFF:    {endpoint: "/off",    label: "OFF ⚫"},
    YELLOW: {endpoint: "/yellow", label: "YELLOW 🟡"},
    RED:    {endpoint: "/red",    label: "RED 🔴"},
};
let currentState = null;
let shuttingDown = false;

// Logging
const HOST_DIR = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = join(HOST_DIR, "logs.log");
const ERR_PATH = join(HOST_DIR, "errors.log");
const LOG_MAX_BYTES = 200_000;
const TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Append a line, first trimming the file to its newest half once it passes LOG_MAX_BYTES
function appendLine(path, line) {
    try {
        if (statSync(path, {throwIfNoEntry: false})?.size > LOG_MAX_BYTES) {
            const content = readFileSync(path, "utf-8");
            writeFileSync(path, content.slice(content.indexOf("\n", content.length / 2) + 1));
        }
        appendFileSync(path, `${line}\n`);
    } catch {} // Logging must never crash the monitor
}

function log(msg) {
    const now = new Date();
    const date = now.toLocaleDateString([], {month: "2-digit", day: "2-digit"});
    const time = now.toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false});
    const line = `[${date} ${time} ${TIMEZONE}] ${msg}`;
    console.log(line);
    appendLine(LOG_PATH, line);
    return line;
}

function logError(msg) {
    appendLine(ERR_PATH, log(msg));
}

// Log a recurring poll error only when it changes, so a persistent failure doesn't write a line every poll
let lastPollError = null;
function logPollError(msg) {
    if (msg === lastPollError) return;
    lastPollError = msg;
    logError(msg);
}

// Config from the gitignored .env next to this file; real environment variables win
const ENV_PATH = join(HOST_DIR, ".env");
try {
    process.loadEnvFile(ENV_PATH);
} catch (e) {
    if (e.code !== "ENOENT") logError(`Failed to read ${ENV_PATH}: ${e.message}`);
}

// Exit 0 so launchd doesn't relaunch every ~10s over a config error that won't fix itself
if (!process.env.HOME_GATEWAY_MAC) {
    logError(`HOME_GATEWAY_MAC is not set. Add it to ${ENV_PATH} — get it on your home network with: arp -n "$(route -n get default | awk '/gateway:/ {print $2}')"`);
    process.exit(0);
}

// Home = the default gateway's (router's) MAC matches HOME_GATEWAY_MAC. Normalized because arp drops
// leading zeros ("9:a:..." not "09:0a:...")
const normalizeMac = (mac) => mac.toLowerCase().split(":").map((octet) => octet.replace(/^0(?=.)/, "")).join(":");
const HOME_GATEWAY_MAC = normalizeMac(process.env.HOME_GATEWAY_MAC);

function isHome() {
    try {
        const route = execFileSync("route", ["-n", "get", "default"], {timeout: 2000, stdio: "pipe"}).toString();
        const gatewayIp = route.match(/gateway:\s*(\S+)/)?.[1];
        if (!gatewayIp) return false;
        const arp = execFileSync("arp", ["-n", gatewayIp], {timeout: 2000, stdio: "pipe"}).toString();
        return normalizeMac(arp.match(/ at (\S+)/)?.[1] ?? "") === HOME_GATEWAY_MAC;
    } catch {
        return false; // Offline (no default route) or no ARP entry
    }
}

// Native probe, compiled by build.sh (not here — swiftc usually isn't on launchd's PATH).
// Prints "<inMeeting>|<cameraInUse>"; exits 1 with the reason on stderr
const PROBE_BIN = join(HOST_DIR, "probe");
function runProbe() {
    try {
        return execFileSync(PROBE_BIN, {timeout: 10000, stdio: "pipe"}).toString().trim();
    } catch (e) {
        if (e.code === "ENOENT" || e.code === "EACCES") throw new Error(`Probe at ${PROBE_BIN} is missing or not executable — run ./build.sh`);
        if (e.code === "ETIMEDOUT") throw new Error("Probe timed out after 10s");
        if (e.signal) throw e; // Killed by Ctrl-C/shutdown — the caller ignores it
        throw new Error(`Probe failed: ${e.stderr?.toString().trim() || e.message}`);
    }
}

// macOS notification via osascript
function notify(label) {
    execFile("osascript", ["-e", `display notification ${JSON.stringify(label)} with title "On Air sign"`], (e) => {
        if (e) logError(`Notification failed: ${e.message}`);
    });
}

// Set the sign color; onError lets the caller roll back so the next poll retries
function callPico(state, onError, isTransition = false) {
    const req = http.request({hostname: PICO_IP, port: 80, path: state.endpoint, method: "GET"}, (res) => {
        res.resume(); // Drain the body to free the socket
        log(`Sign → ${state.label} (HTTP ${res.statusCode})`);
        if (isTransition && NOTIFY_ON_CHANGE && res.statusCode === 200) notify(state.label);
    });
    req.setTimeout(3000, () => req.destroy(new Error("Request timed out")));
    req.on("error", (e) => {
        logError(`Pico unreachable: ${e.message}`);
        onError?.();
    });
    req.end();
}

// OFF unless home and in a meeting; then RED with the camera on, else YELLOW
function poll() {
    let newState = STATES.OFF;
    try {
        if (isHome()) {
            const output = runProbe();
            const match = output.match(/^(true|false)\|(true|false)$/);
            if (!match) throw new Error(`Unexpected probe output: ${output}`);
            if (match[1] === "true") newState = match[2] === "true" ? STATES.RED : STATES.YELLOW;
        }
        if (lastPollError) {
            log("Polling recovered");
            lastPollError = null;
        }
    } catch (e) {
        if (shuttingDown || e.signal) return;
        logPollError(`Error polling status: ${e.message}`);
        return; // Hold the state; if this persists mid-meeting, the Pico's watchdog turns the sign off
    }

    if (newState !== currentState) { // Transition — the first poll always sends, clearing a sign left on by a crash
        const prevState = currentState;
        currentState = newState;
        callPico(newState, () => {currentState = prevState;}, prevState !== null);
    } else if (newState !== STATES.OFF) { // Heartbeat for the Pico watchdog during a meeting
        callPico(newState);
    }
}

// poll() is synchronous, so polls never overlap
function schedulePoll() {
    if (shuttingDown) return; // Don't re-light the sign after shutdown turned it off
    poll();
    setTimeout(schedulePoll, POLL_INTERVAL_MS);
}

// Graceful shutdown: turn the sign off, then exit once the request had time to finish (3s timeout)
function shutdown() {
    if (shuttingDown) return; // Ignore a second Ctrl-C
    shuttingDown = true;
    log("Shutting down - turning off sign...");
    callPico(STATES.OFF);
    setTimeout(() => process.exit(0), 3500);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Alive log
setInterval(() => log(`♥ Alive - current state: ${currentState?.label ?? "none"}`), ALIVE_LOG_INTERVAL_MS);

log(`Meeting/webcam monitor started, polling every ${POLL_INTERVAL_MS / 1000}s...`);
schedulePoll();
