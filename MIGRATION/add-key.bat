@echo off
echo Starting SSH Agent...
sc start ssh-agent >nul 2>&1
timeout /t 2 /nobreak >nul
echo Adding key...
ssh-add "%~dp0IT DILER DOCS\dan"
echo.
echo Done. Press any key to close.
pause
