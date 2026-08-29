# cursor-kind — reports which SYSTEM CURSOR is showing, on Windows.
#
# Companion to electron/cursor-kind.py (X11) and cursor-kind.swift (macOS); all
# three speak the same one-line protocol so electron/main.ts drives them
# identically:
#
#   stdout: "<epoch_ms> <kind>" on every CHANGE (and once at startup)
#           kind is one of: default | text | pointer | grab | crosshair | wait
#
# Windows makes this the easy platform. GetCursorInfo() returns the HCURSOR that
# is currently displayed, system-wide, and LoadCursorW(NULL, IDC_*) returns the
# SHARED handle for each stock cursor — the same handle value the OS hands out
# to every process. So identifying the standard cursors is a handle comparison,
# with no image fingerprinting (macOS) or atom lookup (X11) needed.
#
# PowerShell rather than a compiled helper because it ships with every supported
# Windows and needs no toolchain in CI. It's a long-running process printing a
# line per change, so the ~300ms startup cost is paid once per recording.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File cursor-kind.ps1 [-IntervalMs 50]
param([int]$IntervalMs = 50)

$ErrorActionPreference = 'Stop'
if ($IntervalMs -lt 16) { $IntervalMs = 16 }

Add-Type -Namespace RF -Name Cur -MemberDefinition @'
[StructLayout(LayoutKind.Sequential)]
public struct POINT { public int x; public int y; }
[StructLayout(LayoutKind.Sequential)]
public struct CURSORINFO { public int cbSize; public int flags; public IntPtr hCursor; public POINT pt; }
[DllImport("user32.dll")] public static extern bool GetCursorInfo(ref CURSORINFO pci);
[DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr LoadCursorW(IntPtr h, IntPtr name);
'@

# Stock cursor ids (winuser.h). Only the ones that map to a glyph we draw.
$stock = @{
  32512 = 'default'    # IDC_ARROW
  32513 = 'text'       # IDC_IBEAM
  32649 = 'pointer'    # IDC_HAND
  32515 = 'crosshair'  # IDC_CROSS
  32514 = 'wait'       # IDC_WAIT
  32650 = 'wait'       # IDC_APPSTARTING
  32646 = 'grab'       # IDC_SIZEALL
  32644 = 'grab'       # IDC_SIZEWE
  32645 = 'grab'       # IDC_SIZENS
}

# HCURSOR -> kind. Built once; stock handles are stable for the session.
$byHandle = @{}
foreach ($id in $stock.Keys) {
  $h = [RF.Cur]::LoadCursorW([IntPtr]::Zero, [IntPtr]$id)
  if ($h -ne [IntPtr]::Zero -and -not $byHandle.ContainsKey($h)) { $byHandle[$h] = $stock[$id] }
}
[Console]::Error.WriteLine("cursor-kind: indexed $($byHandle.Count) cursors")

# A shape must hold this long before it's reported: crossing a window edge can
# flick through several cursors in a couple of frames, and emitting those would
# make the editor's synthetic pointer strobe.
$debounceMs = 110
$last = $null
$pending = $null
$pendingSince = [DateTimeOffset]::UtcNow
$first = $true

$ci = New-Object RF.Cur+CURSORINFO
$ci.cbSize = [System.Runtime.InteropServices.Marshal]::SizeOf($ci)

while ($true) {
  $kind = 'default'
  if ([RF.Cur]::GetCursorInfo([ref]$ci)) {
    # flags = 0 means the cursor is hidden; keep the last shape rather than
    # inventing a change the viewer never saw.
    if ($ci.flags -ne 0 -and $byHandle.ContainsKey($ci.hCursor)) { $kind = $byHandle[$ci.hCursor] }
    elseif ($ci.flags -eq 0 -and $last) { $kind = $last }
  }
  $now = [DateTimeOffset]::UtcNow
  if ($kind -ne $pending) { $pending = $kind; $pendingSince = $now }
  if ($kind -ne $last -and ($first -or ($now - $pendingSince).TotalMilliseconds -ge $debounceMs)) {
    $last = $kind
    $first = $false
    [Console]::Out.WriteLine("$($now.ToUnixTimeMilliseconds()) $kind")
    [Console]::Out.Flush()
  }
  Start-Sleep -Milliseconds $IntervalMs
}
