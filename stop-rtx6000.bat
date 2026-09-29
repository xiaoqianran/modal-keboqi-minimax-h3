@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
set "APP_NAME=minimax-h3"
set "APP_ID="
set "FAILED=0"
set "APP_JSON=%TEMP%\h3-apps-%RANDOM%-%RANDOM%.json"
set "CONTAINER_JSON=%TEMP%\h3-containers-%RANDOM%-%RANDOM%.json"

echo [RTX6000 STOP] Resolving deployed app...
uv run --with modal modal app list --json > "%APP_JSON%"
if errorlevel 1 goto :modal_error

for /f "delims=" %%A in ('uv run python -c "import json; xs=json.load(open(r'%APP_JSON%',encoding='utf-8')); print(next((x.get('app_id','') for x in xs if x.get('description')=='%APP_NAME%' and x.get('state')=='deployed'),''))"') do set "APP_ID=%%A"
if not defined APP_ID (
  echo [ERROR] No deployed app named %APP_NAME% was found.
  goto :cleanup_error
)

echo [INFO] App ID: %APP_ID%
uv run --with modal modal container list --app-id "%APP_ID%" --json > "%CONTAINER_JSON%"
if errorlevel 1 goto :modal_error

for /f "delims=" %%C in ('uv run python -c "import json; xs=json.load(open(r'%CONTAINER_JSON%',encoding='utf-8')); [print(x.get('container_id','')) for x in xs if x.get('container_id')]"') do call :inspect "%%C"

del /q "%APP_JSON%" "%CONTAINER_JSON%" >nul 2>&1
if not "%FAILED%"=="0" exit /b 1
echo [OK] Target RTX PRO 6000 containers stopped. Deployment remains deployed.
exit /b 0

:inspect
set "CID=%~1"
set "GPU=%TEMP%\h3-gpu-%RANDOM%-%RANDOM%.txt"
uv run --with modal modal container exec --no-pty "%CID%" -- nvidia-smi -L > "%GPU%" 2>&1
if errorlevel 1 (
  del /q "%GPU%" >nul 2>&1
  exit /b 0
)
findstr /i /c:"RTX PRO 6000" /c:"RTX 6000" "%GPU%" >nul
if errorlevel 1 (
  del /q "%GPU%" >nul 2>&1
  exit /b 0
)
echo [FOUND] RTX PRO 6000 container: %CID%
type "%GPU%"
uv run --with modal modal container stop "%CID%" --yes
if errorlevel 1 set "FAILED=1"
del /q "%GPU%" >nul 2>&1
exit /b 0

:modal_error
echo [ERROR] Failed to query Modal control plane.
:cleanup_error
del /q "%APP_JSON%" "%CONTAINER_JSON%" >nul 2>&1
exit /b 1

