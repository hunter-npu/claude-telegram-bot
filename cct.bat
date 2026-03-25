@echo off
set CCT_WORK_DIR=%cd%

:parse_args
if "%~1"=="-i" (
  set CCT_INSTANCE=%~2
  shift
  shift
  goto parse_args
)
if "%~1"=="--instance" (
  set CCT_INSTANCE=%~2
  shift
  shift
  goto parse_args
)

cd /d "%~dp0"
echo Starting bot...
node --no-deprecation dist/index.js
pause
