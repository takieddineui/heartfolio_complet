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

echo ==================================================
echo Stopping Heartfolio containers...
echo (Containers only. Nothing is removed, no volumes
echo  are touched, Supabase and R2 are untouched.)
echo ==================================================
docker compose stop
if errorlevel 1 (
    echo ERROR: docker compose stop failed.
    goto :end
)
echo Done.

:end
echo.
pause
exit /b
