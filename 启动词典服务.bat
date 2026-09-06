@echo off
cd /d "%~dp0"
echo ==========================================================
echo   Dictionary lookup service is starting ...
echo   Server: http://127.0.0.1:17989
echo   Used by word-map-editor.html  "+ Add Word" button.
echo   Keep this window OPEN while using the editor.
echo   Close this window to stop the service.
echo ==========================================================
echo.
node dict-server.js
echo.
echo Service exited. Press any key to close...
pause >nul
