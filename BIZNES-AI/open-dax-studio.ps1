# open-dax-studio.ps1
# Устанавливает DAX Studio если нет, затем открывает с нужным PBIX
# Usage: .\open-dax-studio.ps1 [path-to-pbix]

param(
    [string]$PbixPath = "$PSScriptRoot\INTERNATIONAL CONTROL DESK.pbix"
)

$daxPaths = @(
    "$env:LOCALAPPDATA\DAXStudio\daxstudio.exe",
    "$env:ProgramFiles\DAX Studio\daxstudio.exe",
    "${env:ProgramFiles(x86)}\DAX Studio\daxstudio.exe",
    "$env:LOCALAPPDATA\Programs\DAX Studio\daxstudio.exe"
)

$daxExe = $daxPaths | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $daxExe) {
    Write-Host "DAX Studio не найден. Устанавливаю через winget..." -ForegroundColor Yellow
    winget install DaxStudio.DaxStudio --accept-package-agreements --accept-source-agreements
    Start-Sleep -Seconds 3
    $daxExe = $daxPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
}

if (-not $daxExe) {
    Write-Host "Не удалось найти DAX Studio после установки." -ForegroundColor Red
    Write-Host "Скачай вручную: https://daxstudio.org" -ForegroundColor Cyan
    exit 1
}

if (-not (Test-Path $PbixPath)) {
    Write-Host "PBIX не найден: $PbixPath" -ForegroundColor Red
    exit 1
}

Write-Host "Открываю DAX Studio с: $PbixPath" -ForegroundColor Green
Start-Process $daxExe -ArgumentList """$PbixPath"""
