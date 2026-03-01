@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

echo.
echo  ========================================
echo   Claude Telegram Bot - Setup
echo  ========================================
echo.

:: ------- Check Node.js -------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install Node.js 20+ from https://nodejs.org/
    goto :fail
)
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set NODE_VER=%%v
set NODE_VER=%NODE_VER:v=%
if %NODE_VER% LSS 20 (
    echo  [ERROR] Node.js 20+ is required. Current version: %NODE_VER%
    goto :fail
)
echo  [OK] Node.js %NODE_VER%

:: ------- Check Claude Code CLI -------
where claude >nul 2>&1
if %errorlevel% neq 0 (
    echo  [WARN] Claude Code CLI not found.
    echo  Install it: npm install -g @anthropic-ai/claude-code
    echo  Then run: claude login
    echo.
) else (
    echo  [OK] Claude Code CLI
)

:: ------- npm install -------
echo.
echo  Installing dependencies...
call npm install --no-fund --no-audit
if %errorlevel% neq 0 (
    echo  [ERROR] npm install failed.
    goto :fail
)
echo  [OK] Dependencies installed

:: ------- Configure .env -------
echo.
if exist .env (
    echo  [OK] .env file already exists, skipping configuration.
    echo  Edit .env manually if you need to change settings.
) else (
    echo  ----------------------------------------
    echo   Configuration
    echo  ----------------------------------------
    echo.
    echo  You need two things:
    echo    1. A Telegram Bot Token from @BotFather
    echo    2. Your Telegram User ID from @userinfobot
    echo.

    set /p BOT_TOKEN="  Telegram Bot Token: "
    if "!BOT_TOKEN!"=="" (
        echo  [ERROR] Bot token cannot be empty.
        goto :fail
    )

    set /p USER_ID="  Telegram User ID: "
    if "!USER_ID!"=="" (
        echo  [ERROR] User ID cannot be empty.
        goto :fail
    )

    (
        echo TELEGRAM_BOT_TOKEN=!BOT_TOKEN!
        echo ALLOWED_USER_ID=!USER_ID!
        echo # ANTHROPIC_API_KEY=
        echo # WORKING_DIRECTORY=
    ) > .env

    echo.
    echo  [OK] .env created
)

:: ------- Done -------
echo.
echo  ========================================
echo   Setup complete!
echo  ========================================
echo.
echo  To start the bot, run:
echo    cct.bat
echo.
echo  Or from any working directory:
echo    path\to\cct.bat
echo.
pause
exit /b 0

:fail
echo.
echo  Setup failed. Please fix the errors above and retry.
pause
exit /b 1
