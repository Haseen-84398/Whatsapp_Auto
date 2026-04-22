@echo off
title WhatsApp Bot - Auto Restarter
:loop
echo [SYSTEM] %date% %time% - Starting WhatsApp Bot...
npm start
echo.
echo [SYSTEM] %date% %time% - Bot has stopped or crashed. 
echo [SYSTEM] Restarting in 5 seconds... (Press Ctrl+C to stop the loop)
timeout /t 5
goto loop
