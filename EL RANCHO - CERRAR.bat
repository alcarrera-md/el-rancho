@echo off
setlocal EnableExtensions
title EL RANCHO - CERRAR

set "BASE=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%BASE%scripts\cerrar-el-rancho.ps1"
set "RESULTADO=%ERRORLEVEL%"

if not "%RESULTADO%"=="0" pause
exit /b %RESULTADO%
