@echo off
setlocal EnableExtensions EnableDelayedExpansion
set "SCRIPT_DIR=%~dp0"
for %%I in ("%SCRIPT_DIR%..") do set "ROOT_DIR=%%~fI"

echo ==================================================
echo HEARTFOLIO DOCTOR
echo ==================================================
echo.
echo [Environment]

set "S_ROOT=FAIL"
cd /d "%ROOT_DIR%" 2>nul
if not errorlevel 1 set "S_ROOT=PASS"
echo Heartfolio root:            %S_ROOT%   %ROOT_DIR%

set "S_DOCKERCLI=FAIL"
where docker >nul 2>&1
if not errorlevel 1 set "S_DOCKERCLI=PASS"
echo Docker CLI:                 %S_DOCKERCLI%

set "S_COMPOSECLI=FAIL"
docker compose version >nul 2>&1
if not errorlevel 1 set "S_COMPOSECLI=PASS"
echo Docker Compose:             %S_COMPOSECLI%

set "S_DAEMON=FAIL"
docker info >nul 2>&1
if not errorlevel 1 set "S_DAEMON=PASS"
echo Docker daemon:               %S_DAEMON%

set "S_COMPOSEFILE=FAIL"
if exist "docker-compose.yml" set "S_COMPOSEFILE=PASS"
echo docker-compose.yml:         %S_COMPOSEFILE%

set "S_ENVFILE=FAIL"
if exist ".env.docker" set "S_ENVFILE=PASS"
echo .env.docker:                %S_ENVFILE%

echo.
echo [Compose]

set "S_COMPOSE=SKIPPED"
set "S_API_SVC=SKIPPED"
set "S_WEB_SVC=SKIPPED"
set "S_NO_STRAY_DB=SKIPPED"

if "%S_DAEMON%"=="PASS" (
    set "S_COMPOSE=FAIL"
    set "S_API_SVC=FAIL"
    set "S_WEB_SVC=FAIL"
    docker compose config >"%TEMP%\hf_compose_config.txt" 2>&1
    if not errorlevel 1 (
        set "S_COMPOSE=PASS"
        findstr /b /r "^  api:" "%TEMP%\hf_compose_config.txt" >nul 2>&1
        if not errorlevel 1 set "S_API_SVC=PASS"
        findstr /b /r "^  web:" "%TEMP%\hf_compose_config.txt" >nul 2>&1
        if not errorlevel 1 set "S_WEB_SVC=PASS"
    )
    del "%TEMP%\hf_compose_config.txt" >nul 2>&1

    set "S_NO_STRAY_DB=PASS"
    docker compose ps --services 2>nul | findstr /x "db" >nul 2>&1
    if not errorlevel 1 set "S_NO_STRAY_DB=FAIL"
)

echo Configuration parses:       %S_COMPOSE%
echo Service 'api' present:      %S_API_SVC%
echo Service 'web' present:      %S_WEB_SVC%
echo No stray 'db' running:      %S_NO_STRAY_DB%

echo.
echo [Runtime]

set "S_API_RUNTIME=SKIPPED"
set "S_WEB_RUNTIME=SKIPPED"
if "%S_DAEMON%"=="PASS" (
    set "S_API_RUNTIME=NOT RUNNING"
    docker compose ps --status running 2>nul | findstr /i "api" >nul 2>&1
    if not errorlevel 1 set "S_API_RUNTIME=PASS"
    set "S_WEB_RUNTIME=NOT RUNNING"
    docker compose ps --status running 2>nul | findstr /i "web" >nul 2>&1
    if not errorlevel 1 set "S_WEB_RUNTIME=PASS"
)
echo API container:              %S_API_RUNTIME%
echo Web container:               %S_WEB_RUNTIME%

echo.
echo [Application]

set "S_CURL=FAIL"
where curl >nul 2>&1
if not errorlevel 1 set "S_CURL=PASS"

set "S_API=SKIPPED"
set "S_WEB=SKIPPED"
set "S_SUPABASE=SKIPPED"
set "S_PROXY=SKIPPED"

if "%S_CURL%"=="PASS" (
    set "S_API=FAIL"
    set "S_WEB=FAIL"
    set "S_SUPABASE=FAIL"
    set "S_PROXY=FAIL"

    for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:8000/api/v1/health/ 2^>nul') do set "A1=%%A"
    if "!A1!"=="200" set "S_API=PASS"
    echo API health:                 !S_API!   HTTP=!A1!

    for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:8000/api/v1/health/ready/ 2^>nul') do set "A2=%%A"
    if "!A2!"=="200" set "S_SUPABASE=PASS"
    echo API readiness ^(Supabase^):  !S_SUPABASE!   HTTP=!A2!

    for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:3000 2^>nul') do set "A3=%%A"
    if "!A3!"=="200" set "S_WEB=PASS"
    echo Frontend:                   !S_WEB!   HTTP=!A3!  ^(redirects followed -- e.g. locale routing^)

    for /f %%A in ('curl -s -L -o NUL -w "%%{http_code}" http://localhost:3000/api/backend/products/ 2^>nul') do set "A4=%%A"
    if "!A4!"=="200" set "S_PROXY=PASS"
    if "!A4!"=="401" set "S_PROXY=PASS"
    if "!A4!"=="403" set "S_PROXY=PASS"
    echo Frontend proxy:             !S_PROXY!   HTTP=!A4!
) else (
    echo API health:                 SKIPPED  ^(curl not found^)
    echo API readiness ^(Supabase^):  SKIPPED  ^(curl not found^)
    echo Frontend:                   SKIPPED  ^(curl not found^)
    echo Frontend proxy:             SKIPPED  ^(curl not found^)
)

echo.
echo [Configuration]

set "S_DBURL=NO"
if exist ".env.docker" (
    for /f "usebackq tokens=1,* delims==" %%K in (`findstr /b /c:"DATABASE_URL=" ".env.docker"`) do (
        if not "%%L"=="" set "S_DBURL=YES"
    )
)
echo DATABASE_URL configured:    %S_DBURL%
echo (value is never printed)

set "S_BACKEND_ORIGIN=NO"
findstr /c:"BACKEND_API_ORIGIN" "docker-compose.yml" >nul 2>&1
if not errorlevel 1 set "S_BACKEND_ORIGIN=YES"
echo web uses BACKEND_API_ORIGIN: %S_BACKEND_ORIGIN%

echo.
echo ==================================================
echo HEARTFOLIO DOCTOR SUMMARY
echo ==================================================
echo Docker              %S_DAEMON%
echo Compose             %S_COMPOSE%
echo API                 %S_API%
echo Web                 %S_WEB%
echo Supabase            %S_SUPABASE%
echo Frontend Proxy      %S_PROXY%
echo ==================================================

pause
exit /b
