@echo off
setlocal
set "PYTHONPATH=%~dp0src"
set "hub_python=python"
if exist "%~dp0.venv\Scripts\python.exe" set "hub_python=%~dp0.venv\Scripts\python.exe"
"%hub_python%" -B -m agent_hub chat --interactive-source --folder %*
set "hub_exit=%errorlevel%"
if not "%hub_exit%"=="0" pause
exit /b %hub_exit%
