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

docker compose ps --status running 2>nul | findstr /i "web" >nul 2>&1
if errorlevel 1 (
    echo ==================================================
    echo ERROR: The web container is not running.
    echo Start Heartfolio first ^(option 1^), then try again.
    echo ==================================================
    goto :end
)

echo ==================================================
echo Opening a shell inside the web container...
echo (node:20-slim is Debian-based, so sh is available.)
echo Type exit to leave.
echo ==================================================
docker compose exec web sh

:end
echo.
pause
exit /b
