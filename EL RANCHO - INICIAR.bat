@echo off
setlocal EnableExtensions
title EL RANCHO - INICIAR

set "BASE=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BASE%scripts\iniciar-el-rancho.ps1" %*
set "RESULTADO=%ERRORLEVEL%"

if not "%RESULTADO%"=="0" (
  echo.
  echo El Rancho no pudo iniciarse. Revisa el mensaje anterior.
  pause
)

exit /b %RESULTADO%
