import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { COMPROBACIONES, errorTunel, extraerUrlTunel, revisarDist, verificarDemo } from '../scripts/demo-publica.mjs';

const root = new URL('../../', import.meta.url);

const LOG_CLOUDFLARED = `2026-10-01T18:20:11Z INF Thank you for trying Cloudflare Tunnel. Doing so, without a Cloudflare account, is a quick way to experiment and try it out.
2026-10-01T18:20:11Z INF Requesting new quick Tunnel on trycloudflare.com...
2026-10-01T18:20:13Z INF +--------------------------------------------------------------------------------------------+
2026-10-01T18:20:13Z INF |  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable):  |
2026-10-01T18:20:13Z INF |  https://verde-ganado-ejemplo-prueba.trycloudflare.com                                    |
2026-10-01T18:20:13Z INF +--------------------------------------------------------------------------------------------+
2026-10-01T18:20:14Z INF Registered tunnel connection connIndex=0`;

test('demo: extrae la URL del Quick Tunnel y no confunde la API de Cloudflare', () => {
  assert.equal(extraerUrlTunel(LOG_CLOUDFLARED), 'https://verde-ganado-ejemplo-prueba.trycloudflare.com');
  assert.equal(extraerUrlTunel('Requesting new quick Tunnel on https://api.trycloudflare.com/tunnel'), null);
  assert.equal(extraerUrlTunel(''), null);
});

test('demo: los fallos conocidos de cloudflared se traducen a mensajes claros', () => {
  assert.match(errorTunel('ERR Error unmarshaling QuickTunnel response: 429 Too Many Requests'), /exceso de solicitudes/);
  assert.match(errorTunel('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": dial tcp: lookup api.trycloudflare.com: no such host'), /no pudo contactar a Cloudflare|Internet/);
  assert.equal(errorTunel(LOG_CLOUDFLARED), null);
});

function respuestas(mapa) {
  return async (url) => {
    const { pathname } = new URL(url);
    const r = mapa[pathname];
    return typeof r === 'function' ? r() : (r || { status: 404, headers: {}, cuerpo: '' });
  };
}

const SANAS = {
  '/': { status: 200, headers: { 'content-type': 'text/html' }, cuerpo: '<title>El Rancho</title><div id="root"></div>' },
  '/login': { status: 200, headers: { 'content-type': 'text/html' }, cuerpo: '<title>El Rancho</title><div id="root"></div>' },
  '/api/health': { status: 200, headers: { 'content-type': 'application/json' }, cuerpo: '{"status":"ok"}' },
  '/api/auth/me': { status: 401, headers: { 'content-type': 'application/json; charset=utf-8' }, cuerpo: '{"error":"no autenticado"}' },
  '/manifest.webmanifest': { status: 200, headers: {}, cuerpo: '{"start_url": "/"}' },
};

test('demo: solo declara lista cuando app, login, /api/health y la API protegida responden por la URL pública', async () => {
  const ok = await verificarDemo('https://demo.trycloudflare.com', { peticion: respuestas(SANAS), esperaMs: 1 });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.comprobaciones.map((c) => [c.clave, c.ok]), COMPROBACIONES.map((c) => [c.clave, true]));
});

test('demo: reintenta mientras el túnel se propaga y luego confirma', async () => {
  let intentos = 0;
  const peticion = respuestas({ ...SANAS, '/': () => (++intentos < 3 ? { error: 'ENOTFOUND' } : SANAS['/']) });
  const progreso = [];
  const r = await verificarDemo('https://demo.trycloudflare.com', { peticion, esperaMs: 1, timeoutMs: 5000, alProgreso: (p) => progreso.push(p.intento) });
  assert.equal(r.ok, true);
  assert.equal(r.intentos, 3);
  assert.deepEqual(progreso, [1, 2]);
});

test('demo: si /api/health no responde por la URL pública, lo dice explícitamente', async () => {
  const r = await verificarDemo('https://demo.trycloudflare.com', {
    peticion: respuestas({ ...SANAS, '/api/health': { status: 502, headers: {}, cuerpo: 'Bad gateway' } }), esperaMs: 1, timeoutMs: 20,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mensaje, 'La URL publica existe pero /api/health no responde: el frontend no llega al backend. (HTTP 502)');
  // El manifest es opcional: un fallo ahí no impide la demo.
  const sinManifest = await verificarDemo('https://demo.trycloudflare.com', { peticion: respuestas({ ...SANAS, '/manifest.webmanifest': { status: 404, headers: {}, cuerpo: '' } }), esperaMs: 1 });
  assert.equal(sinManifest.ok, true);
  assert.equal(sinManifest.comprobaciones.find((c) => c.clave === 'pwa').ok, false);
  // Solo HTTPS.
  assert.equal((await verificarDemo('http://demo.trycloudflare.com', { peticion: respuestas(SANAS) })).ok, false);
});

test('demo: el build no debe llevar direcciones locales o privadas al celular', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rancho-dist-'));
  await mkdir(join(dir, 'assets'));
  await writeFile(join(dir, 'assets', 'ok.js'), 'fetch("/api/health")');
  await writeFile(join(dir, 'assets', 'mal.js'), 'const API="http://localhost:3000/api"; const LAN="http://192.168.1.20:5173";');
  const hallazgos = await revisarDist(dir);
  assert.deepEqual(hallazgos.map((h) => h.direccion).sort(), ['http://192.168.1.20:5173', 'http://localhost:3000']);
});

test('demo: el launcher integra la opción 4 con túnel propio, verificación y cierre seguro', async () => {
  const [launcher, red, cierre, api] = await Promise.all([
    readFile(new URL('scripts/iniciar-el-rancho.ps1', root), 'utf8'),
    readFile(new URL('scripts/el-rancho-red.psm1', root), 'utf8'),
    readFile(new URL('scripts/cerrar-el-rancho.ps1', root), 'utf8'),
    readFile(new URL('frontend/src/api.js', root), 'utf8'),
  ]);
  assert.match(launcher, /'4' \{ \$Mode = 'Demo' \}/);
  assert.match(launcher, /\[4\] Demo publica por Internet/);
  // Un solo enlace: preview de producción con el proxy /api existente y Host reescrito por cloudflared.
  assert.match(launcher, /'--url', "http:\/\/127\.0\.0\.1:\$puertoDemo", '--http-host-header', "127\.0\.0\.1:\$puertoDemo"/);
  assert.match(launcher, /npm run preview/);
  assert.match(launcher, /npm run certify:pwa/);
  // Se verifica la URL pública antes de anunciar "DEMO LISTA".
  const verificacion = launcher.indexOf("scripts/demo-publica.mjs verificar $url");
  assert.ok(verificacion > 0 && verificacion < launcher.indexOf("Write-Header 'DEMO LISTA'"));
  assert.match(launcher, /Show-QrCelular \$urlPublica \$qrDemoPath/);
  // Mensajes claros.
  for (const mensaje of ['Backend no pudo iniciar', 'Puerto ocupado por otro proceso', 'Cloudflared no esta instalado', 'No fue posible obtener URL publica']) {
    assert.ok(launcher.includes(mensaje), mensaje);
  }
  // Cierre: solo procesos propios (PID verificado) y el túnel también lo cierra EL RANCHO - CERRAR.bat.
  assert.match(launcher, /Stop-OwnedProcess \$owned\.tunel/);
  assert.match(launcher, /marker = 'EL_RANCHO_CLOUDFLARED'/);
  assert.match(cierre, /Stop-MarkedTree \$state\.tunel 'Tunel Cloudflare \(demo publica\)' 'EL_RANCHO_CLOUDFLARED'/);
  assert.match(red, /function Test-CloudflaredDeElRancho/);
  for (const texto of [launcher, red, cierre]) assert.doesNotMatch(texto, /taskkill(?:\.exe)?\s+(?:\/F\s+)?\/IM/i);
  // Nada de exponer PostgreSQL ni CORS abierto; el cliente usa rutas relativas.
  assert.doesNotMatch(launcher, /5432|Access-Control-Allow-Origin|New-NetFirewallRule.*4173/);
  assert.match(api, /const ORIGIN = '';/);
  assert.match(api, /const BASE_URL = '\/api';/);
  assert.equal(launcher.charCodeAt(0), 0xfeff);
  assert.equal(red.charCodeAt(0), 0xfeff);
});

test('demo: la base interna "http://localhost" de React Router no es un falso positivo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'rancho-dist-'));
  await writeFile(join(dir, 'router.js'), 'let r=`http://localhost`;e&&(r=e.location.origin)');
  assert.deepEqual(await revisarDist(dir), []);
});
