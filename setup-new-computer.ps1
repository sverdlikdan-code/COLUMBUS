# Bootstrap for a second COLUMBUS machine.
# Run AFTER git clone/git pull of the repo:
#   powershell -ExecutionPolicy Bypass -File setup-new-computer.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Test-Cmd($name) {
    return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

$needsRestart = $false

Write-Host "=== 1. Git ===" -ForegroundColor Cyan
if (-not (Test-Cmd git)) {
    Write-Host "Git not found, installing via winget..." -ForegroundColor Yellow
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
    $needsRestart = $true
} else {
    git --version
}

Write-Host "`n=== 2. Node.js ===" -ForegroundColor Cyan
if (-not (Test-Cmd node)) {
    Write-Host "Node.js not found, installing via winget (LTS)..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $needsRestart = $true
} else {
    node -v
}

if ($needsRestart) {
    Write-Host "`nGit/Node.js were just installed - PATH will update after a terminal restart." -ForegroundColor Yellow
    Write-Host "Close this window, open a new PowerShell, and run this script again - it will continue from here." -ForegroundColor Yellow
    exit 0
}

Write-Host "`n=== 3. GitHub CLI (gh, optional) ===" -ForegroundColor Cyan
if (-not (Test-Cmd gh)) {
    Write-Host "gh not found, installing via winget..." -ForegroundColor Yellow
    try { winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements } catch { Write-Host "Not critical, skipping." -ForegroundColor DarkYellow }
} else {
    Write-Host "gh already installed."
}

Write-Host "`n=== 4. Obsidian (for VAULT/) ===" -ForegroundColor Cyan
if (-not (Test-Cmd obsidian)) {
    Write-Host "Obsidian not found, installing via winget..." -ForegroundColor Yellow
    try { winget install -e --id Obsidian.Obsidian --accept-source-agreements --accept-package-agreements } catch { Write-Host "Could not auto-install - install manually: https://obsidian.md" -ForegroundColor Red }
} else {
    Write-Host "Obsidian already installed."
}

Write-Host "`n=== 5. cloudflared (for the API tunnel) ===" -ForegroundColor Cyan
if (-not (Test-Cmd cloudflared)) {
    Write-Host "cloudflared not found, installing via winget..." -ForegroundColor Yellow
    try { winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements } catch { Write-Host "Could not auto-install - install manually: https://github.com/cloudflare/cloudflared/releases" -ForegroundColor Red }
} else {
    Write-Host "cloudflared already installed."
}

Write-Host "`n=== 6. VS Code (for the Claude Code extension, optional) ===" -ForegroundColor Cyan
if (-not (Test-Cmd code)) {
    Write-Host "VS Code not found, installing via winget..." -ForegroundColor Yellow
    try { winget install -e --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements } catch { Write-Host "Not critical, skipping." -ForegroundColor DarkYellow }
} else {
    Write-Host "VS Code already installed."
}

Write-Host "`n=== 7. npm install for each subproject ===" -ForegroundColor Cyan
$projects = @('.', 'server', 'app', 'planogram', 'BIZNES-AI', 'APP-MAHSAN/portfolio')
foreach ($p in $projects) {
    $pkg = Join-Path $root "$p\package.json"
    if (Test-Path $pkg) {
        Write-Host "`n--- npm install: $p ---" -ForegroundColor Green
        Push-Location (Join-Path $root $p)
        npm install
        Pop-Location
    }
}

Write-Host "`n=== DONE ===" -ForegroundColor Cyan
Write-Host "Left to do manually (secrets are not stored in git):"
Write-Host "  - create server/.env (DB connection string, keys) - .env is gitignored for security"
Write-Host "  - start the server: cd server; node index.js"
Write-Host "  - start the tunnel: cloudflared tunnel run <tunnel-name> (if used)"
