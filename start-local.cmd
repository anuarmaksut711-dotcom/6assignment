@echo off
setlocal
cd /d "%~dp0" || exit /b 1

python --version >nul 2>&1
if errorlevel 1 (
    echo Python 3.10 or newer is required. Check that python is on PATH.
    pause
    exit /b 1
)

echo Starting PIXEL at http://127.0.0.1:8879/
start "" /b powershell.exe -NoProfile -Command "$url = 'http://127.0.0.1:8879/'; for ($attempt = 0; $attempt -lt 20; $attempt++) { try { $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2 -ErrorAction Stop } catch { Start-Sleep -Milliseconds 500; continue }; if ($page.Content -match '<title>[^<]*PIXEL') { Start-Process $url; break } }"

python -u booking_server.py --local --port 8879
if errorlevel 1 pause
