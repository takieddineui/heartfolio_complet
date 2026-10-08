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
echo HEARTFOLIO STATUS
echo ==================================================
docker compose ps
echo.
echo --------------------------------------------------
echo This shows whether the WEB and API containers are
echo running. It does NOT confirm Supabase is reachable
echo -- use "Health Check" (option 6) for that.
echo --------------------------------------------------

:end
echo.
pause
exit /b
