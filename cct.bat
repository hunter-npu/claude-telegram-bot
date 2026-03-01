@echo off
set CCT_WORK_DIR=%cd%
cd /d "%~dp0"
npx tsx --no-deprecation src/index.ts
pause
