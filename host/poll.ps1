# Run directly with: pwsh -NoProfile -Command "& { `$HomeSSID = '<HOME_SSID>'; & .\host\poll.ps1 }"
$ProgressPreference = "SilentlyContinue"

# Check computer lock (meeting shorthand)
# LockApp.exe only runs on a true lock screen; LogonUI alone can be a credential popup (e.g. Midway re-auth)
$isLocked = (Get-Process -Name LockApp -ErrorAction SilentlyContinue) -and (Get-Process -Name LogonUI -ErrorAction SilentlyContinue)
if ($isLocked) { "false|false"; exit }

# Check WiFi SSID - via the Network List Manager, without triggering Windows' location permission
$onHomeNetwork = [bool](Get-NetConnectionProfile -ErrorAction SilentlyContinue | Where-Object { $_.Name -eq $HomeSSID })
if (-not $onHomeNetwork) { "false|false"; exit }

# Check meeting
# Use EnumWindows to get all visible window titles, not just MainWindowTitle per process.
# MainWindowTitle only returns one title per process and changes with focus — this causes
# Slack Huddle's floating window to disappear from the list when Slack loses focus.
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class WindowEnum {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
    public static List<string> GetTitles() {
        var list = new List<string>();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                var sb = new StringBuilder(256);
                if (GetWindowText(hWnd, sb, 256) > 0) list.Add(sb.ToString());
            }
            return true;
        }, IntPtr.Zero);
        return list;
    }
}
"@ -ErrorAction SilentlyContinue
$titles = [WindowEnum]::GetTitles()
$meetingPatterns = @("Zoom Meeting", "Huddle", "Amazon Chime:", "Meet -", "Meet –", "| Microsoft Teams")
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