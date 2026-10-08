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
echo Rebuilding Heartfolio images (api + web)...
echo This does NOT touch volumes or unrelated images,
echo and does NOT run docker system prune.
echo.
echo CORRECTED UNDERSTANDING, per a direct reproduction:
echo the earlier stale-frontend incident (old product
echo count, old logo, surviving a correct git pull) was
echo NOT a caching bug in "docker compose build" -- both
echo Dockerfiles already separate dependency installation
echo from source, so a normal cached build correctly
echo invalidates the source-copy layer (and everything
echo after it) whenever a source file actually changes,
echo while leaving npm ci / apt-get install cached when
echo package.json/package-lock.json/apt lists haven't.
echo Verified directly: a real source change, rebuilt
echo without --no-cache, showed up in the running
echo container. --no-cache was paying for a full
echo dependency reinstall on every routine rebuild for a
echo bug it wasn't actually fixing.
echo.
echo --force-recreate below is what actually guards
echo against a stale RUNNING CONTAINER (as opposed to a
echo stale IMAGE) -- kept unconditionally.
echo.
echo If something is genuinely behaving weird after a
echo pull and this doesn't fix it, use
echo scripts\rebuild-clean.bat instead -- same as this
echo script used to always do (--no-cache, every layer).
echo ==================================================
docker compose build
if errorlevel 1 (
    echo ERROR: docker compose build failed.
    echo.
    echo Build failed; running containers were NOT recreated
    echo and still have their old images/env. Fix the build
    echo error above, or use Reload Env if you only needed
    echo an env var change to take effect.
    goto :end
)

echo.
echo Starting rebuilt containers...
echo --force-recreate: guarantees the container is actually
echo swapped for the new image, not left running the old one.
docker compose up -d --force-recreate
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
