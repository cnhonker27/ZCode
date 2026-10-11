@echo off
rem Launch ZCode dev desktop in an isolated local test environment.
rem Data home: %USERPROFILE%\.zcode-dev-home (the installed ZCode at %USERPROFILE%\.zcode is not touched).
rem scripts/dev-desktop-env.mjs derives the same isolation env for test mode;
rem they are set here explicitly so this launcher is independent of that default.

setlocal
cd /d "%~dp0"

set "ZCODE_DATA_BASE_DIR=%USERPROFILE%\.zcode-dev-home"
set "ZCODE_DESKTOP_HOME_DIR=%USERPROFILE%\.zcode-dev-home"
set "ZCODE_SKIP_REMOTE_ASSETS=1"

where pnpm >nul 2>&1
if errorlevel 1 (
  echo [error] pnpm not found in PATH. Install Node 24+ and pnpm 10.33.2 first.
  pause
  exit /b 1
)

echo [dev-desktop] data home: %ZCODE_DATA_BASE_DIR%
echo [dev-desktop] starting isolated dev desktop ...
call pnpm dev:desktop:test

endlocal
