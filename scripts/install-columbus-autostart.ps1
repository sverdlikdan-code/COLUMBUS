# Registers COLUMBUS autostart at Windows logon (Cursor + optional API/tunnel).
# Run: powershell -ExecutionPolicy Bypass -File scripts/install-columbus-autostart.ps1
# Remove: Unregister-ScheduledTask -TaskName 'COLUMBUS-Autostart' -Confirm:$false

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$script = Join-Path $root 'scripts\columbus-autostart.ps1'

if (-not (Test-Path $script)) {
    Write-Error "Missing script: $script"
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask `
    -TaskName 'COLUMBUS-Autostart' `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Description 'Open Cursor COLUMBUS workspace on logon; start API/tunnel if down; CEO Agent autostart' `
    -Force | Out-Null

Write-Host 'OK: Scheduled task COLUMBUS-Autostart registered (runs at logon).' -ForegroundColor Green
Write-Host "Script: $script"
Write-Host 'Hooks: .cursor/hooks.json — CEO + last session inject on Agent sessionStart.'
Write-Host 'Extension: run scripts/install-columbus-ceo-extension.ps1 once, then restart Cursor.'
