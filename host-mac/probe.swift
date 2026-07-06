// Native probe for the macOS host — the two signals that have no reliable
// permission-free CLI on macOS: meeting-window detection and camera-in-use state.
// (Lock state and WiFi SSID stay in poll.sh, which needs no compiled code for them.)
//
// Default mode prints "<inMeeting>|<cameraInUse>" (e.g. "true|false"), the same
// contract poll.sh forwards to monitor.js. Run `--dump-windows` to list every
// on-screen window's owner and title — use it to confirm the exact title strings
// meeting apps use on this Mac and update `meetingPatterns` below if needed.
//
// Compiled to `probe` by build.sh; not run directly by monitor.js.

import CoreGraphics
import CoreMediaIO

// Same meeting-window patterns as host-win/poll.ps1 — keep the two lists in sync
let meetingPatterns = ["Zoom Meeting", "Huddle", "Amazon Chime:", "Meet -", "Meet –", "| Microsoft Teams"]

// MARK: - Meeting-window detection

// Titles of all on-screen windows. Uses CGWindowListCopyWindowInfo (fast, in-process),
// the macOS analog of Windows' EnumWindows — sees meeting windows regardless of focus.
// Requires the Screen Recording permission, or other apps' titles come back empty.
func onScreenWindows() -> [(owner: String, title: String)] {
    guard let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    return windowList.compactMap { info in
        guard let title = info[kCGWindowName as String] as? String, !title.isEmpty else { return nil }
        let owner = info[kCGWindowOwnerName as String] as? String ?? "?"
        return (owner, title)
    }
}

func isInMeeting() -> Bool {
    let titles = onScreenWindows().map { $0.title }
    return titles.contains { title in meetingPatterns.contains { title.contains($0) } }
}

// MARK: - Camera-in-use detection

// Enumerate all CoreMediaIO devices (cameras)
func cameraDevices() -> [CMIOObjectID] {
    var address = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))

    var dataSize: UInt32 = 0
    guard CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, &dataSize) == kCMIOHardwareNoError,
          dataSize > 0 else {
        return []
    }
    let count = Int(dataSize) / MemoryLayout<CMIOObjectID>.size
    var devices = [CMIOObjectID](repeating: 0, count: count)
    var used: UInt32 = 0
    guard CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, dataSize, &used, &devices) == kCMIOHardwareNoError else {
        return []
    }
    return devices
}

// True if the given device is streaming to any process right now.
// kCMIOObjectPropertyElementMain is the current SDK name (was kCMIOObjectPropertyElementMaster
// on older toolchains); both are defined as 0, so swap the constant if this fails to compile.
func isRunning(_ device: CMIOObjectID) -> Bool {
    var address = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))

    guard CMIOObjectHasProperty(device, &address) else { return false }

    var running: UInt32 = 0
    var dataUsed: UInt32 = 0
    let size = UInt32(MemoryLayout<UInt32>.size)
    let status = CMIOObjectGetPropertyData(device, &address, 0, nil, size, &dataUsed, &running)
    return status == kCMIOHardwareNoError && running != 0
}

func isCameraInUse() -> Bool {
    cameraDevices().contains(where: isRunning)
}

// MARK: - Main

// Debug: list every on-screen window so meeting-title patterns can be confirmed on real hardware
if CommandLine.arguments.contains("--dump-windows") {
    onScreenWindows().forEach { print("\($0.owner): \($0.title)") }
    exit(0)
}

let inMeeting = isInMeeting()
// Camera only matters during a meeting; skip the query otherwise to avoid needless work
let cameraInUse = inMeeting && isCameraInUse()
print("\(inMeeting ? "true" : "false")|\(cameraInUse ? "true" : "false")")
