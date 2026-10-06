import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { isAllowedPrecachePath, renderServiceWorker } from '../scripts/pwa-service-worker.mjs';
import { MENSAJE_OFFLINE } from '../src/pwa.js';
import { hayFormularioSucio, registrarFormularioSucio } from '../src/appLifecycle.js';
import { crearRutaContextual } from '../src/navigationContext.js';
import {
  ESTADO_PANEL_SYNC_INICIAL, ejecutarSincronizacionIndependiente, reducirEstadoPanelSync,
} from '../src/offline/syncPanelUi.js';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const leer = (ruta) => readFile(path.join(DIR, '..', ruta), 'utf8');

test('manifest instala El Rancho en standalone con iconos locales suficientes', async () => {
  const manifest = JSON.parse(await leer('public/manifest.webmanifest'));
  assert.equal(manifest.name, 'El Rancho — Gestión Ganadera');
  assert.equal(manifest.short_name, 'El Rancho');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, '/');
  assert.ok(manifest.icons.some((icon) => icon.sizes === '192x192' && icon.src.startsWith('/icons/')));
  assert.ok(manifest.icons.some((icon) => icon.sizes === '512x512' && icon.purpose.includes('maskable')));
  assert.doesNotMatch(await leer('index.html'), /https?:\/\//);
});

test('registro del service worker es exclusivo de producción y contexto seguro', async () => {
  const source = await leer('src/pwa.js');
  assert.match(source, /navigator\.serviceWorker\.register\('\/sw\.js'/);
  assert.match(source, /updateViaCache: 'none'/);
  assert.match(source, /localhost.*127\.0\.0\.1.*\[::1\]/s);
  assert.match(source, /!produccion/);
});

test('precaché admite solo shell, assets versionados e iconos', () => {
  ['/index.html', '/manifest.webmanifest', '/assets/index-ABC.js', '/assets/index-ABC.css', '/icons/el-rancho-192.png'].forEach((pathName) => assert.equal(isAllowedPrecachePath(pathName), true));
  ['/sw.js', '/bundle-analysis.json', '/foto.jpg', 'https://example.com/x.js'].forEach((pathName) => assert.equal(isAllowedPrecachePath(pathName), false));
});

test('service worker excluye API, uploads, Authorization y datos privados', () => {
  const worker = renderServiceWorker({
    version: 'prueba',
    resources: ['/index.html', '/assets/app-1.js', '/api/animales', '/uploads/animal.jpg'],
  });
  assert.match(worker, /const BLOCKED_PATHS = \["\/api","\/uploads"\]/);
  assert.match(worker, /request\.headers\.has\('authorization'\)/);
  assert.doesNotMatch(worker, /"\/api\/animales"/);
  assert.doesNotMatch(worker, /"\/uploads\/animal\.jpg"/);
  assert.doesNotMatch(worker, /cache\.put/);
});

test('el cliente API evita también el cache HTTP para respuestas autenticadas', async () => {
  const api = await leer('src/api.js');
  assert.match(api, /cache: 'no-store'/);
  assert.match(api, /Authorization: `Bearer \$\{token\}`/);
});

test('offline y recuperación de conexión tienen estado accesible y mensaje explícito', async () => {
  const component = await leer('src/components/EstadoPwa.jsx');
  const conectividad = await leer('src/offline/connectivity.js');
  assert.equal(MENSAJE_OFFLINE, 'Sin conexión. Esta información necesita Internet.');
  // Offline v1 Fase B §7: la detección real de conectividad (eventos del
  // navegador + comprobación contra /api/health) vive en
  // src/offline/connectivity.js, no directamente en el componente.
  assert.match(conectividad, /addEventListener\('offline'/);
  assert.match(conectividad, /addEventListener\('online'/);
  assert.match(component, /suscribirConectividad/);
  assert.match(component, /role="status"/);
  assert.match(component, /Conexión recuperada/);
  assert.doesNotMatch(component, /Instalar El Rancho|beforeinstallprompt|pwa-install-action/);
});

test('el acceso a sincronización deja de ser flotante y vive en Configuración', async () => {
  const estadoPwa = await leer('src/components/EstadoPwa.jsx');
  const configuracion = await leer('src/components/ConfiguracionPanel.jsx');
  const perfil = await leer('src/components/Perfil.jsx');
  const estilos = await leer('src/styles.css');
  assert.doesNotMatch(estadoPwa, /PanelSincronizacion|pwa-sync-status|panelAbierto/);
  assert.match(configuracion, /Sincronización y modo offline/);
  assert.match(configuracion, /\/configuracion\/sincronizacion/);
  assert.match(perfil, /\/configuracion\/sincronizacion/);
  assert.doesNotMatch(estilos, /\.pwa-sync-status/);
  assert.match(estilos, /@media \(max-width: 640px\)[\s\S]*\.sync-panel-modal \{ max-height: calc\(100dvh - 12px\); overflow-x: hidden; \}/);
  assert.match(estilos, /\.sync-settings-actions \{ display: grid; grid-template-columns: 1fr; \}/);
});

test('el panel abre, cierra, reabre y no atrapa una sincronización en curso', async () => {
  let estado = ESTADO_PANEL_SYNC_INICIAL;
  const despachar = (accion) => { estado = reducirEstadoPanelSync(estado, accion); };
  let terminar;
  let finalizada = false;
  const proceso = ejecutarSincronizacionIndependiente(
    () => new Promise((resolve) => { terminar = () => { finalizada = true; resolve(); }; }),
    despachar,
  );
  assert.equal(estado.sincronizando, true);
  despachar({ type: 'abrir' });
  assert.equal(estado.abierto, true);
  despachar({ type: 'cerrar' });
  assert.deepEqual(estado, { abierto: false, sincronizando: true });
  assert.equal(finalizada, false);
  despachar({ type: 'abrir' });
  assert.deepEqual(estado, { abierto: true, sincronizando: true });
  despachar({ type: 'cerrar' });
  terminar();
  await proceso;
  assert.deepEqual(estado, { abierto: false, sincronizando: false });
  assert.equal(finalizada, true);
});

test('el modal conserva cierre por botón, backdrop y Escape sin bloquearse por sincronización', async () => {
  const modal = await leer('src/components/ModalAccesible.jsx');
  const panel = await leer('src/components/PanelSincronizacion.jsx');
  assert.match(modal, /evento\.key === 'Escape'/);
  assert.match(modal, /evento\.target === evento\.currentTarget/);
  assert.match(panel, /data-modal-cerrar/);
  assert.match(panel, /onCerrar=\{onCerrar\}/);
  assert.doesNotMatch(panel, /ocupado=\{sincronizando\}/);
});

test('actualización espera confirmación y respeta formularios sucios', async () => {
  const liberar = registrarFormularioSucio();
  assert.equal(hayFormularioSucio(), true);
  liberar();
  assert.equal(hayFormularioSucio(), false);
  const pwa = await leer('src/pwa.js');
  const component = await leer('src/components/EstadoPwa.jsx');
  assert.match(pwa, /registro\.waiting\.postMessage\(\{ tipo: 'ACTIVAR_VERSION' \}\)/);
  assert.match(pwa, /hayFormularioSucio\(\)/);
  assert.match(component, /Actualizar aplicación/);
  assert.match(component, /disabled=\{formularioSucio\}/);
  assert.match(component, /registroActivo\?\.update\(\)/);
});

test('activación elimina caches del shell obsoletos y privados heredados', () => {
  const worker = renderServiceWorker({ version: 'actual', resources: ['/index.html'] });
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\) && key !== CACHE_NAME/);
  assert.match(worker, /PRIVATE_CACHE_PREFIXES/);
  assert.match(worker, /caches\.delete\(key\)/);
  assert.match(worker, /LIMPIAR_CACHES_PRIVADOS/);
});

test('navegación offline conserva fallback SPA y los query params contextuales', () => {
  const worker = renderServiceWorker({ version: 'actual', resources: ['/index.html'] });
  assert.match(worker, /request\.mode === 'navigate'/);
  assert.match(worker, /cache\.match\('\/index\.html'\)/);
  assert.equal(crearRutaContextual('/animales/42/seguimiento', { seccion: 'salud', corral: 3 }), '/animales/42/seguimiento?seccion=salud&corral=3');
});
