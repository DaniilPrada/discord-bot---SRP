@echo off
REM StreetLife Discord Bot auto-restart script

REM change this path to your bot folder if needed
cd /d "C:\StreetLifeBot"

title StreetLife Discord Bot
:loop
node index.js
echo.
echo [StreetLifeBot] Bot crashed or stopped. Restarting in 5 seconds...
timeout /t 5 >nul
goto loop
