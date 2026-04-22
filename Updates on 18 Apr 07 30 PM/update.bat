@echo off
cd /d "%~dp0"
echo Pulling latest code from GitHub...
git pull origin main

echo Installing any new dependencies...
call npm install

echo Starting the bot...
"C:\Program Files\nodejs\node.exe" src\index.js
pause
