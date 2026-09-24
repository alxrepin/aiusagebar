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
$asset = $release.assets | Where-Object { $_.name -like '*-windows-x64-Setup.zip' } | Select-Object -First 1
if (-not $asset) { throw 'Could not find a Windows build in the latest release.' }

$tmp = Join-Path $env:TEMP ("aiusagebar-" + [guid]::NewGuid())
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
    $zip = Join-Path $tmp $asset.name
    Write-Host "-> Downloading $($asset.name)..."
    Invoke-WebRequest $asset.browser_download_url -OutFile $zip -UseBasicParsing
    Expand-Archive $zip -DestinationPath $tmp -Force
    $setup = Get-ChildItem $tmp -Filter '*Setup*.exe' | Select-Object -First 1
    if (-not $setup) { throw 'Setup.exe not found in the archive.' }
    Get-ChildItem $tmp -Recurse | Unblock-File
    Write-Host '-> Running the installer...'
    Start-Process $setup.FullName -WorkingDirectory $tmp -Wait
    Write-Host 'Done. Look for the rings in the system tray (you may need to pin it via the ^ overflow menu).'
}
finally {
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
