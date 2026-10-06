# Utilidades de red y procesos del launcher de El Rancho.
# Solo leen el estado del equipo; la única función que modifica algo
# (New-ReglaFirewallRancho) pide confirmación de administrador de Windows.

Set-StrictMode -Version 2

$script:ReglaLan = 'El Rancho Frontend LAN'
$script:ReglaHotspot = 'El Rancho Frontend Mobile Hotspot'

function Get-RanchoInterfaces {
  # API .NET: no requiere privilegios y funciona aunque una política limite
  # los cmdlets NetTCPIP. Métrica y perfil de red se agregan si son legibles.
  $metricas = @{}
  try {
    foreach ($i in Get-NetIPInterface -AddressFamily IPv4 -ErrorAction Stop) { $metricas[[string]$i.InterfaceAlias] = [int]$i.InterfaceMetric }
  } catch { }
  $perfiles = @{}
  try {
    foreach ($p in Get-NetConnectionProfile -ErrorAction Stop) { $perfiles[[string]$p.InterfaceAlias] = [string]$p.NetworkCategory }
  } catch { }

  $resultado = @()
  foreach ($adaptador in [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
    $propiedades = $adaptador.GetIPProperties()
    $ipv4 = @()
    foreach ($unicast in @($propiedades.UnicastAddresses)) {
      if ($unicast.Address.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) { continue }
      $prefijo = $null
      try { $prefijo = [int]$unicast.PrefixLength } catch { }
      $ipv4 += [ordered]@{ ip = $unicast.Address.ToString(); prefijo = $prefijo }
    }
    $gateways = @($propiedades.GatewayAddresses |
      Where-Object { $_.Address.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } |
      ForEach-Object { $_.Address.ToString() })
    $nombre = [string]$adaptador.Name
    # 192.168.137.1 sin gateway es la dirección fija de la Conexión compartida
    # (ICS) que usa Mobile Hotspot en Windows.
    $ics = [bool](($ipv4 | Where-Object { $_.ip -eq '192.168.137.1' }) -and -not $gateways)
    $clientes = $null
    if ($adaptador.Description -match 'Wi-?Fi Direct|Hosted Network' -and [string]$adaptador.OperationalStatus -eq 'Up') {
      try {
        $clientes = @(Get-NetNeighbor -InterfaceIndex $adaptador.GetIPProperties().GetIPv4Properties().Index -AddressFamily IPv4 -ErrorAction Stop |
          Where-Object { $_.State -in 'Reachable', 'Stale', 'Delay', 'Probe' -and $_.IPAddress -notmatch '\.255$|^22[4-9]\.|^23\d\.' }).Count
      } catch { }
    }
    $resultado += [ordered]@{
      nombre = $nombre
      descripcion = [string]$adaptador.Description
      tipo = [string]$adaptador.NetworkInterfaceType
      estado = [string]$adaptador.OperationalStatus
      ipv4 = @($ipv4)
      gateways = @($gateways)
      metrica = if ($metricas.ContainsKey($nombre)) { $metricas[$nombre] } else { $null }
      categoria = if ($perfiles.ContainsKey($nombre)) { $perfiles[$nombre] } else { $null }
      ics_privada = $ics
      clientes = $clientes
    }
  }
  return $resultado
}

function Get-PuertoPropietario([int]$Puerto) {
  try {
    $conexion = Get-NetTCPConnection -State Listen -LocalPort $Puerto -ErrorAction Stop | Select-Object -First 1
    if ($conexion) { return [int]$conexion.OwningProcess }
  } catch { }
  foreach ($linea in (netstat -ano -p tcp)) {
    if ($linea -match "^\s*TCP\s+\S+:$Puerto\s+\S+\s+\S+\s+(\d+)\s*$") { return [int]$Matches[1] }
  }
  return $null
}

function Get-InfoProceso([int]$Id) {
  $info = [ordered]@{ Id = $Id; Nombre = $null; LineaComandos = $null; PadreId = $null }
  try {
    $w = Get-CimInstance Win32_Process -Filter "ProcessId=$Id" -ErrorAction Stop
    if ($w) { $info.Nombre = $w.Name; $info.LineaComandos = $w.CommandLine; $info.PadreId = $w.ParentProcessId }
  } catch {
    $p = Get-Process -Id $Id -ErrorAction SilentlyContinue
    if ($p) { $info.Nombre = $p.ProcessName + '.exe' }
  }
  return [pscustomobject]$info
}

function ConvertTo-RutaComparable([string]$Ruta) {
  return ($Ruta -replace '/', '\' -replace '\\+', '\').TrimEnd('\').ToLowerInvariant()
}

# Prueba directa de pertenencia: el proceso que escucha es el Vite instalado
# en la carpeta frontend de ESTA copia de El Rancho. No se infiere por nombre
# (node.exe) ni por ancestros lejanos.
function Test-ViteDeElRancho([object]$Info, [string]$Frontend) {
  if (-not $Info -or -not $Info.LineaComandos) { return $false }
  $linea = ConvertTo-RutaComparable ([string]$Info.LineaComandos)
  $modulos = (ConvertTo-RutaComparable $Frontend) + '\node_modules\'
  return $linea.Contains($modulos) -and $linea -match '\bvite\b'
}

# Servidor HTTPS local de la app instalable (frontend\scripts\https-local.mjs).
function Test-HttpsLocalDeElRancho([object]$Info, [string]$Frontend) {
  if (-not $Info -or -not $Info.LineaComandos) { return $false }
  $linea = ConvertTo-RutaComparable ([string]$Info.LineaComandos)
  return $linea.Contains((ConvertTo-RutaComparable $Frontend) + '\scripts\https-local.mjs')
}

function Test-ServidorFrontendDeElRancho([object]$Info, [string]$Frontend) {
  return (Test-ViteDeElRancho $Info $Frontend) -or (Test-HttpsLocalDeElRancho $Info $Frontend)
}

function Stop-ProcesoVerificado([int]$Id) {
  & taskkill.exe /PID $Id /T /F *> $null
  $limite = (Get-Date).AddSeconds(10)
  while ((Get-Process -Id $Id -ErrorAction SilentlyContinue) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 200 }
  return -not (Get-Process -Id $Id -ErrorAction SilentlyContinue)
}

# Tunel temporal de la demo publica: el cloudflared.exe de ESTA copia de El
# Rancho (tools\cloudflared.exe) apuntando al frontend de produccion local.
function Test-CloudflaredDeElRancho([object]$Info, [string]$Cloudflared, [int]$Puerto) {
  if (-not $Info -or -not $Info.LineaComandos) { return $false }
  $linea = ConvertTo-RutaComparable ([string]$Info.LineaComandos)
  return $linea.Contains((ConvertTo-RutaComparable $Cloudflared)) -and $linea.Contains("127.0.0.1:$Puerto")
}

# Cierra solo tuneles anteriores de esta copia (por ejemplo, de una demo cuya
# ventana se cerro con la X). Nunca toca otros cloudflared del equipo.
function Stop-TunelesDeElRancho([string]$Cloudflared, [int]$Puerto) {
  $cerrados = @()
  try {
    $procesos = @(Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction Stop)
  } catch { return $cerrados }
  foreach ($p in $procesos) {
    $info = [pscustomobject]@{ Id = [int]$p.ProcessId; Nombre = $p.Name; LineaComandos = $p.CommandLine; PadreId = $p.ParentProcessId }
    if ((Test-CloudflaredDeElRancho $info $Cloudflared $Puerto) -and (Stop-ProcesoVerificado $info.Id)) { $cerrados += $info.Id }
  }
  return $cerrados
}

# Libera el puerto solo si lo ocupa un Vite demostrablemente de El Rancho.
# Devuelve: 'libre' | 'liberado' | objeto con el proceso ajeno (no se toca).
function Resolve-PuertoFrontend([int]$Puerto, [string]$Frontend) {
  $id = Get-PuertoPropietario $Puerto
  if (-not $id) { return [pscustomobject]@{ Estado = 'libre'; Proceso = $null } }
  $info = Get-InfoProceso $id
  if (-not (Test-ServidorFrontendDeElRancho $info $Frontend)) { return [pscustomobject]@{ Estado = 'ajeno'; Proceso = $info } }
  if (-not (Stop-ProcesoVerificado $id)) { throw "No se pudo cerrar la instancia anterior de El Rancho (PID $id)." }
  $limite = (Get-Date).AddSeconds(10)
  while ((Get-PuertoPropietario $Puerto) -and (Get-Date) -lt $limite) { Start-Sleep -Milliseconds 200 }
  if (Get-PuertoPropietario $Puerto) { throw "El puerto $Puerto sigue ocupado despues de cerrar la instancia anterior." }
  return [pscustomobject]@{ Estado = 'liberado'; Proceso = $info }
}

function Get-TextoFirewall {
  # netsh lee las reglas sin privilegios (Get-NetFirewallRule los exige).
  try { return (& netsh.exe advfirewall firewall show rule name=all dir=in verbose 2>$null | Out-String) } catch { return '' }
}

function Test-ReglaFirewall([string]$Nombre) {
  & netsh.exe advfirewall firewall show rule name="$Nombre" *> $null
  return $LASTEXITCODE -eq 0
}

# Crea UNA regla entrante TCP para el puerto del frontend, limitada a la
# subred local. Windows pide confirmación de administrador (UAC); si ya
# existe una regla con ese nombre no se crea otra.
function Get-NombreReglaFirewall([string]$Perfil, [int[]]$Puertos) {
  # 5173 conserva los nombres historicos (la regla que ya existe se reconoce).
  if ($Puertos.Count -eq 1 -and $Puertos[0] -eq 5173) { return $(if ($Perfil -eq 'Public') { $script:ReglaHotspot } else { $script:ReglaLan }) }
  $lista = ($Puertos | Sort-Object) -join ', '
  return $(if ($Perfil -eq 'Public') { "El Rancho App HTTPS Mobile Hotspot (TCP $lista)" } else { "El Rancho App HTTPS LAN (TCP $lista)" })
}

function New-ReglaFirewallRancho([ValidateSet('Private', 'Public')][string]$Perfil, [int]$Puerto, [string]$InterfaceAlias, [int[]]$Puertos) {
  if (-not $Puertos) { $Puertos = @($Puerto) }
  $nombre = Get-NombreReglaFirewall $Perfil $Puertos
  if (Test-ReglaFirewall $nombre) { return [pscustomobject]@{ Nombre = $nombre; Creada = $false; Existia = $true } }
  $puertosTexto = ($Puertos | ForEach-Object { [int]$_ }) -join ','
  $comando = "New-NetFirewallRule -DisplayName '$nombre' -Description 'El Rancho: acceso del celular al frontend en la red local.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort $puertosTexto -Profile $Perfil -RemoteAddress LocalSubnet"
  if ($Perfil -eq 'Public') {
    if (-not $InterfaceAlias) { throw 'La regla del hotspot requiere el adaptador del Mobile Hotspot.' }
    $comando += " -InterfaceAlias '" + ($InterfaceAlias -replace "'", "''") + "'"
  }
  $proceso = Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -PassThru -WindowStyle Hidden `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $comando)
  return [pscustomobject]@{ Nombre = $nombre; Creada = ($proceso.ExitCode -eq 0 -and (Test-ReglaFirewall $nombre)); Existia = $false }
}

Export-ModuleMember -Function Get-RanchoInterfaces, Get-PuertoPropietario, Get-InfoProceso, Test-ViteDeElRancho,
  Test-HttpsLocalDeElRancho, Test-ServidorFrontendDeElRancho, Stop-ProcesoVerificado, Resolve-PuertoFrontend,
  Test-CloudflaredDeElRancho, Stop-TunelesDeElRancho,
  Get-TextoFirewall, Test-ReglaFirewall, Get-NombreReglaFirewall, New-ReglaFirewallRancho
