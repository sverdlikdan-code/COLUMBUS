# COLUMBUS Watchdog — runs 1.5h after workflow, verifies success, retries if needed
# Scheduled at 07:30 daily

$LOG = "c:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS\workflow.log"
$REPO = "c:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS"
$today = (Get-Date).ToString("MM/dd/yyyy")
$reportLine = "[$(Get-Date -Format 'ddd MM/dd/yyyy HH:mm:ss')] [WATCHDOG]"

function Log($msg) {
  Add-Content -Path $LOG -Value "$reportLine $msg"
  Write-Host "$reportLine $msg"
}

Log "===== WATCHDOG START ====="

# Read today's log entries
$logContent = Get-Content $LOG -ErrorAction SilentlyContinue
$todayLines = $logContent | Where-Object { $_ -match $today }

$didStart  = $todayLines | Where-Object { $_ -match "START" }
$didDone   = $todayLines | Where-Object { $_ -match "DONE" }
$didPushed = $todayLines | Where-Object { $_ -match "Pushed" }
$hadError  = $todayLines | Where-Object { $_ -match "ERROR:" }

if (-not $didStart) {
  Log "ALERT: workflow did not run today at all!"
  Log "Running workflow now..."
  cmd /c "c:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS\run-workflow.bat"
  Log "Workflow triggered."

} elseif ($hadError -or -not $didPushed) {
  Log "ALERT: workflow ran but had errors or push failed. Retrying push..."
  Set-Location $REPO
  git pull origin master --strategy-option=ours 2>&1 | Tee-Object -Append -FilePath $LOG
  git push origin master 2>&1 | Tee-Object -Append -FilePath $LOG
  if ($LASTEXITCODE -eq 0) {
    Log "Push retry: SUCCESS"
  } else {
    Log "Push retry: FAILED -- manual intervention needed"
  }

} elseif ($didPushed) {
  Log "OK -- workflow completed and pushed successfully."

} else {
  Log "OK -- no changes today, nothing to push."
}

# Run doctor — analyze log patterns and update health-report.json
Set-Location $REPO
node planogram/workflow-doctor.js 2>&1 | Tee-Object -Append -FilePath $LOG

Log "===== WATCHDOG DONE ====="
