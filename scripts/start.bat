@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"
cd /d "%ROOT_DIR%" 2>nul
if errorlevel 1 (
    echo ==================================================
    echo ERROR: Could not locate the Heartfolio root directory.
    echo ==================================================
    goto :end
)

where docker >nul 2>&1
if errorlevel 1 (
    echo ==================================================
    echo ERROR: Docker CLI not found in PATH.
    echo Install Docker Desktop and try again.
    echo ==================================================
    goto :end
)

docker info >nul 2>&1
if errorlevel 1 (
    echo ==================================================
    echo ERROR: Docker is not running.
    echo Start Docker Desktop and try again.
    echo ===================================
    goto :end
)

if not exist "docker-compose.yml" (
    echo ==================================================
    echo ERROR: docker-compose.yml not found in %ROOT_DIR%
    echo ==================================================
    goto :end
)

if not exist ".env.docker" (
    echo ==================================================
    echo ERROR: .env.docker not found in %ROOT_DIR%
    echo Copy .env.docker.example to .env.docker and fill
    echo it in first.
    echo ==================================================
    goto :end
)

echo ==================================================
echo Starting Heartfolio (api + web)...
echo This does NOT start a local database. The app uses
echo Supabase, via DATABASE_URL in .env.docker.
echo ==================================================
docker compose up -d
if errorlevel 1 (
    echo ==================================================
    echo ERROR: docker compose up failed. See output above.
    echo ==================================================
    goto :end
)

echo.
echo Current status:
docker compose ps

:end
echo.
pause
exit /b
