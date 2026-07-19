$ErrorActionPreference = 'Continue'
$repo = "c:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS"
$log  = "$repo\prophet\auto-rebuild.log"

function Log($msg) {
    $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "$ts  $msg" | Out-File -FilePath $log -Append -Encoding utf8
}

Log "=== Prophet auto-rebuild START ==="

try {
    Set-Location $repo

    & node server/fetch-prophet-history.js
    if ($LASTEXITCODE -ne 0) { throw "fetch-prophet-history exit code: $LASTEXITCODE" }
    Log "Weekly sales CSV updated from PBI"

    $env:PYTHONIOENCODING = "utf-8"
    & python prophet\run_prophet.py
    if ($LASTEXITCODE -ne 0) { throw "prophet exit code: $LASTEXITCODE" }
    Log "Prophet OK"

    & git add docs/prophet.json prophet/weekly_sales.csv
    $ts2 = Get-Date -Format "yyyy-MM-dd HH:mm"
    & git commit -m "data: prophet auto-rebuild $ts2"
    if ($LASTEXITCODE -ne 0) { Log "Nothing to commit"; exit 0 }

    & git pull --rebase origin master
    if ($LASTEXITCODE -ne 0) { throw "git pull rebase failed" }

    & git push origin master
    if ($LASTEXITCODE -ne 0) { throw "git push failed" }
    Log "Pushed prophet.json OK"

} catch {
    Log "ERROR: $_"
    exit 1
}

Log "=== DONE ==="
