@echo off
setlocal
cd /d "%~dp0" || exit /b 1

echo Starting PIXEL at http://192.168.31.40:8880/
python -B -u booking_server.py --local --telegram --host 192.168.31.40 --port 8880
if errorlevel 1 pause
