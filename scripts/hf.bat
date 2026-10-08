@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"

:menu
cls
echo ==================================================
echo HEARTFOLIO LOCAL
echo Docker Operations Menu
echo ==================================================
echo [1]  Start
echo [2]  Stop
echo [3]  Restart
echo [4]  Status
echo [5]  Logs
echo [6]  Health Check
echo [7]  Rebuild
echo [8]  Run Tests
echo [9]  Django/API Shell
echo [10] Web Shell
echo [11] Doctor
echo [12] Open Frontend
echo [13] Open API
echo [14] Reload Env
echo [0]  Exit
echo ==================================================
set "CHOICE="
set /p "CHOICE=Choose an option: "

if "%CHOICE%"=="1"  call "%SCRIPT_DIR%start.bat"     & goto :menu
if "%CHOICE%"=="2"  call "%SCRIPT_DIR%stop.bat"      & goto :menu
if "%CHOICE%"=="3"  call "%SCRIPT_DIR%restart.bat"   & goto :menu
if "%CHOICE%"=="4"  call "%SCRIPT_DIR%status.bat"    & goto :menu
if "%CHOICE%"=="5"  call "%SCRIPT_DIR%logs.bat"      & goto :menu
if "%CHOICE%"=="6"  call "%SCRIPT_DIR%health.bat"    & goto :menu
if "%CHOICE%"=="7"  call "%SCRIPT_DIR%rebuild.bat"   & goto :menu
if "%CHOICE%"=="8"  call "%SCRIPT_DIR%test.bat"      & goto :menu
if "%CHOICE%"=="9"  call "%SCRIPT_DIR%shell-api.bat" & goto :menu
if "%CHOICE%"=="10" call "%SCRIPT_DIR%shell-web.bat" & goto :menu
if "%CHOICE%"=="11" call "%SCRIPT_DIR%doctor.bat"    & goto :menu
if "%CHOICE%"=="12" start "" "http://localhost:3000" & goto :menu
if "%CHOICE%"=="13" start "" "http://localhost:8000/api/v1/health/" & goto :menu
if "%CHOICE%"=="14" call "%SCRIPT_DIR%reload-env.bat" & goto :menu
if "%CHOICE%"=="0"  goto :eof

echo Invalid option.
pause
goto :menu
