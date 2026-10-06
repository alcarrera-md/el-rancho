[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$runtimeRoot = if ($env:EL_RANCHO_RUNTIME_DIR) {
  $env:EL_RANCHO_RUNTIME_DIR
} else {
  [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
}
if (-not $runtimeRoot) { $runtimeRoot = [IO.Path]::GetTempPath() }
$runtimeBase = Join-Path $runtimeRoot 'ElRancho'
$statePath = Join-Path $runtimeBase 'local-runtime.json'

function Stop-MarkedTree($entry, [string]$label, [string]$expectedMarker) {
  if (-not $entry -or -not $entry.pid) { return $false }
  if ([string]$entry.marker -ne $expectedMarker -or -not $entry.startedAtUtc) {
    Write-Warning "El estado guardado de $label no es valido; no se cerrara ningun proceso."
    return $false
  }
  $process = Get-Process -Id ([int]$entry.pid) -ErrorAction SilentlyContinue
  if (-not $process) { return $false }
  $recordedStart = [DateTimeOffset]::Parse([string]$entry.startedAtUtc).UtcDateTime
  $actualStart = $process.StartTime.ToUniversalTime()
  if ([Math]::Abs(($actualStart - $recordedStart).TotalSeconds) -gt 1) {
    Write-Warning "El PID guardado de $label ya pertenece a otro proceso; no se cerrara."
    return $false
  }
  & taskkill.exe /PID ([int]$entry.pid) /T /F *> $null
  Write-Host "$label cerrado."
  return $true
}

try {
  if (-not (Test-Path $statePath)) {
    Write-Host 'No hay procesos iniciados por el launcher de El Rancho.'
    exit 0
  }
  $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
  Stop-MarkedTree $state.tunel 'Tunel Cloudflare (demo publica)' 'EL_RANCHO_CLOUDFLARED' | Out-Null
  Stop-MarkedTree $state.frontend 'Frontend' 'EL_RANCHO_LOCAL_FRONTEND' | Out-Null
  Stop-MarkedTree $state.backend 'Backend' 'EL_RANCHO_LOCAL_BACKEND' | Out-Null
  Remove-Item -LiteralPath $statePath -Force
  Write-Host 'El Rancho se cerro correctamente.' -ForegroundColor Green
  exit 0
} catch {
  Write-Host ('ERROR: No fue posible cerrar El Rancho: ' + $_.Exception.Message) -ForegroundColor Red
  exit 1
}
