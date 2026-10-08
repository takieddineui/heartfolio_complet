@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%" 2>nul
if errorlevel 1 (
    echo ERROR: Could not locate the Heartfolio root directory.
    goto :end
)

where docker >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker CLI not found in PATH.
    goto :end
)

docker info >nul 2>&1
if errorlevel 1 (
    echo ERROR: Docker is not running.
    goto :end
)

:menu
cls
echo ==================================================
echo HEARTFOLIO LOGS
echo ==================================================
echo [1] API logs (follow)
echo [2] Web logs (follow)
echo [3] Both (follow)
echo [0] Back
echo ==================================================
choice /c 1230 /n /m "Choose an option: "

if errorlevel 4 goto :end
if errorlevel 3 goto :both
if errorlevel 2 goto :web
if errorlevel 1 goto :api

:api
echo Press Ctrl+C to stop following.
docker compose logs -f --tail=200 api
goto :menu

:web
echo Press Ctrl+C to stop following.
docker compose logs -f --tail=200 web
goto :menu

:both
echo Press Ctrl+C to stop following.
docker compose logs -f --tail=200 api web
goto :menu

:end
exit /b
