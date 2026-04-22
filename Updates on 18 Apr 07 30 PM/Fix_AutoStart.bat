@echo off
set "TARGET_DIR=d:\Whatsapp Automation"
set "TARGET_FILE=d:\Whatsapp Automation\start.bat"
set "SHORTCUT_PATH=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\WhatsappBot.lnk"

echo Creating startup shortcut...
powershell -ExecutionPolicy Bypass -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = '%TARGET_FILE%'; $s.WorkingDirectory = '%TARGET_DIR%'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo.
    echo ==========================================
    echo SUCCESS: Startup shortcut created!
    echo Bot will now start automatically.
    echo ==========================================
) else (
    echo.
    echo ERROR: Failed to create shortcut.
)
pause
