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
echo Reloading environment for Heartfolio (api + web)...
echo.
echo Recreates the containers from their CURRENT images
echo with whatever .env.docker/.env currently contains --
echo no image rebuild, so this is fast. This is the
echo option to use right after editing an env var (e.g.
echo CORS_ALLOWED_ORIGINS) and needing it to take effect.
echo.
echo How this differs from the other two options:
echo   Restart     -- same containers, same env (a plain
echo                  stop/start). Use after a backend
echo                  code edit picked up through the api
echo                  service's bind mount -- no env
echo                  change, no rebuild needed.
echo   Rebuild     -- rebuilds the IMAGES first (source or
echo                  dependencies changed), then also
echo                  recreates the containers.
echo   Reload Env (this) -- recreates the containers only,
echo                  no build. Exactly what an env-only
echo                  change needs, nothing more.
echo ==================================================
docker compose up -d --force-recreate api web
if errorlevel 1 (
    echo ERROR: docker compose up failed.
    goto :end
)

echo.
echo Current status:
docker compose ps

:end
echo.
pause
exit /b
