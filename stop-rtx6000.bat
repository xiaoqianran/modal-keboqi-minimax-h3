@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "HTTPS_PROXY=http://127.0.0.1:7890"
set "HTTP_PROXY=http://127.0.0.1:7890"
set "ALL_PROXY=http://127.0.0.1:7890"
set "NO_PROXY=127.0.0.1,localhost,.modal.run"
set "APP_NAME=minimax-h3"
set "APP_ID="
set "FAILED=0"
set "APP_JSON=%TEMP%\h3-apps-%RANDOM%-%RANDOM%.json"
set "CONTAINER_JSON=%TEMP%\h3-containers-%RANDOM%-%RANDOM%.json"

echo [RTX6000 STOP] Resolving deployed app...
uv run --with "modal[api-proxy-support]" modal app list --json > "%APP_JSON%"
if errorlevel 1 goto :modal_error

for /f "delims=" %%A in ('uv run python -c "import json; xs=json.load(open(r'%APP_JSON%',encoding='utf-8')); print(next((x.get('app_id','') for x in xs if x.get('description')=='%APP_NAME%' and x.get('state')=='deployed'),''))"') do set "APP_ID=%%A"
if not defined APP_ID (
  echo [ERROR] No deployed app named %APP_NAME% was found.
  goto :cleanup_error
)

echo [INFO] App ID: %APP_ID%
for /l %%R in (1,1,10) do (
  uv run --with "modal[api-proxy-support]" modal container list --app-id "%APP_ID%" --json > "%CONTAINER_JSON%"
  if errorlevel 1 goto :modal_error
  set "FOUND=0"
  for /f "delims=" %%C in ('uv run python -c "import json; xs=json.load(open(r'%CONTAINER_JSON%',encoding='utf-8')); [print(x.get('container_id','')) for x in xs if x.get('container_id')]"') do (
    set "FOUND=1"
    echo [FOUND] H3 runtime container: %%C
    uv run --with "modal[api-proxy-support]" modal container stop "%%C" --yes
    if errorlevel 1 set "FAILED=1"
  )
  if "!FOUND!"=="0" goto :done
  timeout /t 3 /nobreak >nul
)
echo [ERROR] Could not prove all H3 runtime containers stopped.
set "FAILED=1"

:done
del /q "%APP_JSON%" "%CONTAINER_JSON%" >nul 2>&1
if not "%FAILED%"=="0" exit /b 1
echo [OK] H3 RTX PRO 6000 runtime containers stopped. Deployment remains deployed.
exit /b 0

:modal_error
echo [ERROR] Failed to query Modal control plane.
:cleanup_error
del /q "%APP_JSON%" "%CONTAINER_JSON%" >nul 2>&1
exit /b 1
