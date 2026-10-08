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

where curl >nul 2>&1
if errorlevel 1 (
    echo ==================================================
    echo ERROR: curl.exe not found in PATH.
    echo Windows 10/11 ships curl by default; this toolkit
    echo will not install one for you.
    echo ==================================================
    goto :end
)

echo ==================================================
echo HEARTFOLIO HEALTH CHECK
echo ==================================================
echo.
echo [Docker]

set "API_RUNNING=NOT RUNNING"
docker compose ps --status running 2>nul | findstr /i "api" >nul 2>&1
if not errorlevel 1 set "API_RUNNING=PASS"
echo API container:              %API_RUNNING%

set "WEB_RUNNING=NOT RUNNING"
docker compose ps --status running 2>nul | findstr /i "web" >nul 2>&1
if not errorlevel 1 set "WEB_RUNNING=PASS"
echo Web container:              %WEB_RUNNING%

echo.
echo [Application]

for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:8000/api/v1/health/ 2^>nul') do set "H1=%%A"
set "R1=FAIL"
if "!H1!"=="200" set "R1=PASS"
echo API health:                 !R1!   HTTP=!H1!

for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:8000/api/v1/health/ready/ 2^>nul') do set "H2=%%A"
set "R2=FAIL"
if "!H2!"=="200" set "R2=PASS"
echo API readiness (Supabase):   !R2!   HTTP=!H2!

for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:3000 2^>nul') do set "H3=%%A"
set "R3=FAIL"
if "!H3!"=="200" set "R3=PASS"
echo Frontend:                   !R3!   HTTP=!H3!   (redirects followed)

for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:8000/api/v1/products/ 2^>nul') do set "H4=%%A"
set "R4=FAIL"
if "!H4!"=="200" set "R4=PASS"
if "!H4!"=="401" set "R4=PASS (auth required, expected)"
if "!H4!"=="403" set "R4=PASS (auth required, expected)"
echo Product endpoint:           !R4!   HTTP=!H4!

for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:3000/api/backend/products/ 2^>nul') do set "H5=%%A"
set "R5=FAIL"
if "!H5!"=="200" set "R5=PASS"
if "!H5!"=="401" set "R5=PASS (auth required, expected)"
if "!H5!"=="403" set "R5=PASS (auth required, expected)"
echo Frontend proxy:             !R5!   HTTP=!H5!

echo.
echo --------------------------------------------------
echo "API readiness" is the real signal for Supabase
echo connectivity. A running container does not mean the
echo database is reachable. HTTP 000 means no response at
echo all (container down or not listening yet).
echo --------------------------------------------------

:end
echo.
pause
exit /b
