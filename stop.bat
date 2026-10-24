@echo off
setlocal
cd /d "%~dp0"
node home-server\cli.mjs stop
set result=%errorlevel%
echo.
pause
exit /b %result%
