# AIUsageBar installer for Windows 10/11 (x64).
#   irm https://raw.githubusercontent.com/alxrepin/aiusagebar/main/scripts/install.ps1 | iex
#
# Files downloaded by PowerShell don't carry the browser's "Mark of the Web",
# so SmartScreen doesn't block the unsigned installer.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$repo = 'alxrepin/aiusagebar'

Write-Host '-> Looking up the latest release...'
$release = Invoke-RestMethod "https://api.github.com/repos/$repo/releases/latest" -Headers @{ 'User-Agent' = 'aiusagebar-installer' }
$exe = $release.assets | Where-Object { $_.name -like '*-windows-x64-Setup.exe' } | Select-Object -First 1
$zip = $release.assets | Where-Object { $_.name -like '*-windows-x64-Setup.zip' } | Select-Object -First 1
if (-not $exe -and -not $zip) { throw 'Could not find a Windows build in the latest release.' }

$tmp = Join-Path $env:TEMP ("aiusagebar-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    if ($exe) {
        $setup = Join-Path $tmp $exe.name
        Write-Host "-> Downloading $($exe.name)..."
        Invoke-WebRequest $exe.browser_download_url -OutFile $setup -UseBasicParsing
        Write-Host '-> Installing...'
        # /SILENT: progress only, no questions; the app starts when it's done.
        Start-Process $setup -ArgumentList '/SILENT', '/SUPPRESSMSGBOXES', '/NORESTART' -Wait
    }
    else {
        # Releases before v0.6.2 shipped a zip with Setup.exe + .installer\
        $file = Join-Path $tmp $zip.name
        Write-Host "-> Downloading $($zip.name)..."
        Invoke-WebRequest $zip.browser_download_url -OutFile $file -UseBasicParsing
        Expand-Archive $file -DestinationPath $tmp -Force
        $setup = Get-ChildItem $tmp -Filter '*Setup*.exe' | Select-Object -First 1
        if (-not $setup) { throw 'Setup.exe not found in the archive.' }
        Write-Host '-> Installing...'
        Start-Process $setup.FullName -WorkingDirectory $tmp -Wait
    }
    Write-Host 'Done. Look for the rings in the system tray (you may need to pin it via the ^ overflow menu).'
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
