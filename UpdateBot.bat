@echo off
title WhatsApp Bot - Auto Updater
echo [UPDATE] Checking for code updates...

:: Check if git is initialized
if not exist .git (
    echo [ERROR] Git is not initialized in this folder.
    pause
    exit
)

:: Pull latest changes from GitHub
echo [GIT] Pulling latest changes...
git pull origin master

:: Install/Update dependencies
echo [NPM] Updating libraries...
call npm install

echo.
echo [SUCCESS] Project is up to date!
echo You can now run the bot using RunBot.bat
pause
