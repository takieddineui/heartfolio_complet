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
echo FULL clean rebuild of Heartfolio images (api + web).
echo This does NOT touch volumes or unrelated images,
echo and does NOT run docker system prune.
echo.
echo THE "SOMETHING IS ACTUALLY BEHAVING WEIRD" OPTION --
echo not the routine one. This is rebuild.bat's old,
echo always-on behavior: --no-cache discards every layer,
echo including npm ci / apt-get install, even when
echo package.json/package-lock.json/apt lists haven't
echo changed. That is a real, paid-for cost (a full
echo dependency reinstall every time), which is exactly
echo why it is no longer the default -- rebuild.bat now
echo does a normal cached build, verified directly to
echo still pick up real source changes correctly.
echo.
echo Reach for THIS script only when you have a genuine,
echo specific reason to distrust the cache itself (not
echo just "let's be safe") -- e.g. a build that looks
echo successful but produces output inconsistent with the
echo source you can see on disk.
echo ==================================================
docker compose build --no-cache
if errorlevel 1 (
    echo ERROR: docker compose build failed.
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
