# Installs local COLUMBUS CEO autostart extension into Cursor.
# Run: powershell -ExecutionPolicy Bypass -File scripts/install-columbus-ceo-extension.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$src = Join-Path $root 'tools\columbus-ceo-autostart'
$dest = Join-Path $env:USERPROFILE '.cursor\extensions\columbus.columbus-ceo-autostart-0.1.0'

if (-not (Test-Path $src)) {
    Write-Error "Missing extension source: $src"
}

New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Path (Join-Path $src '*') -Destination $dest -Recurse -Force

Write-Host 'OK: Extension installed to' $dest -ForegroundColor Green
Write-Host 'Restart Cursor to load the extension.'
