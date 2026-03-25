@echo off
set CCT_WORK_DIR=%cd%

:parse_args
if "%~1"=="--env" (
  set CCT_ENV_FILE=%~f2
  shift
  shift
  goto parse_args
)
if "%~1"=="-e" (
  set CCT_ENV_FILE=%~f2
  shift
  shift
  goto parse_args
)
if "%~1"=="--config" (
  set CCT_CONFIG_FILE=%~f2
  shift
  shift
  goto parse_args
)
if "%~1"=="-c" (
  set CCT_CONFIG_FILE=%~f2
  shift
  shift
  goto parse_args
)

cd /d "%~dp0"
echo Starting bot...
node --no-deprecation dist/index.js
pause
