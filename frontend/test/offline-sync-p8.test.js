import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  _cerrarConexionParaPruebas, CAMPO_DB_NOMBRE, listarConflictosLocal, listarOperacionesLocal, listarHistorialSincronizacionLocal,
} from '../src/offline/campoDB.js';
import {
  _reiniciarSincronizacionParaPruebas, aplicarJitter, claveBloqueoOperacion, construirOperacion, descartarOperacion,
  encolarOperacion, ESTADO_SYNC, obtenerEstadoCola, sincronizarOperacionesPendientes, TIPO_OPERACION,
} from '../src/offline/colaOperaciones.js';
import { describirConflicto, estadoGeneralSincronizacion } from '../src/offline/syncUx.js';

const valoresLocales = new Map();
globalThis.localStorage = {
  getItem: (clave) => valoresLocales.get(clave) ?? null,
  setItem: (clave, valor) => valoresLocales.set(clave, String(valor)),
  removeItem: (clave) => valoresLocales.delete(clave),
};

const usuario = { id: 7, rol: 'Trabajador', nombre: 'Campo' };
let reloj = Date.parse('2026-09-24T12:00:00.000Z');
const siguienteFecha = () => new Date((reloj += 1000));
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function baseLimpia() {
  _reiniciarSincronizacionParaPruebas();
  valoresLocales.clear();
  await _cerrarConexionParaPruebas();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CAMPO_DB_NOMBRE);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = resolve;
  });
}

function mover(n, animalId, extra = {}) {
  return construirOperacion({
    usuario, id: uuid(n), tipo: TIPO_OPERACION.MOVIMIENTO, entidadId: animalId, ahora: siguienteFecha(),
    payload: { corral_id: 4, corral_origen_id: 3, expected_version: 5, estado_observado: 'vivo' }, ...extra,
  });
}

function pesar(n, animalId, extra = {}) {
  return construirOperacion({
    usuario, id: uuid(n), tipo: TIPO_OPERACION.PESAJE, entidadId: animalId, ahora: siguienteFecha(),
    payload: { animal_id: animalId, fecha: '2026-09-24', peso_kg: 400 + n }, ...extra,
  });
}

const conflicto409 = (code = 'ANIMAL_VERSION_CONFLICT') => Object.assign(new Error('conflicto'), { status: 409, code });

test('estados locales tienen equivalente explícito en el contrato P8', () => {
  assert.deepEqual(ESTADO_SYNC, {
    pendiente: 'pending', bloqueada: 'pending', sincronizando: 'syncing', sincronizada: 'synced', conflicto: 'conflict', error: 'failed',
  });
});

test('un conflicto bloquea solo los cambios posteriores del mismo registro', async () => {
  await baseLimpia();
  await encolarOperacion(mover(1, 10));
  await encolarOperacion(mover(2, 10)); // mismo animal: depende de la ubicación anterior
  await encolarOperacion(pesar(3, 10)); // append-only del mismo animal: no se bloquea
  await encolarOperacion(mover(4, 11)); // otro animal
  const enviadas = [];
  await sincronizarOperacionesPendientes(usuario, {
    enviar: async (operacion) => {
      enviadas.push(operacion.id);
      if (operacion.id === uuid(1)) throw conflicto409();
    },
  });
  assert.deepEqual(enviadas, [uuid(1), uuid(3), uuid(4)], 'el segundo movimiento del animal 10 no se envía');
  const cola = await listarOperacionesLocal(usuario.id);
  assert.deepEqual(cola.map((fila) => [fila.id, fila.estado]), [[uuid(2), 'bloqueada']]);
  assert.equal(cola[0].ultimo_error.code, 'BLOQUEADA_POR_CAMBIO_ANTERIOR');
  const estado = await obtenerEstadoCola(usuario.id);
  assert.equal(estado.bloqueadas, 1);
  assert.equal(estado.pendientes, 0);
  assert.equal(estado.conflictos.length, 1);

  // Resolver el conflicto (descartar) libera la captura bloqueada en la siguiente ronda.
  await descartarOperacion(uuid(1), usuario.id, { conflicto: true });
  enviadas.length = 0;
  await sincronizarOperacionesPendientes(usuario, { enviar: async (operacion) => { enviadas.push(operacion.id); } });
  assert.deepEqual(enviadas, [uuid(2)]);
  assert.equal((await listarOperacionesLocal(usuario.id)).length, 0);
});

test('una dependencia explícita en conflicto bloquea a sus dependientes, incluso transitivos', async () => {
  await baseLimpia();
  const servicio = pesar(1, 20);
  const diagnostico = pesar(2, 21, { dependeDe: [uuid(1)] });
  const parto = pesar(3, 22, { dependeDe: [uuid(2)] });
  for (const operacion of [servicio, diagnostico, parto]) await encolarOperacion(operacion);
  const enviadas = [];
  await sincronizarOperacionesPendientes(usuario, {
    enviar: async (operacion) => {
      enviadas.push(operacion.id);
      throw conflicto409('CICLO_CAMBIADO');
    },
  });
  assert.deepEqual(enviadas, [uuid(1)]);
  assert.deepEqual((await listarOperacionesLocal(usuario.id)).map((fila) => fila.estado), ['bloqueada', 'bloqueada']);
});

test('dependencias confirmadas se envían en orden dentro de la misma ronda', async () => {
  await baseLimpia();
  await encolarOperacion(pesar(1, 30));
  await encolarOperacion(pesar(2, 30, { dependeDe: [uuid(1)] }));
  const enviadas = [];
  await sincronizarOperacionesPendientes(usuario, { enviar: async (operacion) => { enviadas.push(operacion.id); } });
  assert.deepEqual(enviadas, [uuid(1), uuid(2)]);
  assert.equal((await listarHistorialSincronizacionLocal(usuario.id)).length, 2);
});

test('dependencias inválidas o circulares no se pueden capturar', () => {
  assert.throws(() => pesar(1, 1, { dependeDe: ['no-uuid'] }), /dependencias/);
  assert.throws(() => pesar(1, 1, { dependeDe: [uuid(1)] }), /dependencias/, 'no puede depender de sí misma');
  assert.throws(() => pesar(1, 1, { dependeDe: Array.from({ length: 11 }, (_, i) => uuid(100 + i)) }), /dependencias/);
  assert.deepEqual(pesar(2, 1, { dependeDe: [uuid(1).toUpperCase(), uuid(1)] }).depende_de, [uuid(1)]);
});

test('corte de red a mitad de la ronda conserva el orden y no reenvía lo confirmado', async () => {
  await baseLimpia();
  for (const n of [1, 2, 3]) await encolarOperacion(pesar(n, 40));
  const enviadas = [];
  await sincronizarOperacionesPendientes(usuario, {
    enviar: async (operacion) => {
      enviadas.push(operacion.id);
      // api.js traduce el fallo de transporte a code NETWORK_ERROR.
      if (operacion.id === uuid(2)) throw Object.assign(new Error('sin red'), { code: 'NETWORK_ERROR' });
    },
  });
  assert.deepEqual(enviadas, [uuid(1), uuid(2)], 'se detiene en el corte');
  const cola = await listarOperacionesLocal(usuario.id);
  assert.deepEqual(cola.map((fila) => [fila.id, fila.estado]), [[uuid(2), 'pendiente'], [uuid(3), 'pendiente']]);

  // Cierre y reapertura de la PWA: la cola sigue en IndexedDB.
  await _cerrarConexionParaPruebas();
  _reiniciarSincronizacionParaPruebas();
  enviadas.length = 0;
  await sincronizarOperacionesPendientes(usuario, { enviar: async (operacion) => { enviadas.push(operacion.id); } });
  assert.deepEqual(enviadas, [uuid(2), uuid(3)]);
});

test('un permiso revocado se explica como permiso, no como datos cambiados', async () => {
  await baseLimpia();
  await encolarOperacion(mover(1, 50));
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw Object.assign(new Error('prohibido'), { status: 403, code: 'FORBIDDEN' }); } });
  const [registro] = await listarConflictosLocal(usuario.id);
  assert.equal(registro.conflicto.tipo, 'permiso');
  assert.match(registro.conflicto.message, /rol ya no permite/);
  assert.match(describirConflicto(registro).cambio, /permisos cambiaron/);
});

test('una sesión expirada (401) detiene la ronda sin mover nada a conflicto', async () => {
  await baseLimpia();
  await encolarOperacion(pesar(1, 60));
  await encolarOperacion(pesar(2, 60));
  const enviadas = [];
  await sincronizarOperacionesPendientes(usuario, { enviar: async (operacion) => { enviadas.push(operacion.id); throw Object.assign(new Error('expirada'), { status: 401 }); } });
  assert.deepEqual(enviadas, [uuid(1)]);
  assert.equal((await listarConflictosLocal(usuario.id)).length, 0);
  assert.deepEqual((await listarOperacionesLocal(usuario.id)).map((fila) => fila.estado), ['pendiente', 'pendiente']);
});

test('cientos de capturas se envían de una en una, nunca en paralelo', async () => {
  await baseLimpia();
  for (let n = 1; n <= 60; n += 1) await encolarOperacion(pesar(n, 70 + (n % 5)));
  let enVuelo = 0;
  let maximo = 0;
  await sincronizarOperacionesPendientes(usuario, {
    enviar: async () => {
      enVuelo += 1; maximo = Math.max(maximo, enVuelo);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      enVuelo -= 1;
    },
  });
  assert.equal(maximo, 1);
  assert.equal((await listarOperacionesLocal(usuario.id)).length, 0);
});

test('jitter acota el retraso a ±20 % y la clave de bloqueo solo aplica a operaciones con estado', () => {
  assert.equal(aplicarJitter(10000, 0), 8000);
  assert.equal(aplicarJitter(10000, 1), 12000);
  assert.equal(aplicarJitter(10000, 0.5), 10000);
  assert.equal(claveBloqueoOperacion({ tipo: TIPO_OPERACION.MOVIMIENTO, entidad_id: 5 }), 'animal:5:ubicacion');
  assert.equal(claveBloqueoOperacion({ tipo: TIPO_OPERACION.COMPLETAR_TAREA, entidad_id: 8 }), 'tarea:8');
  assert.equal(claveBloqueoOperacion({ tipo: TIPO_OPERACION.ALIMENTACION, payload: { insumo_id: 3 } }), 'insumo:3');
  assert.equal(claveBloqueoOperacion({ tipo: TIPO_OPERACION.PESAJE, entidad_id: 5 }), null);
  assert.equal(claveBloqueoOperacion({ tipo: TIPO_OPERACION.PESAJE, clave_bloqueo: 'ciclo:9' }), 'ciclo:9');
});

test('el resumen avisa de cambios en espera sin llenar la pantalla', () => {
  const resumen = estadoGeneralSincronizacion({ conectividad: 'online', autenticacion: 'authenticated_online', estado: { bloqueadas: 2, pendientes: 0, conflictos: [] } });
  assert.equal(resumen.clave, 'bloqueada');
  assert.equal(resumen.titulo, '2 cambios en espera de revisión');
});
