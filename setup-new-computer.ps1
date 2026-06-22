# Bootstrap для второго компьютера COLUMBUS.
# Запуск ПОСЛЕ git clone/git pull репозитория:
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
    Write-Host "Git не найден — устанавливаю через winget..." -ForegroundColor Yellow
    winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
    $needsRestart = $true
} else {
    git --version
}

Write-Host "`n=== 2. Node.js ===" -ForegroundColor Cyan
if (-not (Test-Cmd node)) {
    Write-Host "Node.js не найден — устанавливаю через winget (LTS)..." -ForegroundColor Yellow
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    $needsRestart = $true
} else {
    node -v
}

if ($needsRestart) {
    Write-Host "`nГit/Node.js только установлены — PATH обновится после перезапуска терминала." -ForegroundColor Yellow
    Write-Host "Закрой это окно, открой новый PowerShell и запусти скрипт ещё раз — он продолжит с того места." -ForegroundColor Yellow
    exit 0
}

Write-Host "`n=== 3. GitHub CLI (gh, опционально) ===" -ForegroundColor Cyan
if (-not (Test-Cmd gh)) {
    Write-Host "gh не найден — устанавливаю через winget..." -ForegroundColor Yellow
    try { winget install -e --id GitHub.cli --accept-source-agreements --accept-package-agreements } catch { Write-Host "Не критично, пропускаю." -ForegroundColor DarkYellow }
} else {
    Write-Host "gh уже установлен."
}

Write-Host "`n=== 4. Obsidian (для VAULT/) ===" -ForegroundColor Cyan
if (-not (Test-Cmd obsidian)) {
    Write-Host "Obsidian не найден — устанавливаю через winget..." -ForegroundColor Yellow
    try { winget install -e --id Obsidian.Obsidian --accept-source-agreements --accept-package-agreements } catch { Write-Host "Не удалось автоматически — установи вручную: https://obsidian.md" -ForegroundColor Red }
} else {
    Write-Host "Obsidian уже установлен."
}

Write-Host "`n=== 5. cloudflared (для туннеля API) ===" -ForegroundColor Cyan
if (-not (Test-Cmd cloudflared)) {
    Write-Host "cloudflared не найден — устанавливаю через winget..." -ForegroundColor Yellow
    try { winget install -e --id Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements } catch { Write-Host "Не удалось автоматически — установи вручную: https://github.com/cloudflare/cloudflared/releases" -ForegroundColor Red }
} else {
    Write-Host "cloudflared уже установлен."
}

Write-Host "`n=== 6. VS Code (для Claude Code extension, опционально) ===" -ForegroundColor Cyan
if (-not (Test-Cmd code)) {
    Write-Host "VS Code не найден — устанавливаю через winget..." -ForegroundColor Yellow
    try { winget install -e --id Microsoft.VisualStudioCode --accept-source-agreements --accept-package-agreements } catch { Write-Host "Не критично, пропускаю." -ForegroundColor DarkYellow }
} else {
    Write-Host "VS Code уже установлен."
}

Write-Host "`n=== 7. npm install по подпроектам ===" -ForegroundColor Cyan
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

Write-Host "`n=== ГОТОВО ===" -ForegroundColor Cyan
Write-Host "Дальше вручную (зависит от секретов, не в git):"
Write-Host "  - создать server/.env (DB-строка, ключи) — .env не пушится в git по соображениям безопасности"
Write-Host "  - запустить сервер: cd server; node index.js"
Write-Host "  - запустить тоннель: cloudflared tunnel run <имя-туннеля> (если используется)"
