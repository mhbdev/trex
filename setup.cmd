@echo off
rem Trex one-step setup for Windows. Double-click this file or run it from a terminal.
rem It runs setup.ps1 with a relaxed execution policy for this process only.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup did not finish. Read the message above, then press any key to close this window.
  pause >nul
)
