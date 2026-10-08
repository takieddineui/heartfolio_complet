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

docker compose ps --status running 2>nul | findstr /i "api" >nul 2>&1
if errorlevel 1 (
    echo ==================================================
    echo ERROR: The API container is not running.
    echo Start Heartfolio first ^(option 1^), then try again.
    echo ==================================================
    goto :end
)

echo ==================================================
echo Opening a Django shell inside the API container...
echo This connects to Supabase (the same DATABASE_URL the
echo app itself uses) -- be careful, this is live data.
echo Type exit^(^) or press Ctrl+D to leave.
echo ==================================================
docker compose exec api python manage.py shell

:end
echo.
pause
exit /b
