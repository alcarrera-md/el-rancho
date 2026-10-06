import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  _cerrarConexionParaPruebas, ALMACEN_ANIMALES, ALMACEN_INSUMOS, CAMPO_DB_NOMBRE, guardarBootstrapLocal,
  leerColeccionLocal, listarCambiosLocalesAnimal, listarConflictosLocal, listarOperacionesLocal,
} from '../src/offline/campoDB.js';
import {
  _reiniciarSincronizacionParaPruebas, capturarConSoporteOffline, construirOperacion, enviarOperacion,
  sincronizarOperacionesPendientes, TIPO_OPERACION,
} from '../src/offline/colaOperaciones.js';
import { construirBootstrapLocal } from '../src/offline/bootstrapSync.js';
import { alimentacionPendientePorInsumo, construirFichaOffline, textoStockOffline } from '../src/offline/fichaOffline.js';
import { describirConflicto } from '../src/offline/syncUx.js';
import { accionesCampoDisponibles, ACCIONES_CAMPO } from '../src/fieldActions.js';

const almacenamiento = new Map();
globalThis.localStorage = {
  getItem: (clave) => almacenamiento.get(clave) ?? null,
  setItem: (clave, valor) => almacenamiento.set(clave, String(valor)),
  removeItem: (clave) => almacenamiento.delete(clave),
};
globalThis.window ??= { dispatchEvent: () => true, addEventListener: () => {}, removeEventListener: () => {} };
globalThis.CustomEvent ??= class CustomEvent { constructor(tipo, init) { this.type = tipo; this.detail = init?.detail; } };

const VET = { id: 21, rol: 'Veterinario', nombre: 'Vet', email: 'vet@rancho.test' };
const TRAB = { id: 22, rol: 'Trabajador', nombre: 'Trab', email: 'trab@rancho.test' };

function tokenPara(usuarioId) {
  const base64url = (valor) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  return `${base64url({ alg: 'HS256' })}.${base64url({ id: usuarioId, exp: 2000000000 })}.firma`;
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

function bootstrap(usuario, { stock = '120.00', condicion = 3 } = {}) {
  return {
    schema: 'offline-bootstrap.v5', snapshot_version: 5,
    server_timestamp: '2026-09-24T15:30:00.000Z', generado_en: '2026-09-24T15:30:00.000Z',
    partition: { usuario_id: usuario.id, sesion_version: 1 },
    usuario: { ...usuario, sesion_version: 1, trabajador: { id: 5, nombre: 'Campo' } },
    animales: [{ id: 10, arete_id: 'MX-10', estado: 'vivo', version: 2, corral_actual_id: 1, corral_actual: 'Norte', condicion_corporal: condicion, condicion_corporal_fecha: '2026-09-01', eventos_salud_recientes: [], proximas_dosis: [], notas_recientes: [] }],
    corrales: [{ id: 1, nombre: 'Norte', capacidad_maxima: 10, ocupacion_actual: 1 }],
    tareas: [{ id: 30, titulo: 'Revisar bebedero', estado: 'pendiente', version: 4 }],
    insumos: [{ id: 6, nombre: 'Heno', unidad_medida: 'kg', stock_actual: stock, version: 7, estado: 'disponible', activo: true }],
    insumos_sanitarios: [{ id: 8, nombre: 'Rabia', tipo: 'vacuna', unidad_medida: 'dosis', estado: 'disponible', activo: true }],
  };
}

async function sincronizarSnapshot(usuario, opciones) {
  const preparado = construirBootstrapLocal(bootstrap(usuario, opciones), usuario, { token: tokenPara(usuario.id), instalacionId: '00000000-0000-4000-8000-000000000999' });
  await guardarBootstrapLocal(preparado.usuarioId, preparado.contenido);
}

const sinRed = () => assert.fail('sin conexión no debe intentarse el envío');

async function capturar(usuario, tipo, entidadId, payload) {
  return capturarConSoporteOffline({ usuario, sinConexion: true, tipo, entidadId, payload, ejecutarOnline: sinRed });
}

test('P8.3 flujo: capturar salud, condición, tarea y alimentación sin Internet, reabrir, reconectar y confirmar', async () => {
  await borrarBase();
  // 1. Sincronización online (snapshot v5 con catálogo sanitario).
  await sincronizarSnapshot(VET);
  const insumos = await leerColeccionLocal(ALMACEN_INSUMOS, VET.id);
  assert.deepEqual(insumos.sanitarios.map((i) => i.nombre), ['Rabia']);

  // 2-3. Sin Internet: capturas de los cuatro módulos (el Veterinario puede salud y CC;
  // la alimentación y la tarea las captura el Trabajador en su dispositivo).
  await capturar(VET, TIPO_OPERACION.EVENTO_SALUD, 10, { animal_id: 10, tipo: 'vacuna', insumo_id: 8, fecha: '2026-09-24', proxima_dosis: '2026-10-24' });
  await capturar(VET, TIPO_OPERACION.CONDICION_CORPORAL, 10, { animal_id: 10, fecha: '2026-09-24', puntuacion: 4, observacion: 'Mejoró' });
  await sincronizarSnapshot(TRAB);
  await capturar(TRAB, TIPO_OPERACION.COMPLETAR_TAREA, 30, { expected_version: 4 });
  await capturar(TRAB, TIPO_OPERACION.ALIMENTACION, 10, { animal_id: 10, insumo_id: 6, cantidad: 20, fecha: '2026-09-24', unidad_medida: 'kg', expected_version: 7, stock_observado: 120 });

  // 4-6. Cierre completo y reapertura sin Internet: todo sigue pendiente.
  await _cerrarConexionParaPruebas();
  _reiniciarSincronizacionParaPruebas();
  assert.deepEqual((await listarOperacionesLocal(VET.id)).map((o) => [o.tipo, o.estado]), [['evento_salud.crear', 'pendiente'], ['condicion_corporal.crear', 'pendiente']]);
  assert.deepEqual((await listarOperacionesLocal(TRAB.id)).map((o) => o.tipo), ['asignacion_tarea.completar', 'alimentacion.crear']);

  // Ficha: dato del servidor y cambio local por separado.
  const animal = (await leerColeccionLocal(ALMACEN_ANIMALES, VET.id)).datos[0];
  const ficha = construirFichaOffline({ animal, cambios: await listarCambiosLocalesAnimal(VET.id, 10) });
  assert.deepEqual(ficha.condicion_corporal, { puntuacion: 3, fecha: '01/09/2026' });
  assert.deepEqual(ficha.condicion_corporal_pendiente, { puntuacion: 4, fecha: '24/09/2026', estado: 'pendiente de sincronizar' });
  assert.match(ficha.cambios_locales[0].texto, /Evento sanitario: vacuna \(24\/09\/2026\) · próxima 24\/10\/2026/);

  // Alimentación: stock del snapshot intacto + consumo pendiente informado aparte.
  const insumoTrab = (await leerColeccionLocal(ALMACEN_INSUMOS, TRAB.id)).datos[0];
  const pendientes = alimentacionPendientePorInsumo(await listarOperacionesLocal(TRAB.id));
  assert.equal(insumoTrab.stock_actual, '120.00');
  assert.equal(textoStockOffline(insumoTrab, pendientes.get('6')), 'Stock según última sincronización: 120 kg · 20 kg pendientes de sincronización');

  // 7-8. Reconexión: la cola se envía en orden.
  const enviadas = [];
  await sincronizarOperacionesPendientes(VET, { enviar: async (o) => { enviadas.push(o.tipo); } });
  await sincronizarOperacionesPendientes(TRAB, { enviar: async (o) => { enviadas.push(o.tipo); } });
  assert.deepEqual(enviadas, ['evento_salud.crear', 'condicion_corporal.crear', 'asignacion_tarea.completar', 'alimentacion.crear']);
  assert.equal((await listarOperacionesLocal(VET.id)).length + (await listarOperacionesLocal(TRAB.id)).length, 0);

  // 10. Snapshot actualizado: la condición 4 ahora viene del servidor y ya no hay pendiente.
  await sincronizarSnapshot(VET, { condicion: 4, stock: '100.00' });
  const fichaFinal = construirFichaOffline({ animal: (await leerColeccionLocal(ALMACEN_ANIMALES, VET.id)).datos[0], cambios: await listarCambiosLocalesAnimal(VET.id, 10) });
  assert.equal(fichaFinal.condicion_corporal.puntuacion, 4);
  assert.equal(fichaFinal.condicion_corporal_pendiente, null);
});

test('P8.3 envío real: salud y condición viajan con Idempotency-Key y marca offline al endpoint existente', async () => {
  await borrarBase();
  localStorage.setItem('sistema_ganadero_token', tokenPara(VET.id));
  const peticiones = [];
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async (ruta, opciones) => {
    peticiones.push({ ruta, metodo: opciones.method, headers: opciones.headers, body: JSON.parse(opciones.body) });
    return { ok: true, status: 201, json: async () => ({ id: 1 }) };
  };
  try {
    const salud = construirOperacion({ usuario: VET, tipo: TIPO_OPERACION.EVENTO_SALUD, entidadId: 10, payload: { animal_id: 10, tipo: 'tratamiento', fecha: '2026-09-24' } });
    const condicion = construirOperacion({ usuario: VET, tipo: TIPO_OPERACION.CONDICION_CORPORAL, entidadId: 10, payload: { animal_id: 10, fecha: '2026-09-24', puntuacion: 2 } });
    await enviarOperacion(salud);
    await enviarOperacion(condicion);
  } finally {
    globalThis.fetch = fetchOriginal;
  }
  assert.deepEqual(peticiones.map((p) => [p.metodo, p.ruta]), [['POST', '/api/salud'], ['POST', '/api/condicion-corporal']]);
  for (const peticion of peticiones) {
    assert.match(peticion.headers['Idempotency-Key'], /^[0-9a-f-]{36}$/);
    assert.equal(peticion.headers['X-Offline-Operation'], 'true');
    assert.ok(peticion.headers['X-Client-Local-Timestamp']);
  }
  assert.equal(Object.hasOwn(peticiones[1].body, 'trabajador_id'), false, 'el responsable no viaja desde el cliente');
});

test('P8.3 permisos de captura: exactamente la matriz de policy.js', () => {
  const evento = { animal_id: 10, tipo: 'vacuna', fecha: '2026-09-24' };
  const cc = { animal_id: 10, fecha: '2026-09-24', puntuacion: 3 };
  const puede = (rol, tipo, payload) => {
    try { construirOperacion({ usuario: { id: 1, rol }, tipo, entidadId: 10, payload }); return true; } catch (error) { if (error.code === 'FORBIDDEN') return false; throw error; }
  };
  assert.deepEqual(['Administrador', 'Veterinario', 'Trabajador', 'Auditor'].map((rol) => puede(rol, TIPO_OPERACION.EVENTO_SALUD, evento)), [true, true, false, false]);
  assert.deepEqual(['Administrador', 'Veterinario', 'Trabajador', 'Auditor'].map((rol) => puede(rol, TIPO_OPERACION.CONDICION_CORPORAL, cc)), [true, true, true, false]);
  assert.deepEqual(['Administrador', 'Veterinario', 'Trabajador', 'Auditor'].map((rol) => puede(rol, TIPO_OPERACION.ALIMENTACION, { animal_id: 10 })), [true, false, true, false]);
  assert.deepEqual(['Administrador', 'Veterinario', 'Trabajador', 'Auditor'].map((rol) => puede(rol, TIPO_OPERACION.COMPLETAR_TAREA, { expected_version: 1 })), [true, true, true, false]);
  // La acción rápida aparece solo para quien puede usarla.
  const animal = { id: 10, estado: 'vivo', sexo: 'hembra' };
  assert.ok(accionesCampoDisponibles('Trabajador', animal).some((a) => a.id === ACCIONES_CAMPO.CONDICION));
  assert.equal(accionesCampoDisponibles('Trabajador', animal).some((a) => a.id === ACCIONES_CAMPO.SALUD), false);
  assert.equal(accionesCampoDisponibles('Auditor', animal).length, 0);
});

test('P8.3 bloqueos: eventos sanitarios independientes no se bloquean; el mismo insumo sí', async () => {
  await borrarBase();
  await sincronizarSnapshot(VET);
  await capturar(VET, TIPO_OPERACION.EVENTO_SALUD, 10, { animal_id: 10, tipo: 'vacuna', fecha: '2026-09-24' });
  await capturar(VET, TIPO_OPERACION.EVENTO_SALUD, 10, { animal_id: 10, tipo: 'tratamiento', fecha: '2026-09-24' });
  let n = 0;
  await sincronizarOperacionesPendientes(VET, { enviar: async () => { n += 1; if (n === 1) throw Object.assign(new Error('baja'), { status: 409, code: 'ANIMAL_DADO_DE_BAJA' }); } });
  assert.equal(n, 2, 'el segundo evento se envía aunque el primero entró en conflicto');

  await sincronizarSnapshot(TRAB);
  const alimento = (cantidad) => ({ animal_id: 10, insumo_id: 6, cantidad, fecha: '2026-09-24', unidad_medida: 'kg', expected_version: 7, stock_observado: 120 });
  await capturar(TRAB, TIPO_OPERACION.ALIMENTACION, 10, alimento(100));
  await capturar(TRAB, TIPO_OPERACION.ALIMENTACION, 10, alimento(30));
  const enviadas = [];
  await sincronizarOperacionesPendientes(TRAB, {
    enviar: async (o) => { enviadas.push(o.payload.cantidad); throw Object.assign(new Error('stock'), { status: 409, code: 'STOCK_INSUFICIENTE', details: [{ field: 'cantidad', insumo: 'Heno', requerido: 100, disponible: 60, unidad_medida: 'kg' }] }); },
  });
  assert.deepEqual(enviadas, [100], 'la segunda alimentación del mismo insumo espera revisión');
  assert.deepEqual((await listarOperacionesLocal(TRAB.id)).map((o) => o.estado), ['bloqueada']);
  const [conflicto] = await listarConflictosLocal(TRAB.id);
  assert.match(describirConflicto(conflicto).cambio, /Ya no hay alimento suficiente de Heno\. Quedan 60 kg y la captura necesita 100 kg\./);
});

test('P8.3 tarea completada por otra persona: mensaje claro y sin segunda finalización', () => {
  const texto = describirConflicto({ tipo: TIPO_OPERACION.COMPLETAR_TAREA, conflicto: { code: 'TAREA_ALREADY_COMPLETED', status: 409 } });
  assert.equal(texto.cambio, 'Esta tarea ya fue completada mientras estabas sin conexión.');
  assert.match(texto.siguiente, /descarta esta captura/);
});

test('P8.3 cola grande: 100 operaciones mixtas se envían una a una, en orden y sin duplicar', async () => {
  await borrarBase();
  const tipos = [
    [TIPO_OPERACION.EVENTO_SALUD, (i) => ({ animal_id: 10, tipo: 'diagnostico', enfermedad: `e${i}`, fecha: '2026-09-24' })],
    [TIPO_OPERACION.CONDICION_CORPORAL, (i) => ({ animal_id: 10, fecha: '2026-09-24', puntuacion: (i % 5) + 1 })],
    [TIPO_OPERACION.PESAJE, (i) => ({ animal_id: 10, fecha: '2026-09-24', peso_kg: 400 + i })],
    [TIPO_OPERACION.NOTA, (i) => ({ animal_id: 10, contenido: `nota ${i}` })],
  ];
  const admin = { id: 40, rol: 'Administrador' };
  for (let i = 0; i < 100; i += 1) {
    const [tipo, payload] = tipos[i % tipos.length];
    await capturar(admin, tipo, 10, payload(i));
  }
  const vistos = new Set();
  let enVuelo = 0;
  let maximo = 0;
  const inicio = Date.now();
  await sincronizarOperacionesPendientes(admin, {
    enviar: async (operacion) => {
      assert.equal(vistos.has(operacion.id), false, 'ninguna operación se envía dos veces');
      vistos.add(operacion.id);
      enVuelo += 1; maximo = Math.max(maximo, enVuelo);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      enVuelo -= 1;
    },
  });
  console.info('[p83-cola-cliente]', { operaciones: vistos.size, ms: Date.now() - inicio });
  assert.equal(vistos.size, 100);
  assert.equal(maximo, 1);
  assert.equal((await listarOperacionesLocal(admin.id)).length, 0);
});
