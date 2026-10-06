[CmdletBinding()]
param(
  [ValidateSet('Pc', 'Lan', 'Pwa', 'Https', 'Demo')]
  [string]$Mode,
  [switch]$Validate,
  [switch]$NoWait,
  [switch]$SkipOpenBrowser,
  [switch]$SkipFirewallPrompt
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$httpsLauncher = Join-Path $root 'EL RANCHO - PRUEBA PWA HTTPS.bat'
# 5173 por defecto; EL_RANCHO_PUERTO_FRONTEND permite probar el launcher completo
# sin tocar una instancia que ya este usando 5173. Vite lee VITE_DEV_PORT.
$puertoFrontend = if ($env:EL_RANCHO_PUERTO_FRONTEND -match '^\d{4,5}$') { [int]$env:EL_RANCHO_PUERTO_FRONTEND } else { 5173 }
$env:VITE_DEV_PORT = [string]$puertoFrontend
Import-Module (Join-Path $PSScriptRoot 'el-rancho-red.psm1') -Force
$runtimeRoot = if ($env:EL_RANCHO_RUNTIME_DIR) {
  $env:EL_RANCHO_RUNTIME_DIR
} else {
  [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
}
if (-not $runtimeRoot) { $runtimeRoot = [IO.Path]::GetTempPath() }
$runtimeBase = Join-Path $runtimeRoot 'ElRancho'
$statePath = Join-Path $runtimeBase 'local-runtime.json'
$backendOut = Join-Path $runtimeBase 'backend.log'
$backendErr = Join-Path $runtimeBase 'backend-error.log'
$frontendOut = Join-Path $runtimeBase 'frontend.log'
$frontendErr = Join-Path $runtimeBase 'frontend-error.log'
$interfacesPath = Join-Path $runtimeBase 'red-interfaces.json'
$firewallPath = Join-Path $runtimeBase 'red-firewall.txt'
$qrPath = Join-Path $runtimeBase 'el-rancho-celular-qr.png'
$qrCaPath = Join-Path $runtimeBase 'el-rancho-certificado-qr.png'
$certDir = Join-Path $runtimeBase 'https'
# Modo app instalable: origen HTTPS fijo. Con Mobile Hotspot la laptop es
# siempre 192.168.137.1, asi que https://192.168.137.1:5443 no cambia.
$puertoHttps = 5443
$puertoCertificado = 5180
# Demo publica por Internet: build de produccion servido por vite preview
# (proxy /api y /uploads al backend local) y un Cloudflare Quick Tunnel HTTPS.
# Solo sale la aplicacion por el tunel: PostgreSQL y el puerto 3000 siguen locales.
$puertoDemo = 4173
$cloudflared = Join-Path $root 'tools\cloudflared.exe'
$tunelOut = Join-Path $runtimeBase 'cloudflared.log'
$tunelErr = Join-Path $runtimeBase 'cloudflared-error.log'
$qrDemoPath = Join-Path $runtimeBase 'el-rancho-demo-qr.png'
$urlDemoPath = Join-Path $runtimeBase 'el-rancho-demo-url.txt'
$owned = [ordered]@{ backend = $null; frontend = $null; tunel = $null }
$completed = $false

function Write-Header([string]$title) {
  Write-Host ''
  Write-Host '==================================================' -ForegroundColor DarkGreen
  Write-Host ("              {0}" -f $title) -ForegroundColor Green
  Write-Host '==================================================' -ForegroundColor DarkGreen
  Write-Host ''
}

function Write-Estado([string]$etiqueta, [string]$valor, [string]$color = 'Green') {
  Write-Host ('{0,-13}' -f ($etiqueta + ':')) -NoNewline
  Write-Host $valor -ForegroundColor $color
}

function Test-Executable([string]$name) {
  return $null -ne (Get-Command $name -ErrorAction SilentlyContinue)
}

function Test-Http([string]$url, [int]$timeoutSeconds = 3) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec $timeoutSeconds
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Wait-Http([string]$url, [int]$timeoutSeconds) {
  $limit = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    if (Test-Http $url 2) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limit)
  return $false
}

function Describe-Proceso($info) {
  $linea = [string]$info.LineaComandos
  if ($linea.Length -gt 160) { $linea = $linea.Substring(0, 160) + '...' }
  return "PID $($info.Id) ($($info.Nombre)) $linea"
}

function Ensure-Dependencies([string]$directory, [string]$label) {
  if (Test-Path (Join-Path $directory 'node_modules')) { return }
  if ($Validate) { throw "Faltan dependencias de $label. Ejecuta npm ci en $directory." }
  Write-Host "Instalando dependencias de $label por primera vez..." -ForegroundColor Yellow
  Push-Location $directory
  try {
    & npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw "npm ci fallo en $label." }
  } finally {
    Pop-Location
  }
}

function Start-RanchoProcess([string]$kind, [string]$directory, [string]$stdout, [string]$stderr) {
  $marker = "EL_RANCHO_LOCAL_$($kind.ToUpperInvariant())"
  $command = "set $marker=1&& npm run dev"
  return Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', $command) `
    -WorkingDirectory $directory -WindowStyle Hidden -PassThru `
    -RedirectStandardOutput $stdout -RedirectStandardError $stderr
}

function Stop-OwnedProcess([System.Diagnostics.Process]$process, [string]$label) {
  if (-not $process) { return }
  if ($process.HasExited) { return }
  Write-Host "Cerrando $label..."
  & taskkill.exe /PID $process.Id /T /F *> $null
}

# Detección de red: PowerShell reúne los datos (API .NET, sin privilegios) y
# frontend/scripts/lan-launcher.mjs decide y verifica por HTTP qué dirección
# responde realmente. Ver docs/INICIAR_EL_RANCHO.md.
function Get-DireccionCelular([switch]$Https) {
  New-Item -ItemType Directory -Path $runtimeBase -Force | Out-Null
  ConvertTo-Json -InputObject @(Get-RanchoInterfaces) -Depth 5 | Set-Content -LiteralPath $interfacesPath -Encoding UTF8
  Get-TextoFirewall | Set-Content -LiteralPath $firewallPath -Encoding UTF8
  $argumentos = @('scripts/lan-launcher.mjs', 'detectar', $interfacesPath, '--firewall', $firewallPath)
  if ($Https) {
    $argumentos += @('--puerto', $puertoHttps, '--protocolo', 'https', '--ca', (Join-Path $certDir 'el-rancho-ca.pem'), '--puertos-firewall', "$puertoHttps,$puertoCertificado")
  } else {
    $argumentos += @('--puerto', $puertoFrontend)
  }
  Push-Location $frontend
  try {
    $json = & node.exe @argumentos
    if ($LASTEXITCODE -ne 0 -or -not $json) { throw 'No se pudo analizar la red local.' }
  } finally {
    Pop-Location
  }
  return ($json | Out-String | ConvertFrom-Json)
}

function Test-Https([string]$url, [switch]$SinTitulo) {
  Push-Location $frontend
  try {
    $argumentos = @('scripts/lan-launcher.mjs', 'verificar', $url, '--ca', (Join-Path $certDir 'el-rancho-ca.pem'))
    if ($SinTitulo) { $argumentos += '--sin-titulo' }
    & node.exe @argumentos
    return $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
}

function Wait-Https([string]$url, [int]$timeoutSeconds) {
  $limit = (Get-Date).AddSeconds($timeoutSeconds)
  do {
    if (Test-Https $url) { return $true }
    Start-Sleep -Milliseconds 500
  } while ((Get-Date) -lt $limit)
  return $false
}

function Confirm-Firewall($red, [int[]]$Puertos = @($puertoFrontend)) {
  $firewall = $red.firewall
  if (-not $firewall -or -not $firewall.legible) { return 'NO VERIFICADO' }
  if ($firewall.bloqueos) {
    Write-Host ''
    Write-Host ('AVISO: el Firewall bloquea el puerto {0} en esta red por: {1}' -f ($Puertos -join ', '), ($firewall.bloqueos -join ', ')) -ForegroundColor Yellow
    Write-Host 'No se modifico ninguna regla. Revisa docs\INICIAR_EL_RANCHO.md.' -ForegroundColor Yellow
    return 'BLOQUEADO'
  }
  if ($firewall.permitido) { return 'LISTO' }
  $esHotspot = $red.elegido.clase -eq 'hotspot'
  $perfil = if ($firewall.perfil -eq 'public') { 'Public' } else { 'Private' }
  if ($perfil -eq 'Public' -and -not $esHotspot) {
    Write-Host ''
    Write-Host 'AVISO: Windows considera esta red como Publica. Por seguridad no se abre el puerto en redes publicas.' -ForegroundColor Yellow
    Write-Host 'Si es tu red de confianza, cambiala a Privada en Configuracion > Red e Internet.' -ForegroundColor Yellow
    return 'RED PUBLICA'
  }
  $descripcion = if ($esHotspot) { "solo el adaptador del Mobile Hotspot ($($red.elegido.nombre))" } else { 'redes privadas' }
  Write-Host ''
  Write-Host ("Falta permitir en el Firewall TCP {0} para {1}, limitado a la subred local." -f ($Puertos -join ', '), $descripcion) -ForegroundColor Yellow
  if ($SkipFirewallPrompt -or $NoWait) {
    Write-Host 'No se creo ninguna regla (ejecucion no interactiva).' -ForegroundColor Yellow
    return 'FALTA REGLA'
  }
  $respuesta = Read-Host 'Crear esa unica regla ahora? Windows pedira permiso de administrador [S/N]'
  if ($respuesta -notmatch '^(s|si|y|yes)$') { return 'FALTA REGLA' }
  $regla = New-ReglaFirewallRancho -Perfil $perfil -Puertos $Puertos -InterfaceAlias $red.elegido.nombre
  if ($regla.Creada -or $regla.Existia) { return 'LISTO' }
  Write-Host 'La regla no se creo (permiso cancelado o denegado).' -ForegroundColor Yellow
  return 'FALTA REGLA'
}

function Show-QrCelular([string]$url, [string]$png = $qrPath) {
  Push-Location $frontend
  try {
    & node.exe scripts/print-local-qr.mjs $url --png $png
  } finally {
    Pop-Location
  }
  if ((Test-Path $png) -and -not $SkipOpenBrowser) { Start-Process $png }
}

function Save-State {
  New-Item -ItemType Directory -Path $runtimeBase -Force | Out-Null
  [ordered]@{
    version = 1
    root = $root
    startedAt = (Get-Date).ToString('o')
    backend = if ($owned.backend) { @{ pid = $owned.backend.Id; marker = 'EL_RANCHO_LOCAL_BACKEND'; startedAtUtc = $owned.backend.StartTime.ToUniversalTime().ToString('o') } } else { $null }
    frontend = if ($owned.frontend) { @{ pid = $owned.frontend.Id; marker = 'EL_RANCHO_LOCAL_FRONTEND'; startedAtUtc = $owned.frontend.StartTime.ToUniversalTime().ToString('o') } } else { $null }
    tunel = if ($owned.tunel) { @{ pid = $owned.tunel.Id; marker = 'EL_RANCHO_CLOUDFLARED'; startedAtUtc = $owned.tunel.StartTime.ToUniversalTime().ToString('o') } } else { $null }
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $statePath -Encoding UTF8
}

function Wait-Cierre {
  Write-Host 'Presiona ENTER, Q o Ctrl+C para cerrar El Rancho.' -ForegroundColor Yellow
  $oldControlC = [Console]::TreatControlCAsInput
  [Console]::TreatControlCAsInput = $true
  try {
    do {
      $key = [Console]::ReadKey($true)
    } while ($key.Key -ne 'Enter' -and $key.Key -ne 'Q' -and [int]$key.KeyChar -ne 3)
  } finally {
    [Console]::TreatControlCAsInput = $oldControlC
  }
}

function Write-Paso([string]$texto) {
  Write-Host ('{0,-44}' -f ($texto + '...')) -NoNewline
}

function Write-Ok([string]$detalle = '') {
  Write-Host 'OK' -ForegroundColor Green -NoNewline
  if ($detalle) { Write-Host (' ' + $detalle) -ForegroundColor DarkGray } else { Write-Host '' }
}

function Invoke-DemoNode([string[]]$Argumentos) {
  Push-Location $frontend
  try {
    $salida = & node.exe scripts/demo-publica.mjs @Argumentos
    return [pscustomobject]@{ Codigo = $LASTEXITCODE; Salida = (@($salida) -join [Environment]::NewLine) }
  } finally {
    Pop-Location
  }
}

function Get-TextoTunel {
  $texto = ''
  foreach ($ruta in @($tunelErr, $tunelOut)) {
    if (Test-Path $ruta) { $texto += (Get-Content -LiteralPath $ruta -Raw -ErrorAction SilentlyContinue) }
  }
  return $texto
}

function Start-DemoPublica {
  # 1. Backend: se reutiliza uno sano de El Rancho; si no, se inicia en modo
  #    demo (solo 127.0.0.1, sin trabajos programados ni correo).
  Write-Paso 'Iniciando backend'
  $pidBackend = Get-PuertoPropietario 3000
  if ($pidBackend) {
    if (-not (Test-Http 'http://127.0.0.1:3000/api/health' 4)) {
      throw ("Puerto ocupado por otro proceso: el 3000 lo usa {0} y no es El Rancho. No se cerro ni modifico." -f (Describe-Proceso (Get-InfoProceso $pidBackend)))
    }
    Write-Ok '(se reutiliza el backend de El Rancho ya abierto)'
  } else {
    $comando = 'set EL_RANCHO_LOCAL_BACKEND=1&& set NODE_ENV=production&& npm run certify:pwa'
    $owned.backend = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', $comando) `
      -WorkingDirectory $backend -WindowStyle Hidden -PassThru -RedirectStandardOutput $backendOut -RedirectStandardError $backendErr
    if (-not (Wait-Http 'http://127.0.0.1:3000/api/health' 45)) { throw "Backend no pudo iniciar. Revisa $backendErr" }
    Write-Ok
  }

  # 2. Frontend: build de produccion + vite preview con el proxy existente.
  Write-Paso 'Compilando la aplicacion (build de produccion)'
  $buildLog = Join-Path $runtimeBase 'frontend-build.log'
  Push-Location $frontend
  try {
    & npm.cmd run build *> $buildLog
    if ($LASTEXITCODE -ne 0) { throw "Fallo el build del frontend. Revisa $buildLog" }
  } finally {
    Pop-Location
  }
  Write-Ok
  $revision = Invoke-DemoNode @('revisar-dist', 'dist')
  if ($revision.Codigo -eq 2) {
    Write-Host 'AVISO: el build contiene direcciones locales que un celular externo no podria abrir:' -ForegroundColor Yellow
    Write-Host $revision.Salida -ForegroundColor Yellow
  }

  Write-Paso 'Iniciando frontend'
  $puerto = Resolve-PuertoFrontend -Puerto $puertoDemo -Frontend $frontend
  if ($puerto.Estado -eq 'ajeno') {
    throw ("Puerto ocupado por otro proceso: el {0} lo usa {1}. No se cerro; cierralo tu y vuelve a intentar." -f $puertoDemo, (Describe-Proceso $puerto.Proceso))
  }
  $owned.frontend = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', 'set EL_RANCHO_LOCAL_FRONTEND=1&& npm run preview') `
    -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr
  Save-State
  if (-not (Wait-Http "http://127.0.0.1:$puertoDemo/" 30)) { throw "Frontend no pudo iniciar en el puerto $puertoDemo. Revisa $frontendErr" }
  if (-not (Test-Http "http://127.0.0.1:$puertoDemo/api/health" 8)) { throw 'El frontend inicio, pero su proxy /api no llega al backend.' }
  Write-Ok

  # 3. Quick Tunnel: no requiere cuenta ni inicio de sesion. Antes se cierran
  #    tuneles anteriores de ESTA copia que hayan quedado abiertos.
  Write-Paso 'Iniciando Cloudflare Tunnel'
  $anteriores = @(Stop-TunelesDeElRancho -Cloudflared $cloudflared -Puerto $puertoDemo)
  Remove-Item $tunelOut, $tunelErr, $urlDemoPath -Force -ErrorAction SilentlyContinue
  $argumentosTunel = @('tunnel', '--no-autoupdate', '--url', "http://127.0.0.1:$puertoDemo", '--http-host-header', "127.0.0.1:$puertoDemo")
  $owned.tunel = Start-Process -FilePath $cloudflared -ArgumentList $argumentosTunel -WorkingDirectory $runtimeBase `
    -WindowStyle Hidden -PassThru -RedirectStandardOutput $tunelOut -RedirectStandardError $tunelErr
  Save-State
  $url = $null
  $limite = (Get-Date).AddSeconds(45)
  do {
    Start-Sleep -Milliseconds 700
    $lectura = Invoke-DemoNode @('url', $tunelErr)
    if ($lectura.Codigo -eq 0 -and $lectura.Salida) { $url = $lectura.Salida.Trim() }
    if (-not $url) {
      $lectura = Invoke-DemoNode @('url', $tunelOut)
      if ($lectura.Codigo -eq 0 -and $lectura.Salida) { $url = $lectura.Salida.Trim() }
    }
    if (-not $url -and $owned.tunel.HasExited) { break }
  } while (-not $url -and (Get-Date) -lt $limite)
  if (-not $url) {
    $causa = (Invoke-DemoNode @('error', $tunelErr)).Salida
    if (-not $causa) { $causa = "Revisa $tunelErr" }
    throw ("No fue posible obtener URL publica de Cloudflare. {0}" -f $causa)
  }
  Write-Ok $(if ($anteriores.Count) { "(se cerro un tunel anterior de El Rancho: PID $($anteriores -join ', '))" } else { '' })
  Set-Content -LiteralPath $urlDemoPath -Value $url -Encoding UTF8

  # 4. Verificacion real desde esta PC a traves de la URL publica.
  Write-Host 'Verificando aplicacion publica (puede tardar unos segundos)...'
  Push-Location $frontend
  try {
    # Out-Host: el progreso se muestra en consola y no se mezcla con el valor
    # que devuelve la funcion (la URL).
    & node.exe scripts/demo-publica.mjs verificar $url --timeout 90 | Out-Host
    $verificada = $LASTEXITCODE -eq 0
  } finally {
    Pop-Location
  }
  if (-not $verificada) {
    if ($owned.tunel.HasExited) { throw ("El tunel de Cloudflare se cerro durante la verificacion. {0}" -f (Invoke-DemoNode @('error', $tunelErr)).Salida) }
    throw "La URL publica $url no paso la verificacion (detalle arriba). No se anuncia como lista."
  }
  return $url
}

function Stop-Owned {
  Stop-OwnedProcess $owned.tunel 'tunel de Cloudflare'
  Stop-OwnedProcess $owned.frontend 'frontend'
  Stop-OwnedProcess $owned.backend 'backend'
  Remove-Item -LiteralPath $statePath -Force -ErrorAction SilentlyContinue
}

try {
  Write-Header 'EL RANCHO'
  if (-not $Mode) {
    Write-Host 'Como quieres iniciar El Rancho?'
    Write-Host ''
    Write-Host '[1] Solo esta PC'
    Write-Host '[2] PC + celular en la misma red (prueba rapida; no abre sin conexion al reabrir)'
    Write-Host '[3] Celular con app instalable y offline (HTTPS local, recomendado para campo)'
    Write-Host '[4] Demo publica por Internet (Cloudflare: cualquier celular, incluso con datos moviles)'
    Write-Host '[5] Salir'
    Write-Host ''
    switch (Read-Host 'Elige una opcion') {
      '1' { $Mode = 'Pc' }
      '2' { $Mode = 'Lan' }
      '3' { $Mode = 'Pwa' }
      '4' { $Mode = 'Demo' }
      default { exit 0 }
    }
  }

  # Flujo anterior de certificacion PWA (EL RANCHO - PRUEBA PWA HTTPS.bat), solo con -Mode Https.
  if ($Mode -eq 'Https') {
    if (-not (Test-Path $httpsLauncher)) { throw 'No se encontro el launcher HTTPS existente.' }
    Write-Host 'Abriendo el modo HTTPS temporal en una ventana independiente...'
    Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/c', ('"{0}"' -f $httpsLauncher)) -WorkingDirectory $root
    exit 0
  }

  if (-not (Test-Path $backend) -or -not (Test-Path $frontend)) { throw 'No se localizaron backend y frontend junto al launcher.' }
  if (-not (Test-Executable 'node.exe')) { throw 'Node.js no esta instalado o no esta disponible en PATH.' }
  if (-not (Test-Executable 'npm.cmd')) { throw 'npm no esta instalado o no esta disponible en PATH.' }
  Ensure-Dependencies $backend 'backend'
  Ensure-Dependencies $frontend 'frontend'

  Write-Host '[1/6] Comprobando PostgreSQL...'
  Push-Location $backend
  try {
    & node.exe scripts/check-local-runtime.js
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL no respondio. Revisa que el servicio este iniciado y la configuracion local sea valida.' }
  } finally {
    Pop-Location
  }

  if ($Mode -eq 'Demo') {
    if (-not (Test-Path $cloudflared)) {
      throw "Cloudflared no esta instalado: falta $cloudflared. Descarga cloudflared-windows-amd64.exe desde el sitio oficial de Cloudflare y guardalo con ese nombre."
    }
    if (Test-Path (Join-Path $env:USERPROFILE '.cloudflared\config.yml')) {
      Write-Host 'AVISO: existe una configuracion permanente en ~\.cloudflared\config.yml; si el tunel falla, renombrala temporalmente.' -ForegroundColor Yellow
    }
    if ($Validate) {
      Write-Host ('Cloudflared ..... OK ({0})' -f ((& $cloudflared --version) -join ' '))
      Write-Host 'Node/npm ........ OK'
      Write-Host 'PostgreSQL ...... OK'
      Write-Host 'VALIDACION DE LA DEMO PUBLICA: OK (no se abrio ningun tunel)' -ForegroundColor Green
      exit 0
    }
    New-Item -ItemType Directory -Path $runtimeBase -Force | Out-Null
    Remove-Item $backendOut, $backendErr, $frontendOut, $frontendErr -Force -ErrorAction SilentlyContinue
    Write-Header 'EL RANCHO - DEMO PUBLICA'
    $urlPublica = Start-DemoPublica
    Write-Header 'DEMO LISTA'
    Write-Host 'Abre en cualquier celular (datos moviles u otra red):' -ForegroundColor Cyan
    Write-Host ''
    Write-Host ("    {0}" -f $urlPublica) -ForegroundColor Green
    Write-Host ''
    Write-Host 'Escanea el codigo QR:' -ForegroundColor Cyan
    Show-QrCelular $urlPublica $qrDemoPath
    if (Test-Path $qrDemoPath) { Write-Host ("QR guardado en: {0}" -f $qrDemoPath) }
    Write-Host ("URL guardada en: {0}" -f $urlDemoPath)
    Write-Host ''
    Write-Host 'Solo la aplicacion es publica; PostgreSQL y el puerto 3000 siguen solo en esta PC.' -ForegroundColor DarkGray
    Write-Host 'La URL cambia cada vez que inicias la demo.' -ForegroundColor DarkGray
    Write-Host ''
    Write-Host 'Manten esta ventana abierta durante la demostracion.' -ForegroundColor Yellow
    Write-Host 'Para terminar usa ENTER/Q aqui (o EL RANCHO - CERRAR.bat); no la cierres con la X.' -ForegroundColor Yellow
    $completed = $true
    if ($NoWait) {
      Write-Host 'Procesos en segundo plano. Usa EL RANCHO - CERRAR.bat para detenerlos.'
      exit 0
    }
    Wait-Cierre
    return
  }

  if ($Validate) {
    $red = Get-DireccionCelular
    Write-Host 'Node/npm ........ OK'
    Write-Host 'PostgreSQL ...... OK'
    Write-Host 'Vite/proxy ...... OK (configuracion existente)'
    $propuesta = @($red.sin_respuesta) + @($red.elegido) | Where-Object { $_ } | Select-Object -First 1
    if ($propuesta) { Write-Host ("Red celular ..... {0} - {1} ({2})" -f $propuesta.ip, $propuesta.modo, $propuesta.nombre) }
    else { Write-Host 'Red celular ..... ninguna red local valida' }
    Write-Host 'VALIDACION DEL LAUNCHER: OK' -ForegroundColor Green
    exit 0
  }

  New-Item -ItemType Directory -Path $runtimeBase -Force | Out-Null
  Remove-Item $backendOut, $backendErr, $frontendOut, $frontendErr -Force -ErrorAction SilentlyContinue

  Write-Host '[2/6] Iniciando backend...'
  $pidBackend = Get-PuertoPropietario 3000
  if ($pidBackend) {
    if (-not (Test-Http 'http://127.0.0.1:3000/api/health' 4)) {
      throw ("El puerto 3000 esta ocupado por otro proceso que no es El Rancho: {0}. No se cerro ni modifico." -f (Describe-Proceso (Get-InfoProceso $pidBackend)))
    }
    Write-Host 'Backend saludable existente: se reutilizara.' -ForegroundColor Yellow
  } else {
    $owned.backend = Start-RanchoProcess 'backend' $backend $backendOut $backendErr
    if (-not (Wait-Http 'http://127.0.0.1:3000/api/health' 45)) {
      throw "El backend no quedo listo. Revisa $backendErr"
    }
  }

  # Un servidor frontend viejo de ESTA copia de El Rancho se cierra (se
  # comprueba por su linea de comandos); cualquier otro proceso se informa y no se toca.
  $puertosFrontend = if ($Mode -eq 'Pwa') { @($puertoHttps, $puertoCertificado) } else { @($puertoFrontend) }
  foreach ($p in $puertosFrontend) {
    $puerto = Resolve-PuertoFrontend -Puerto $p -Frontend $frontend
    if ($puerto.Estado -eq 'ajeno') {
      throw ("El puerto {0} esta ocupado por un proceso que no se puede identificar como El Rancho: {1}. No se cerro; cierralo tu y vuelve a intentar." -f $p, (Describe-Proceso $puerto.Proceso))
    }
    if ($puerto.Estado -eq 'liberado') {
      Write-Host ("Se cerro una instancia anterior de El Rancho que ocupaba el puerto {0} (PID {1})." -f $p, $puerto.Proceso.Id) -ForegroundColor Yellow
    }
  }

  if ($Mode -eq 'Pwa') {
    Write-Host '[3/6] Compilando la app de produccion (incluye el Service Worker)...'
    Push-Location $frontend
    try {
      & npm.cmd run build *> (Join-Path $runtimeBase 'frontend-build.log')
      if ($LASTEXITCODE -ne 0) { throw ("Fallo el build del frontend. Revisa {0}" -f (Join-Path $runtimeBase 'frontend-build.log')) }
    } finally {
      Pop-Location
    }
    $previa = Get-DireccionCelular
    $ips = @($previa.ips_candidatas) -join ','
    Push-Location $frontend
    try {
      $certificados = & node.exe scripts/https-local.mjs certificados --dir $certDir --ips $ips | Out-String | ConvertFrom-Json
      if ($LASTEXITCODE -ne 0) { throw 'No se pudieron preparar los certificados HTTPS locales.' }
    } finally {
      Pop-Location
    }
    if ($certificados.caNueva) {
      Write-Host 'Se creo el certificado local de este equipo. Cada celular debe instalarlo UNA vez (ver instrucciones al final).' -ForegroundColor Yellow
    }
    $comandoHttps = "set EL_RANCHO_LOCAL_FRONTEND=1&& node scripts\https-local.mjs servir --dir `"$certDir`" --puerto $puertoHttps --puerto-ca $puertoCertificado"
    $owned.frontend = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', $comandoHttps) `
      -WorkingDirectory $frontend -WindowStyle Hidden -PassThru -RedirectStandardOutput $frontendOut -RedirectStandardError $frontendErr
    if (-not (Wait-Https "https://127.0.0.1:$puertoHttps/" 30)) { throw "El servidor HTTPS local no quedo listo. Revisa $frontendErr" }
    Write-Host '[4/6] Verificando proxy /api...'
    if (-not (Test-Https "https://127.0.0.1:$puertoHttps/api/health" -SinTitulo)) { throw 'La app abrio, pero su proxy /api no pudo comunicarse con el backend.' }
  } else {
    Write-Host '[3/6] Iniciando frontend...'
    $owned.frontend = Start-RanchoProcess 'frontend' $frontend $frontendOut $frontendErr
    if (-not (Wait-Http "http://127.0.0.1:$puertoFrontend/" 45)) {
      throw "El frontend no quedo listo. Revisa $frontendErr"
    }
    Write-Host '[4/6] Verificando proxy /api...'
    if (-not (Test-Http "http://127.0.0.1:$puertoFrontend/api/health" 8)) { throw 'El frontend abrio, pero su proxy /api no pudo comunicarse con el backend.' }
  }
  Save-State

  $red = $null
  $estadoFirewall = $null
  if ($Mode -in 'Lan', 'Pwa') {
    Write-Host '[5/6] Detectando la red del celular...'
    $red = if ($Mode -eq 'Pwa') { Get-DireccionCelular -Https } else { Get-DireccionCelular }
    if (-not $red.elegido) {
      Write-Host ''
      Write-Host ('No se encontro una direccion para el celular: ' + $red.mensaje) -ForegroundColor Yellow
      foreach ($c in @($red.sin_respuesta)) { Write-Host ("  {0}  ({1}, sin respuesta)" -f $c.url, $c.nombre) -ForegroundColor Yellow }
      Write-Host 'El Rancho sigue disponible en esta PC.' -ForegroundColor Yellow
    } else {
      Write-Host '[6/6] Revisando el Firewall...'
      $estadoFirewall = if ($Mode -eq 'Pwa') { Confirm-Firewall $red @($puertoHttps, $puertoCertificado) } else { Confirm-Firewall $red }
    }
  }

  $pcUrl = if ($Mode -eq 'Pwa') { "https://localhost:$puertoHttps" } else { "http://localhost:$puertoFrontend" }
  Write-Header 'EL RANCHO'
  Write-Estado 'Backend' 'LISTO'
  Write-Estado 'Frontend' 'LISTO'
  Write-Estado 'PostgreSQL' 'LISTO'
  if ($estadoFirewall) { Write-Estado 'Firewall' $estadoFirewall $(if ($estadoFirewall -eq 'LISTO') { 'Green' } else { 'Yellow' }) }
  Write-Host ''
  Write-Host 'En esta PC:' -ForegroundColor Cyan
  Write-Host $pcUrl

  if ($red -and $red.elegido) {
    Write-Host ''
    Write-Host 'Modo:' -ForegroundColor Cyan
    Write-Host $red.elegido.modo
    if ($red.elegido.clase -eq 'hotspot' -and $null -ne $red.elegido.clientes_hotspot) {
      Write-Host ("Dispositivos conectados al hotspot: {0}" -f $red.elegido.clientes_hotspot)
    }
    Write-Host ''
    Write-Host 'Abre en tu celular:' -ForegroundColor Cyan
    Write-Host $red.elegido.url -ForegroundColor Green
    if ($red.estado -eq 'ambiguo') { Write-Host $red.mensaje -ForegroundColor Yellow }
    if (@($red.alternativas).Count) {
      Write-Host ''
      Write-Host 'Si el celular esta en otra red, usa:' -ForegroundColor Yellow
      foreach ($c in @($red.alternativas)) { Write-Host ("  {0}  ({1} - {2})" -f $c.url, $c.modo, $c.nombre) }
    }
    Write-Host ''
    Show-QrCelular $red.elegido.url
    if (Test-Path $qrPath) { Write-Host ("QR tambien guardado en: {0}" -f $qrPath) }
    if ($Mode -eq 'Pwa') {
      $urlCertificado = "http://$($red.elegido.ip):$puertoCertificado"
      Write-Host ''
      Write-Host 'PRIMERA VEZ EN UN CELULAR: instala el certificado de este equipo' -ForegroundColor Cyan
      Write-Host $urlCertificado -ForegroundColor Green
      Write-Host 'Abre esa direccion, descarga el certificado e instalalo como "Certificado de CA".'
      Write-Host 'Luego abre la direccion HTTPS de arriba, inicia sesion, sincroniza e instala la app.'
      Show-QrCelular $urlCertificado $qrCaPath
      Write-Host ("Huella del certificado: {0}" -f $certificados.huellaCa)
    }
  }

  if (-not $SkipOpenBrowser) { Start-Process $pcUrl }
  $completed = $true
  if ($NoWait) {
    Write-Host ''
    Write-Host 'Procesos en segundo plano. Usa EL RANCHO - CERRAR.bat para detenerlos.'
    exit 0
  }

  Write-Host ''
  Write-Host 'Esperando conexiones...' -ForegroundColor Green
  Write-Host 'La PC debe permanecer encendida y esta ventana abierta.' -ForegroundColor Yellow
  Wait-Cierre
} catch {
  Write-Host ''
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  if (Test-Path $backendErr) { Write-Host ("Log backend: $backendErr") }
  if (Test-Path $frontendErr) { Write-Host ("Log frontend: $frontendErr") }
  if (Test-Path $tunelErr) { Write-Host ("Log del tunel: $tunelErr") }
  exit 1
} finally {
  if (-not $NoWait -and ($owned.backend -or $owned.frontend -or $owned.tunel)) {
    Stop-Owned
    if ($completed) { Write-Host 'El Rancho se cerro correctamente.' -ForegroundColor Green }
  }
}
