import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import {
  _cerrarConexionParaPruebas, abrirCampoDB, ALMACEN_ANIMALES, ALMACEN_CONFLICTOS, ALMACEN_CORRALES, ALMACEN_HISTORIAL_SYNC,
  ALMACEN_OPERACIONES, ALMACEN_SESION, CAMPO_DB_NOMBRE, CAMPO_DB_VERSION, guardarBootstrapLocal, INDICE_POR_ANIMAL,
  leerColeccionLocal, leerSyncMetadataLocal, listarCambiosLocalesAnimal, listarOperacionesLocal, migrarCampoDB,
} from '../src/offline/campoDB.js';
import {
  _reiniciarSincronizacionParaPruebas, capturarConSoporteOffline, construirOperacion, sincronizarOperacionesPendientes, TIPO_OPERACION,
} from '../src/offline/colaOperaciones.js';
import { construirBootstrapLocal, validarContratoBootstrap } from '../src/offline/bootstrapSync.js';
import {
  animalesDeCorralOffline, buscarAnimalesOffline, construirFichaOffline, edadDesde, resumenCorralOffline,
} from '../src/offline/fichaOffline.js';
import { formatearFechaHora, formatearFechaNegocio } from '../src/offline/formatoTiempo.js';
import { describirConflicto, resumenEstadoCompacto } from '../src/offline/syncUx.js';

const almacenamiento = new Map();
globalThis.localStorage = {
  getItem: (clave) => almacenamiento.get(clave) ?? null,
  setItem: (clave, valor) => almacenamiento.set(clave, String(valor)),
  removeItem: (clave) => almacenamiento.delete(clave),
};

const USUARIO = { id: 7, rol: 'Trabajador', nombre: 'Campo', email: 'campo@rancho.test' };
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function tokenPara(usuarioId) {
  const base64url = (valor) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  return `${base64url({ alg: 'HS256' })}.${base64url({ id: usuarioId, exp: 2000000000 })}.firma`;
}

async function borrarBase() {
  _reiniciarSincronizacionParaPruebas();
  await _cerrarConexionParaPruebas();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(CAMPO_DB_NOMBRE);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
    request.onblocked = resolve;
  });
}

// Base v4 real, construida con las mismas migraciones que usó la PWA
// instalada antes de P8.2, poblada con snapshot v3, cola, conflicto e historial.
async function crearBaseV4Poblada() {
  const db = await openDB(CAMPO_DB_NOMBRE, 4, {
    upgrade(base, oldVersion, _nueva, transaccion) { return migrarCampoDB(base, oldVersion, transaccion, 4); },
  });
  await db.put(ALMACEN_SESION, { usuario_id: USUARIO.id, nombre: 'Campo', rol: 'Trabajador' });
  await db.put(ALMACEN_ANIMALES, { usuario_id: USUARIO.id, version_bootstrap: 'offline-bootstrap.v3', sincronizado_en: '2026-09-23T18:42:00.000Z', datos: [{ id: 10, arete_id: 'MX-10', estado: 'vivo', ultimo_peso_kg: '420.00', corral_actual_id: 1, corral_actual: 'Norte' }] });
  const operaciones = [
    { id: uuid(1), usuario_id: USUARIO.id, client_operation_id: uuid(1), tipo: 'pesaje.crear', entidad: 'pesaje', entidad_id: 10, payload: { animal_id: 10, fecha: '2026-09-23', peso_kg: 426 }, estado: 'pendiente', intentos: 0, creada_en: '2026-09-23T19:00:00.000Z' },
    { id: uuid(2), usuario_id: USUARIO.id, client_operation_id: uuid(2), tipo: 'animal.trasladar', entidad: 'animal', entidad_id: 11, payload: { corral_id: 2, expected_version: 3 }, estado: 'error', intentos: 2, creada_en: '2026-09-23T19:01:00.000Z' },
    { id: uuid(3), usuario_id: USUARIO.id, client_operation_id: uuid(3), tipo: 'asignacion_tarea.completar', entidad: 'asignacion_tarea', entidad_id: 30, payload: { expected_version: 2 }, estado: 'pendiente', intentos: 0, creada_en: '2026-09-23T19:02:00.000Z' },
    { id: uuid(4), usuario_id: 99, client_operation_id: uuid(4), tipo: 'pesaje.crear', entidad: 'pesaje', entidad_id: 10, payload: { animal_id: 10, peso_kg: 1 }, estado: 'pendiente', intentos: 0, creada_en: '2026-09-23T19:03:00.000Z' },
  ];
  for (const operacion of operaciones) await db.put(ALMACEN_OPERACIONES, operacion);
  await db.put(ALMACEN_CONFLICTOS, { id: uuid(5), usuario_id: USUARIO.id, tipo: 'nota_seguimiento.crear', entidad_id: 10, payload: { animal_id: 10, contenido: 'x' }, estado: 'conflicto', detectado_en: '2026-09-23T19:04:00.000Z', creada_en: '2026-09-23T18:59:00.000Z' });
  await db.put(ALMACEN_HISTORIAL_SYNC, { id: uuid(6), usuario_id: USUARIO.id, sincronizada_en: '2026-09-23T18:00:00.000Z' });
  db.close();
  return operaciones;
}

function bootstrapV4({ peso = '420.00', vendido = false } = {}) {
  return {
    schema: 'offline-bootstrap.v4', snapshot_version: 4,
    server_timestamp: '2026-09-24T15:30:00.000Z', generado_en: '2026-09-24T15:30:00.000Z',
    partition: { usuario_id: USUARIO.id, sesion_version: 1 },
    usuario: { ...USUARIO, sesion_version: 1, trabajador: null },
    animales: [
      { id: 10, arete_id: 'MX-10', nombre_alias: 'Lucero', sexo: 'hembra', categoria: 'vientre', raza: 'Angus', fecha_nacimiento: '2020-03-15T06:00:00.000Z', estado: 'vivo', fecha_baja: null, version: 4, estado_salud: 'observacion', salud_fecha_inicio: '2026-09-20', salud_diagnostico: null, corral_actual_id: 1, corral: 'Norte', corral_actual: 'Norte', ultimo_peso_kg: peso, ultimo_peso_fecha: '2026-09-01', condicion_corporal: 3, condicion_corporal_fecha: '2026-09-10', eventos_salud_recientes: [{ tipo: 'vacuna', enfermedad: 'Clostridiosis', fecha: '2026-08-01' }], proximas_dosis: [{ tipo: 'vacuna', enfermedad: 'Refuerzo', fecha: '2026-09-20' }, { tipo: 'vacuna', enfermedad: 'Rabia', fecha: '2026-10-05' }], notas_recientes: [{ tag: 'Salud', contenido: 'Cojea de la pata trasera', fecha: '2026-09-21T09:00:00', autor: 'Ana' }] },
      { id: 12, arete_id: 'MX-12', nombre_alias: 'Árbol', sexo: 'macho', categoria: 'engorde', raza: null, fecha_nacimiento: null, estado: vendido ? 'vendido' : 'vivo', fecha_baja: vendido ? '2026-09-20' : null, version: 2, estado_salud: 'sano', corral_actual_id: 1, corral_actual: 'Norte', ultimo_peso_kg: null, eventos_salud_recientes: [], proximas_dosis: [], notas_recientes: [] },
    ],
    corrales: [
      { id: 1, nombre: 'Norte', capacidad_maxima: 10, ocupacion_actual: vendido ? 1 : 2, activo: true },
      { id: 2, nombre: 'Sur', capacidad_maxima: null, ocupacion_actual: 0, activo: true },
    ],
    tareas: [], insumos: [],
  };
}

async function sincronizarSnapshot(payload) {
  const preparado = construirBootstrapLocal(payload, USUARIO, { token: tokenPara(USUARIO.id), instalacionId: uuid(900) });
  await guardarBootstrapLocal(preparado.usuarioId, preparado.contenido);
}

test('IndexedDB v5: actualizar desde una base v4 poblada no pierde ni altera ninguna operación', async () => {
  await borrarBase();
  const originales = await crearBaseV4Poblada();
  const db = await abrirCampoDB();
  assert.equal(db.version, CAMPO_DB_VERSION);
  assert.equal(CAMPO_DB_VERSION, 5);
  assert.equal(db.objectStoreNames.length, 9);
  const tx = db.transaction(ALMACEN_OPERACIONES);
  assert.ok(tx.objectStore(ALMACEN_OPERACIONES).indexNames.contains(INDICE_POR_ANIMAL));

  const todas = await db.getAll(ALMACEN_OPERACIONES);
  assert.equal(todas.length, originales.length);
  for (const original of originales) {
    const migrada = todas.find((fila) => fila.id === original.id);
    assert.ok(migrada, `operación ${original.id} conservada`);
    assert.equal(migrada.client_operation_id, original.client_operation_id);
    assert.equal(migrada.estado, original.estado);
    assert.equal(migrada.usuario_id, original.usuario_id);
    assert.deepEqual(migrada.payload, original.payload);
  }
  assert.equal(todas.find((fila) => fila.id === uuid(1)).animal_id, 10);
  assert.equal(todas.find((fila) => fila.id === uuid(2)).animal_id, 11);
  assert.equal(todas.find((fila) => fila.id === uuid(3)).animal_id, undefined, 'una tarea no pertenece a un animal');
  assert.equal((await db.getAll(ALMACEN_HISTORIAL_SYNC)).length, 1);
  assert.equal((await leerColeccionLocal(ALMACEN_ANIMALES, USUARIO.id)).datos[0].ultimo_peso_kg, '420.00', 'el snapshot v3 sigue legible');

  // El índice nuevo respeta la partición: el pesaje del usuario 99 no aparece.
  const cambios = await listarCambiosLocalesAnimal(USUARIO.id, 10);
  assert.deepEqual(cambios.operaciones.map((fila) => fila.id), [uuid(1)]);
  assert.deepEqual(cambios.conflictos.map((fila) => fila.id), [uuid(5)]);
});

test('IndexedDB v5: si la actualización se interrumpe, la base sigue en v4 con todos sus datos', async () => {
  await borrarBase();
  await crearBaseV4Poblada();
  await new Promise((resolve) => {
    const peticion = indexedDB.open(CAMPO_DB_NOMBRE, 5);
    peticion.onupgradeneeded = () => {
      // Simula el cierre de la app a mitad del upgrade.
      peticion.transaction.objectStore(ALMACEN_OPERACIONES).createIndex(INDICE_POR_ANIMAL, ['usuario_id', 'animal_id']);
      peticion.transaction.abort();
    };
    peticion.onerror = () => resolve();
    peticion.onsuccess = () => { peticion.result.close(); resolve(); };
  });
  const v4 = await openDB(CAMPO_DB_NOMBRE);
  assert.equal(v4.version, 4);
  assert.equal(v4.transaction(ALMACEN_OPERACIONES).objectStore(ALMACEN_OPERACIONES).indexNames.contains(INDICE_POR_ANIMAL), false);
  assert.equal((await v4.getAll(ALMACEN_OPERACIONES)).length, 4);
  v4.close();
  // El siguiente arranque vuelve a intentar y completa la migración.
  const db = await abrirCampoDB();
  assert.equal(db.version, 5);
  assert.equal((await db.getAll(ALMACEN_OPERACIONES)).length, 4);
});

test('flujo completo: v4 con cola → v5 → online → sin Internet → ficha y corrales → cierre y reapertura → captura → reconexión', async () => {
  await borrarBase();
  await crearBaseV4Poblada();
  // 1-4. Actualización a v5 y sincronización online con contrato v4.
  await abrirCampoDB();
  await sincronizarSnapshot(bootstrapV4());
  const metadatos = await leerSyncMetadataLocal(USUARIO.id);
  assert.equal(metadatos.snapshot_version, 4);
  assert.equal(metadatos.snapshot_generado_en, '2026-09-24T15:30:00.000Z');
  assert.equal((await listarOperacionesLocal(USUARIO.id)).length, 3, 'la cola sobrevive a la sincronización del snapshot');

  // 5-6. Sin Internet: búsqueda por arete, nombre (sin acentos) y filtros.
  const animales = (await leerColeccionLocal(ALMACEN_ANIMALES, USUARIO.id)).datos;
  assert.deepEqual(buscarAnimalesOffline(animales, { q: 'mx-10' }).map((a) => a.id), [10]);
  assert.deepEqual(buscarAnimalesOffline(animales, { q: 'arbol' }).map((a) => a.id), [12]);
  assert.deepEqual(buscarAnimalesOffline(animales, { estado: 'vivo', corralId: 1 }).map((a) => a.id), [10, 12]);

  // 7. Ficha: dato del servidor y pesaje local pendiente, por separado.
  const corrales = (await leerColeccionLocal(ALMACEN_CORRALES, USUARIO.id)).datos;
  const ficha = construirFichaOffline({ animal: animales[0], corrales, cambios: await listarCambiosLocalesAnimal(USUARIO.id, 10), hoy: new Date('2026-09-24T12:00:00') });
  assert.deepEqual(ficha.peso.servidor, { kg: 420, fecha: '01/09/2026' });
  assert.deepEqual(ficha.peso.pendiente, { kg: 426, fecha: '23/09/2026', estado: 'pendiente de sincronizar' });
  assert.equal(animales[0].ultimo_peso_kg, '420.00', 'el snapshot no se modifica para simular el pesaje');
  assert.equal(ficha.conflictos, 1);
  assert.equal(ficha.identidad.edad, '6 años');
  assert.equal(ficha.identidad.nacimiento, '15/03/2020');
  assert.deepEqual(ficha.condicion_corporal, { puntuacion: 3, fecha: '10/09/2026' });
  assert.deepEqual(ficha.salud.proximas_dosis.map((d) => [d.fecha, d.vencida]), [['20/09/2026', true], ['05/10/2026', false]]);
  assert.equal(ficha.notas[0].fecha, '21/09/2026');
  assert.equal(ficha.corral.texto_capacidad, '2 de 10 lugares ocupados');

  // 8. Corrales: capacidad real o "no registrada", nunca inventada.
  assert.equal(resumenCorralOffline(corrales[1]).texto_disponible, 'Disponibilidad no calculable');
  assert.equal(resumenCorralOffline(corrales[0]).disponible, 8);
  assert.deepEqual(animalesDeCorralOffline(animales, 1).map((a) => a.id), [10, 12]);

  // 9-11. Cierre completo de la PWA y reapertura sin Internet.
  await _cerrarConexionParaPruebas();
  _reiniciarSincronizacionParaPruebas();
  assert.equal((await leerColeccionLocal(ALMACEN_ANIMALES, USUARIO.id)).datos.length, 2);
  assert.equal((await listarOperacionesLocal(USUARIO.id)).length, 3);

  // 12. Nueva captura soportada sin conexión.
  const nueva = await capturarConSoporteOffline({
    usuario: USUARIO, sinConexion: true, tipo: TIPO_OPERACION.NOTA, entidadId: 10,
    payload: { animal_id: 10, contenido: 'Revisada en campo' }, ejecutarOnline: () => assert.fail('no debe enviarse'),
  });
  assert.equal(nueva.offline_pending, true);
  assert.equal((await listarCambiosLocalesAnimal(USUARIO.id, 10)).operaciones.length, 2);

  // 13-14. Reconexión: la cola se envía (la operación con error queda para reintento manual).
  const enviadas = [];
  await sincronizarOperacionesPendientes(USUARIO, { enviar: async (operacion) => { enviadas.push(operacion.tipo); } });
  assert.deepEqual(enviadas, ['pesaje.crear', 'asignacion_tarea.completar', 'nota_seguimiento.crear']);
  assert.deepEqual((await listarOperacionesLocal(USUARIO.id)).map((fila) => fila.estado), ['error']);

  // 15. Snapshot actualizado desde el servidor: ahora el 426 es dato del servidor, no pendiente.
  await sincronizarSnapshot(bootstrapV4({ peso: '426.00', vendido: true }));
  const actualizados = (await leerColeccionLocal(ALMACEN_ANIMALES, USUARIO.id)).datos;
  const fichaFinal = construirFichaOffline({ animal: actualizados[0], corrales: (await leerColeccionLocal(ALMACEN_CORRALES, USUARIO.id)).datos, cambios: await listarCambiosLocalesAnimal(USUARIO.id, 10) });
  assert.equal(fichaFinal.peso.servidor.kg, 426);
  assert.equal(fichaFinal.peso.pendiente, null);
  const vendido = construirFichaOffline({ animal: actualizados[1] });
  assert.equal(vendido.vida.activo, false);
  assert.match(vendido.vida.aviso, /vendido desde el 20\/09\/2026/);
  assert.deepEqual(animalesDeCorralOffline(actualizados, 1).map((a) => a.id), [10], 'un vendido ya no ocupa lugar');
});

test('contrato de snapshot: acepta v4 y v3, rechaza desconocidos', () => {
  assert.equal(validarContratoBootstrap(bootstrapV4(), USUARIO.id).snapshot_version, 4);
  assert.ok(validarContratoBootstrap({ ...bootstrapV4(), schema: 'offline-bootstrap.v3' }, USUARIO.id));
  assert.throws(() => validarContratoBootstrap({ ...bootstrapV4(), schema: 'offline-bootstrap.v9' }, USUARIO.id), /schema/);
  const v3 = construirFichaOffline({ animal: { id: 1, arete_id: 'A', estado: 'vivo' } });
  assert.equal(v3.snapshot_completo, false, 'un snapshot v3 dice "sin dato", no "ninguno"');
});

test('fechas de negocio no se corren por zona horaria y la última sincronización es exacta', () => {
  assert.equal(formatearFechaNegocio('2026-09-20'), '20/09/2026');
  assert.equal(formatearFechaNegocio('2026-09-21T09:00:00'), '21/09/2026');
  assert.equal(formatearFechaNegocio(null), null);
  const local = new Date(2026, 8, 23, 18, 42);
  assert.equal(formatearFechaHora(local.toISOString()), '23/09/2026 18:42');
  assert.equal(edadDesde('2026-09-10', new Date(2026, 8, 24)), 'Recién nacido');
});

test('estado compacto: sin conexión dice desde cuándo son los datos; con conexión solo avisa lo pendiente', () => {
  const ultima = new Date(2026, 8, 23, 18, 42).toISOString();
  const offline = resumenEstadoCompacto({ conectividad: 'offline', cola: { pendientes: 3, bloqueadas: 1, errores: 0, conflictos: [] }, ultimaSincronizacion: ultima });
  assert.deepEqual(offline.offline, { titulo: 'Trabajando offline', detalle: 'Última sincronización: 23/09/2026 18:42 · 4 cambios pendientes' });
  assert.equal(resumenEstadoCompacto({ conectividad: 'online', cola: { pendientes: 0, conflictos: [] } }).chip, null, 'online y al día: sin avisos');
  assert.equal(resumenEstadoCompacto({ conectividad: 'online', cola: { pendientes: 0, conflictos: [{}] } }).chip.texto, '1 conflicto requiere atención');
  assert.equal(resumenEstadoCompacto({ conectividad: 'online', cola: { pendientes: 2, conflictos: [] } }).chip.texto, '2 cambios pendientes');
});

test('conflicto por baja explica fechas de baja y del registro', () => {
  const texto = describirConflicto({ tipo: TIPO_OPERACION.PESAJE, conflicto: { code: 'ANIMAL_DADO_DE_BAJA', status: 409, details: [{ field: 'fecha', fecha_evento: '2026-09-21', fecha_baja: '2026-09-20', estado: 'vendido' }] } });
  assert.match(texto.cambio, /vendido el 20\/09\/2026/);
  assert.match(texto.motivo, /21\/09\/2026/);
});

test('permisos de captura offline por rol: la sesión local nunca amplía lo que permite el servidor', () => {
  const payload = { animal_id: 10, fecha: '2026-09-24', peso_kg: 400 };
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador']) {
    assert.ok(construirOperacion({ usuario: { id: 1, rol }, tipo: TIPO_OPERACION.PESAJE, entidadId: 10, payload }), rol);
  }
  assert.throws(() => construirOperacion({ usuario: { id: 1, rol: 'Auditor' }, tipo: TIPO_OPERACION.PESAJE, entidadId: 10, payload }), (e) => e.code === 'FORBIDDEN');
  assert.throws(() => construirOperacion({ usuario: { id: 1, rol: 'Veterinario' }, tipo: TIPO_OPERACION.MOVIMIENTO, entidadId: 10, payload: { corral_id: 2 } }), (e) => e.code === 'FORBIDDEN');
});
