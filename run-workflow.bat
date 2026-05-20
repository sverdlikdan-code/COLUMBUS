@echo off
setlocal

set LOG=c:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS\workflow.log
echo. >> %LOG%
echo [%DATE% %TIME%] ===== START ===== >> %LOG%

:: 1. csv-to-base — apply default CSVs to base JSONs
echo [%DATE% %TIME%] csv-to-base... >> %LOG%
cd /d "c:\Users\d.sverdlik\Desktop\WORKSPACE\PLANOGRAM MAHSAN FORMULA"
node csv-to-base.js >> %LOG% 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] ERROR: csv-to-base failed >> %LOG%
  goto DONE
)

:: 2. build-planogram — fetch PBI, build Excel + JSON
echo [%DATE% %TIME%] build-planogram... >> %LOG%
cd /d "c:\Users\d.sverdlik\Desktop\WORKSPACE\COLUMBUS"
node planogram/build-planogram.js >> %LOG% 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] ERROR: build-planogram failed >> %LOG%
  goto DONE
)

:: 3. workflow-doctor — analyze log, write health-report.json
echo [%DATE% %TIME%] workflow-doctor... >> %LOG%
node planogram/workflow-doctor.js >> %LOG% 2>&1

:: 4. git add changed JSON files
git add docs/kapua-base.json docs/halavi-base.json docs/dagim-yavesh-base.json docs/dagim-base.json docs/product-data.json docs/refresh-info.json docs/product-photos.json docs/health-report.json >> %LOG% 2>&1

:: 4. commit only if there are staged changes
git diff --cached --quiet
if errorlevel 1 (
  git commit -m "chore: daily planogram build" >> %LOG% 2>&1
) else (
  echo [%DATE% %TIME%] No changes after build. >> %LOG%
  goto DONE
)

:: 5. pull to sync with remote (no-rebase to avoid unstaged-changes error)
echo [%DATE% %TIME%] pulling... >> %LOG%
git pull --no-rebase -X ours origin master >> %LOG% 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] WARNING: pull failed, skipping... >> %LOG%
)

:: 6. push with retry
echo [%DATE% %TIME%] pushing... >> %LOG%
git push origin master >> %LOG% 2>&1
if errorlevel 1 (
  echo [%DATE% %TIME%] push rejected, retrying after pull... >> %LOG%
  git pull origin master --strategy-option=ours >> %LOG% 2>&1
  git push origin master >> %LOG% 2>&1
  if errorlevel 1 (
    echo [%DATE% %TIME%] ERROR: push failed after retry. >> %LOG%
  ) else (
    echo [%DATE% %TIME%] Pushed (after retry). >> %LOG%
  )
) else (
  echo [%DATE% %TIME%] Pushed. >> %LOG%
)

:DONE
echo [%DATE% %TIME%] ===== DONE ===== >> %LOG%
endlocal
