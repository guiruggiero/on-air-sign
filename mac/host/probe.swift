// Detects lock state, meeting windows, and camera use for monitor.mjs. Prints "<inMeeting>|<cameraInUse>";
// `--dump-windows` lists every window's owner and title, for tuning isMeetingWindow

import CoreGraphics
import CoreMediaIO

// MARK: - Lock detection

// Read from the login session; needs no permission
func isScreenLocked() -> Bool {
    let session = CGSessionCopyCurrentDictionary() as? [String: Any]
    return session?["CGSSessionScreenIsLocked"] as? Bool ?? false
}

// MARK: - Meeting-window detection

// Every window, including minimized and hidden ones; other apps' titles are empty without Screen Recording
func allWindows() -> [(owner: String, title: String)] {
    let windows = CGWindowListCopyWindowInfo(.optionAll, kCGNullWindowID) as? [[String: Any]] ?? []
    return windows.compactMap { info in
        guard let title = info[kCGWindowName as String] as? String, !title.isEmpty else { return nil }
        return (info[kCGWindowOwnerName as String] as? String ?? "?", title)
    }
}

// Per-app meeting rules, confirmed with `--dump-windows` on real calls. Searching all windows (not just
// on-screen ones) catches minimized meetings; the Zoom, Slack, and Meet windows disappear when the meeting ends
func isMeetingWindow(owner: String, title: String) -> Bool {
    switch owner {
    case "Zoom": return title.contains("Zoom Meeting")
    case "Slack": return title.contains("[Main]") // Slack tags its main window this way only while a huddle is open
    case "Google Chrome": return title.hasPrefix("Meet - ") // Meet tab, or its floating window when another tab is active
    case "Webex", "Microsoft Teams": return true // Only ever opened for meetings, so running means in a meeting
    default: return false
    }
}

func isInMeeting() -> Bool {
    allWindows().contains { isMeetingWindow(owner: $0.owner, title: $0.title) }
}

// MARK: - Camera-in-use detection

// Global-scope CoreMediaIO property address
func cmioAddress(_ selector: Int) -> CMIOObjectPropertyAddress {
    CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(selector),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
}

// All cameras, including virtual ones
func cameraDevices() -> [CMIOObjectID] {
    let system = CMIOObjectID(kCMIOObjectSystemObject)
    var address = cmioAddress(kCMIOHardwarePropertyDevices)
    var size: UInt32 = 0
    guard CMIOObjectGetPropertyDataSize(system, &address, 0, nil, &size) == kCMIOHardwareNoError else { return [] }
    var devices = [CMIOObjectID](repeating: 0, count: Int(size) / MemoryLayout<CMIOObjectID>.size)
    guard CMIOObjectGetPropertyData(system, &address, 0, nil, size, &size, &devices) == kCMIOHardwareNoError else { return [] }
    return devices
}

// Streaming to any app right now — the same signal as the green camera LED
func isRunning(_ device: CMIOObjectID) -> Bool {
    var address = cmioAddress(kCMIODevicePropertyDeviceIsRunningSomewhere)
    var running: UInt32 = 0
    var used: UInt32 = 0
    let status = CMIOObjectGetPropertyData(device, &address, 0, nil, UInt32(MemoryLayout<UInt32>.size), &used, &running)
    return status == kCMIOHardwareNoError && running != 0
}

func isCameraInUse() -> Bool {
    cameraDevices().contains(where: isRunning)
}

// MARK: - Permission

// Fail loudly (exit 1 + reason on stderr) — without Screen Recording every check reads "no meeting"
func requireScreenRecording() {
    guard CGPreflightScreenCaptureAccess() else {
        fputs("Screen Recording permission not granted — enable it for the app running the monitor (your terminal, or node under launchd) in System Settings → Privacy & Security → Screen Recording\n", stderr)
        exit(1)
    }
}

// MARK: - Main

// Debug: list windows to tune isMeetingWindow
if CommandLine.arguments.contains("--dump-windows") {
    requireScreenRecording()
    allWindows().forEach { print("\($0.owner): \($0.title)") }
    exit(0)
}

// Locked means OFF; checked before the permission since it needs none
if isScreenLocked() {
    print("false|false")
    exit(0)
}

requireScreenRecording()
let inMeeting = isInMeeting()
let cameraInUse = inMeeting && isCameraInUse() // Camera only matters during a meeting
print("\(inMeeting)|\(cameraInUse)")