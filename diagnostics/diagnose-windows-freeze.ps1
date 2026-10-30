# Read-only sampling: no desktop input, screenshots, process termination or uploads.
[CmdletBinding()]
param(
    [ValidateRange(5, 86400)][int]$DurationSeconds = 1800,
    [ValidateRange(1, 60)][int]$IntervalSeconds = 5,
    [string]$OutputDirectory = (Join-Path (Join-Path (Get-Location) '.local/diagnostics') ("windows-freeze-" + (Get-Date -Format 'yyyyMMdd-HHmmss')))
)

$ErrorActionPreference = 'Stop'
if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
    throw 'This collector runs on Windows only.'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class FaberReadOnlyCounters {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetGuiResources(IntPtr process, uint flags);
    [DllImport("user32.dll")]
    public static extern short GetAsyncKeyState(int key);
}
'@

$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$started = Get-Date
$clock = [Diagnostics.Stopwatch]::StartNew()
$last = @{}
$processFile = Join-Path $OutputDirectory 'processes.csv'
$inputFile = Join-Path $OutputDirectory 'input-state.csv'

@{
    StartedUtc = $started.ToUniversalTime().ToString('o')
    OS = [Environment]::OSVersion.VersionString
    PowerShell = $PSVersionTable.PSVersion.ToString()
    LogicalProcessors = [Environment]::ProcessorCount
    IntervalSeconds = $IntervalSeconds
    Note = 'CPU is total-machine percent; blank means first sample or unavailable. Input state records held modifiers/buttons only. No window titles, typed text, command lines, screenshots or dumps.'
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $OutputDirectory 'environment.json') -Encoding UTF8

Write-Host "Collecting for $DurationSeconds seconds. Ctrl+C stops collection. Output: $OutputDirectory"
try {
    while ($clock.Elapsed.TotalSeconds -lt $DurationSeconds) {
        $utc = [DateTime]::UtcNow.ToString('o')
        $seen = @{}
        foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
            try {
                if ($process.ProcessName -notmatch '^(Faber|micromatrix-service.*|micromatrix-computer.*|cloudflared|ngrok|flclash|clash.*|mihomo.*|sing-box|explorer|dwm|msedgewebview2|bash|sh|cmd|powershell|pwsh|node|python(?:w|\d+(?:\.\d+)?)?)$') { continue }
                $key = "$($process.Id):$($process.StartTime.ToUniversalTime().Ticks)"
                $seen[$key] = $true
                $elapsed = $clock.Elapsed.TotalSeconds
                $cpuSeconds = $process.TotalProcessorTime.TotalSeconds
                $cpuPercent = $null
                if ($last.ContainsKey($key) -and $elapsed -gt $last[$key].Time) {
                    $cpuPercent = [Math]::Round(100 * ($cpuSeconds - $last[$key].Cpu) / ($elapsed - $last[$key].Time) / [Environment]::ProcessorCount, 2)
                }
                $last[$key] = @{ Time = $elapsed; Cpu = $cpuSeconds }
                $gdi = $null; $user = $null
                try {
                    $gdi = [FaberReadOnlyCounters]::GetGuiResources($process.Handle, 0)
                    $user = [FaberReadOnlyCounters]::GetGuiResources($process.Handle, 1)
                } catch { } # Protected processes may deny counter access.
                [pscustomobject]@{
                    Utc = $utc; Name = $process.ProcessName; Pid = $process.Id
                    StartedUtc = $process.StartTime.ToUniversalTime().ToString('o')
                    CpuPercent = $cpuPercent
                    PrivateMB = [Math]::Round($process.PrivateMemorySize64 / 1MB, 2)
                    WorkingSetMB = [Math]::Round($process.WorkingSet64 / 1MB, 2)
                    Handles = $process.HandleCount; Threads = $process.Threads.Count
                    GdiObjects = $gdi; UserObjects = $user
                } | Export-Csv -LiteralPath $processFile -Append -NoTypeInformation -Encoding UTF8
            } catch {
                # A process can exit between enumeration and sampling.
            } finally { $process.Dispose() }
        }
        foreach ($key in @($last.Keys)) { if (-not $seen.ContainsKey($key)) { $last.Remove($key) } }
        $held = @()
        foreach ($entry in @(@{ Name='LeftMouse'; Key=1 }, @{ Name='RightMouse'; Key=2 }, @{ Name='MiddleMouse'; Key=4 },
            @{ Name='Shift'; Key=16 }, @{ Name='Ctrl'; Key=17 }, @{ Name='Alt'; Key=18 }, @{ Name='LeftWin'; Key=91 }, @{ Name='RightWin'; Key=92 })) {
            if (([int][FaberReadOnlyCounters]::GetAsyncKeyState($entry.Key) -band 0x8000) -ne 0) { $held += $entry.Name }
        }
        [pscustomobject]@{ Utc=$utc; HeldModifiersAndButtons=($held -join '|') } |
            Export-Csv -LiteralPath $inputFile -Append -NoTypeInformation -Encoding UTF8
        Start-Sleep -Seconds $IntervalSeconds
    }
} finally {
    $clock.Stop()
    Write-Host "Samples saved in $OutputDirectory"
}
