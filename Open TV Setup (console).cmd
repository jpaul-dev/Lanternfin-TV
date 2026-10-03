@echo off
cd /d "%~dp0"
node tv-setup/server.mjs --open
if errorlevel 1 (
  echo TV Setup needs Node.js 22 or newer. Install it from https://nodejs.org and try again.
  pause
)
