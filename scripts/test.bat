@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: Heartfolio -- test runner
:: ============================================================
:: Run from anywhere; this script locates the repo root itself
:: (the parent of this scripts\ folder) so it works whether you
:: double-click it from Explorer or run it from H:\heartfolio.
::
:: BACKEND TESTS ARE ISOLATED FROM SUPABASE ON PURPOSE.
:: docker-compose.yml's "db" service is gated behind the "test"
:: Compose profile, and the normal "api" service no longer
:: depends on it -- the ordinary application stack is
:: web -> api -> Supabase, untouched by anything in this file.
:: Backend tests explicitly start "db" and explicitly override
:: DATABASE_URL for that one command only, so Django's test
:: runner creates its throwaway test_<name> database on the
:: LOCAL Postgres container, never on Supabase. .env.docker is
:: never read, edited, or overridden by this script -- the
:: normal application's own DATABASE_URL is completely
:: untouched, in that file, pointing at Supabase, as always.
::
:: FRONTEND TESTS RUN NATIVELY, NOT IN DOCKER. The "web" image's
:: runtime stage only ever copies .next/standalone, .next/static
:: and public/ (see frontend-heartfolio\Dockerfile) -- vitest and
:: every other dev dependency are never in that image at all, so
:: there is no Docker frontend test command to run. The existing,
:: already-working command is "npm run test" (package.json:
:: "test": "vitest run"), run directly on this machine.
:: ============================================================

set "REPO_ROOT=%~dp0.."
set "TEST_DB_URL=postgres://heartfolio:heartfolio@db:5432/heartfolio"
set "BACKEND_RESULT="
set "FRONTEND_RESULT="

cd /d "%REPO_ROOT%"
if errorlevel 1 (
    echo [ERROR] Could not switch to repo root: "%REPO_ROOT%"
    exit /b 1
)

echo ============================================================
echo  Heartfolio test runner
echo  Repo root: %REPO_ROOT%
echo ============================================================
echo.

:: --- Docker Compose availability -------------------------------
docker compose version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] "docker compose" is not available. Is Docker Desktop
    echo         installed and running?
    exit /b 1
)

if "%~1"=="backend" (
    call :run_backend
    exit /b !BACKEND_RESULT!
)
if "%~1"=="frontend" (
    call :run_frontend
    exit /b !FRONTEND_RESULT!
)
if "%~1"=="both" goto :menu_both
if not "%~1"=="" (
    echo [ERROR] Unknown argument: %~1
    echo         Usage: test.bat [backend^|frontend^|both]
    echo         Or run with no argument for the menu.
    exit /b 1
)

:menu
echo What do you want to run?
echo   1. Backend tests   (local Docker PostgreSQL, NOT Supabase)
echo   2. Frontend tests  (native, via npm run test)
echo   3. Both
echo.
set "CHOICE="
set /p "CHOICE=Enter 1, 2 or 3: "

if "%CHOICE%"=="1" (
    call :run_backend
    exit /b !BACKEND_RESULT!
)
if "%CHOICE%"=="2" (
    call :run_frontend
    exit /b !FRONTEND_RESULT!
)
if "%CHOICE%"=="3" goto :menu_both

echo [ERROR] Invalid choice: "%CHOICE%"
goto :menu

:menu_both
call :run_backend
call :run_frontend
echo.
echo ============================================================
echo  Summary
echo ============================================================
if "!BACKEND_RESULT!"=="0" (echo  Backend tests:  PASSED) else (echo  Backend tests:  FAILED ^(exit !BACKEND_RESULT!^))
if "!FRONTEND_RESULT!"=="0" (echo  Frontend tests: PASSED) else (echo  Frontend tests: FAILED ^(exit !FRONTEND_RESULT!^))
echo ============================================================

if not "!BACKEND_RESULT!"=="0" exit /b !BACKEND_RESULT!
if not "!FRONTEND_RESULT!"=="0" exit /b !FRONTEND_RESULT!
exit /b 0


:: ============================================================
:: :run_backend -- isolated backend tests
:: Sets BACKEND_RESULT to the real "manage.py test" exit code,
:: even if the test database fails to start (in which case it is
:: set to a non-zero sentinel instead, and no test command runs
:: against whatever DATABASE_URL happens to be ambient).
:: ============================================================
:run_backend
echo.
echo ============================================================
echo  BACKEND TESTS
echo  Database:  LOCAL Docker PostgreSQL ("db" service)
echo  DATABASE_URL override for this run only:
echo    %TEST_DB_URL%
echo  This does NOT touch .env.docker and does NOT run against
echo  Supabase. The "db" service is started ONLY for this test
echo  run and is NOT the application's normal database.
echo ============================================================
echo.

echo [1/3] Starting the test-only PostgreSQL service (profile: test)
echo       and waiting for it to report healthy...
docker compose --profile test up -d --wait db
if errorlevel 1 (
    echo [ERROR] The "db" service did not start and become healthy.
    echo         Backend tests did not run. It is NOT touched further.
    set "BACKEND_RESULT=1"
    call :stop_test_db
    goto :eof
)

echo [2/3] Making sure the "api" container is running...
:: Starts "api" only -- this does NOT start or touch "db" as the
:: application's own database. "api"'s own environment still comes
:: from .env.docker (Supabase) for anything else run against it;
:: only the single command below overrides DATABASE_URL, and only
:: for that one invocation.
docker compose up -d api
if errorlevel 1 (
    echo [ERROR] Could not start the "api" container. Backend tests did not run.
    set "BACKEND_RESULT=1"
    call :stop_test_db
    goto :eof
)

echo [3/3] Running Django tests against the LOCAL test database...
echo.
docker compose exec -e DATABASE_URL=%TEST_DB_URL% api python manage.py test
set "BACKEND_RESULT=!errorlevel!"

echo.
if "!BACKEND_RESULT!"=="0" (
    echo [OK] Backend tests passed.
) else (
    echo [FAIL] Backend tests failed ^(exit code !BACKEND_RESULT!^).
)

call :stop_test_db
goto :eof


:: ============================================================
:: :stop_test_db -- cleanup, always runs, never destroys data
:: Stops (does not remove) the test-only "db" container. No
:: "down", no "-v", no volume removal -- pgdata is untouched
:: (compose.yml's "db" and "pgdata" are the test service's own
:: throwaway data; still not deleted here regardless, per the
:: explicit "do not delete volumes" requirement).
:: ============================================================
:stop_test_db
echo.
echo [CLEANUP] Stopping the test-only PostgreSQL service...
docker compose --profile test stop db
if errorlevel 1 (
    echo [WARN] Could not stop the "db" service cleanly. You can stop it
    echo        manually with: docker compose --profile test stop db
)
goto :eof


:: ============================================================
:: :run_frontend -- native frontend tests (no Docker, no Postgres)
:: ============================================================
:run_frontend
echo.
echo ============================================================
echo  FRONTEND TESTS
echo  Running natively via "npm run test" (vitest run) --
echo  NOT inside Docker. The "web" runtime image has no dev
echo  dependencies (vitest included) and no test files; see this
echo  file's own header comment for why. No database is involved.
echo ============================================================
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm was not found on PATH. Install Node.js to run
    echo         frontend tests, or run "npm run test" yourself inside
    echo         frontend-heartfolio\.
    set "FRONTEND_RESULT=1"
    goto :eof
)

pushd "%REPO_ROOT%\frontend-heartfolio"
if errorlevel 1 (
    echo [ERROR] Could not find frontend-heartfolio\.
    set "FRONTEND_RESULT=1"
    goto :eof
)

call npm run test
set "FRONTEND_RESULT=!errorlevel!"
popd

echo.
if "!FRONTEND_RESULT!"=="0" (
    echo [OK] Frontend tests passed.
) else (
    echo [FAIL] Frontend tests failed ^(exit code !FRONTEND_RESULT!^).
)
goto :eof
