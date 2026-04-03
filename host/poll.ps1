# Run directly with: pwsh -NoProfile -Command "& { `$HomeSSID = '<HOME_SSID>'; & .\host\poll.ps1 }"
$ProgressPreference = "SilentlyContinue"

# Check computer lock (meeting shorthand)
if (Get-Process -Name LogonUI -ErrorAction SilentlyContinue) { "false|false"; exit }

# Check WiFi SSID
$ssidLine = (netsh wlan show interfaces) | Select-String "(?<!\w)SSID\s" | Select-Object -First 1
$ssid = if ($ssidLine) { ($ssidLine -split ":", 2)[1].Trim() } else { "" }
if ($ssid -ne $HomeSSID) { "false|false"; exit }

# Check meeting
$titles = Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -ExpandProperty MainWindowTitle
# TODO: "Microsoft Teams" matches the app even when not in a meeting — verify the in-call window title and replace with a more specific pattern (likely "| Microsoft Teams" or "Call | Microsoft Teams")
$meetingPatterns = @("Zoom Meeting", "Huddle", "Amazon Chime:", "Meet -", "Meet –", "Microsoft Teams")
$inMeeting = $false
foreach ($title in $titles) {
    foreach ($pattern in $meetingPatterns) {
        if ($title -like "*$pattern*") { $inMeeting = $true; break }
    }
    if ($inMeeting) { break }
}
if (-not $inMeeting) { "false|false"; exit }

# Check camera
$paths = @(
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam",
    "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\webcam\NonPackaged"
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
$cameraInUse = if ($count -gt 0) { "true" } else { "false" }
"true|$cameraInUse"