// El Rancho — Offline v1 Fase B: capa de almacenamiento local (IndexedDB).
//
// Elegimos `idb` (envoltorio delgado por promesas sobre IndexedDB nativo, de
// Jake Archibald) en vez de Dexie o la API nativa directa:
//   - ~1.2 kB min+gzip (Dexie ronda 25-30 kB) — el bundle inicial tiene un
//     presupuesto acordado de 500 kB (ver scripts/check-bundle.mjs) y esta
//     fase no necesita queries complejas, índices compuestos ni "live
//     queries" que justifiquen ese peso.
//   - Conserva la API y la semántica de transacciones nativas de
//     IndexedDB (atomicidad real, `tx.done`), en vez de envolverlas en una
//     capa propia — encaja con el estilo ya usado en el backend
//     (`enTransaccion`, BEGIN/COMMIT/ROLLBACK explícitos en ventas.js):
//     transacciones explícitas y auditables, no "magia" oculta.
//   - Migraciones simples vía el propio callback `upgrade(db, oldVersion)`
//     de IndexedDB, sin DSL adicional que aprender.
//   - Trivial de probar en Node con `fake-indexeddb` (devDependency, sin
//     impacto en el bundle de producción) — ver test/offline-indexeddb.test.js.
//
// Los cinco almacenes de snapshot usan `usuario_id` como keyPath: cada
// usuario tiene una fila por colección. En v2, operaciones y conflictos
// usan el UUID local como keyPath e índices obligatorios por usuario; sus
// APIs públicas nunca hacen lecturas globales. El bootstrap conserva su
// transacción independiente, todo o nada.
import { openDB } from 'idb';

export const CAMPO_DB_NOMBRE = 'el-rancho-campo-v1';
export const CAMPO_DB_VERSION = 5;
export const INDICE_POR_ANIMAL = 'por_usuario_animal';

export const ALMACEN_SESION = 'session_snapshot';
export const ALMACEN_ANIMALES = 'animales_resumen';
export const ALMACEN_CORRALES = 'corrales';
export const ALMACEN_TAREAS = 'tareas';
export const ALMACEN_INSUMOS = 'insumos_alimentacion';
export const ALMACEN_SYNC_METADATA = 'sync_metadata';
export const ALMACEN_OPERACIONES = 'operaciones_pendientes';
export const ALMACEN_CONFLICTOS = 'conflictos_sync';
export const ALMACEN_HISTORIAL_SYNC = 'historial_sync';

const ALMACENES_V1 = [ALMACEN_SESION, ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, ALMACEN_SYNC_METADATA];
const ALMACENES_V2 = [ALMACEN_OPERACIONES, ALMACEN_CONFLICTOS];
const ALMACENES_V3 = [ALMACEN_HISTORIAL_SYNC];
const ALMACENES_V4 = [ALMACEN_INSUMOS];
const TODOS_LOS_ALMACENES = [...ALMACENES_V1, ...ALMACENES_V2, ...ALMACENES_V3, ...ALMACENES_V4];
const RETENCION_HISTORIAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_HISTORIAL_POR_USUARIO = 100;

let promesaDB = null;

// Animal al que se refiere una captura, para mostrar cambios pendientes en su
// ficha. Tareas y alimentación por corral no pertenecen a un animal.
export function animalIdDeOperacion(operacion) {
  if (!operacion || operacion.tipo === 'asignacion_tarea.completar') return null;
  const id = operacion.payload?.animal_id ?? operacion.entidad_id;
  return id === null || id === undefined || id === '' || !Number.isFinite(Number(id)) ? null : Number(id);
}

async function rellenarAnimalId(almacen) {
  let cursor = await almacen.openCursor();
  while (cursor) {
    const fila = cursor.value;
    const animalId = animalIdDeOperacion(fila);
    // Solo agrega el campo derivado; id, UUID, estado y payload no cambian.
    if (animalId !== null && fila.animal_id !== animalId) await cursor.update({ ...fila, animal_id: animalId });
    cursor = await cursor.continue();
  }
}

/**
 * Migraciones aditivas del esquema local. Todo corre dentro de la única
 * transacción `versionchange` de IndexedDB: si la app se cierra o el upgrade
 * falla a mitad, el navegador la revierte completa y la base sigue en la
 * versión anterior con sus datos intactos. Exportada para probar la
 * actualización desde una base v4 real.
 */
export async function migrarCampoDB(db, oldVersion, transaction, hastaVersion = CAMPO_DB_VERSION) {
  // v1: crea los cinco almacenes si todavía no existen. Una futura
  // versión debe agregar un bloque `if (oldVersion < N) { ... }` nuevo,
  // sin tocar ni borrar los almacenes de versiones anteriores, para
  // que abrir una base ya poblada nunca pierda datos.
  if (oldVersion < 1 && hastaVersion >= 1) {
    for (const nombre of ALMACENES_V1) {
      if (!db.objectStoreNames.contains(nombre)) db.createObjectStore(nombre, { keyPath: 'usuario_id' });
    }
  }
  // v2: cola explícita y conflictos. No se altera ni elimina ningún
  // almacén del snapshot v1; la actualización conserva todos los
  // datos descargados previamente.
  if (oldVersion < 2 && hastaVersion >= 2) {
    const operaciones = db.createObjectStore(ALMACEN_OPERACIONES, { keyPath: 'id' });
    operaciones.createIndex('por_usuario', 'usuario_id');
    operaciones.createIndex('por_usuario_estado', ['usuario_id', 'estado']);
    operaciones.createIndex('por_usuario_fecha', ['usuario_id', 'creada_en']);

    const conflictos = db.createObjectStore(ALMACEN_CONFLICTOS, { keyPath: 'id' });
    conflictos.createIndex('por_usuario', 'usuario_id');
    conflictos.createIndex('por_usuario_fecha', ['usuario_id', 'detectado_en']);
  }
  // v3: comprobantes locales mínimos. Nunca almacena el payload;
  // sólo permite confirmar al usuario que una captura ya llegó.
  if (oldVersion < 3 && hastaVersion >= 3) {
    const historial = db.createObjectStore(ALMACEN_HISTORIAL_SYNC, { keyPath: 'id' });
    historial.createIndex('por_usuario', 'usuario_id');
    historial.createIndex('por_usuario_fecha', ['usuario_id', 'sincronizada_en']);
  }
  // v4: catálogo mínimo versionado para capturar alimentación sin
  // conexión. Sólo se agrega el almacén; los snapshots y colas de
  // v1-v3 permanecen intactos.
  if (oldVersion < 4 && hastaVersion >= 4) {
    db.createObjectStore(ALMACEN_INSUMOS, { keyPath: 'usuario_id' });
  }
  // v5 (P8.2): índice por usuario y animal en cola y conflictos para mostrar
  // en la ficha offline los cambios que aún no confirma el servidor. No se
  // crea ningún almacén; las filas existentes solo ganan `animal_id`
  // derivado (mismo UUID, mismo estado, mismo payload).
  if (oldVersion < 5 && hastaVersion >= 5) {
    for (const nombre of [ALMACEN_OPERACIONES, ALMACEN_CONFLICTOS]) {
      const almacen = transaction.objectStore(nombre);
      if (!almacen.indexNames.contains(INDICE_POR_ANIMAL)) almacen.createIndex(INDICE_POR_ANIMAL, ['usuario_id', 'animal_id']);
    }
    if (oldVersion >= 2) {
      await rellenarAnimalId(transaction.objectStore(ALMACEN_OPERACIONES));
      await rellenarAnimalId(transaction.objectStore(ALMACEN_CONFLICTOS));
    }
  }
}

export function abrirCampoDB() {
  if (!promesaDB) {
    const apertura = openDB(CAMPO_DB_NOMBRE, CAMPO_DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        return migrarCampoDB(db, oldVersion, transaction);
      },
      blocking() {
        // Otra pestaña abrió una versión nueva. Cerramos esta conexión
        // para no bloquear la migración y reabrimos bajo demanda.
        apertura.then((db) => db.close()).catch(() => {});
        promesaDB = null;
      },
      blocked() {
        console.warn('[offline-db]', 'Otra pestaña debe cerrarse para actualizar los datos locales.');
      },
    });
    promesaDB = apertura.catch((error) => {
      promesaDB = null;
      throw error;
    });
  }
  return promesaDB;
}

// Solo para pruebas: descarta la conexión cacheada para que la próxima
// llamada a abrirCampoDB() abra una nueva (p. ej. tras borrar la base de
// datos de prueba entre tests).
export function _reiniciarConexionParaPruebas() {
  promesaDB = null;
}

// Solo para pruebas: cierra de verdad la conexión IDBDatabase subyacente
// (no solo descarta la promesa cacheada). Una conexión abierta bloquea
// indefinidamente cualquier `deleteDatabase`/upgrade de versión futura
// sobre la misma base — sin este cierre explícito, un test de migración
// de esquema que abre una versión mayor nunca recibiría el evento
// `upgradeneeded` y quedaría colgado esperando a que "algo" cierre la
// conexión anterior.
export async function _cerrarConexionParaPruebas() {
  if (promesaDB) {
    const db = await promesaDB;
    db.close();
  }
  promesaDB = null;
}

/**
 * Reemplaza atómicamente el snapshot local completo de un usuario: las
 * seis filas (una por almacén) se escriben en una única transacción de
 * IndexedDB. Si cualquiera de los `put` falla (dato inválido, cuota
 * excedida, etc.) la transacción entera se revierte — el snapshot
 * anterior queda intacto, nunca a medio actualizar, y nunca se llega a
 * marcar `sync_metadata` como exitosa.
 */
export async function guardarBootstrapLocal(usuarioId, { sesion, animales, corrales, tareas, insumos, metadatos }) {
  if (!usuarioId) throw new Error('guardarBootstrapLocal requiere usuario_id.');
  const db = await abrirCampoDB();
  const tx = db.transaction([...ALMACENES_V1, ...ALMACENES_V4], 'readwrite');
  const finalizacion = tx.done;
  finalizacion.catch(() => {});
  const operaciones = [];
  const programar = (promesa) => {
    promesa.catch(() => {});
    operaciones.push(promesa);
  };
  try {
    programar(tx.objectStore(ALMACEN_SESION).put({ ...sesion, usuario_id: usuarioId }));
    programar(tx.objectStore(ALMACEN_ANIMALES).put({ ...animales, usuario_id: usuarioId }));
    programar(tx.objectStore(ALMACEN_CORRALES).put({ ...corrales, usuario_id: usuarioId }));
    programar(tx.objectStore(ALMACEN_TAREAS).put({ ...tareas, usuario_id: usuarioId }));
    programar(tx.objectStore(ALMACEN_INSUMOS).put({ ...insumos, usuario_id: usuarioId }));
    programar(tx.objectStore(ALMACEN_SYNC_METADATA).put({ ...metadatos, usuario_id: usuarioId }));
    await Promise.all(operaciones);
    await finalizacion;
  } catch (error) {
    // Un `put` puede lanzar DataCloneError de forma síncrona antes de
    // devolver una promesa. Sin este abort explícito, los put anteriores
    // sí podrían confirmarse y mezclar dos snapshots.
    try { tx.abort(); } catch { /* ya abortada/inactiva */ }
    await finalizacion.catch(() => {});
    throw error;
  }
}

export async function leerSesionLocal(usuarioId) {
  if (!usuarioId) return undefined;
  const db = await abrirCampoDB();
  return db.get(ALMACEN_SESION, usuarioId);
}

export async function leerColeccionLocal(almacen, usuarioId) {
  if (!usuarioId) return undefined;
  if (![ALMACEN_ANIMALES, ALMACEN_CORRALES, ALMACEN_TAREAS, ALMACEN_INSUMOS].includes(almacen)) {
    throw new Error(`leerColeccionLocal: almacén no soportado "${almacen}".`);
  }
  const db = await abrirCampoDB();
  return db.get(almacen, usuarioId);
}

export async function leerSyncMetadataLocal(usuarioId) {
  if (!usuarioId) return undefined;
  const db = await abrirCampoDB();
  return db.get(ALMACEN_SYNC_METADATA, usuarioId);
}

export async function guardarOperacionLocal(operacion) {
  if (!operacion?.id || !operacion?.usuario_id) throw new Error('La operación local requiere id y usuario_id.');
  const db = await abrirCampoDB();
  const tx = db.transaction(ALMACEN_OPERACIONES, 'readwrite');
  const almacen = tx.objectStore(ALMACEN_OPERACIONES);
  const existente = await almacen.get(operacion.id);
  if (existente && String(existente.usuario_id) !== String(operacion.usuario_id)) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('El identificador de la captura pertenece a otro usuario local.');
  }
  const animalId = animalIdDeOperacion(operacion);
  const fila = animalId === null ? operacion : { ...operacion, animal_id: animalId };
  await almacen.put(fila);
  await tx.done;
  return fila;
}

/**
 * Cambios de este dispositivo sobre un animal que el servidor todavía no
 * confirmó (pendientes, en espera, con error) y conflictos abiertos. Nunca
 * modifica el snapshot: la UI los muestra aparte como "pendiente".
 */
export async function listarCambiosLocalesAnimal(usuarioId, animalId) {
  if (!usuarioId || animalId === null || animalId === undefined) return { operaciones: [], conflictos: [] };
  const db = await abrirCampoDB();
  const clave = IDBKeyRange.only([usuarioId, Number(animalId)]);
  const [operaciones, conflictos] = await Promise.all([
    db.getAllFromIndex(ALMACEN_OPERACIONES, INDICE_POR_ANIMAL, clave),
    db.getAllFromIndex(ALMACEN_CONFLICTOS, INDICE_POR_ANIMAL, clave),
  ]);
  const porFecha = (a, b) => String(a.creada_en).localeCompare(String(b.creada_en));
  return { operaciones: operaciones.sort(porFecha), conflictos: conflictos.sort(porFecha) };
}

export async function listarOperacionesLocal(usuarioId, estados = null) {
  if (!usuarioId) return [];
  const db = await abrirCampoDB();
  const filas = await db.getAllFromIndex(ALMACEN_OPERACIONES, 'por_usuario', usuarioId);
  const permitidos = estados ? new Set(estados) : null;
  return filas
    .filter((fila) => !permitidos || permitidos.has(fila.estado))
    .sort((a, b) => String(a.creada_en).localeCompare(String(b.creada_en)));
}

export async function actualizarOperacionLocal(id, usuarioId, cambios) {
  const db = await abrirCampoDB();
  const tx = db.transaction(ALMACEN_OPERACIONES, 'readwrite');
  const almacen = tx.objectStore(ALMACEN_OPERACIONES);
  const actual = await almacen.get(id);
  if (!actual || String(actual.usuario_id) !== String(usuarioId)) {
    await tx.done;
    return null;
  }
  const siguiente = { ...actual, ...cambios, actualizada_en: new Date().toISOString() };
  await almacen.put(siguiente);
  await tx.done;
  return siguiente;
}

export async function eliminarOperacionLocal(id, usuarioId) {
  if (!id || !usuarioId) return false;
  const db = await abrirCampoDB();
  const tx = db.transaction(ALMACEN_OPERACIONES, 'readwrite');
  const almacen = tx.objectStore(ALMACEN_OPERACIONES);
  const actual = await almacen.get(id);
  if (actual && String(actual.usuario_id) === String(usuarioId)) await almacen.delete(id);
  await tx.done;
  return Boolean(actual && String(actual.usuario_id) === String(usuarioId));
}

export async function moverOperacionAConflicto(id, usuarioId, conflicto) {
  const db = await abrirCampoDB();
  const tx = db.transaction([ALMACEN_OPERACIONES, ALMACEN_CONFLICTOS], 'readwrite');
  const operacion = await tx.objectStore(ALMACEN_OPERACIONES).get(id);
  if (!operacion || String(operacion.usuario_id) !== String(usuarioId)) {
    await tx.done;
    return null;
  }
  const conflictoExistente = await tx.objectStore(ALMACEN_CONFLICTOS).get(id);
  if (conflictoExistente && String(conflictoExistente.usuario_id) !== String(usuarioId)) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('El identificador del conflicto pertenece a otro usuario local.');
  }
  const registro = {
    ...operacion,
    estado: 'conflicto',
    conflicto,
    detectado_en: new Date().toISOString(),
  };
  await tx.objectStore(ALMACEN_CONFLICTOS).put(registro);
  await tx.objectStore(ALMACEN_OPERACIONES).delete(id);
  await tx.done;
  return registro;
}

export async function listarConflictosLocal(usuarioId) {
  if (!usuarioId) return [];
  const db = await abrirCampoDB();
  const filas = await db.getAllFromIndex(ALMACEN_CONFLICTOS, 'por_usuario', usuarioId);
  return filas.sort((a, b) => String(a.detectado_en).localeCompare(String(b.detectado_en)));
}

export async function eliminarConflictoLocal(id, usuarioId) {
  if (!id || !usuarioId) return false;
  const db = await abrirCampoDB();
  const tx = db.transaction(ALMACEN_CONFLICTOS, 'readwrite');
  const almacen = tx.objectStore(ALMACEN_CONFLICTOS);
  const actual = await almacen.get(id);
  if (actual && String(actual.usuario_id) === String(usuarioId)) await almacen.delete(id);
  await tx.done;
  return Boolean(actual && String(actual.usuario_id) === String(usuarioId));
}

function comprobanteDesdeOperacion(operacion, resultado = {}) {
  return {
    id: operacion.id,
    usuario_id: operacion.usuario_id,
    tipo: operacion.tipo,
    entidad: operacion.entidad,
    entidad_id: operacion.entidad_id,
    contexto_publico: operacion.contexto_publico || null,
    sincronizada_en: new Date().toISOString(),
    resultado: {
      code: resultado.code || 'SYNC_CONFIRMED',
      message: resultado.message || 'Sincronizado con El Rancho',
    },
  };
}

async function podarHistorial(tx, usuarioId, ahora = Date.now()) {
  const almacen = tx.objectStore(ALMACEN_HISTORIAL_SYNC);
  const filas = await almacen.index('por_usuario').getAll(usuarioId);
  filas.sort((a, b) => String(b.sincronizada_en).localeCompare(String(a.sincronizada_en)));
  const limite = ahora - RETENCION_HISTORIAL_MS;
  await Promise.all(filas
    .filter((fila, indice) => indice >= MAX_HISTORIAL_POR_USUARIO || new Date(fila.sincronizada_en).getTime() < limite)
    .map((fila) => almacen.delete(fila.id)));
}

export async function guardarHistorialSincronizado(operacion, resultado) {
  if (!operacion?.id || !operacion?.usuario_id) throw new Error('El comprobante requiere operación y usuario.');
  const db = await abrirCampoDB();
  const tx = db.transaction(ALMACEN_HISTORIAL_SYNC, 'readwrite');
  const almacen = tx.objectStore(ALMACEN_HISTORIAL_SYNC);
  const existente = await almacen.get(operacion.id);
  if (existente && String(existente.usuario_id) !== String(operacion.usuario_id)) {
    tx.abort();
    await tx.done.catch(() => {});
    throw new Error('El identificador del comprobante pertenece a otro usuario local.');
  }
  await almacen.put(comprobanteDesdeOperacion(operacion, resultado));
  await podarHistorial(tx, operacion.usuario_id);
  await tx.done;
}

export async function confirmarOperacionSincronizada(id, usuarioId, resultado) {
  const db = await abrirCampoDB();
  const tx = db.transaction([ALMACEN_OPERACIONES, ALMACEN_HISTORIAL_SYNC], 'readwrite');
  const operaciones = tx.objectStore(ALMACEN_OPERACIONES);
  const operacion = await operaciones.get(id);
  if (!operacion || String(operacion.usuario_id) !== String(usuarioId)) {
    await tx.done;
    return null;
  }
  await tx.objectStore(ALMACEN_HISTORIAL_SYNC).put(comprobanteDesdeOperacion(operacion, resultado));
  await operaciones.delete(id);
  await podarHistorial(tx, usuarioId);
  await tx.done;
  return operacion;
}

export async function listarHistorialSincronizacionLocal(usuarioId) {
  if (!usuarioId) return [];
  const db = await abrirCampoDB();
  const filas = await db.getAllFromIndex(ALMACEN_HISTORIAL_SYNC, 'por_usuario', usuarioId);
  return filas.sort((a, b) => String(b.sincronizada_en).localeCompare(String(a.sincronizada_en)));
}

/** Elimina sólo el snapshot legible; conserva capturas pendientes tras una revocación/expiración. */
export async function limpiarSnapshotUsuarioLocal(usuarioId) {
  if (!usuarioId) return;
  const db = await abrirCampoDB();
  const tx = db.transaction([...ALMACENES_V1, ...ALMACENES_V4], 'readwrite');
  await Promise.all([
    ...[...ALMACENES_V1, ...ALMACENES_V4].map((almacen) => tx.objectStore(almacen).delete(usuarioId)),
    tx.done,
  ]);
}

/**
 * Logout en equipo compartido (ver docs/MODO_OFFLINE.md): borra
 * físicamente el snapshot, operaciones y conflictos del usuario en una
 * única transacción. No deja rastro recuperable en este dispositivo — el
 * siguiente usuario que inicie sesión (el mismo u otro) nunca puede ver
 * este snapshot, ni siquiera indirectamente.
 */
export async function limpiarDatosUsuarioLocal(usuarioId) {
  if (!usuarioId) return;
  const db = await abrirCampoDB();
  const tx = db.transaction(TODOS_LOS_ALMACENES, 'readwrite');
  const eliminarFilasUsuario = async (almacen) => {
    let cursor = await tx.objectStore(almacen).index('por_usuario').openCursor(usuarioId);
    while (cursor) {
      await cursor.delete();
      cursor = await cursor.continue();
    }
  };
  await Promise.all([
    ...[...ALMACENES_V1, ...ALMACENES_V4].map((almacen) => tx.objectStore(almacen).delete(usuarioId)),
    eliminarFilasUsuario(ALMACEN_OPERACIONES),
    eliminarFilasUsuario(ALMACEN_CONFLICTOS),
    eliminarFilasUsuario(ALMACEN_HISTORIAL_SYNC),
  ]);
  await tx.done;
}
