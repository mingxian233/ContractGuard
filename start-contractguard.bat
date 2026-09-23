@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "contractguardNoPause="
set /a contractguardArgCount=0 >nul

:collect_arguments
if "%~1"=="" goto :run_launcher
if /I "%~1"=="--no-pause" set "contractguardNoPause=1"
if /I "%~1"=="--check" set "contractguardNoPause=1"
if /I "%~1"=="--help" set "contractguardNoPause=1"
if /I "%~1"=="/?" set "contractguardNoPause=1"
set "CONTRACTGUARD_LAUNCHER_ARG_%contractguardArgCount%=%~1"
set /a contractguardArgCount+=1 >nul
shift /1
goto :collect_arguments

:run_launcher
set "CONTRACTGUARD_LAUNCHER_ARG_COUNT=%contractguardArgCount%"

if not exist "%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" (
  echo [ERROR] Windows PowerShell 5.1 was not found.
  set "contractguardExitCode=1"
  goto :finish
)

"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-contractguard.ps1" --arguments-from-environment
set "contractguardExitCode=%ERRORLEVEL%"

:finish
if not "%contractguardExitCode%"=="0" if not defined contractguardNoPause (
  echo.
  pause
)

endlocal & exit /b %contractguardExitCode%
