import Foundation
import CoreGraphics
import CoreMediaIO
import Darwin

// MARK: - Config

let PICO_IP = "192.168.0.209"
let POLL_INTERVAL: TimeInterval = 5.0
let HEARTBEAT_LOG_INTERVAL: TimeInterval = 5 * 60
let LOG_MAX_BYTES = 200_000

let meetingPatterns = ["Zoom Meeting", "Huddle", "Amazon Chime:", "Meet -", "Meet –", "| Microsoft Teams"]

// MARK: - State

enum SignState: String, Equatable {
    case off, yellow, red
    var endpoint: String { "/\(rawValue)" }
    var label: String {
        switch self {
        case .off: return "OFF ⚫"
        case .yellow: return "YELLOW 🟡"
        case .red: return "RED 🔴"
        }
    }
}

let stateLock = NSLock()
var currentState: SignState? = nil
var shuttingDown = false
var homeSSID = ""
var wifiInterface: String? = nil

// MARK: - Logging

let executableDirectory = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
let logPath = executableDirectory.appendingPathComponent("logs.log").path
let errorPath = executableDirectory.appendingPathComponent("errors.log").path

let logDateFormatter: DateFormatter = {
    let formatter = DateFormatter()
    formatter.dateFormat = "MM/dd HH:mm:ss"
    return formatter
}()

func timestamp() -> String {
    let tz = TimeZone.current.abbreviation() ?? TimeZone.current.identifier
    return "[\(logDateFormatter.string(from: Date())) \(tz)]"
}

func trimLog(_ path: String) {
    guard let attrs = try? FileManager.default.attributesOfItem(atPath: path),
          let size = attrs[.size] as? Int, size > LOG_MAX_BYTES,
          let content = try? String(contentsOfFile: path, encoding: .utf8) else { return }
    let midpoint = content.index(content.startIndex, offsetBy: content.count / 2)
    guard let newlineRange = content.range(of: "\n", range: midpoint..<content.endIndex) else { return }
    try? String(content[newlineRange.upperBound...]).write(toFile: path, atomically: true, encoding: .utf8)
}

func appendLine(_ path: String, _ line: String) {
    trimLog(path)
    guard let data = (line + "\n").data(using: .utf8) else { return }
    if FileManager.default.fileExists(atPath: path), let handle = FileHandle(forWritingAtPath: path) {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    } else {
        try? data.write(to: URL(fileURLWithPath: path))
    }
}

func log(_ message: String) {
    let line = "\(timestamp()) \(message)"
    print(line)
    appendLine(logPath, line)
}

func logError(_ message: String) {
    appendLine(errorPath, "\(timestamp()) \(message)")
    log(message)
}

// MARK: - Shell helper

@discardableResult
func runProcess(_ path: String, _ args: [String]) -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: path)
    process.arguments = args
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = Pipe()
    do {
        try process.run()
    } catch {
        return ""
    }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    process.waitUntilExit()
    return String(data: data, encoding: .utf8) ?? ""
}

// MARK: - Screen lock detection

// CGSessionCopyCurrentDictionary is undocumented but has been a stable CoreGraphics
// export since 10.5; it's the standard way to read lock-screen state outside AppKit.
@_silgen_name("CGSessionCopyCurrentDictionary")
func CGSessionCopyCurrentDictionary() -> CFDictionary?

func isScreenLocked() -> Bool {
    guard let sessionDict = CGSessionCopyCurrentDictionary() as? [String: Any] else {
        return true // no session info available (e.g. at loginwindow) - fail safe toward OFF
    }
    return (sessionDict["CGSSessionScreenIsLocked"] as? Bool) ?? false
}

// MARK: - WiFi SSID detection

func resolveWiFiInterfaceName() -> String? {
    let output = runProcess("/usr/sbin/networksetup", ["-listallhardwareports"])
    var foundWiFi = false
    for line in output.components(separatedBy: "\n") {
        if line.hasPrefix("Hardware Port: Wi-Fi") {
            foundWiFi = true
            continue
        }
        if foundWiFi, line.hasPrefix("Device: ") {
            return line.replacingOccurrences(of: "Device: ", with: "").trimmingCharacters(in: .whitespaces)
        }
    }
    return nil
}

func currentSSID(interface: String) -> String? {
    let output = runProcess("/usr/sbin/ipconfig", ["getsummary", interface])
    for line in output.components(separatedBy: "\n") {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.hasPrefix("SSID : ") {
            return String(trimmed.dropFirst("SSID : ".count))
        }
    }
    return nil
}

// MARK: - Meeting window detection

func onScreenWindowTitles() -> [(owner: String, title: String)] {
    guard let windowList = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
        return []
    }
    return windowList.compactMap { info in
        guard let title = info[kCGWindowName as String] as? String, !title.isEmpty else { return nil }
        let owner = info[kCGWindowOwnerName as String] as? String ?? "?"
        return (owner, title)
    }
}

func isInMeetingWindow() -> Bool {
    let titles = onScreenWindowTitles().map { $0.title }
    return titles.contains { title in meetingPatterns.contains { title.contains($0) } }
}

// MARK: - Camera-in-use detection

func cameraDeviceIDs() -> [CMIOObjectID] {
    var propertyAddress = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyDevices),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))

    var dataSize: UInt32 = 0
    var status = CMIOObjectGetPropertyDataSize(CMIOObjectID(kCMIOObjectSystemObject), &propertyAddress, 0, nil, &dataSize)
    guard status == kCMIOHardwareNoError, dataSize > 0 else { return [] }

    let deviceCount = Int(dataSize) / MemoryLayout<CMIOObjectID>.size
    var devices = [CMIOObjectID](repeating: 0, count: deviceCount)
    var dataUsed: UInt32 = 0
    status = CMIOObjectGetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &propertyAddress, 0, nil, dataSize, &dataUsed, &devices)
    guard status == kCMIOHardwareNoError else { return [] }
    return devices
}

func isDeviceRunning(_ device: CMIOObjectID) -> Bool {
    // kCMIOObjectPropertyElementMain is the current SDK name (formerly kCMIOObjectPropertyElementMaster
    // on older toolchains); both are defined as 0, so swap the constant if this fails to compile.
    var propertyAddress = CMIOObjectPropertyAddress(
        mSelector: CMIOObjectPropertySelector(kCMIODevicePropertyDeviceIsRunningSomewhere),
        mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal),
        mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))

    guard CMIOObjectHasProperty(device, &propertyAddress) else { return false }

    var isRunning: UInt32 = 0
    var dataUsed: UInt32 = 0
    let dataSize = UInt32(MemoryLayout<UInt32>.size)
    let status = CMIOObjectGetPropertyData(device, &propertyAddress, 0, nil, dataSize, &dataUsed, &isRunning)
    return status == kCMIOHardwareNoError && isRunning != 0
}

func isCameraInUse() -> Bool {
    cameraDeviceIDs().contains { isDeviceRunning($0) }
}

// MARK: - Pico HTTP client

// Raw sockets, not URLSession: CFNetwork's App Transport Security blocks plain http://
// by default and a bare swiftc binary has no Info.plist to declare an exception.
func httpGet(host: String, path: String, timeoutSeconds: Int) -> Int32? {
    let sock = socket(AF_INET, SOCK_STREAM, 0)
    guard sock >= 0 else { return nil }
    defer { close(sock) }

    var timeout = timeval(tv_sec: timeoutSeconds, tv_usec: 0)
    setsockopt(sock, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    setsockopt(sock, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))

    var addr = sockaddr_in()
    addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    addr.sin_family = sa_family_t(AF_INET)
    addr.sin_port = in_port_t(80).bigEndian
    guard inet_pton(AF_INET, host, &addr.sin_addr) == 1 else { return nil }

    // Note: SO_RCVTIMEO/SO_SNDTIMEO bound send/recv, not connect() itself. On a healthy
    // LAN a refused/unreachable connect fails near-instantly, so this is not worth the
    // added complexity of a non-blocking connect+select for this use case.
    let connectResult = withUnsafePointer(to: &addr) { ptr -> Int32 in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
            connect(sock, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard connectResult == 0 else { return nil }

    let request = "GET \(path) HTTP/1.0\r\nHost: \(host)\r\nConnection: close\r\n\r\n"
    guard let requestData = request.data(using: .utf8) else { return nil }
    let bytesWritten = requestData.withUnsafeBytes { buf -> Int in
        write(sock, buf.baseAddress, buf.count)
    }
    guard bytesWritten > 0 else { return nil }

    var buffer = [UInt8](repeating: 0, count: 512)
    let bytesRead = read(sock, &buffer, buffer.count)
    guard bytesRead > 0 else { return nil }

    let response = String(bytes: buffer[0..<bytesRead], encoding: .utf8) ?? ""
    guard let statusLine = response.components(separatedBy: "\r\n").first else { return nil }
    let parts = statusLine.components(separatedBy: " ")
    guard parts.count >= 2, let statusCode = Int32(parts[1]) else { return nil }
    return statusCode
}

func callPico(_ state: SignState, isTransition: Bool, onError: (() -> Void)? = nil) {
    if let code = httpGet(host: PICO_IP, path: state.endpoint, timeoutSeconds: 3) {
        log("Sign → \(state.label) (HTTP \(code))")
        if isTransition, code == 200 {
            notify(state.label)
        }
    } else {
        logError("Pico unreachable: request to \(state.endpoint) failed")
        onError?()
    }
}

// MARK: - Notifications

func notify(_ message: String) {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    process.arguments = ["-e", "display notification \"\(message)\" with title \"On Air Sign\""]
    process.standardOutput = FileHandle.nullDevice
    process.standardError = FileHandle.nullDevice
    try? process.run() // fire-and-forget
}

// MARK: - State machine

func setNotInMeeting() {
    stateLock.lock(); let cur = currentState; stateLock.unlock()
    guard let cur = cur, cur != .off else { return }
    stateLock.lock(); currentState = .off; stateLock.unlock()
    callPico(.off, isTransition: true) {
        stateLock.lock(); currentState = cur; stateLock.unlock()
    }
}

func setInMeeting(cameraOn: Bool) {
    let new: SignState = cameraOn ? .red : .yellow
    stateLock.lock(); let cur = currentState; stateLock.unlock()
    if new != cur {
        stateLock.lock(); currentState = new; stateLock.unlock()
        callPico(new, isTransition: true) {
            stateLock.lock(); currentState = cur; stateLock.unlock()
        }
    } else {
        callPico(new, isTransition: false) // heartbeat, feeds Pico's 5-minute watchdog
    }
}

func poll() {
    if isScreenLocked() { setNotInMeeting(); return }
    guard let iface = wifiInterface, let ssid = currentSSID(interface: iface), ssid == homeSSID else {
        setNotInMeeting()
        return
    }
    guard isInMeetingWindow() else { setNotInMeeting(); return }
    setInMeeting(cameraOn: isCameraInUse())
}

// MARK: - Shutdown

func shutdown() {
    stateLock.lock(); shuttingDown = true; stateLock.unlock()
    log("Shutting down - turning off sign...")
    callPico(.off, isTransition: false)
    DispatchQueue.main.asyncAfter(deadline: .now() + 3.5) { exit(0) }
}

// MARK: - Main

if CommandLine.arguments.contains("--dump-windows") {
    onScreenWindowTitles().forEach { print("\($0.owner): \($0.title)") }
    exit(0)
}

guard let envSSID = ProcessInfo.processInfo.environment["HOME_SSID"], !envSSID.isEmpty else {
    FileHandle.standardError.write("HOME_SSID environment variable not set. Terminating\n".data(using: .utf8)!)
    exit(1)
}
homeSSID = envSSID
wifiInterface = resolveWiFiInterfaceName()
if wifiInterface == nil {
    logError("Could not resolve WiFi interface name; WiFi checks will always fail")
}

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)

let sigintSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
sigintSource.setEventHandler { shutdown() }
sigintSource.resume()

let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigtermSource.setEventHandler { shutdown() }
sigtermSource.resume()

Timer.scheduledTimer(withTimeInterval: HEARTBEAT_LOG_INTERVAL, repeats: true) { _ in
    stateLock.lock(); let label = currentState?.label ?? "none"; stateLock.unlock()
    log("♥ Alive - current state: \(label)")
}

log("Poll interval: \(Int(POLL_INTERVAL))s\nMeeting/webcam monitor started...")

Thread.detachNewThread {
    while true {
        stateLock.lock(); let stop = shuttingDown; stateLock.unlock()
        if stop { break }
        poll()
        Thread.sleep(forTimeInterval: POLL_INTERVAL)
    }
}

RunLoop.main.run()
