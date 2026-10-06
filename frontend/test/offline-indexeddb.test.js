import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  abrirCampoDB, guardarBootstrapLocal, leerSesionLocal, leerColeccionLocal,
  leerSyncMetadataLocal, limpiarDatosUsuarioLocal, _cerrarConexionParaPruebas,
  CAMPO_DB_NOMBRE, CAMPO_DB_VERSION,
  ALMACEN_SESION, ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, ALMACEN_INSUMOS, ALMACEN_SYNC_METADATA,
  ALMACEN_OPERACIONES, ALMACEN_CONFLICTOS, ALMACEN_HISTORIAL_SYNC,
} from '../src/offline/campoDB.js';

function payloadDePrueba(usuarioId, sufijo = '') {
  return {
    sesion: {
      nombre: `Usuario ${sufijo}`, email: `u${sufijo}@rancho.com`, rol: 'Trabajador',
      trabajador: { id: 1, nombre: 'Juan' }, sesion_version: 1,
      ultima_validacion_online: '2026-09-01T10:00:00.000Z',
      jwt_expira_en: '2026-09-01T18:00:00.000Z',
      ventana_offline_expira_en: '2026-09-01T18:00:00.000Z',
      version_bootstrap: 'offline-bootstrap.v3',
    },
    animales: { datos: [{ id: 1, arete_id: `A${sufijo}` }], version_bootstrap: 'offline-bootstrap.v3', sincronizado_en: '2026-09-01T10:00:00.000Z' },
    corrales: { datos: [{ id: 1, nombre: `Corral ${sufijo}` }], version_bootstrap: 'offline-bootstrap.v3', sincronizado_en: '2026-09-01T10:00:00.000Z' },
    tareas: { datos: [{ id: 1, titulo: `Tarea ${sufijo}`, version: 1 }], version_bootstrap: 'offline-bootstrap.v3', sincronizado_en: '2026-09-01T10:00:00.000Z' },
    insumos: { datos: [{ id: 4, nombre: `Alimento ${sufijo}`, stock_actual: 100, unidad_medida: 'kg', version: 1, estado: 'disponible' }], version_bootstrap: 'offline-bootstrap.v3', sincronizado_en: '2026-09-01T10:00:00.000Z' },
    metadatos: { instalacion_id: 'inst-1', ultima_sincronizacion_exitosa: '2026-09-01T10:00:00.000Z', server_timestamp: '2026-09-01T10:00:00.000Z', version_esquema_local: 1 },
  };
}

async function baseLimpia() {
  await _cerrarConexionParaPruebas();
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(CAMPO_DB_NOMBRE);
    req.onsuccess = resolve;
    req.onerror = () => reject(req.error);
    req.onblocked = resolve;
  });
}

test('abre v4 y conserva snapshot, cola, conflictos, historial e insumos', async () => {
  await baseLimpia();
  const db = await abrirCampoDB();
  assert.equal(db.version, CAMPO_DB_VERSION);
  const esperados = [ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_SESION, ALMACEN_SYNC_METADATA, ALMACEN_TAREAS, ALMACEN_INSUMOS, ALMACEN_OPERACIONES, ALMACEN_CONFLICTOS, ALMACEN_HISTORIAL_SYNC].sort();
  assert.deepEqual([...db.objectStoreNames].sort(), esperados);
  for (const almacen of esperados) {
    assert.ok(db.objectStoreNames.contains(almacen), `falta almacén ${almacen}`);
  }
  const tx = db.transaction(ALMACEN_SESION, 'readonly');
  assert.deepEqual(tx.objectStore(ALMACEN_SESION).keyPath, 'usuario_id');
  await tx.done;
});

test('migra una base local v1 real hasta la versión actual sin perder el snapshot', async () => {
  await baseLimpia();
  const { openDB } = await import('idb');
  const almacenesV1 = [ALMACEN_SESION, ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, ALMACEN_SYNC_METADATA];
  const dbV1 = await openDB(CAMPO_DB_NOMBRE, 1, {
    upgrade(db) {
      for (const nombre of almacenesV1) db.createObjectStore(nombre, { keyPath: 'usuario_id' });
    },
  });
  await dbV1.put(ALMACEN_SESION, { usuario_id: 'user-a', nombre: 'Snapshot v1' });
  dbV1.close();

  const dbV4 = await abrirCampoDB();
  assert.equal(dbV4.version, CAMPO_DB_VERSION);
  assert.ok(dbV4.objectStoreNames.contains(ALMACEN_OPERACIONES));
  assert.ok(dbV4.objectStoreNames.contains(ALMACEN_CONFLICTOS));
  assert.ok(dbV4.objectStoreNames.contains(ALMACEN_HISTORIAL_SYNC));
  assert.ok(dbV4.objectStoreNames.contains(ALMACEN_INSUMOS));
  assert.equal((await leerSesionLocal('user-a')).nombre, 'Snapshot v1');
});

test('upgrade secuencial v1 → v2 → v3 → versión actual conserva snapshot, pendientes, conflictos e historial', async () => {
  await baseLimpia();
  const { openDB } = await import('idb');
  const almacenesV1 = [ALMACEN_SESION, ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, ALMACEN_SYNC_METADATA];
  let db = await openDB(CAMPO_DB_NOMBRE, 1, {
    upgrade(base) {
      for (const nombre of almacenesV1) base.createObjectStore(nombre, { keyPath: 'usuario_id' });
    },
  });
  await db.put(ALMACEN_SESION, { usuario_id: 'user-a', nombre: 'Secuencia completa' });
  await db.put(ALMACEN_ANIMALES, { usuario_id: 'user-a', datos: [{ id: 10, version: 4 }] });
  db.close();

  db = await openDB(CAMPO_DB_NOMBRE, 2, {
    upgrade(base) {
      const operaciones = base.createObjectStore(ALMACEN_OPERACIONES, { keyPath: 'id' });
      operaciones.createIndex('por_usuario', 'usuario_id');
      operaciones.createIndex('por_usuario_estado', ['usuario_id', 'estado']);
      operaciones.createIndex('por_usuario_fecha', ['usuario_id', 'creada_en']);
      const conflictos = base.createObjectStore(ALMACEN_CONFLICTOS, { keyPath: 'id' });
      conflictos.createIndex('por_usuario', 'usuario_id');
      conflictos.createIndex('por_usuario_fecha', ['usuario_id', 'detectado_en']);
    },
  });
  await db.put(ALMACEN_OPERACIONES, { id: 'movimiento-a', usuario_id: 'user-a', tipo: 'animal.trasladar', estado: 'pendiente', creada_en: '2026-09-01T10:00:00.000Z' });
  await db.put(ALMACEN_OPERACIONES, { id: 'alimentacion-a', usuario_id: 'user-a', tipo: 'alimentacion.crear', estado: 'pendiente', creada_en: '2026-09-01T10:01:00.000Z' });
  await db.put(ALMACEN_CONFLICTOS, { id: 'conflicto-a', usuario_id: 'user-a', estado: 'conflicto', detectado_en: '2026-09-01T10:02:00.000Z' });
  db.close();

  db = await openDB(CAMPO_DB_NOMBRE, 3, {
    upgrade(base) {
      const historial = base.createObjectStore(ALMACEN_HISTORIAL_SYNC, { keyPath: 'id' });
      historial.createIndex('por_usuario', 'usuario_id');
      historial.createIndex('por_usuario_fecha', ['usuario_id', 'sincronizada_en']);
    },
  });
  await db.put(ALMACEN_HISTORIAL_SYNC, { id: 'confirmada-a', usuario_id: 'user-a', sincronizada_en: '2026-09-01T10:03:00.000Z' });
  db.close();

  const dbV4 = await abrirCampoDB();
  assert.equal(dbV4.version, CAMPO_DB_VERSION);
  assert.equal((await dbV4.get(ALMACEN_SESION, 'user-a')).nombre, 'Secuencia completa');
  assert.equal((await dbV4.get(ALMACEN_ANIMALES, 'user-a')).datos[0].version, 4);
  assert.deepEqual((await dbV4.getAllFromIndex(ALMACEN_OPERACIONES, 'por_usuario', 'user-a')).map((fila) => fila.tipo).sort(), ['alimentacion.crear', 'animal.trasladar']);
  assert.equal((await dbV4.getAllFromIndex(ALMACEN_CONFLICTOS, 'por_usuario', 'user-a')).length, 1);
  assert.equal((await dbV4.getAllFromIndex(ALMACEN_HISTORIAL_SYNC, 'por_usuario', 'user-a')).length, 1);
  assert.ok(dbV4.objectStoreNames.contains(ALMACEN_INSUMOS));
});

test('guardarBootstrapLocal escribe y se puede releer cada almacén', async () => {
  await baseLimpia();
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'A'));

  const sesion = await leerSesionLocal('user-a');
  assert.equal(sesion.usuario_id, 'user-a');
  assert.equal(sesion.nombre, 'Usuario A');

  const animales = await leerColeccionLocal(ALMACEN_ANIMALES, 'user-a');
  assert.deepEqual(animales.datos, [{ id: 1, arete_id: 'AA' }]);

  const tareas = await leerColeccionLocal(ALMACEN_TAREAS, 'user-a');
  assert.equal(tareas.datos[0].version, 1);

  const metadatos = await leerSyncMetadataLocal('user-a');
  assert.equal(metadatos.instalacion_id, 'inst-1');
  assert.equal((await leerColeccionLocal(ALMACEN_INSUMOS, 'user-a')).datos[0].stock_actual, 100);
});

test('atomicidad: si la transacción se aborta, ningún almacén queda a medio escribir', async () => {
  await baseLimpia();
  // Snapshot previo válido, completo.
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'viejo'));

  // Simula una actualización que falla a medio camino: mismo patrón que
  // guardarBootstrapLocal (una única transacción sobre los cinco
  // almacenes) pero forzando tx.abort() tras el primer put, para probar
  // que IndexedDB revierte TODO lo escrito en esa transacción, no solo
  // el almacén que "falló".
  const nuevo = payloadDePrueba('user-a', 'nuevo');
  const db = await abrirCampoDB();
  const almacenes = [ALMACEN_SESION, ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, ALMACEN_SYNC_METADATA];
  const tx = db.transaction(almacenes, 'readwrite');
  // Los requests individuales también rechazan con AbortError al abortar
  // la transacción — se silencian acá a propósito (ver `tx.done` abajo,
  // que es la señal que realmente nos interesa) para que ese rechazo
  // esperado no quede como una unhandledRejection.
  const putSesion = tx.objectStore(ALMACEN_SESION).put({ ...nuevo.sesion, usuario_id: 'user-a' });
  const putAnimales = tx.objectStore(ALMACEN_ANIMALES).put({ ...nuevo.animales, usuario_id: 'user-a' });
  putSesion.catch(() => {});
  putAnimales.catch(() => {});
  tx.abort();
  await assert.rejects(tx.done);

  // El snapshot anterior debe seguir intacto en TODOS los almacenes,
  // incluido el que sí alcanzó a recibir un put antes del abort.
  const sesion = await leerSesionLocal('user-a');
  assert.equal(sesion.nombre, 'Usuario viejo');
  const animales = await leerColeccionLocal(ALMACEN_ANIMALES, 'user-a');
  assert.deepEqual(animales.datos, [{ id: 1, arete_id: 'Aviejo' }]);
});

test('una falla real de guardarBootstrapLocal conserva completo el snapshot anterior', async () => {
  await baseLimpia();
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'anterior'));
  const invalido = payloadDePrueba('user-a', 'nuevo');
  invalido.tareas.datos.push({ id: 2, no_clonable: () => 'falla DataClone' });

  await assert.rejects(guardarBootstrapLocal('user-a', invalido));

  assert.equal((await leerSesionLocal('user-a')).nombre, 'Usuario anterior');
  assert.deepEqual((await leerColeccionLocal(ALMACEN_TAREAS, 'user-a')).datos, [{ id: 1, titulo: 'Tarea anterior', version: 1 }]);
  assert.equal((await leerSyncMetadataLocal('user-a')).ultima_sincronizacion_exitosa, '2026-09-01T10:00:00.000Z');
});

test('conservar snapshot anterior si guardarBootstrapLocal es llamado dos veces, la segunda gana completa', async () => {
  await baseLimpia();
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'uno'));
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'dos'));
  const sesion = await leerSesionLocal('user-a');
  assert.equal(sesion.nombre, 'Usuario dos');
  const corrales = await leerColeccionLocal(ALMACEN_CORRALES, 'user-a');
  assert.equal(corrales.datos[0].nombre, 'Corral dos');
});

test('partición estricta: el usuario B nunca ve datos locales del usuario A', async () => {
  await baseLimpia();
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'A'));
  await guardarBootstrapLocal('user-b', payloadDePrueba('user-b', 'B'));

  const sesionA = await leerSesionLocal('user-a');
  const sesionB = await leerSesionLocal('user-b');
  assert.equal(sesionA.nombre, 'Usuario A');
  assert.equal(sesionB.nombre, 'Usuario B');

  const animalesA = await leerColeccionLocal(ALMACEN_ANIMALES, 'user-a');
  const animalesB = await leerColeccionLocal(ALMACEN_ANIMALES, 'user-b');
  assert.deepEqual(animalesA.datos, [{ id: 1, arete_id: 'AA' }]);
  assert.deepEqual(animalesB.datos, [{ id: 1, arete_id: 'AB' }]);

  // Ningún identificador ajeno devuelve nada.
  assert.equal(await leerSesionLocal('user-desconocido'), undefined);
});

test('logout: limpiarDatosUsuarioLocal borra solo los datos de ese usuario', async () => {
  await baseLimpia();
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'A'));
  await guardarBootstrapLocal('user-b', payloadDePrueba('user-b', 'B'));

  await limpiarDatosUsuarioLocal('user-a');

  assert.equal(await leerSesionLocal('user-a'), undefined);
  assert.equal(await leerColeccionLocal(ALMACEN_ANIMALES, 'user-a'), undefined);
  assert.equal(await leerColeccionLocal(ALMACEN_CORRALES, 'user-a'), undefined);
  assert.equal(await leerColeccionLocal(ALMACEN_TAREAS, 'user-a'), undefined);
  assert.equal(await leerColeccionLocal(ALMACEN_INSUMOS, 'user-a'), undefined);
  assert.equal(await leerSyncMetadataLocal('user-a'), undefined);

  // El usuario B, que no cerró sesión, conserva sus datos intactos.
  const sesionB = await leerSesionLocal('user-b');
  assert.equal(sesionB.nombre, 'Usuario B');
});

test('cambio de usuario: iniciar sesión con otro usuario no reutiliza ni mezcla el snapshot anterior', async () => {
  await baseLimpia();
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'A'));

  // "Cambio de usuario" = simplemente leer con OTRO usuario_id — nunca
  // hay una ruta de código que promedie, mezcle o reutilice claves entre
  // usuarios distintos.
  const sesionNuevoUsuario = await leerSesionLocal('user-c');
  assert.equal(sesionNuevoUsuario, undefined);

  await guardarBootstrapLocal('user-c', payloadDePrueba('user-c', 'C'));
  const sesionC = await leerSesionLocal('user-c');
  assert.equal(sesionC.nombre, 'Usuario C');
  // El usuario A original sigue intacto y separado.
  const sesionA = await leerSesionLocal('user-a');
  assert.equal(sesionA.nombre, 'Usuario A');
});

test('migración de esquema: una futura versión puede agregar un almacén sin perder datos existentes', async () => {
  await baseLimpia();
  await guardarBootstrapLocal('user-a', payloadDePrueba('user-a', 'A'));
  await _cerrarConexionParaPruebas();

  // Simula la forma en que una v5 real se vería: mismo patrón "if
  // (oldVersion < N)" agregando un almacén nuevo, sin tocar los
  // anteriores.
  const { openDB } = await import('idb');
  const dbV5 = await openDB(CAMPO_DB_NOMBRE, CAMPO_DB_VERSION + 1, {
    upgrade(db, oldVersion) {
      if (oldVersion < CAMPO_DB_VERSION + 1 && !db.objectStoreNames.contains('preferencias_v5_demo')) {
        db.createObjectStore('preferencias_v5_demo', { keyPath: 'id' });
      }
    },
  });
  assert.ok(dbV5.objectStoreNames.contains(ALMACEN_SESION));
  assert.ok(dbV5.objectStoreNames.contains(ALMACEN_OPERACIONES));
  assert.ok(dbV5.objectStoreNames.contains(ALMACEN_INSUMOS));
  assert.ok(dbV5.objectStoreNames.contains('preferencias_v5_demo'));
  const sesion = await dbV5.get(ALMACEN_SESION, 'user-a');
  assert.equal(sesion.nombre, 'Usuario A');
  dbV5.close();
});
