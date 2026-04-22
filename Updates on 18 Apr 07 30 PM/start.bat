@echo off
cd /d "%~dp0"
title WhatsApp Automation Bot - Auto Updating
set PATH=C:\Program Files\nodejs;%PATH%

:loop
echo.
echo ===================================================
echo [INFO] Checking for latest updates from GitHub...
git pull origin main

echo [INFO] Installing any missing dependencies...
call npm install

echo.
echo [INFO] Starting WhatsApp Automation Bot...
node src\index.js

echo.
echo [WARNING] Bot stopped or an update was found! Restarting in 5 seconds...
echo ===================================================
timeout /t 5
goto loop
