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
echo Restarting Heartfolio (api + web)...
echo.
echo This restarts the EXISTING containers as-is -- same
echo image, same environment. It does NOT re-read
echo .env.docker/.env: env_file content is only applied
echo when a container is CREATED, not restarted, so an
echo edited env var (e.g. CORS_ALLOWED_ORIGINS) will NOT
echo take effect from this option, with no error telling
echo you that.
echo.
echo Just changed an env var and need it to take effect?
echo Use "Reload Env" instead -- same containers' images,
echo but actually recreated, no rebuild needed.
echo ==================================================
docker compose restart api web
if errorlevel 1 (
    echo ERROR: docker compose restart failed.
    goto :end
)

echo.
echo Current status:
docker compose ps

:end
echo.
pause
exit /b
