@echo off
set CCT_WORK_DIR=%cd%
cd /d "%~dp0"
echo Starting bot...
node --no-deprecation dist/index.js
pause
