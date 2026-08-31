@echo off
cd /d "%~dp0"
set PORT=17989

echo ==========================================================
echo   Starting Word Map Editor with dictionary service ...
echo   Editor: word-map-editor.html
echo   Dict service: http://127.0.0.1:%PORT%
echo ==========================================================
echo.

rem --- Check whether the dictionary service is already running ---
powershell -NoProfile -Command "if(Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue){exit 0}else{exit 1}" >nul 2>&1
if not errorlevel 1 goto open

rem --- Not running: start dictionary service in a new window ---
echo [1/2] Starting dictionary service ...
start "dict-server-%PORT%" cmd /c "node dict-server.js"
echo       waiting for service ...
timeout /t 2 /nobreak >nul

:open
echo [2/2] Opening editor in your browser ...
start "" "word-map-editor.html"
echo.
echo Done. In the editor click "+ Add Word" to fetch from the dictionary.
echo Keep the dict-server window open while using it.
echo.
