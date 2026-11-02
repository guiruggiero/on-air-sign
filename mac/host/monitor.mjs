// Imports
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {statSync, readFileSync, writeFileSync, appendFileSync} from "node:fs";
import {execFileSync, execFile} from "node:child_process";

// Initializations
const NOTIFY_ON_CHANGE = false; // Notify on every sign change (always on for errors)
const POLL_INTERVAL_MS = 3000; // 3 seconds; caps writes at 20/min
const REFRESH_INTERVAL_MS = 60 * 1000; // 1 minute; re-send during a meeting, well inside the Pico's 5-minute staleness limit
const FEED_TIMEOUT_MS = 5000; // 5 seconds
const STATES = {
    OFF:    {value: "off",    label: "OFF ⚫"},
    YELLOW: {value: "yellow", label: "YELLOW 🟡"},
    RED:    {value: "red",    label: "RED 🔴"},
};
let currentState = null;
let lastSentAt = 0;
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
    const line = `[${date} ${time} ${TIMEZONE}] ${String(msg).replace(/[\r\n]+/g, " ")}`; // Newlines stripped to avoid log forging
    console.log(line);
    appendLine(LOG_PATH, line);
    return line;
}

function logError(msg) {
    appendLine(ERR_PATH, log(msg));
}

// Log a recurring error only when it changes, so a persistent failure doesn't write a line every poll.
// Tracked per kind ("Polling", "Feed"), and a recovery is logged once. Returns true when newly logged
const lastErrors = {};
function logErrorOnce(kind, msg) {
    if (lastErrors[kind] === msg) return false;
    lastErrors[kind] = msg;
    logError(`${kind} error: ${msg}`);
    return true;
}

function clearError(kind) {
    if (!lastErrors[kind]) return;
    delete lastErrors[kind];
    log(`${kind} recovered`);
}

// Config from the gitignored .env next to this file; real environment variables win
const ENV_PATH = join(HOST_DIR, ".env");
try {
    process.loadEnvFile(ENV_PATH);
} catch (e) {
    if (e.code !== "ENOENT") logError(`Failed to read ${ENV_PATH}: ${e.message}`);
}

// Exit 0 so launchd doesn't relaunch every ~10s over a config error that won't fix itself
const missing = ["HOME_ROUTER_MAC", "ADAFRUIT_IO_USERNAME", "ADAFRUIT_IO_KEY"].filter((name) => !process.env[name]);
if (missing.length) {
    logError(`Missing in ${ENV_PATH}: ${missing.join(", ")}. Get the router MAC on your home network with: arp -n "$(route -n get default | awk '/gateway:/ {print $2}')"`);
    process.exit(0);
}

// Home = the default gateway's (router's) MAC matches HOME_ROUTER_MAC. Normalized because arp drops
// leading zeros ("9:a:..." not "09:0a:...")
const normalizeMac = (mac) => mac.toLowerCase().split(":").map((octet) => octet.replace(/^0(?=.)/, "")).join(":");
const HOME_ROUTER_MAC = normalizeMac(process.env.HOME_ROUTER_MAC);

function isHome() {
    try {
        const route = execFileSync("route", ["-n", "get", "default"], {timeout: 2000, stdio: "pipe"}).toString();
        const gatewayIp = route.match(/gateway:\s*(\S+)/)?.[1];
        if (!gatewayIp) return false;
        const arp = execFileSync("arp", ["-n", gatewayIp], {timeout: 2000, stdio: "pipe"}).toString();
        return normalizeMac(arp.match(/ at (\S+)/)?.[1] ?? "") === HOME_ROUTER_MAC;
    } catch {
        return false; // Offline (no default route) or no ARP entry
    }
}

// Native probe, compiled by build.sh (not here — swiftc usually isn't on launchd's PATH).
// Prints "<inMeeting>|<cameraInUse>"; exits 1 with the reason on stderr
// Errors you can fix carry an `action`, which becomes the notification text
const PROBE_BIN = join(HOST_DIR, "probe");
const probeError = (message, action) => Object.assign(new Error(message), {action});
function runProbe() {
    try {
        return execFileSync(PROBE_BIN, {timeout: 2000, stdio: "pipe"}).toString().trim();
    } catch (e) {
        if (e.code === "ENOENT" || e.code === "EACCES") throw probeError(`Probe at ${PROBE_BIN} is missing or not executable`, "Rebuild the probe: run ./build.sh in mac/host");
        if (e.code === "ETIMEDOUT") throw new Error("Probe timed out after 2s");
        if (e.signal) throw e; // Killed by Ctrl-C/shutdown — the caller ignores it
        const stderr = e.stderr?.toString().trim() || e.message;
        // process.execPath is the real node binary, so after a Node upgrade this names the new one to grant
        if (stderr.includes("Screen Recording")) throw probeError(`Probe failed: ${stderr}`, `Grant Screen Recording to ${process.execPath} (System Settings → Privacy & Security → Screen & System Audio Recording), then restart the monitor`);
        throw new Error(`Probe failed: ${stderr}`);
    }
}

// macOS notification via osascript
function notify(message, title = "On Air sign") {
    execFile("osascript", ["-e", `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)}`], (e) => {
        if (e) logError(`Notification failed: ${e.message}`);
    });
}

// Write the state to the Adafruit IO feed the Pico polls. Resolves true on success
const FEED_URL = `https://io.adafruit.com/api/v2/${process.env.ADAFRUIT_IO_USERNAME}/feeds/on-air-sign/data`;
async function sendState(state) {
    try {
        const res = await fetch(FEED_URL, {
            method: "POST",
            headers: {"X-AIO-Key": process.env.ADAFRUIT_IO_KEY, "Content-Type": "application/json"},
            body: JSON.stringify({value: state.value}),
            signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
        lastSentAt = Date.now();
        clearError("Feed");
        return true;
    } catch (e) {
        logErrorOnce("Feed", e.message);
        return false;
    }
}

// On a transition, update the state first so polls don't re-send it, and roll back on failure so the next poll retries
async function transition(newState) {
    const prevState = currentState;
    currentState = newState;
    if (!await sendState(newState)) {
        if (currentState === newState) currentState = prevState; // Unless a newer transition already happened
        return;
    }
    log(`Sign → ${newState.label}`);
    if (prevState !== null && NOTIFY_ON_CHANGE) notify(newState.label);
}

// OFF unless home and in a meeting; then RED with the camera on, else YELLOW
function detectState() {
    if (!isHome()) return STATES.OFF;
    const output = runProbe();
    const match = output.match(/^(true|false)\|(true|false)$/);
    if (!match) throw new Error(`Unexpected probe output: ${output}`);
    if (match[1] !== "true") return STATES.OFF;
    return match[2] === "true" ? STATES.RED : STATES.YELLOW;
}

function poll() {
    let newState;
    try {
        newState = detectState();
        clearError("Polling");
    } catch (e) {
        if (shuttingDown || e.signal) return;
        // Polling errors need action (e.g. Screen Recording lost after a Node upgrade), so also notify; feed errors fix themselves
        if (logErrorOnce("Polling", e.message)) notify(e.action ?? e.message, "On Air sign needs attention");
        return; // Hold the state; if this persists mid-meeting, the Pico's staleness check turns the sign off
    }

    if (newState !== currentState) { // Transition — the first poll always sends, clearing a sign left on by a crash
        void transition(newState); // Errors are handled inside sendState
    } else if (newState !== STATES.OFF && Date.now() - lastSentAt >= REFRESH_INTERVAL_MS) { // Keep the value fresh during a meeting
        void sendState(newState);
    }
}

// poll() is synchronous, so polls never overlap
function schedulePoll() {
    if (shuttingDown) return; // Don't re-light the sign after shutdown turned it off
    poll();
    setTimeout(schedulePoll, POLL_INTERVAL_MS);
}

// Graceful shutdown: turn the sign off (the write times out after FEED_TIMEOUT_MS), then exit
async function shutdown() {
    if (shuttingDown) return; // Ignore a second Ctrl-C
    shuttingDown = true;
    log("Shutting down - turning off sign...");
    if (await sendState(STATES.OFF)) log(`Sign → ${STATES.OFF.label}`);
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log(`Meeting/webcam monitor started, polling every ${POLL_INTERVAL_MS / 1000}s...`);
schedulePoll();