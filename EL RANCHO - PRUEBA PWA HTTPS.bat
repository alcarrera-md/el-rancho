@echo off
setlocal EnableExtensions
title EL RANCHO - PRUEBA PWA HTTPS

set "BASE=%~dp0"
set "BACKEND=%BASE%backend"
set "FRONTEND=%BASE%frontend"
set "CLOUDFLARED=%BASE%tools\cloudflared.exe"
set "VALIDATE_ONLY=0"
set "REUSE_BACKEND=0"
set "STARTED_BACKEND=0"

if /I "%~1"=="--validate" set "VALIDATE_ONLY=1"

echo ========================================================
echo       EL RANCHO - CERTIFICACION PWA HTTPS TEMPORAL
echo ========================================================
echo.

if not exist "%CLOUDFLARED%" (
  echo ERROR: No existe tools\cloudflared.exe.
  echo Coloca el binario de Cloudflare en esa ruta y vuelve a intentar.
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo ERROR: npm no esta disponible en PATH.
  pause
  exit /b 1
)

call :port_in_use 3000
if not errorlevel 1 (
  if "%VALIDATE_ONLY%"=="0" (
    echo ERROR: El puerto 3000 ya esta ocupado.
    echo Cierra el backend anterior y vuelve a intentar.
    pause
    exit /b 1
  )
  call :wait_url "http://127.0.0.1:3000/api/health" 5
  if errorlevel 1 (
    echo ERROR: El puerto 3000 esta ocupado pero /api/health no responde.
    pause
    exit /b 1
  )
  set "REUSE_BACKEND=1"
  echo VALIDACION: Se reutilizara el backend saludable que ya ocupa el puerto 3000.
)

call :port_in_use 4173
if not errorlevel 1 (
  echo ERROR: El puerto 4173 ya esta ocupado.
  echo Cierra el preview anterior y vuelve a intentar.
  pause
  exit /b 1
)

echo [1/4] Compilando frontend de produccion...
pushd "%FRONTEND%"
call npm run build
if errorlevel 1 (
  popd
  echo ERROR: Fallo el build. No se abrira el tunel.
  pause
  exit /b 1
)
popd

if "%REUSE_BACKEND%"=="1" goto backend_ready

echo [2/4] Iniciando backend en http://127.0.0.1:3000 ...
if "%VALIDATE_ONLY%"=="1" (
  start "El Rancho - Backend 3000" /D "%BACKEND%" cmd /c "set NODE_ENV=production&& npm run certify:pwa"
) else (
  start "El Rancho - Backend 3000" /D "%BACKEND%" cmd /k "set NODE_ENV=production&& npm run certify:pwa"
)
set "STARTED_BACKEND=1"

call :wait_url "http://127.0.0.1:3000/api/health" 30
if errorlevel 1 (
  call :cleanup_validation
  echo ERROR: El backend no respondio en 30 segundos.
  echo Revisa la ventana El Rancho - Backend 3000.
  pause
  exit /b 1
)

:backend_ready
echo [3/4] Sirviendo frontend compilado en http://127.0.0.1:4173 ...
if "%VALIDATE_ONLY%"=="1" (
  start "El Rancho - Frontend produccion 4173" /D "%FRONTEND%" cmd /c "npm run preview"
) else (
  start "El Rancho - Frontend produccion 4173" /D "%FRONTEND%" cmd /k "npm run preview"
)

call :wait_url "http://127.0.0.1:4173/" 30
if errorlevel 1 (
  call :cleanup_validation
  echo ERROR: El frontend de produccion no respondio en 30 segundos.
  echo Revisa la ventana El Rancho - Frontend produccion 4173.
  pause
  exit /b 1
)

call :wait_url "http://127.0.0.1:4173/api/health" 10
if errorlevel 1 (
  call :cleanup_validation
  echo ERROR: El proxy del frontend no pudo llegar a /api/health.
  echo Revisa las ventanas Backend y Frontend. No se abrira el tunel.
  pause
  exit /b 1
)

if "%VALIDATE_ONLY%"=="1" (
  echo.
  echo VALIDACION CORRECTA: build, preview, SPA, proxy y /api/health funcionan.
  echo Cloudflare Tunnel NO fue iniciado.
  call :cleanup_validation
  exit /b 0
)

echo [4/4] Abriendo HTTPS temporal con Cloudflare Quick Tunnel...
echo.
echo Busca abajo una URL con este formato:
echo     https://palabras-aleatorias.trycloudflare.com
echo.
echo ESA ES LA URL QUE DEBES ABRIR EN EL CELULAR.
echo Manten abiertas esta ventana y las ventanas Backend y Frontend.
echo Pulsa Ctrl+C en esta ventana para cerrar el acceso publico temporal.
echo ========================================================
echo.

"%CLOUDFLARED%" tunnel --no-autoupdate --url http://127.0.0.1:4173 --http-host-header 127.0.0.1:4173
if errorlevel 1 (
  echo.
  echo ERROR: Cloudflare Tunnel termino con un error.
  echo Revisa los mensajes anteriores. La URL temporal ya no esta disponible.
  pause
  exit /b 1
)

echo.
echo El tunel HTTPS termino correctamente.
echo Cierra tambien las ventanas Backend y Frontend.
pause
exit /b 0

:port_in_use
netstat -ano -p tcp | %SystemRoot%\System32\findstr.exe /R /C:":%~1 .*LISTENING" >nul
if errorlevel 1 exit /b 1
exit /b 0

:wait_url
powershell -NoProfile -Command "$limit=(Get-Date).AddSeconds(%~2); do { try { $response=Invoke-WebRequest -Uri '%~1' -UseBasicParsing -TimeoutSec 2; if ($response.StatusCode -eq 200) { exit 0 } } catch {}; Start-Sleep -Milliseconds 500 } while ((Get-Date) -lt $limit); exit 1"
exit /b %errorlevel%

:cleanup_validation
if not "%VALIDATE_ONLY%"=="1" exit /b 0
call :kill_listening_port 4173
if "%STARTED_BACKEND%"=="1" call :kill_listening_port 3000
exit /b 0

:kill_listening_port
powershell -NoProfile -Command "$port='%~1'; $pattern=':'+$port+'\s+.*LISTENING\s+(\d+)\s*$'; netstat -ano -p tcp | Select-String -Pattern $pattern | ForEach-Object { if ($_.Line -match $pattern) { Stop-Process -Id ([int]$Matches[1]) -Force -ErrorAction SilentlyContinue } }"
exit /b 0
