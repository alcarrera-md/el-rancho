import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {
  _cerrarConexionParaPruebas, CAMPO_DB_NOMBRE, guardarBootstrapLocal, leerSesionLocal,
  limpiarDatosUsuarioLocal, limpiarSnapshotUsuarioLocal, listarConflictosLocal, listarOperacionesLocal,
  listarHistorialSincronizacionLocal, leerColeccionLocal, ALMACEN_INSUMOS,
} from '../src/offline/campoDB.js';
import {
  _reiniciarSincronizacionParaPruebas, capturarConSoporteOffline, construirOperacion,
  descartarOperacion, encolarOperacion, metadataOperacion, sincronizarOperacionesPendientes, TIPO_OPERACION,
  calcularRetardoReintento,
} from '../src/offline/colaOperaciones.js';
import {
  describirConflicto, estadoGeneralSincronizacion, rutaParaVolverACapturar,
} from '../src/offline/syncUx.js';

const valoresLocales = new Map();
globalThis.localStorage = {
  getItem: (clave) => valoresLocales.get(clave) ?? null,
  setItem: (clave, valor) => valoresLocales.set(clave, String(valor)),
  removeItem: (clave) => valoresLocales.delete(clave),
};

const usuario = { id: 7, rol: 'Trabajador', nombre: 'Campo' };

function tokenPara(usuarioId) {
  const base64url = (valor) => Buffer.from(JSON.stringify(valor)).toString('base64url');
  return `${base64url({ alg: 'HS256' })}.${base64url({ id: usuarioId, exp: 2000000000 })}.firma`;
}

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

function pesaje(id = '11111111-1111-4111-8111-111111111111') {
  return construirOperacion({
    usuario, id, tipo: TIPO_OPERACION.PESAJE, entidadId: 10,
    payload: { animal_id: 10, fecha: '2026-09-07', peso_kg: 412.5, observacion: '' },
    ahora: new Date('2026-09-07T12:00:00.000Z'),
  });
}

function alimentacion(id = '55555555-5555-4555-8555-555555555555') {
  return construirOperacion({
    usuario, id, tipo: TIPO_OPERACION.ALIMENTACION, entidadId: 10,
    payload: {
      animal_id: 10, corral_contexto_id: 3, insumo_id: 6, cantidad: 70, fecha: '2026-09-07',
      unidad_medida: 'kg', expected_version: 3, stock_observado: 100,
    },
    contextoPublico: { entidad: 'Forraje · Animal MX-10' },
    ahora: new Date('2026-09-07T12:05:00.000Z'),
  });
}

function movimiento(id = '66666666-6666-4666-8666-666666666666') {
  return construirOperacion({
    usuario, id, tipo: TIPO_OPERACION.MOVIMIENTO, entidadId: 10,
    payload: {
      corral_id: 4, corral_origen_id: 3, expected_version: 5, estado_observado: 'vivo',
      destino_ocupacion_observada: 9, destino_capacidad_observada: 10,
    },
    contextoPublico: { entidad: 'MX-10 · Norte → Sur' },
    ahora: new Date('2026-09-07T12:08:00.000Z'),
  });
}

test('encola una captura persistente sin guardar tokens ni secretos', async () => {
  await baseLimpia();
  const guardada = await encolarOperacion(pesaje());
  const filas = await listarOperacionesLocal(usuario.id);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].client_operation_id, guardada.id);
  assert.equal(filas[0].estado, 'pendiente');
  assert.equal(JSON.stringify(filas).includes('Bearer'), false);
  assert.equal(JSON.stringify(filas).includes('password'), false);
  assert.deepEqual(metadataOperacion(guardada, true), {
    offline: true,
    id: guardada.id,
    installationId: guardada.installation_id,
    fechaLocal: guardada.fecha_local,
  });
});

test('una respuesta perdida conserva exactamente el UUID del primer intento online', async () => {
  await baseLimpia();
  let idEnviado;
  const resultado = await capturarConSoporteOffline({
    usuario, sinConexion: false, tipo: TIPO_OPERACION.PESAJE, entidadId: 10,
    payload: pesaje().payload,
    ejecutarOnline: async (operacion) => {
      idEnviado = operacion.id;
      const error = new Error('respuesta perdida');
      error.code = 'NETWORK_ERROR';
      throw error;
    },
  });
  assert.equal(resultado.offline_pending, true);
  const [guardada] = await listarOperacionesLocal(usuario.id);
  assert.equal(guardada.id, idEnviado);
});

test('sincroniza en orden y elimina sólo después de confirmación', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje('11111111-1111-4111-8111-111111111111'));
  await encolarOperacion(construirOperacion({
    usuario, id: '22222222-2222-4222-8222-222222222222', tipo: TIPO_OPERACION.PESAJE, entidadId: 10,
    payload: pesaje().payload, ahora: new Date('2026-09-07T12:01:00.000Z'),
  }));
  const enviados = [];
  await sincronizarOperacionesPendientes(usuario, { enviar: async (operacion) => { enviados.push(operacion.id); return { id: 1 }; } });
  assert.deepEqual(enviados, ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222']);
  assert.deepEqual(await listarOperacionesLocal(usuario.id), []);
});

test('una operación confirmada deja historial mínimo sin payload', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => ({ code: 'PESAJE_CREADO' }) });
  assert.deepEqual(await listarOperacionesLocal(usuario.id), []);
  const [comprobante] = await listarHistorialSincronizacionLocal(usuario.id);
  assert.equal(comprobante.tipo, TIPO_OPERACION.PESAJE);
  assert.equal(comprobante.resultado.code, 'SYNC_CONFIRMED');
  assert.equal('payload' in comprobante, false);
});

test('dos disparos concurrentes procesan una sola ronda local', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  let llamadas = 0;
  const enviar = async () => { llamadas += 1; await new Promise((resolve) => setTimeout(resolve, 10)); };
  await Promise.all([
    sincronizarOperacionesPendientes(usuario, { enviar }),
    sincronizarOperacionesPendientes(usuario, { enviar }),
  ]);
  assert.equal(llamadas, 1);
});

test('un conflicto 409 se separa y nunca se sobrescribe automáticamente', async () => {
  await baseLimpia();
  await encolarOperacion({
    usuario, id: '33333333-3333-4333-8333-333333333333', tipo: TIPO_OPERACION.COMPLETAR_TAREA,
    entidadId: 9, payload: { completada: true, expected_version: 2 },
  });
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => {
    const error = new Error('La tarea cambió desde la última sincronización.');
    error.status = 409;
    error.code = 'TAREA_VERSION_CONFLICT';
    throw error;
  } });
  assert.deepEqual(await listarOperacionesLocal(usuario.id), []);
  const conflictos = await listarConflictosLocal(usuario.id);
  assert.equal(conflictos.length, 1);
  assert.equal(conflictos[0].conflicto.code, 'TAREA_VERSION_CONFLICT');
});

test('un permiso revocado por el servidor queda como conflicto y no se reintenta a ciegas', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => {
    const error = new Error('Ya no tienes permiso para esta operación.');
    error.status = 403;
    error.code = 'FORBIDDEN';
    throw error;
  } });
  assert.deepEqual(await listarOperacionesLocal(usuario.id), []);
  assert.equal((await listarConflictosLocal(usuario.id))[0].conflicto.code, 'FORBIDDEN');
});

test('completar dos veces la misma tarea mantiene una sola intención local', async () => {
  await baseLimpia();
  const datos = {
    usuario, tipo: TIPO_OPERACION.COMPLETAR_TAREA, entidadId: 9,
    payload: { completada: true, expected_version: 2 },
  };
  const primera = await encolarOperacion(datos);
  const segunda = await encolarOperacion(datos);
  assert.equal(segunda.id, primera.id);
  assert.equal((await listarOperacionesLocal(usuario.id)).length, 1);
});

test('un fallo de red conserva la operación pendiente para reintentar', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => {
    const error = new Error('sin red');
    error.code = 'NETWORK_ERROR';
    throw error;
  } });
  const [pendiente] = await listarOperacionesLocal(usuario.id);
  assert.equal(pendiente.estado, 'pendiente');
  assert.equal(pendiente.intentos, 1);
});

test('500 y timeout conservan la operación pendiente con mensaje seguro', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  const error = new Error('SQL interno y conexión privada');
  error.status = 500;
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw error; } });
  let [pendiente] = await listarOperacionesLocal(usuario.id);
  assert.equal(pendiente.estado, 'pendiente');
  assert.equal(pendiente.ultimo_error.code, 'SERVER_TEMPORARY');
  assert.equal(pendiente.ultimo_error.message.includes('SQL'), false);

  await baseLimpia();
  await encolarOperacion(pesaje());
  const timeout = new Error('stack y detalles internos');
  timeout.code = 'TIMEOUT';
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw timeout; } });
  [pendiente] = await listarOperacionesLocal(usuario.id);
  assert.equal(pendiente.estado, 'pendiente');
  assert.equal(pendiente.ultimo_error.code, 'SYNC_TIMEOUT');
});

test('404 se presenta como conflicto recuperable, no como error técnico', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  const error = new Error('relation animal internals');
  error.status = 404;
  error.code = 'ANIMAL_NO_ENCONTRADO';
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw error; } });
  const [conflicto] = await listarConflictosLocal(usuario.id);
  assert.equal(conflicto.conflicto.code, 'ANIMAL_NO_ENCONTRADO');
  assert.equal(conflicto.conflicto.message.includes('relation'), false);
});

test('backoff usa retrasos crecientes y acotados', () => {
  assert.deepEqual([1, 2, 3, 4, 99].map(calcularRetardoReintento), [5000, 15000, 45000, 60000, 60000]);
});

test('la capa UX explica conflictos y conserva contexto para volver a capturar', () => {
  const operacion = construirOperacion({
    usuario, tipo: TIPO_OPERACION.OBSERVACION, entidadId: 10,
    payload: { animal_id: 10, observacion: 'Requiere revisión' },
  });
  const detalle = describirConflicto({ ...operacion, conflicto: { code: 'ANIMAL_INACTIVO' } });
  assert.match(detalle.motivo, /activo/i);
  assert.equal(rutaParaVolverACapturar(operacion), '/animales/10/seguimiento?accion=observacion');
  assert.equal(estadoGeneralSincronizacion({ conectividad: 'offline', autenticacion: 'autenticado', estado: { pendientes: 2, conflictos: [] } }).titulo, 'Sin conexión · 2 pendientes');
});

test('cola y conflictos están aislados por usuario y logout los elimina físicamente', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  assert.deepEqual(await listarOperacionesLocal(8), []);
  await descartarOperacion('11111111-1111-4111-8111-111111111111', 8);
  assert.equal((await listarOperacionesLocal(usuario.id)).length, 1);
  await limpiarDatosUsuarioLocal(usuario.id);
  assert.deepEqual(await listarOperacionesLocal(usuario.id), []);
  assert.deepEqual(await listarConflictosLocal(usuario.id), []);
  assert.equal(await leerSesionLocal(usuario.id), undefined);
});

test('un UUID local no puede sobrescribir la captura de otro usuario', async () => {
  await baseLimpia();
  await encolarOperacion(pesaje());
  await assert.rejects(encolarOperacion({
    usuario: { ...usuario, id: 8 },
    id: '11111111-1111-4111-8111-111111111111',
    tipo: TIPO_OPERACION.PESAJE,
    entidadId: 10,
    payload: pesaje().payload,
  }), /otro usuario/);
  assert.equal((await listarOperacionesLocal(usuario.id)).length, 1);
  assert.deepEqual(await listarOperacionesLocal(8), []);
});

test('un reintento diferido de A nunca usa la sesión activa de B', async () => {
  await baseLimpia();
  const operacionA = movimiento();
  await encolarOperacion(operacionA);
  localStorage.setItem('sistema_ganadero_token', tokenPara(8));
  let peticiones = 0;
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = async () => {
    peticiones += 1;
    return { ok: true, status: 200, json: async () => ({ animal: { id: 10 }, movimiento: { id: 91 } }) };
  };
  try {
    await sincronizarOperacionesPendientes({ id: 7, rol: 'Trabajador' });
    assert.equal(peticiones, 0);
    const [pendienteA] = await listarOperacionesLocal(7);
    assert.equal(pendienteA.id, operacionA.id);
    assert.equal(pendienteA.estado, 'pendiente');

    // Equivale a reautenticar al propietario después de que el JWT
    // venció: la misma fila y UUID sí pueden salir con su nueva sesión.
    localStorage.setItem('sistema_ganadero_token', tokenPara(7));
    await sincronizarOperacionesPendientes({ id: 7, rol: 'Trabajador' });
    assert.equal(peticiones, 1);
    assert.deepEqual(await listarOperacionesLocal(7), []);
  } finally {
    globalThis.fetch = fetchOriginal;
    localStorage.removeItem('sistema_ganadero_token');
  }
});

test('alimentación offline conserva stock, unidad, versión y propietario sin secretos', async () => {
  await baseLimpia();
  const guardada = await encolarOperacion(alimentacion());
  const [fila] = await listarOperacionesLocal(usuario.id);
  assert.equal(fila.tipo, TIPO_OPERACION.ALIMENTACION);
  assert.equal(fila.usuario_id, usuario.id);
  assert.equal(fila.payload.stock_observado, 100);
  assert.equal(fila.payload.expected_version, 3);
  assert.equal(fila.payload.unidad_medida, 'kg');
  assert.equal(fila.payload.corral_contexto_id, 3);
  assert.equal(guardada.contexto_publico.entidad, 'Forraje · Animal MX-10');
  assert.equal(/token|jwt|password/i.test(JSON.stringify(fila)), false);
});

test('conflicto de stock conserva el snapshot local y muestra existencias actuales seguras', async () => {
  await baseLimpia();
  await guardarBootstrapLocal(usuario.id, {
    sesion: { nombre: 'Campo' }, animales: { datos: [] }, corrales: { datos: [] }, tareas: { datos: [] },
    insumos: { datos: [{ id: 6, nombre: 'Forraje', stock_actual: 100, unidad_medida: 'kg', version: 3 }] },
    metadatos: { server_timestamp: '2026-09-07T12:00:00.000Z' },
  });
  await encolarOperacion(alimentacion());
  const error = new Error('detalle interno que no debe mostrarse');
  error.status = 409;
  error.code = 'INSUMO_VERSION_CONFLICT';
  error.details = [{ field: 'stock_actual', message: 'Revisa la existencia actual.', observado: 100, actual: 50, unidad_medida: 'kg', version_observada: 3, version_actual: 4 }];
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw error; } });
  const [conflicto] = await listarConflictosLocal(usuario.id);
  assert.equal(conflicto.conflicto.details[0].actual, 50);
  assert.equal((await leerColeccionLocal(ALMACEN_INSUMOS, usuario.id)).datos[0].stock_actual, 100);
  const descripcion = describirConflicto(conflicto);
  assert.match(descripcion.cambio, /50 kg/);
  assert.match(descripcion.intento, /70 kg/);
  assert.equal(rutaParaVolverACapturar(conflicto), '/animales/10/seguimiento?accion=alimentacion');
});

test('movimiento offline conserva precondiciones, propietario e identidad de instalación', async () => {
  await baseLimpia();
  const guardada = await encolarOperacion(movimiento());
  const [fila] = await listarOperacionesLocal(usuario.id);
  assert.equal(fila.tipo, TIPO_OPERACION.MOVIMIENTO);
  assert.equal(fila.usuario_id, usuario.id);
  assert.equal(fila.payload.corral_origen_id, 3);
  assert.equal(fila.payload.corral_id, 4);
  assert.equal(fila.payload.expected_version, 5);
  assert.equal(fila.payload.estado_observado, 'vivo');
  assert.equal(fila.payload.destino_ocupacion_observada, 9);
  assert.equal(fila.payload.destino_capacidad_observada, 10);
  assert.equal(guardada.contexto_publico.entidad, 'MX-10 · Norte → Sur');
  assert.ok(guardada.installation_id);
  assert.equal(/token|jwt|password/i.test(JSON.stringify(fila)), false);
});

test('respuesta perdida de movimiento conserva el UUID original para replay idempotente', async () => {
  await baseLimpia();
  let uuidEnviado;
  const captura = movimiento();
  const resultado = await capturarConSoporteOffline({
    usuario, sinConexion: false, tipo: TIPO_OPERACION.MOVIMIENTO, entidadId: captura.entidad_id,
    payload: captura.payload, contextoPublico: captura.contexto_publico,
    ejecutarOnline: async (operacion) => {
      uuidEnviado = operacion.id;
      const error = new Error('respuesta perdida después de enviar');
      error.code = 'NETWORK_ERROR';
      throw error;
    },
  });
  assert.equal(resultado.offline_pending, true);
  const [pendiente] = await listarOperacionesLocal(usuario.id);
  assert.equal(pendiente.id, uuidEnviado);
  assert.equal(pendiente.tipo, TIPO_OPERACION.MOVIMIENTO);
});

test('movimiento sobrevive cierre, retry y reconexión; dos disparos envían una sola vez', async () => {
  await baseLimpia();
  const original = await encolarOperacion(movimiento());
  const fallo = new Error('sin red');
  fallo.code = 'NETWORK_ERROR';
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw fallo; } });
  assert.equal((await listarOperacionesLocal(usuario.id))[0].intentos, 1);

  await _cerrarConexionParaPruebas();
  const [reabierta] = await listarOperacionesLocal(usuario.id);
  assert.equal(reabierta.id, original.id);
  let envios = 0;
  let uuidReintentado;
  const enviar = async (operacion) => {
    envios += 1;
    uuidReintentado = operacion.id;
    return { movimiento: { id: 91 } };
  };
  await Promise.all([
    sincronizarOperacionesPendientes(usuario, { enviar }),
    sincronizarOperacionesPendientes(usuario, { enviar }),
  ]);
  assert.equal(envios, 1);
  assert.equal(uuidReintentado, original.id);
  assert.deepEqual(await listarOperacionesLocal(usuario.id), []);
});

test('conflicto de movimiento conserva la intención y permite recapturar con datos actuales', async () => {
  await baseLimpia();
  await encolarOperacion(movimiento());
  const error = new Error('detalle interno');
  error.status = 409;
  error.code = 'ANIMAL_CORRAL_CAMBIO';
  error.details = [{
    field: 'corral_origen_id', observado: 3, actual: 8, destino: 4,
    corral_observado: 3, corral_actual: 'Potrero Este',
  }];
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw error; } });

  assert.deepEqual(await listarOperacionesLocal(usuario.id), []);
  const [conflicto] = await listarConflictosLocal(usuario.id);
  assert.equal(conflicto.payload.corral_origen_id, 3);
  assert.equal(conflicto.payload.corral_id, 4);
  assert.match(describirConflicto(conflicto).cambio, /Potrero Este/);
  assert.equal(rutaParaVolverACapturar(conflicto), '/animales/10/seguimiento?accion=mover');
  await descartarOperacion(conflicto.id, usuario.id, { conflicto: true });
  assert.deepEqual(await listarConflictosLocal(usuario.id), []);
});

test('destino lleno se explica con capacidad actual sin mutar el snapshot observado', async () => {
  await baseLimpia();
  await encolarOperacion(movimiento());
  const error = new Error('sin cupo');
  error.status = 409;
  error.code = 'CORRAL_SIN_CAPACIDAD';
  error.details = [{ field: 'corral_id', observado: 9, actual: 10, capacidad_observada: 10, capacidad_actual: 10 }];
  await sincronizarOperacionesPendientes(usuario, { enviar: async () => { throw error; } });
  const [conflicto] = await listarConflictosLocal(usuario.id);
  assert.equal(conflicto.payload.destino_ocupacion_observada, 9);
  assert.match(describirConflicto(conflicto).cambio, /10 de 10/);
});

test('una sesión invalidada retira el snapshot pero conserva la cola del mismo usuario', async () => {
  await baseLimpia();
  await guardarBootstrapLocal(usuario.id, {
    sesion: { usuario: { ...usuario, email: 'campo@rancho.test' } },
    animales: { items: [] }, corrales: { items: [] }, tareas: { items: [] }, insumos: { items: [] },
    metadatos: { schema_version: 1, server_timestamp: '2026-09-07T12:00:00.000Z' },
  });
  await encolarOperacion(pesaje());

  await limpiarSnapshotUsuarioLocal(usuario.id);

  assert.equal(await leerSesionLocal(usuario.id), undefined);
  assert.equal((await listarOperacionesLocal(usuario.id)).length, 1);
});

test('un rol sin permiso no puede crear la captura local', async () => {
  await baseLimpia();
  assert.throws(() => construirOperacion({
    usuario: { id: 12, rol: 'Auditor' }, tipo: TIPO_OPERACION.PESAJE, entidadId: 10, payload: pesaje().payload,
  }), /no permite/);
});

test('rechaza payloads demasiado grandes o con claves sensibles', async () => {
  await baseLimpia();
  assert.throws(() => construirOperacion({
    usuario, tipo: TIPO_OPERACION.NOTA, entidadId: 10,
    payload: { animal_id: 10, contenido: 'x'.repeat(101 * 1024), tag: 'General' },
  }), /tamaño máximo/);
  assert.throws(() => construirOperacion({
    usuario, tipo: TIPO_OPERACION.NOTA, entidadId: 10,
    payload: { animal_id: 10, contenido: 'normal', jwt_token: 'no debe guardarse' },
  }), /información que no puede guardarse/);
});
