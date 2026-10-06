import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import 'fake-indexeddb/auto';
import {
  ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, ALMACEN_INSUMOS, CAMPO_DB_NOMBRE,
  _cerrarConexionParaPruebas, guardarBootstrapLocal, leerColeccionLocal, leerSesionLocal,
} from '../src/offline/campoDB.js';
import { construirBootstrapLocal } from '../src/offline/bootstrapSync.js';
import { puedeArrancarOffline } from '../src/offline/sessionWindow.js';
import {
  CONECTIVIDAD_OFFLINE, CONECTIVIDAD_ONLINE, _reiniciarConectividadParaPruebas,
  comprobarConectividadReal,
} from '../src/offline/connectivity.js';

function jwt(usuarioId, expiraEn) {
  const base64url = (valor) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  return `${base64url({ alg: 'HS256' })}.${base64url({ id: usuarioId, exp: Math.floor(new Date(expiraEn).getTime() / 1000) })}.firma`;
}

function bootstrap({ tareaVersion = 1, timestamp = '2026-09-01T10:00:00.000Z' } = {}) {
  return {
    schema: 'offline-bootstrap.v3', server_timestamp: timestamp,
    partition: { usuario_id: 'usuario-campo', sesion_version: 2 },
    usuario: { id: 'usuario-campo', nombre: 'César', email: 'campo@rancho.com', rol: 'Trabajador', sesion_version: 2, trabajador: { id: 4, nombre: 'César' } },
    animales: [{ id: 10, arete_id: 'MX-10', estado: 'vivo', corral_actual_id: 3, version: 5 }],
    corrales: [{ id: 3, nombre: 'Norte', capacidad_maxima: 20, ocupacion_actual: 1, saludables: 1, en_observacion: 0, enfermos: 0, activo: true }],
    tareas: [{ id: 9, titulo: 'Revisar bebedero', estado: 'pendiente', prioridad: 'media', version: tareaVersion, corrales: [{ id: 3, nombre: 'Norte' }] }],
    insumos: [{ id: 6, nombre: 'Forraje', unidad_medida: 'kg', stock_actual: 100, fecha_caducidad: null, version: tareaVersion, estado: 'disponible' }],
  };
}

async function borrarBase() {
  await _cerrarConexionParaPruebas();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CAMPO_DB_NOMBRE);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = resolve;
  });
}

test('flujo online → bootstrap → corte → recarga local → recuperación → snapshot nuevo', async () => {
  await borrarBase();
  const token = jwt('usuario-campo', '2026-09-01T18:00:00.000Z');
  const primero = construirBootstrapLocal(bootstrap(), { id: 'usuario-campo' }, { token, instalacionId: 'tablet-1' });
  await guardarBootstrapLocal(primero.usuarioId, primero.contenido);

  _reiniciarConectividadParaPruebas();
  const fetchOriginal = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError('red desconectada'); };
    assert.equal(await comprobarConectividadReal(), CONECTIVIDAD_OFFLINE);

    // Equivale a una recarga: la identidad se reconstruye desde el JWT y
    // el snapshot; las tres vistas permitidas leen solo su partición.
    const sesion = await leerSesionLocal('usuario-campo');
    assert.equal(puedeArrancarOffline({ snapshot: sesion, usuarioIdLocal: 'usuario-campo', ahora: new Date('2026-09-01T12:00:00.000Z') }), true);
    assert.equal((await leerColeccionLocal(ALMACEN_ANIMALES, 'usuario-campo')).datos[0].arete_id, 'MX-10');
    assert.equal((await leerColeccionLocal(ALMACEN_ANIMALES, 'usuario-campo')).datos[0].version, 5);
    assert.equal((await leerColeccionLocal(ALMACEN_CORRALES, 'usuario-campo')).datos[0].nombre, 'Norte');
    assert.equal((await leerColeccionLocal(ALMACEN_CORRALES, 'usuario-campo')).datos[0].activo, true);
    assert.equal((await leerColeccionLocal(ALMACEN_TAREAS, 'usuario-campo')).datos[0].version, 1);
    assert.equal((await leerColeccionLocal(ALMACEN_INSUMOS, 'usuario-campo')).datos[0].stock_actual, 100);

    globalThis.fetch = async () => ({ ok: true });
    assert.equal(await comprobarConectividadReal(), CONECTIVIDAD_ONLINE);
    const segundo = construirBootstrapLocal(bootstrap({ tareaVersion: 2, timestamp: '2026-09-01T12:10:00.000Z' }), { id: 'usuario-campo' }, { token, instalacionId: 'tablet-1' });
    await guardarBootstrapLocal(segundo.usuarioId, segundo.contenido);
    assert.equal((await leerColeccionLocal(ALMACEN_TAREAS, 'usuario-campo')).datos[0].version, 2);
    assert.equal((await leerColeccionLocal(ALMACEN_INSUMOS, 'usuario-campo')).datos[0].version, 2);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
});

test('la interfaz limita lectura offline y habilita las seis capturas seguras', async () => {
  const [app, animales, corrales, tareas, resumenOffline, alimentacion, movimiento, capturaRapida, seguimiento, flujoAccion, estilos] = await Promise.all([
    readFile(new URL('../src/App.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/AnimalesList.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/CorralesList.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/TareasList.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/ResumenOffline.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/RegistrarAlimentacionModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MoverAnimalModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/CapturaRapidaModal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/SeguimientoAnimal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/FlujoAccionAnimal.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles.css', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /soporteOfflineVista/);
  assert.match(app, /SeguimientoAnimalOffline/);
  assert.match(app, /CapturaModuloOffline modulo="alimentacion"/);
  assert.match(app, /CapturaModuloOffline modulo="movimientos"/);
  assert.match(animales, /No hay una copia local de Animales/);
  assert.match(corrales, /No hay una copia local de Corrales/);
  assert.match(tareas, /No hay una copia local de Tareas/);
  assert.match(resumenOffline, /setDatos\(null\)/);
  assert.match(animales, /disabled=\{sinConexion\}/);
  assert.match(corrales, /disabled=\{sinConexion\}/);
  assert.match(tareas, /Puedes guardar la finalización ahora/);
  assert.match(animales, /ACCIONES_OFFLINE/);
  assert.match(capturaRapida, /ACCIONES_CAMPO\.ALIMENTACION/);
  assert.match(capturaRapida, /ACCIONES_CAMPO\.MOVER/);
  // P8.3: el texto del stock sale de textoStockOffline (Stock según última
  // sincronización · N pendientes) y aclara que se revalida al sincronizar.
  assert.match(alimentacion, /textoStockOffline\(insumoSeleccionado/);
  assert.match(alimentacion, /al sincronizar se aplica solo si todavía alcanza/);
  assert.match(alimentacion, /Guardar para sincronizar/);
  assert.match(alimentacion, /TIPO_OPERACION\.ALIMENTACION/);
  assert.match(movimiento, /Ubicación sincronizada:/);
  assert.match(movimiento, /La ubicación y capacidad se validarán nuevamente al recuperar conexión/);
  assert.match(movimiento, /Guardar para sincronizar/);
  assert.match(movimiento, /TIPO_OPERACION\.MOVIMIENTO/);
  assert.match(seguimiento, /onCreado=\{cerrarAlimentacion\}/);
  assert.match(seguimiento, /onCreado=\{cerrarMovimiento\}/);
  assert.match(seguimiento, /resultado\?\.offline_pending/);
  assert.match(seguimiento, /titulo: 'Guardado en este dispositivo'/);
  assert.match(seguimiento, /mensaje: 'Pendiente de sincronización\.'/);
  assert.match(flujoAccion, /Guardado en este dispositivo\. Pendiente de sincronización\./);
  assert.match(app, /capturaRapida\.abierta/);
  assert.match(estilos, /sync-operation-actions \.btn \{ flex: 1 1 auto; min-height: 44px; \}/);
  assert.match(estilos, /sync-panel-modal \{ max-height: calc\(100dvh - 12px\); overflow-x: hidden; \}/);
  assert.doesNotMatch(estilos, /min-width:\s*(?:[4-9]\d\d|\d{4,})px[^}]*offline/i);
});
