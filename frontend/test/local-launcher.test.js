import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);

test('el launcher local usa wrappers portables y conserva separado el modo HTTPS', async () => {
  const start = await readFile(new URL('EL%20RANCHO%20-%20INICIAR.bat', root), 'utf8');
  const stop = await readFile(new URL('EL%20RANCHO%20-%20CERRAR.bat', root), 'utf8');
  assert.match(start, /%~dp0/);
  assert.match(start, /scripts\\iniciar-el-rancho\.ps1/);
  assert.doesNotMatch(start, /C:\\Users\\/i);
  assert.match(stop, /scripts\\cerrar-el-rancho\.ps1/);

  const launcher = await readFile(new URL('scripts/iniciar-el-rancho.ps1', root), 'utf8');
  const red = await readFile(new URL('scripts/el-rancho-red.psm1', root), 'utf8');
  assert.match(launcher, /EL RANCHO - PRUEBA PWA HTTPS\.bat/);
  // La deteccion de red vive en el modulo y en lan-launcher.mjs (probado aparte).
  assert.match(launcher, /el-rancho-red\.psm1/);
  assert.match(launcher, /'scripts\/lan-launcher\.mjs', 'detectar'/);
  // Modo app instalable: build de produccion servido por HTTPS local.
  assert.match(launcher, /'Pwa'/);
  assert.match(launcher, /https-local\.mjs servir/);
  assert.match(launcher, /npm\.cmd run build/);
  assert.match(red, /NetworkInterface\]::GetAllNetworkInterfaces/);
  assert.match(red, /192\.168\.137\.1/);
  assert.match(launcher, /EL_RANCHO_LOCAL_BACKEND/);
  assert.match(launcher, /http:\/\/127\.0\.0\.1:\$puertoFrontend\/api\/health/);
  assert.match(launcher, /Resolve-PuertoFrontend/);
  for (const texto of [launcher, red]) assert.doesNotMatch(texto, /taskkill(?:\.exe)?\s+(?:\/F\s+)?\/IM/i);
  // Solo se cierra el Vite de esta carpeta frontend, verificado por su linea de comandos.
  assert.match(red, /\\node_modules\\/);
  assert.match(red, /Test-ViteDeElRancho/);
  // Los .ps1 llevan BOM para que Windows PowerShell 5.1 no lea los acentos como ANSI.
  assert.equal(launcher.charCodeAt(0), 0xfeff);
  assert.equal(red.charCodeAt(0), 0xfeff);
});

test('el cierre solo acepta los PID marcados por el launcher', async () => {
  const stop = await readFile(new URL('scripts/cerrar-el-rancho.ps1', root), 'utf8');
  assert.match(stop, /local-runtime\.json/);
  assert.match(stop, /startedAtUtc/);
  assert.match(stop, /expectedMarker/);
  assert.match(stop, /taskkill\.exe \/PID/);
  assert.doesNotMatch(stop, /node\.exe/);
});

test('el QR se genera localmente con la dependencia ya existente', async () => {
  const qr = await readFile(new URL('../scripts/print-local-qr.mjs', import.meta.url), 'utf8');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(typeof pkg.dependencies.qrcode, 'string');
  assert.match(qr, /QRCode\.toString/);
  assert.doesNotMatch(qr, /fetch\(|https?:\/\/api\./);
});

test('la guia limita Firewall a TCP 5173, explica el hotspot y el consentimiento', async () => {
  const guide = await readFile(new URL('docs/INICIAR_EL_RANCHO.md', root), 'utf8');
  const red = await readFile(new URL('scripts/el-rancho-red.psm1', root), 'utf8');
  assert.match(guide, /doble clic/i);
  assert.match(guide, /mismo Wi-Fi/i);
  assert.match(guide, /Mobile Hotspot/);
  assert.match(guide, /TCP \*\*5173\*\*/);
  assert.match(guide, /solo si respondes \*\*S\*\*/i);
  assert.match(guide, /Nunca desactiva el Firewall/);
  // La unica regla posible: entrada TCP al puerto del frontend, subred local, sin tocar el estado del Firewall.
  assert.match(red, /-Direction Inbound -Action Allow -Protocol TCP -LocalPort \$puertosTexto -Profile \$Perfil -RemoteAddress LocalSubnet/);
  assert.match(red, /Test-HttpsLocalDeElRancho/);
  assert.match(red, /-Verb RunAs/);
  assert.match(red, /Test-ReglaFirewall \$nombre/);
  assert.doesNotMatch(red, /Set-NetFirewallProfile|advfirewall set|state off/i);
});
