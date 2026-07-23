# fix-pbi-refresh-schedule.ps1
# Reads current PBI scheduled refresh config and sets it to once per day at 06:00 Israel

$TenantId   = Read-Host "PBI_TENANT (Azure Tenant ID)"
$ClientId   = Read-Host "PBI_CLIENT (App Client ID)"
$ClientSecret = Read-Host "PBI_SECRET" -AsSecureString
$WorkspaceId  = Read-Host "PBI_WORKSPACE (Workspace/Group ID)"
$DatasetId    = Read-Host "PBI_DATASET (Dataset ID)"

$ClientSecretPlain = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [Runtime.InteropServices.Marshal]::SecureStringToBSTR($ClientSecret)
)

Write-Host "`nGetting token..." -ForegroundColor Cyan

$tokenUrl = "https://login.microsoftonline.com/$TenantId/oauth2/v2.0/token"
$tokenBody = @{
    grant_type    = "client_credentials"
    client_id     = $ClientId
    client_secret = $ClientSecretPlain
    scope         = "https://analysis.windows.net/powerbi/api/.default"
}
$tokenResp = Invoke-RestMethod -Uri $tokenUrl -Method Post -Body $tokenBody
$token = $tokenResp.access_token
$headers = @{ Authorization = "Bearer $token" }

Write-Host "Token OK." -ForegroundColor Green

$baseUrl = "https://api.powerbi.com/v1.0/myorg/groups/$WorkspaceId/datasets/$DatasetId"

Write-Host "`n--- CURRENT SCHEDULED REFRESH ---" -ForegroundColor Yellow
$current = Invoke-RestMethod -Uri "$baseUrl/refreshSchedule" -Headers $headers
$current | ConvertTo-Json -Depth 5

Write-Host "`n--- CURRENT DIRECT QUERY REFRESH (if applicable) ---" -ForegroundColor Yellow
try {
    $dq = Invoke-RestMethod -Uri "$baseUrl/directQueryRefreshSchedule" -Headers $headers
    $dq | ConvertTo-Json -Depth 5
} catch { Write-Host "(No DirectQuery schedule or not applicable)" }

Write-Host "`n" -NoNewline
$confirm = Read-Host "Reset scheduled refresh to 1x/day at 06:00 Israel (03:00 UTC)? (yes/no)"

if ($confirm -ne "yes") {
    Write-Host "Cancelled." -ForegroundColor Red
    exit
}

$newSchedule = @{
    value = @{
        enabled           = $true
        notifyOption      = "MailOnFailure"
        localTimeZoneId   = "Israel Standard Time"
        days              = @("Sunday","Monday","Tuesday","Wednesday","Thursday")
        times             = @("06:00")
    }
} | ConvertTo-Json -Depth 5

Write-Host "`nPatching scheduled refresh..." -ForegroundColor Cyan
try {
    Invoke-RestMethod -Uri "$baseUrl/refreshSchedule" -Method Patch -Headers $headers `
        -ContentType "application/json" -Body $newSchedule
    Write-Host "Done. Scheduled refresh set to 06:00 Israel, Sun-Thu only." -ForegroundColor Green
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
