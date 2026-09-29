@echo off
setlocal
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "APP_NAME=minimax-h3"
set "MODAL_WORKSPACE="

for /f "delims=" %%A in ('uv run --with modal modal profile current 2^>nul') do set "MODAL_WORKSPACE=%%A"
if not defined MODAL_WORKSPACE (
  echo [ERROR] Could not determine the active Modal profile.
  exit /b 1
)

set "PUBLIC_URL=https://%MODAL_WORKSPACE%--%APP_NAME%-serve.modal.run"
echo [RTX6000 START] Waking deployed H3 service...
echo [INFO] App: %APP_NAME%
echo [INFO] URL: %PUBLIC_URL%
echo.

curl.exe --fail --show-error --silent --location --max-time 1800 -o NUL -w "[HTTP] status=%%{http_code} total_s=%%{time_total}\n" "%PUBLIC_URL%/"
set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
  echo [OK] RTX PRO 6000 service is ready.
) else (
  echo [ERROR] Failed to wake H3. Exit code: %RC%
  echo [INFO] Check logs with:
  echo        uv run --with modal modal app logs %APP_NAME% --timestamps --tail 500
)
exit /b %RC%


