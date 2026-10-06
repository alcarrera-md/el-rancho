# Prueba de los escenarios D y E del launcher con procesos reales, en puertos
# de prueba para no interferir con una instancia de El Rancho en 5173.
#   D: el puerto lo ocupa un Vite de ESTA copia de El Rancho -> se cierra.
#   E: el puerto lo ocupa un proceso ajeno -> se informa y NO se toca.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\probar-puerto-launcher.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$frontend = Join-Path $root 'frontend'
Import-Module (Join-Path $PSScriptRoot 'el-rancho-red.psm1') -Force
$fallos = 0

function Esperar-Puerto([int]$Puerto, [bool]$Ocupado, [int]$Segundos = 30) {
  $limite = (Get-Date).AddSeconds($Segundos)
  while ((Get-Date) -lt $limite) {
    if ([bool](Get-PuertoPropietario $Puerto) -eq $Ocupado) { return $true }
    Start-Sleep -Milliseconds 300
  }
  return $false
}

function Afirmar([bool]$Condicion, [string]$Mensaje) {
  if ($Condicion) { Write-Host "  OK  $Mensaje" -ForegroundColor Green }
  else { Write-Host "  FALLA  $Mensaje" -ForegroundColor Red; $script:fallos++ }
}

$ajeno = $null
try {
  Write-Host 'Escenario D: instancia vieja de El Rancho en el puerto'
  $vite = Join-Path $frontend 'node_modules\vite\bin\vite.js'
  $env:VITE_DEV_PORT = '5199'
  $viejo = Start-Process -FilePath 'node.exe' -ArgumentList @("`"$vite`"") -WorkingDirectory $frontend -WindowStyle Hidden -PassThru
  Remove-Item Env:VITE_DEV_PORT
  Afirmar (Esperar-Puerto 5199 $true) 'Vite de prueba escuchando en 5199'
  $idVite = Get-PuertoPropietario 5199
  Afirmar (Test-ViteDeElRancho (Get-InfoProceso $idVite) $frontend) "PID $idVite identificado como Vite de El Rancho por su linea de comandos"
  $resultado = Resolve-PuertoFrontend -Puerto 5199 -Frontend $frontend
  Afirmar ($resultado.Estado -eq 'liberado') "resultado = $($resultado.Estado)"
  Afirmar (-not (Get-PuertoPropietario 5199)) 'puerto 5199 libre despues de cerrar la instancia'
  Afirmar (-not (Get-Process -Id $idVite -ErrorAction SilentlyContinue)) 'el proceso de Vite ya no existe'

  Write-Host 'Escenario E: proceso ajeno en el puerto'
  $script = "require('http').createServer((q, s) => s.end('otro proyecto')).listen(5198)"
  $ajeno = Start-Process -FilePath 'node.exe' -ArgumentList @('-e', "`"$script`"") -WorkingDirectory $env:TEMP -WindowStyle Hidden -PassThru
  Afirmar (Esperar-Puerto 5198 $true) 'servidor ajeno escuchando en 5198'
  $resultado = Resolve-PuertoFrontend -Puerto 5198 -Frontend $frontend
  Afirmar ($resultado.Estado -eq 'ajeno') "resultado = $($resultado.Estado) (PID $($resultado.Proceso.Id), $($resultado.Proceso.Nombre))"
  Afirmar ([bool](Get-Process -Id $ajeno.Id -ErrorAction SilentlyContinue)) 'el proceso ajeno sigue vivo: no se cerro'
  Afirmar ([bool](Get-PuertoPropietario 5198)) 'el puerto 5198 sigue ocupado por el proceso ajeno'

  Write-Host 'Puerto libre'
  Afirmar ((Resolve-PuertoFrontend -Puerto 5197 -Frontend $frontend).Estado -eq 'libre') 'un puerto sin procesos se informa como libre'
} finally {
  # Solo se cierra el proceso ajeno que esta prueba creo, por su PID exacto.
  if ($ajeno -and -not $ajeno.HasExited) { & taskkill.exe /PID $ajeno.Id /T /F *> $null }
}

if ($fallos) { Write-Host "$fallos comprobacion(es) fallaron." -ForegroundColor Red; exit 1 }
Write-Host 'Escenarios D y E: OK' -ForegroundColor Green
