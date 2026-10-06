import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import 'fake-indexeddb/auto';
import { generarUUID } from '../src/offline/uuid.js';
import { decidirSinServidor, puedeArrancarOffline } from '../src/offline/sessionWindow.js';
import { construirBootstrapLocal } from '../src/offline/bootstrapSync.js';
import {
  _cerrarConexionParaPruebas, CAMPO_DB_NOMBRE, guardarBootstrapLocal, leerSesionLocal, limpiarSnapshotUsuarioLocal, listarOperacionesLocal,
} from '../src/offline/campoDB.js';
import { _reiniciarSincronizacionParaPruebas, capturarConSoporteOffline, sincronizarOperacionesPendientes, TIPO_OPERACION } from '../src/offline/colaOperaciones.js';
import { renderServiceWorker } from '../scripts/pwa-service-worker.mjs';
import { diagnosticoAperturaOffline } from '../src/pwa.js';

const almacenamiento = new Map();
globalThis.localStorage = {
  getItem: (clave) => almacenamiento.get(clave) ?? null,
  setItem: (clave, valor) => almacenamiento.set(clave, String(valor)),
  removeItem: (clave) => almacenamiento.delete(clave),
};
globalThis.window ??= { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.CustomEvent ??= class CustomEvent { constructor(tipo, init) { this.type = tipo; this.detail = init?.detail; } };

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const USUARIO = { id: 7, rol: 'Trabajador', nombre: 'Campo', email: 'campo@rancho.test' };

function tokenPara(usuarioId, expSegundos) {
  const base64url = (valor) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  return `${base64url({ alg: 'HS256' })}.${base64url({ id: usuarioId, exp: expSegundos })}.firma`;
}

async function borrarBase() {
  _reiniciarSincronizacionParaPruebas();
  almacenamiento.clear();
  await _cerrarConexionParaPruebas();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CAMPO_DB_NOMBRE);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = resolve;
  });
}

// Simula http://IP de la red local: sin crypto.randomUUID (solo contextos seguros).
async function sinContextoSeguro(fn) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const reducido = { getRandomValues: (arreglo) => globalThis.__cryptoReal.getRandomValues(arreglo) };
  globalThis.__cryptoReal = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', { value: reducido, configurable: true, writable: true });
  try { return await fn(); } finally { Object.defineProperty(globalThis, 'crypto', original); }
}

function bootstrap(serverTimestamp) {
  return {
    schema: 'offline-bootstrap.v5', snapshot_version: 5, server_timestamp: serverTimestamp, generado_en: serverTimestamp,
    partition: { usuario_id: USUARIO.id, sesion_version: 1 },
    usuario: { ...USUARIO, sesion_version: 1, trabajador: null },
    animales: [{ id: 10, arete_id: 'MX-10', estado: 'vivo', version: 1 }], corrales: [], tareas: [], insumos: [], insumos_sanitarios: [],
  };
}

test('causa raíz: sin contexto seguro (http://IP) igual se generan UUID v4 y se prepara la sesión offline', async () => {
  await borrarBase();
  await sinContextoSeguro(async () => {
    assert.equal(typeof globalThis.crypto.randomUUID, 'undefined');
    const ids = new Set(Array.from({ length: 200 }, () => generarUUID()));
    assert.equal(ids.size, 200);
    for (const id of ids) assert.match(id, UUID_V4);
    // Antes esto lanzaba y el snapshot nunca se guardaba (se perdía en un console.warn).
    const preparado = construirBootstrapLocal(bootstrap('2026-09-24T12:00:00.000Z'), USUARIO, { token: tokenPara(USUARIO.id, 2000000000) });
    await guardarBootstrapLocal(preparado.usuarioId, preparado.contenido);
    assert.match(localStorage.getItem('el_rancho_instalacion_id'), UUID_V4);
    // Y la cola también puede crear capturas.
    const r = await capturarConSoporteOffline({ usuario: USUARIO, sinConexion: true, tipo: TIPO_OPERACION.PESAJE, entidadId: 10, payload: { animal_id: 10, fecha: '2026-09-24', peso_kg: 400 }, ejecutarOnline: () => assert.fail() });
    assert.match(r.operacion.id, UUID_V4);
  });
  const sesion = await leerSesionLocal(USUARIO.id);
  assert.equal(sesion.ventana_offline_expira_en, '2026-09-27T12:00:00.000Z', '72 h desde la validación online');
});

test('login válido → snapshot → NETWORK_ERROR: mantiene la sesión local (no va a login)', () => {
  const sesionLocal = { usuario_id: 7, ultima_validacion_online: '2026-09-24T12:00:00.000Z', ventana_offline_expira_en: '2026-09-27T12:00:00.000Z' };
  assert.equal(decidirSinServidor({ esFalloRed: true, sesionLocal, usuarioIdLocal: 7, ahora: new Date('2026-09-24T13:00:00Z') }), 'offline');
});

test('login válido → cerrar app → abrir sin red: entra con el último snapshot', async () => {
  await borrarBase();
  const preparado = construirBootstrapLocal(bootstrap('2026-09-24T12:00:00.000Z'), USUARIO, { token: tokenPara(USUARIO.id, 2000000000), instalacionId: generarUUID() });
  await guardarBootstrapLocal(preparado.usuarioId, preparado.contenido);
  await _cerrarConexionParaPruebas(); // cierre completo de la PWA
  const sesionLocal = await leerSesionLocal(USUARIO.id);
  assert.equal(decidirSinServidor({ esFalloRed: true, sesionLocal, usuarioIdLocal: USUARIO.id, ahora: new Date('2026-09-25T08:00:00Z') }), 'offline');
});

test('sin login previo → abrir sin red: pide conexión (no inventa una sesión)', () => {
  assert.equal(decidirSinServidor({ esFalloRed: true, sesionLocal: null, usuarioIdLocal: null }), 'sin_datos');
  assert.equal(decidirSinServidor({ esFalloRed: true, sesionLocal: null, usuarioIdLocal: 7 }), 'sin_datos');
});

test('401/403 real del servidor nunca se trata como falta de red', () => {
  const sesionLocal = { usuario_id: 7, ultima_validacion_online: '2026-09-24T12:00:00.000Z', ventana_offline_expira_en: '2026-09-27T12:00:00.000Z' };
  assert.equal(decidirSinServidor({ status: 401, esFalloRed: false, sesionLocal, usuarioIdLocal: 7 }), 'sesion_invalida');
  assert.equal(decidirSinServidor({ status: 403, esFalloRed: false, sesionLocal, usuarioIdLocal: 7 }), 'sesion_invalida');
  assert.equal(decidirSinServidor({ status: 500, esFalloRed: false, sesionLocal, usuarioIdLocal: 7 }), 'error_servidor');
});

test('JWT vencido offline: conserva datos y cola dentro de las 72 h; después exige conexión', () => {
  const sesionLocal = { usuario_id: 7, ultima_validacion_online: '2026-09-24T12:00:00.000Z', jwt_expira_en: '2026-09-24T20:00:00.000Z', ventana_offline_expira_en: '2026-09-27T12:00:00.000Z' };
  assert.equal(decidirSinServidor({ esFalloRed: true, sesionLocal, usuarioIdLocal: 7, ahora: new Date('2026-09-26T09:00:00Z') }), 'offline', 'JWT vencido, 45 h después');
  assert.equal(decidirSinServidor({ esFalloRed: true, sesionLocal, usuarioIdLocal: 7, ahora: new Date('2026-09-27T12:00:01Z') }), 'vencida');
  assert.equal(puedeArrancarOffline({ snapshot: sesionLocal, usuarioIdLocal: 8, ahora: new Date('2026-09-25T09:00:00Z') }), false, 'nunca con otra cuenta');
});

test('JWT vencido → reconecta: el servidor exige autenticarse antes de sincronizar y la cola se conserva', async () => {
  await borrarBase();
  const preparado = construirBootstrapLocal(bootstrap('2026-09-24T12:00:00.000Z'), USUARIO, { token: tokenPara(USUARIO.id, 2000000000), instalacionId: generarUUID() });
  await guardarBootstrapLocal(preparado.usuarioId, preparado.contenido);
  await capturarConSoporteOffline({ usuario: USUARIO, sinConexion: true, tipo: TIPO_OPERACION.PESAJE, entidadId: 10, payload: { animal_id: 10, fecha: '2026-09-24', peso_kg: 401 }, ejecutarOnline: () => assert.fail() });
  // /auth/me responde 401 (JWT vencido, usuario desactivado o sesión reemplazada).
  assert.equal(decidirSinServidor({ status: 401 }), 'sesion_invalida');
  await limpiarSnapshotUsuarioLocal(USUARIO.id); // lo que hace AuthContext con preservarOperaciones
  assert.equal(await leerSesionLocal(USUARIO.id), undefined, 'el snapshot legible se retira');
  // Si aun así se intentara enviar, el 401 detiene la ronda sin descartar nada.
  await sincronizarOperacionesPendientes(USUARIO, { enviar: async () => { throw Object.assign(new Error('vencida'), { status: 401 }); } });
  assert.deepEqual((await listarOperacionesLocal(USUARIO.id)).map((o) => o.estado), ['pendiente']);
});

test('Service Worker: sin red abre la app guardada; con red lenta no se queda colgado; /api nunca se cachea', async () => {
  const codigo = renderServiceWorker({ version: 'prueba', resources: ['/index.html', '/assets/app.js'] });
  const oyentes = {};
  const guardados = new Map([['/index.html', 'APP GUARDADA']]);
  let modoRed = 'caida';
  const contexto = {
    self: { addEventListener: (tipo, fn) => { oyentes[tipo] = fn; }, location: { origin: 'https://192.168.137.1:5443' }, clients: { claim: () => Promise.resolve() }, skipWaiting: () => {} },
    caches: { open: async () => ({ match: async (ruta) => guardados.get(ruta), addAll: async () => {} }), keys: async () => [] },
    fetch: () => (modoRed === 'caida' ? Promise.reject(new TypeError('Failed to fetch')) : modoRed === 'colgada' ? new Promise(() => {}) : Promise.resolve('RED')),
    setTimeout: (fn) => { fn(); return 0; },
    URL, Response: { error: () => 'ERROR' }, Promise, Set, console,
  };
  vm.runInNewContext(codigo, contexto);
  const navegar = async () => {
    let respuesta = null;
    oyentes.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://192.168.137.1:5443/animales', headers: { has: () => false } }, respondWith: (p) => { respuesta = p; } });
    return respuesta;
  };
  assert.equal(await navegar(), 'APP GUARDADA', 'sin red');
  modoRed = 'colgada';
  assert.equal(await navegar(), 'APP GUARDADA', 'red que no responde: usa la copia tras el límite');
  modoRed = 'ok';
  const conRed = await navegar();
  assert.ok(conRed === 'RED' || conRed === 'APP GUARDADA');
  let intercepto = false;
  oyentes.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://192.168.137.1:5443/api/animales', headers: { has: () => false } }, respondWith: () => { intercepto = true; } });
  assert.equal(intercepto, false, '/api siempre va a la red (datos privados)');
});

test('diagnóstico de apertura sin conexión: IndexedDB sola no basta', () => {
  assert.equal(diagnosticoAperturaOffline({ seguro: false, soportaSw: false }).clave, 'sin_https');
  assert.equal(diagnosticoAperturaOffline({ seguro: true, soportaSw: true, controlada: false }).clave, 'sin_cache');
  assert.equal(diagnosticoAperturaOffline({ seguro: true, soportaSw: true, controlada: true, instalada: true }).listo, true);
});

test('login sin conexión y logout conservan la regla acordada', async () => {
  const [login, auth] = await Promise.all([
    readFile(new URL('../src/components/Login.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/auth/AuthContext.jsx', import.meta.url), 'utf8'),
  ]);
  assert.match(login, /Conéctate para iniciar sesión por primera vez/);
  assert.doesNotMatch(auth, /localStorage\.setItem\([^)]*password/i, 'nunca guarda contraseñas');
  // Cerrar sesión con pendientes las conserva en la partición de esa cuenta.
  assert.match(auth, /preservarOperaciones: total > 0/);
  assert.match(auth, /Se conservarán en este dispositivo/);
});
