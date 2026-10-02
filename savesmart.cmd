@echo off
rem SaveSmart CLI.  Usage: savesmart launch [backend^|frontend]   (omit for both)
setlocal
set "ROOT=%~dp0"
set "PY=%ROOT%backend\venv\Scripts\python.exe"
if not exist "%PY%" set "PY=python"

if /i "%~1"=="launch" (
    shift
    goto launch
)
echo Usage: savesmart launch [backend^|frontend]   (omit for both)
if "%~1"=="" exit /b 0
exit /b 1

:launch
"%PY%" "%ROOT%dev.py" %1 %2 %3
