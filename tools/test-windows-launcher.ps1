[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string] $Executable,
    [string] $Output = 'dist/Windows-smoke.json'
)

# Native Windows smoke test. No browser automation or manual gameplay is
# claimed here. Only launcher processes created by this script and their
# recorded Node children may be stopped during cleanup.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$outputPath = [System.IO.Path]::GetFullPath($Output)
$launchers = [System.Collections.Generic.List[System.Diagnostics.Process]]::new()
$ownedNodes = @{}
$temporaryDirectory = $null
$result = [ordered]@{
    schema = 1
    status = 'running'
    startedAt = [DateTime]::UtcNow.ToString('o')
    windowsVersion = [Environment]::OSVersion.VersionString
    architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    checks = [ordered]@{}
    browserOpening = 'not observed; no browser automation was performed'
    manualGameplay = 'not tested'
}
$exitCode = 0

function Wait-Condition {
    param([scriptblock] $Condition, [string] $Failure, [int] $Seconds = 30)
    $clock = [System.Diagnostics.Stopwatch]::StartNew()
    do {
        if (& $Condition) { return }
        Start-Sleep -Milliseconds 200
    } while ($clock.Elapsed.TotalSeconds -lt $Seconds)
    throw $Failure
}

function Get-GameListeners {
    @(Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue)
}

function Get-OwnedNodeChildren {
    param([System.Diagnostics.Process] $Launcher)
    $children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($Launcher.Id) AND Name = 'node.exe'")
    foreach ($child in $children) {
        $process = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
        if ($null -ne $process) {
            $ownedNodes[[int]$child.ProcessId] = $process.StartTime.ToUniversalTime().Ticks
        }
    }
    return $children
}

function Test-RecordedProcessAlive {
    param([int] $ProcessId, [long] $StartedAt)
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    return ($null -ne $process -and $process.StartTime.ToUniversalTime().Ticks -eq $StartedAt)
}

function Start-TestLauncher {
    param([string] $Path)
    $process = Start-Process -FilePath $Path -WorkingDirectory (Split-Path -Parent $Path) -PassThru
    $launchers.Add($process)
    return $process
}

function Wait-ReadyLauncher {
    param([System.Diagnostics.Process] $Launcher)
    Wait-Condition -Failure 'The native launcher window did not appear within 30 seconds.' -Condition {
        $Launcher.Refresh()
        if ($Launcher.HasExited) { throw "Launcher exited before showing its window (code $($Launcher.ExitCode))." }
        return ($Launcher.MainWindowHandle -ne [IntPtr]::Zero)
    }
    Wait-Condition -Failure 'The bundled Node server did not become healthy on port 3000 within 30 seconds.' -Condition {
        $Launcher.Refresh()
        if ($Launcher.HasExited) { throw 'Launcher exited before the server became ready.' }
        $null = Get-OwnedNodeChildren -Launcher $Launcher
        try {
            $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3000/health' -TimeoutSec 1
            $health = $response.Content | ConvertFrom-Json
            return ($response.StatusCode -eq 200 -and $health.ok -eq $true)
        } catch { return $false }
    }
    $children = @(Get-OwnedNodeChildren -Launcher $Launcher)
    if ($children.Count -ne 1) { throw "Expected one bundled Node child, found $($children.Count)." }
    $child = $children[0]
    $runtimeRoot = [System.IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'FrotaEstelar/runtime')) + [System.IO.Path]::DirectorySeparatorChar
    if (-not $child.ExecutablePath -or -not $child.ExecutablePath.StartsWith($runtimeRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The server is not running from the private bundled runtime.'
    }
    $listeners = @(Get-GameListeners)
    if ($listeners.Count -ne 1 -or $listeners[0].OwningProcess -ne $child.ProcessId -or $listeners[0].LocalAddress -ne '127.0.0.1') {
        throw 'Port 3000 does not belong exclusively to the launched loopback Node server.'
    }
    return $child
}

function Close-TestLauncher {
    param([System.Diagnostics.Process] $Launcher, [int] $NodeId)
    $Launcher.Refresh()
    if ($Launcher.HasExited) { throw 'Launcher exited unexpectedly before the graceful shutdown check.' }
    if (-not $Launcher.CloseMainWindow()) { throw 'Could not request native-window shutdown.' }
    if (-not $Launcher.WaitForExit(12000)) { throw 'Launcher did not exit after closing its main window.' }
    if ($Launcher.ExitCode -ne 0) { throw "Launcher exited with code $($Launcher.ExitCode)." }
    Wait-Condition -Seconds 5 -Failure 'The owned Node process survived launcher shutdown.' -Condition {
        return -not (Test-RecordedProcessAlive -ProcessId $NodeId -StartedAt $ownedNodes[$NodeId])
    }
    if (@(Get-GameListeners).Count -ne 0) { throw 'Port 3000 remained occupied after launcher shutdown.' }
}

try {
    if (-not $IsWindows) { throw 'This smoke test requires native Windows and PowerShell 7.' }
    if (@(Get-GameListeners).Count -ne 0) {
        throw 'Port 3000 was already occupied before this test. Its owner was not stopped.'
    }
    $result.checks.initialPortFree = $true
    $sourceExecutable = (Resolve-Path -LiteralPath $Executable).Path
    $result.executableSHA256 = (Get-FileHash -LiteralPath $sourceExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
    $temporaryDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('Frota Estelar ação ' + [Guid]::NewGuid().ToString('N'))
    $null = New-Item -ItemType Directory -Path $temporaryDirectory
    $copiedExecutable = Join-Path $temporaryDirectory 'Frota Estelar teste.exe'
    Copy-Item -LiteralPath $sourceExecutable -Destination $copiedExecutable

    Write-Host 'Starting the native launcher from a path containing spaces and Unicode...'
    $first = Start-TestLauncher -Path $copiedExecutable
    $firstNode = Wait-ReadyLauncher -Launcher $first
    $result.checks.nativeWindow = $true
    $result.checks.unicodeExecutablePath = $true
    $result.checks.bundledNodeAndLoopbackHealth = $true
    $first.Refresh()
    if (-not $first.Responding) { throw 'The native launcher window is not responding.' }
    $result.checks.responsiveWindow = $true

    $assetPaths = @('/', '/styles.css', '/battle/simWorker.js', '/shared/sim/battle.js',
        '/fonts/orbitron-latin.woff2', '/fonts/exo2-latin.woff2', '/fonts/exo2-latin-ext.woff2', '/fonts/LICENSES.txt')
    foreach ($assetPath in $assetPaths) {
        $asset = Invoke-WebRequest -Uri ('http://localhost:3000' + $assetPath) -TimeoutSec 5
        if ($asset.StatusCode -ne 200 -or $asset.RawContentLength -le 0) { throw "Asset unavailable: $assetPath" }
        if ($assetPath -eq '/' -and $asset.Content -notmatch 'Frota Estelar') { throw 'The root document is not the game.' }
    }
    $result.checks.assets = $assetPaths

    $session = [Microsoft.PowerShell.Commands.WebRequestSession]::new()
    $created = Invoke-WebRequest -Uri 'http://localhost:3000/api/profile' -Method Post -ContentType 'application/json' -Body '{}' -WebSession $session -TimeoutSec 5
    $profile = ($created.Content | ConvertFrom-Json).profile
    if (-not $profile.id) { throw 'Profile creation did not return an identity.' }
    if ($session.Cookies.GetCookies([Uri]'http://localhost:3000')['fe.profile'] -eq $null) { throw 'The private profile cookie was not stored.' }
    $null = Invoke-WebRequest -Uri 'http://localhost:3000/api/profile/legacy' -Method Post -ContentType 'application/json' -Body '{"progress":{"normal":{"max":2,"cleared":[1,2]}}}' -WebSession $session -TimeoutSec 5
    $stored = (Invoke-WebRequest -Uri 'http://localhost:3000/api/profile' -WebSession $session -TimeoutSec 5).Content | ConvertFrom-Json
    if ($stored.profile.id -ne $profile.id -or $stored.profile.legacyProgress.normal.max -ne 2) { throw 'Profile cookie round trip did not preserve the saved progress.' }
    if (-not (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'FrotaEstelar/data/profiles.sqlite'))) { throw 'The persistent SQLite file was not created.' }
    $result.checks.profileAndCookie = $true

    Write-Host 'Checking that a second launch reuses the existing instance...'
    $second = Start-TestLauncher -Path $copiedExecutable
    if (-not $second.WaitForExit(10000)) { throw 'The second launcher did not yield to the first instance.' }
    if ($second.ExitCode -ne 0) { throw "The second launcher exited with code $($second.ExitCode)." }
    $remaining = @(Get-OwnedNodeChildren -Launcher $first)
    $extra = @(Get-OwnedNodeChildren -Launcher $second)
    if ($remaining.Count -ne 1 -or $remaining[0].ProcessId -ne $firstNode.ProcessId -or $extra.Count -ne 0) {
        throw 'A second launch changed or duplicated the Node server.'
    }
    $result.checks.singleInstance = $true
    Close-TestLauncher -Launcher $first -NodeId $firstNode.ProcessId
    $result.checks.gracefulShutdown = $true

    Write-Host 'Restarting and checking the same profile cookie against the persisted database...'
    $restarted = Start-TestLauncher -Path $copiedExecutable
    $restartedNode = Wait-ReadyLauncher -Launcher $restarted
    $restored = (Invoke-WebRequest -Uri 'http://localhost:3000/api/profile' -WebSession $session -TimeoutSec 5).Content | ConvertFrom-Json
    if ($restored.profile.id -ne $profile.id -or $restored.profile.legacyProgress.normal.max -ne 2) { throw 'Profile data did not survive launcher restart.' }
    if (($restored.profile.legacyProgress.normal.cleared -join ',') -ne '1,2') { throw 'Saved campaign history changed after restart.' }
    $result.checks.profileSurvivesRestart = $true
    Close-TestLauncher -Launcher $restarted -NodeId $restartedNode.ProcessId
    $result.checks.restartShutdown = $true
    $result.status = 'passed'
} catch {
    $exitCode = 1
    $result.status = 'failed'
    $result.error = $_.Exception.Message
    Write-Warning $result.error
} finally {
    foreach ($launcher in $launchers) {
        try {
            $launcher.Refresh()
            if (-not $launcher.HasExited) {
                $null = Get-OwnedNodeChildren -Launcher $launcher
                $null = $launcher.CloseMainWindow()
                if (-not $launcher.WaitForExit(5000)) { $launcher.Kill(); $null = $launcher.WaitForExit(3000) }
            }
        } catch { Write-Warning "Cleanup of owned launcher $($launcher.Id): $($_.Exception.Message)" }
    }
    foreach ($nodeId in @($ownedNodes.Keys)) {
        try {
            if (Test-RecordedProcessAlive -ProcessId $nodeId -StartedAt $ownedNodes[$nodeId]) { Stop-Process -Id $nodeId -Force }
        } catch { Write-Warning "Cleanup of owned Node ${nodeId}: $($_.Exception.Message)" }
    }
    if ($temporaryDirectory -and (Test-Path -LiteralPath $temporaryDirectory)) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    # Do not remove LOCALAPPDATA data, close unrelated browser processes, or
    # touch pre-existing port owners. Never write the private cookie to output.
    $result.finishedAt = [DateTime]::UtcNow.ToString('o')
    $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $outputPath)
    $result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $outputPath -Encoding utf8
    Write-Host "Native launcher smoke result: $($result.status). Report: $outputPath"
}
exit $exitCode
