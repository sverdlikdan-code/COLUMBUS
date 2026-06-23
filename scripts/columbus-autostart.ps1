# Opens COLUMBUS in Cursor at Windows logon.
# Optional services: Formula Road API + cloudflared (if installed).
# Sets .cursor/ceo-boot-pending so the CEO autostart extension opens Agent chat.

$ErrorActionPreference = 'SilentlyContinue'
$root = 'C:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS'
$cursor = Join-Path $env:LOCALAPPDATA 'Programs\cursor\Cursor.exe'
$bootFlagDir = Join-Path $root '.cursor'
$bootFlag = Join-Path $bootFlagDir 'ceo-boot-pending'

function Test-PortListening([int]$Port) {
    $match = netstat -ano | Select-String ":$Port\s" | Select-String 'LISTENING'
    return [bool]$match
}

if (-not (Test-Path $cursor)) {
    Write-Host "Cursor not found: $cursor"
    exit 1
}

New-Item -ItemType Directory -Force -Path $bootFlagDir | Out-Null
@{
    createdAt = (Get-Date).ToString('o')
    prompt    = 'CEO?'
    source    = 'columbus-autostart.ps1'
} | ConvertTo-Json | Set-Content -Path $bootFlag -Encoding UTF8

# Formula Road API on :3000
if (-not (Test-PortListening 3000)) {
    $serverDir = Join-Path $root 'server'
    if (Test-Path (Join-Path $serverDir 'index.js')) {
        Start-Process -FilePath 'node' -ArgumentList 'index.js' -WorkingDirectory $serverDir -WindowStyle Hidden
    }
}

# cloudflared tunnel (if binary exists)
if (Get-Command cloudflared -ErrorAction SilentlyContinue) {
    if (-not (Get-Process cloudflared -ErrorAction SilentlyContinue)) {
        Start-Process -FilePath 'cloudflared' -ArgumentList 'tunnel', 'run', 'formula-road' -WindowStyle Hidden
    }
}

Start-Sleep -Seconds 3
Start-Process -FilePath $cursor -ArgumentList "`"$root`""
