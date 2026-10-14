@echo off
setlocal
cd /d "%~dp0"
title NetEase Perks Tool

:menu
cls
echo ========================================================
echo          NetEase Perks Tool (Partner-Perks-NE)
echo ========================================================
echo.
echo Please select an option:
echo [1] Refresh Auth Token (passport.jsonc to auth.json)
echo [2] Query Available Coupons
echo [3] Grant Coupons Now (Immediate)
echo [4] Scheduled 00:00:00 Auto Grant (Midnight Sniper)
echo [5] Run All (Auth + List + Grant Immediately)
echo [0] Exit
echo.

set /p opt="Enter option [0-5]: "

if "%opt%"=="1" goto do_auth
if "%opt%"=="2" goto do_list
if "%opt%"=="3" goto do_grant
if "%opt%"=="4" goto do_midnight
if "%opt%"=="5" goto do_all
if "%opt%"=="0" exit /b 0
goto menu

:do_auth
echo.
echo [1/1] Refreshing Auth Token...
call npx tsx run.ts auth
goto finish

:do_list
echo.
echo [1/1] Querying Coupons...
call npx tsx run.ts list
goto finish

:do_grant
echo.
echo [1/1] Granting Coupons Immediately...
call npx tsx run.ts grant
goto finish

:do_midnight
echo.
echo [1/1] Starting 00:00:00 Scheduler...
call npx tsx run.ts midnight
goto finish

:do_all
echo.
echo [1/1] Running All Steps...
call npx tsx run.ts all
goto finish

:finish
echo.
echo ========================================================
echo Operation completed.
pause
goto menu
