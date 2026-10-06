const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

const actores = new Map();
const instalacionId = crypto.randomUUID();
let secuencia = 0;
let contexto;

function marca(prefijo) {
  secuencia += 1;
  return `OFFLINE-${prefijo}-${Date.now()}-${secuencia}`;
}

async function crearActor(rol) {
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, 'hash-test', id, true FROM rol WHERE nombre = $3
     RETURNING id, nombre, email, sesion_version`,
    [`Offline ${rol}`, `${marca(rol).toLowerCase()}@rancho.test`, rol]
  );
  const actor = { ...rows[0], rol };
  actor.token = jwt.sign(
    { id: actor.id, nombre: actor.nombre, email: actor.email, sesion_version: actor.sesion_version },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
  actores.set(rol, actor);
  return actor;
}

async function crearTrabajador(usuario, nombre) {
  const { rows } = await db.query(
    'INSERT INTO trabajador (usuario_id, nombre, activo) VALUES ($1,$2,true) RETURNING *',
    [usuario.id, nombre]
  );
  return rows[0];
}

async function crearTarea(trabajadorId, estado = 'pendiente') {
  const { rows } = await db.query(
    `INSERT INTO asignacion_tarea
     (trabajador_id, titulo, descripcion, tipo, fecha, prioridad, estado)
     VALUES ($1,$2,$3,'revision_general',CURRENT_DATE,'media',$4) RETURNING *`,
    [trabajadorId, marca('TAREA'), 'Tarea para probar sincronización offline.', estado]
  );
  return rows[0];
}

async function crearAlimento(stock = 100, opciones = {}) {
  const { rows } = await db.query(
    `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo, fecha_caducidad)
     VALUES ($1, 'alimento', $2, $3, 0, $4) RETURNING *`,
    [marca('ALIMENTO'), opciones.unidad || 'kg', stock, opciones.caducidad || '2099-12-31']
  );
  return rows[0];
}

function payloadAlimentacion(insumo, cantidad, destino = {}) {
  const porCorral = Boolean(destino.corral_id);
  return {
    animal_id: porCorral ? undefined : (destino.animal_id ?? contexto.animalActivo.id),
    corral_contexto_id: porCorral ? undefined : (destino.corral_contexto_id ?? contexto.corral.id),
    ...(porCorral ? { corral_id: destino.corral_id } : {}),
    insumo_id: insumo.id,
    fecha: '2026-09-01',
    cantidad,
    unidad_medida: insumo.unidad_medida,
    expected_version: insumo.version,
    stock_observado: Number(insumo.stock_actual),
  };
}

async function crearCorral(capacidad = 10, opciones = {}) {
  const { rows } = await db.query(
    'INSERT INTO corral (nombre, capacidad_maxima, activo) VALUES ($1,$2,$3) RETURNING *',
    [marca('CORRAL-MOV'), capacidad, opciones.activo ?? true]
  );
  return rows[0];
}

async function crearAnimalMovimiento(corral, estado = 'vivo') {
  const { rows } = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, corral_actual_id)
     VALUES ($1,'hembra','nacimiento',$2,$3) RETURNING *`,
    [marca('ANIMAL-MOV'), estado, corral?.id ?? null]
  );
  return rows[0];
}

function payloadMovimiento(animal, destino, opciones = {}) {
  return {
    corral_id: destino.id,
    corral_origen_id: opciones.corralOrigenId ?? animal.corral_actual_id ?? null,
    expected_version: opciones.expectedVersion ?? animal.version,
    estado_observado: opciones.estadoObservado ?? animal.estado,
    destino_ocupacion_observada: opciones.ocupacionObservada ?? 0,
    destino_capacidad_observada: opciones.capacidadObservada ?? destino.capacidad_maxima,
  };
}

function api(rol, metodo, ruta, body) {
  const llamada = request(app)[metodo](ruta).set('Authorization', `Bearer ${actores.get(rol).token}`);
  return body === undefined ? llamada : llamada.send(body);
}

function offline(rol, metodo, ruta, body, key = crypto.randomUUID(), headers = {}) {
  let llamada = api(rol, metodo, ruta, body)
    .set('X-Offline-Operation', 'true')
    .set('Idempotency-Key', key)
    .set('X-Client-Installation-Id', instalacionId)
    .set('X-Client-Local-Timestamp', '2026-09-01T06:30:00-06:00');
  for (const [nombre, valor] of Object.entries(headers)) llamada = llamada.set(nombre, valor);
  return llamada;
}

async function contarRecibos(usuarioId, key) {
  const { rows } = await db.query(
    'SELECT COUNT(*)::int AS total FROM operacion_cliente WHERE usuario_id = $1 AND client_operation_id = $2',
    [usuarioId, key]
  );
  return rows[0].total;
}

test.before(async () => {
  const admin = await crearActor('Administrador');
  const trabajador = await crearActor('Trabajador');
  const veterinario = await crearActor('Veterinario');
  await crearActor('Auditor');
  const trabajadorCampo = await crearTrabajador(trabajador, 'Responsable offline de campo');
  const trabajadorVeterinario = await crearTrabajador(veterinario, 'Responsable offline veterinario');
  const { rows: corrales } = await db.query(
    'INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 30) RETURNING *',
    [marca('CORRAL')]
  );
  const { rows: animales } = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, corral_actual_id)
     VALUES ($1,'hembra','nacimiento','vivo',$3),
            ($2,'macho','nacimiento','muerto',NULL)
     RETURNING *`,
    [marca('ACTIVO'), marca('INACTIVO'), corrales[0].id]
  );
  contexto = {
    admin, trabajador, veterinario, trabajadorCampo, trabajadorVeterinario,
    corral: corrales[0], animalActivo: animales[0], animalInactivo: animales[1],
  };
});

test.after(async () => {
  await db.pool.end();
});

test('mismo UUID y payload aplica un pesaje una vez y devuelve el resultado previo', async () => {
  const key = crypto.randomUUID();
  const payload = { animal_id: contexto.animalActivo.id, peso_kg: 431.5, observacion: marca('PESAJE') };
  const primera = await offline('Trabajador', 'post', '/api/pesajes', payload, key);
  const repetida = await offline('Trabajador', 'post', '/api/pesajes', payload, key);
  assert.equal(primera.status, 201);
  assert.equal(repetida.status, 201);
  assert.equal(primera.headers['idempotency-replayed'], 'false');
  assert.equal(repetida.headers['idempotency-replayed'], 'true');
  assert.equal(repetida.body.id, primera.body.id);
  const pesajes = await db.query('SELECT id FROM pesaje WHERE observacion = $1', [payload.observacion]);
  const auditoria = await db.query(
    "SELECT id FROM bitacora WHERE accion = 'registrar_pesaje' AND entidad_id = $1",
    [primera.body.id]
  );
  assert.equal(pesajes.rowCount, 1);
  assert.equal(auditoria.rowCount, 1);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 1);
});

test('dos requests concurrentes con el mismo UUID crean una sola nota y una sola auditoría', async () => {
  const key = crypto.randomUUID();
  const payload = { animal_id: contexto.animalActivo.id, tag: 'campo', contenido: marca('NOTA') };
  const respuestas = await Promise.all([
    offline('Trabajador', 'post', '/api/notas-seguimiento', payload, key),
    offline('Trabajador', 'post', '/api/notas-seguimiento', payload, key),
  ]);
  assert.deepEqual(respuestas.map((r) => r.status), [201, 201]);
  assert.equal(new Set(respuestas.map((r) => r.body.id)).size, 1);
  assert.deepEqual(respuestas.map((r) => r.headers['idempotency-replayed']).sort(), ['false', 'true']);
  const notas = await db.query('SELECT id FROM nota_seguimiento WHERE contenido = $1', [payload.contenido]);
  const auditoria = await db.query(
    "SELECT id FROM bitacora WHERE accion = 'crear_nota_seguimiento' AND entidad_id = $1",
    [respuestas[0].body.id]
  );
  assert.equal(notas.rowCount, 1);
  assert.equal(auditoria.rowCount, 1);
});

test('reutilizar UUID con payload distinto devuelve 409 estructurado', async () => {
  const key = crypto.randomUUID();
  const base = { animal_id: contexto.animalActivo.id, peso_kg: 410, observacion: marca('REUSE') };
  assert.equal((await offline('Trabajador', 'post', '/api/pesajes', base, key)).status, 201);
  const conflicto = await offline('Trabajador', 'post', '/api/pesajes', { ...base, peso_kg: 411 }, key);
  assert.equal(conflicto.status, 409);
  assert.equal(conflicto.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('rollback no deja pesaje, auditoría ni recibo falso', async () => {
  const key = crypto.randomUUID();
  const observacion = marca('ROLLBACK');
  const response = await offline('Trabajador', 'post', '/api/pesajes', {
    animal_id: 2147483000, peso_kg: 400, observacion,
  }, key);
  assert.ok(response.status >= 400);
  assert.equal((await db.query('SELECT id FROM pesaje WHERE observacion = $1', [observacion])).rowCount, 0);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 0);
});

test('usuario desactivado y rol sin permiso son rechazados antes de crear recibos', async () => {
  const desactivado = await crearActor('Trabajador');
  await db.query('UPDATE usuario SET activo = false WHERE id = $1', [desactivado.id]);
  const keyDesactivado = crypto.randomUUID();
  const desactivada = await offline('Trabajador', 'post', '/api/pesajes', {
    animal_id: contexto.animalActivo.id, peso_kg: 390,
  }, keyDesactivado);
  assert.equal(desactivada.status, 401);
  assert.equal(await contarRecibos(desactivado.id, keyDesactivado), 0);

  // Restaurar el actor original del mapa para el resto de la suite.
  actores.set('Trabajador', contexto.trabajador);
  const keyAuditor = crypto.randomUUID();
  const denegada = await offline('Auditor', 'post', '/api/pesajes', {
    animal_id: contexto.animalActivo.id, peso_kg: 390,
  }, keyAuditor);
  assert.equal(denegada.status, 403);
  assert.equal(await contarRecibos(actores.get('Auditor').id, keyAuditor), 0);
});

test('observación offline exige animal activo y conserva una sola auditoría', async () => {
  const key = crypto.randomUUID();
  const payload = { estado_salud: 'observacion' };
  const aplicada = await offline('Trabajador', 'patch', `/api/animales/${contexto.animalActivo.id}/estado-salud`, payload, key);
  const repetida = await offline('Trabajador', 'patch', `/api/animales/${contexto.animalActivo.id}/estado-salud`, payload, key);
  assert.equal(aplicada.status, 200);
  assert.equal(repetida.status, 200);
  assert.equal(repetida.headers['idempotency-replayed'], 'true');
  const auditoria = await db.query(
    "SELECT id FROM bitacora WHERE accion = 'cambiar_estado_salud' AND entidad_id = $1",
    [contexto.animalActivo.id]
  );
  assert.equal(auditoria.rowCount, 1);

  const keyInactivo = crypto.randomUUID();
  const inactivo = await offline('Trabajador', 'patch', `/api/animales/${contexto.animalInactivo.id}/estado-salud`, payload, keyInactivo);
  assert.equal(inactivo.status, 409);
  assert.equal(inactivo.body.error.code, 'ANIMAL_INACTIVO');
  assert.equal(await contarRecibos(contexto.trabajador.id, keyInactivo), 0);
});

test('completar tarea offline aplica una vez y exige la versión vigente', async () => {
  const tarea = await crearTarea(contexto.trabajadorCampo.id);
  const key = crypto.randomUUID();
  const payload = { completada: true, expected_version: tarea.version };
  const primera = await offline('Trabajador', 'patch', `/api/asignaciones/${tarea.id}/completar`, payload, key);
  const repetida = await offline('Trabajador', 'patch', `/api/asignaciones/${tarea.id}/completar`, payload, key);
  assert.equal(primera.status, 200);
  assert.equal(repetida.status, 200);
  assert.equal(primera.body.estado, 'completada');
  assert.equal(primera.body.version, tarea.version + 1);
  assert.equal(repetida.body.version, primera.body.version);
  const auditoria = await db.query(
    "SELECT id FROM bitacora WHERE accion = 'completar_tarea' AND entidad_id = $1",
    [tarea.id]
  );
  assert.equal(auditoria.rowCount, 1);
});

test('tarea cancelada, reasignada o con versión antigua produce conflicto sin recibo', async () => {
  const cancelada = await crearTarea(contexto.trabajadorCampo.id, 'cancelada');
  const keyCancelada = crypto.randomUUID();
  const rCancelada = await offline('Trabajador', 'patch', `/api/asignaciones/${cancelada.id}/completar`, {
    completada: true, expected_version: cancelada.version,
  }, keyCancelada);
  assert.equal(rCancelada.status, 409);
  assert.equal(rCancelada.body.error.code, 'TAREA_CANCELADA');

  const reasignada = await crearTarea(contexto.trabajadorCampo.id);
  await db.query('UPDATE asignacion_tarea SET trabajador_id = $1 WHERE id = $2', [contexto.trabajadorVeterinario.id, reasignada.id]);
  const keyReasignada = crypto.randomUUID();
  const rReasignada = await offline('Trabajador', 'patch', `/api/asignaciones/${reasignada.id}/completar`, {
    completada: true, expected_version: reasignada.version,
  }, keyReasignada);
  assert.equal(rReasignada.status, 409);
  assert.equal(rReasignada.body.error.code, 'TAREA_REASIGNADA');

  const modificada = await crearTarea(contexto.trabajadorCampo.id);
  await db.query("UPDATE asignacion_tarea SET prioridad = 'alta' WHERE id = $1", [modificada.id]);
  const keyVersion = crypto.randomUUID();
  const rVersion = await offline('Administrador', 'patch', `/api/asignaciones/${modificada.id}/completar`, {
    completada: true, expected_version: modificada.version,
  }, keyVersion);
  assert.equal(rVersion.status, 409);
  assert.equal(rVersion.body.error.code, 'TAREA_VERSION_CONFLICT');

  assert.equal(await contarRecibos(contexto.trabajador.id, keyCancelada), 0);
  assert.equal(await contarRecibos(contexto.trabajador.id, keyReasignada), 0);
  assert.equal(await contarRecibos(contexto.admin.id, keyVersion), 0);
});

test('bootstrap entrega snapshot mínimo y filtra tareas por rol', async () => {
  const alimento = await crearAlimento(84);
  const propia = await crearTarea(contexto.trabajadorCampo.id);
  const ajena = await crearTarea(contexto.trabajadorVeterinario.id);
  const [trabajador, auditor] = await Promise.all([
    api('Trabajador', 'get', '/api/sync/bootstrap'),
    api('Auditor', 'get', '/api/sync/bootstrap'),
  ]);
  assert.equal(trabajador.status, 200);
  assert.equal(auditor.status, 200);
  assert.equal(trabajador.body.schema, 'offline-bootstrap.v5');
  assert.equal(trabajador.body.partition.usuario_id, contexto.trabajador.id);
  const animalBootstrap = trabajador.body.animales.find((animal) => animal.id === contexto.animalActivo.id);
  assert.ok(animalBootstrap);
  assert.equal(animalBootstrap.estado, 'vivo');
  assert.ok(Number.isInteger(animalBootstrap.version));
  assert.ok(!trabajador.body.animales.some((animal) => animal.id === contexto.animalInactivo.id));
  assert.equal(trabajador.body.usuario.trabajador.id, contexto.trabajadorCampo.id);
  assert.ok(trabajador.body.corrales.every((corral) => Number.isInteger(corral.ocupacion_actual)));
  assert.ok(trabajador.body.corrales.every((corral) => typeof corral.activo === 'boolean'));
  assert.ok(trabajador.body.tareas.some((tarea) => tarea.id === propia.id));
  assert.ok(!trabajador.body.tareas.some((tarea) => tarea.id === ajena.id));
  assert.ok(auditor.body.tareas.some((tarea) => tarea.id === propia.id));
  assert.ok(auditor.body.tareas.some((tarea) => tarea.id === ajena.id));
  assert.ok(trabajador.body.tareas.every((tarea) => Number.isInteger(tarea.version)));
  assert.ok(trabajador.body.tareas.every((tarea) => Array.isArray(tarea.corrales)));
  const insumoBootstrap = trabajador.body.insumos.find((insumo) => insumo.id === alimento.id);
  assert.deepEqual(
    Object.keys(insumoBootstrap).sort(),
    ['activo', 'estado', 'fecha_caducidad', 'id', 'nombre', 'stock_actual', 'unidad_medida', 'version'].sort()
  );
  assert.equal(insumoBootstrap.estado, 'disponible');
  assert.equal(Number(insumoBootstrap.stock_actual), 84);
  assert.ok(Number.isInteger(insumoBootstrap.version));
  const serializado = JSON.stringify(trabajador.body).toLowerCase();
  for (const prohibido of ['password', 'jwt', 'token', 'bitacora', 'finanzas']) {
    assert.equal(serializado.includes(prohibido), false, prohibido);
  }
});

test('alimentación offline se aplica una vez con stock, auditoría y recibo atómicos', async () => {
  const insumo = await crearAlimento(100);
  const key = crypto.randomUUID();
  const payload = payloadAlimentacion(insumo, 12.5);
  const primera = await offline('Trabajador', 'post', '/api/alimentacion', payload, key);
  const repetida = await offline('Trabajador', 'post', '/api/alimentacion', payload, key);
  assert.equal(primera.status, 201);
  assert.equal(repetida.status, 201);
  assert.equal(repetida.headers['idempotency-replayed'], 'true');
  assert.equal(repetida.body.id, primera.body.id);
  const actual = await db.query('SELECT stock_actual, version FROM insumo WHERE id = $1', [insumo.id]);
  assert.equal(Number(actual.rows[0].stock_actual), 87.5);
  assert.equal(actual.rows[0].version, insumo.version + 1);
  assert.equal((await db.query('SELECT id FROM alimentacion WHERE id = $1', [primera.body.id])).rowCount, 1);
  assert.equal((await db.query("SELECT id FROM bitacora WHERE accion = 'registrar_alimentacion' AND entidad_id = $1", [primera.body.id])).rowCount, 1);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 1);
});

test('dos requests concurrentes con el mismo UUID descuentan alimento una sola vez', async () => {
  const insumo = await crearAlimento(100);
  const key = crypto.randomUUID();
  const payload = payloadAlimentacion(insumo, 20);
  const respuestas = await Promise.all([
    offline('Trabajador', 'post', '/api/alimentacion', payload, key),
    offline('Trabajador', 'post', '/api/alimentacion', payload, key),
  ]);
  assert.deepEqual(respuestas.map((respuesta) => respuesta.status), [201, 201]);
  assert.equal(new Set(respuestas.map((respuesta) => respuesta.body.id)).size, 1);
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 80);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 1);
});

test('alimentación offline rechaza UUID reutilizado con otro payload', async () => {
  const insumo = await crearAlimento(100);
  const key = crypto.randomUUID();
  const payload = payloadAlimentacion(insumo, 10);
  assert.equal((await offline('Trabajador', 'post', '/api/alimentacion', payload, key)).status, 201);
  const conflicto = await offline('Trabajador', 'post', '/api/alimentacion', { ...payload, cantidad: 11 }, key);
  assert.equal(conflicto.status, 409);
  assert.equal(conflicto.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
});

test('fallo de destino revierte alimentación, stock, auditoría y recibo', async () => {
  const insumo = await crearAlimento(60);
  const key = crypto.randomUUID();
  const payload = payloadAlimentacion(insumo, 10, { corral_id: 2147483000 });
  const respuesta = await offline('Trabajador', 'post', '/api/alimentacion', payload, key);
  assert.equal(respuesta.status, 404);
  assert.equal(respuesta.body.error.code, 'CORRAL_NO_ENCONTRADO');
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 60);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 0);
});

test('fallo intermedio de auditoría revierte descuento, alimentación y recibo offline', async () => {
  const insumo = await crearAlimento(60);
  const key = crypto.randomUUID();
  await db.query(`
    CREATE OR REPLACE FUNCTION fallar_auditoria_alimentacion_offline()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.accion = 'registrar_alimentacion' THEN
        RAISE EXCEPTION 'fallo de auditoría offline';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_fallar_auditoria_alimentacion_offline
    BEFORE INSERT ON bitacora
    FOR EACH ROW EXECUTE FUNCTION fallar_auditoria_alimentacion_offline();
  `);
  let respuesta;
  try {
    respuesta = await offline('Trabajador', 'post', '/api/alimentacion', payloadAlimentacion(insumo, 10), key);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS trg_fallar_auditoria_alimentacion_offline ON bitacora');
    await db.query('DROP FUNCTION IF EXISTS fallar_auditoria_alimentacion_offline()');
  }
  assert.equal(respuesta.status, 500);
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 60);
  assert.equal((await db.query('SELECT id FROM alimentacion WHERE insumo_id = $1', [insumo.id])).rowCount, 0);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 0);
});

test('alimentación offline valida animal activo, unidad y caducidad', async () => {
  const insumo = await crearAlimento(50);
  const inactivo = await offline('Trabajador', 'post', '/api/alimentacion', {
    ...payloadAlimentacion(insumo, 5), animal_id: contexto.animalInactivo.id,
  });
  assert.equal(inactivo.status, 409);
  assert.equal(inactivo.body.error.code, 'ANIMAL_INACTIVO');

  const unidad = await offline('Trabajador', 'post', '/api/alimentacion', {
    ...payloadAlimentacion(insumo, 5), unidad_medida: 'litros',
  });
  assert.equal(unidad.status, 409);
  assert.equal(unidad.body.error.code, 'INSUMO_UNIDAD_CAMBIO');

  const caducado = await crearAlimento(50, { caducidad: '2025-01-01' });
  const vencido = await offline('Trabajador', 'post', '/api/alimentacion', payloadAlimentacion(caducado, 5));
  assert.equal(vencido.status, 409);
  assert.equal(vencido.body.error.code, 'INSUMO_CADUCADO');

  const desactivado = await crearAlimento(50);
  const estadoPrevio = desactivado.version;
  const actualizado = await db.query('UPDATE insumo SET activo = false WHERE id = $1 RETURNING version', [desactivado.id]);
  assert.equal(actualizado.rows[0].version, estadoPrevio + 1);
  const inhabilitado = await offline('Trabajador', 'post', '/api/alimentacion', {
    ...payloadAlimentacion(desactivado, 5), expected_version: actualizado.rows[0].version,
  });
  assert.equal(inhabilitado.status, 409);
  assert.equal(inhabilitado.body.error.code, 'INSUMO_INACTIVO');
});

test('alimentación offline detecta que el animal cambió de corral', async () => {
  const insumo = await crearAlimento(50);
  const { rows: nuevoCorral } = await db.query(
    'INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 20) RETURNING id',
    [marca('CORRAL-NUEVO')]
  );
  const payload = payloadAlimentacion(insumo, 5);
  await db.query('UPDATE animal SET corral_actual_id = $1 WHERE id = $2', [nuevoCorral[0].id, contexto.animalActivo.id]);
  try {
    const respuesta = await offline('Trabajador', 'post', '/api/alimentacion', payload);
    assert.equal(respuesta.status, 409);
    assert.equal(respuesta.body.error.code, 'ANIMAL_CORRAL_CAMBIO');
    assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 50);
  } finally {
    await db.query('UPDATE animal SET corral_actual_id = $1 WHERE id = $2', [contexto.corral.id, contexto.animalActivo.id]);
  }
});

test('dos dispositivos consumen el mismo stock: uno se aplica, el otro no alcanza y nunca queda negativo', async () => {
  const insumo = await crearAlimento(100);
  const payload = payloadAlimentacion(insumo, 70);
  const respuestas = await Promise.all([
    offline('Trabajador', 'post', '/api/alimentacion', payload),
    offline('Trabajador', 'post', '/api/alimentacion', payload),
  ]);
  assert.deepEqual(respuestas.map((respuesta) => respuesta.status).sort(), [201, 409]);
  // D1 (P8.3): la fila se bloquea con FOR UPDATE; el segundo ya no alcanza.
  const rechazo = respuestas.find((respuesta) => respuesta.status === 409).body.error;
  assert.equal(rechazo.code, 'STOCK_INSUFICIENTE');
  assert.deepEqual([rechazo.details[0].requerido, rechazo.details[0].disponible, rechazo.details[0].insumo], [70, 30, insumo.nombre]);
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 30);
});

test('stock insuficiente offline no crea registros ni altera existencias', async () => {
  const insumo = await crearAlimento(15);
  const key = crypto.randomUUID();
  const respuesta = await offline('Trabajador', 'post', '/api/alimentacion', payloadAlimentacion(insumo, 20), key);
  assert.equal(respuesta.status, 409);
  assert.equal(respuesta.body.error.code, 'STOCK_INSUFICIENTE');
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 15);
  assert.equal((await db.query('SELECT id FROM alimentacion WHERE insumo_id = $1', [insumo.id])).rowCount, 0);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 0);
});

test('caso real: otro consumo cambia stock; la captura offline se aplica si alcanza y si no, STOCK_INSUFICIENTE', async () => {
  const suficiente = await crearAlimento(100);
  const consumoPrevio = await api('Trabajador', 'post', '/api/alimentacion', {
    animal_id: contexto.animalActivo.id, insumo_id: suficiente.id, cantidad: 20, fecha: '2026-09-01',
  });
  assert.equal(consumoPrevio.status, 201);
  const aplicada = await offline('Trabajador', 'post', '/api/alimentacion', payloadAlimentacion(suficiente, 70));
  assert.equal(aplicada.status, 201, 'el stock cambió (100 → 80) pero todavía alcanza');
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [suficiente.id])).rows[0].stock_actual), 10);

  const insumo = await crearAlimento(100);
  const capturaA = payloadAlimentacion(insumo, 70);
  const consumoB = await api('Trabajador', 'post', '/api/alimentacion', {
    animal_id: contexto.animalActivo.id,
    insumo_id: insumo.id,
    cantidad: 50,
    fecha: '2026-09-01',
  });
  assert.equal(consumoB.status, 201);

  const respuestaA = await offline('Trabajador', 'post', '/api/alimentacion', capturaA);
  assert.equal(respuestaA.status, 409);
  assert.equal(respuestaA.body.error.code, 'STOCK_INSUFICIENTE');
  assert.equal(respuestaA.body.error.details[0].observado, 100);
  assert.equal(respuestaA.body.error.details[0].requerido, 70);
  assert.equal(respuestaA.body.error.details[0].disponible, 50);
  assert.equal(respuestaA.body.error.details[0].unidad_medida, 'kg');
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 50);
});

test('alimentación por corral valida el destino y conserva el flujo individual atómico', async () => {
  const insumo = await crearAlimento(40);
  const respuesta = await offline('Trabajador', 'post', '/api/alimentacion', payloadAlimentacion(insumo, 8, {
    corral_id: contexto.corral.id,
  }));
  assert.equal(respuesta.status, 201);
  assert.equal(respuesta.body.corral_id, contexto.corral.id);
  assert.equal(respuesta.body.animal_id, null);
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 32);
});

test('Auditor no puede sincronizar alimentación y no deja recibo', async () => {
  const insumo = await crearAlimento(30);
  const key = crypto.randomUUID();
  const respuesta = await offline('Auditor', 'post', '/api/alimentacion', payloadAlimentacion(insumo, 3), key);
  assert.equal(respuesta.status, 403);
  assert.equal(await contarRecibos(actores.get('Auditor').id, key), 0);
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 30);
});

test('movimiento offline válido actualiza ubicación, versión, historial, auditoría y recibo una sola vez', async () => {
  const origen = await crearCorral();
  const destino = await crearCorral();
  const animal = await crearAnimalMovimiento(origen);
  const movimientosAntes = Number((await db.query('SELECT COUNT(*) FROM movimiento_corral WHERE animal_id = $1', [animal.id])).rows[0].count);
  const key = crypto.randomUUID();
  const payload = payloadMovimiento(animal, destino);

  const primera = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payload, key);
  const repetida = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payload, key);

  assert.equal(primera.status, 200);
  assert.equal(repetida.status, 200);
  assert.equal(primera.headers['idempotency-replayed'], 'false');
  assert.equal(repetida.headers['idempotency-replayed'], 'true');
  assert.equal(repetida.body.movimiento.id, primera.body.movimiento.id);
  assert.equal(primera.body.animal.corral_actual_id, destino.id);
  assert.equal(primera.body.animal.version, animal.version + 1);
  assert.equal(Number((await db.query('SELECT COUNT(*) FROM movimiento_corral WHERE animal_id = $1', [animal.id])).rows[0].count), movimientosAntes + 1);
  assert.equal((await db.query("SELECT id FROM bitacora WHERE accion = 'trasladar_animal' AND entidad_id = $1", [animal.id])).rowCount, 1);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 1);
});

test('caso crítico: un movimiento online distinto conserva el corral actual y genera conflicto offline', async () => {
  const origen = await crearCorral();
  const destinoOffline = await crearCorral();
  const destinoOnline = await crearCorral();
  const animal = await crearAnimalMovimiento(origen);
  const payload = payloadMovimiento(animal, destinoOffline);

  const online = await api('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, { corral_id: destinoOnline.id });
  assert.equal(online.status, 200);
  const key = crypto.randomUUID();
  const sincronizada = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payload, key);

  assert.equal(sincronizada.status, 409);
  assert.equal(sincronizada.body.error.code, 'ANIMAL_CORRAL_CAMBIO');
  assert.equal(sincronizada.body.error.details[0].corral_observado, origen.id);
  assert.equal(sincronizada.body.error.details[0].actual, destinoOnline.id);
  assert.equal(sincronizada.body.error.details[0].destino, destinoOffline.id);
  assert.equal((await db.query('SELECT corral_actual_id FROM animal WHERE id = $1', [animal.id])).rows[0].corral_actual_id, destinoOnline.id);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 0);
});

test('caso crítico: el último espacio ocupado impide el movimiento offline sin sobrecapacidad', async () => {
  const origen = await crearCorral();
  const destino = await crearCorral(1);
  const animal = await crearAnimalMovimiento(origen);
  const payload = payloadMovimiento(animal, destino, { ocupacionObservada: 0 });
  await crearAnimalMovimiento(destino);

  const respuesta = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payload);
  assert.equal(respuesta.status, 409);
  assert.equal(respuesta.body.error.code, 'CORRAL_SIN_CAPACIDAD');
  assert.equal(respuesta.body.error.details[0].actual, 1);
  assert.equal((await db.query('SELECT corral_actual_id FROM animal WHERE id = $1', [animal.id])).rows[0].corral_actual_id, origen.id);
  assert.equal(Number((await db.query("SELECT COUNT(*) FROM animal WHERE corral_actual_id = $1 AND estado = 'vivo'", [destino.id])).rows[0].count), 1);
});

test('movimiento offline distingue destino inexistente, desactivado y origen igual a destino', async () => {
  const origen = await crearCorral();
  const inactivo = await crearCorral(10, { activo: false });
  const animal = await crearAnimalMovimiento(origen);

  const inexistente = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, {
    ...payloadMovimiento(animal, { id: 2147483000, capacidad_maxima: 10 }),
  });
  assert.equal(inexistente.status, 404);
  assert.equal(inexistente.body.error.code, 'CORRAL_NO_ENCONTRADO');

  const desactivado = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payloadMovimiento(animal, inactivo));
  assert.equal(desactivado.status, 409);
  assert.equal(desactivado.body.error.code, 'CORRAL_INACTIVO');

  const mismo = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payloadMovimiento(animal, origen));
  assert.equal(mismo.status, 409);
  assert.equal(mismo.body.error.code, 'CORRAL_DESTINO_IGUAL_ORIGEN');
});

test('movimiento offline rechaza animales vendidos, muertos y sacrificados sin reactivarlos', async () => {
  for (const estado of ['vendido', 'muerto', 'sacrificado']) {
    const origen = await crearCorral();
    const destino = await crearCorral();
    const animal = await crearAnimalMovimiento(origen, estado);
    const respuesta = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payloadMovimiento(animal, destino));
    assert.equal(respuesta.status, 409, estado);
    assert.equal(respuesta.body.error.code, 'ANIMAL_INACTIVO', estado);
    const actual = (await db.query('SELECT estado, corral_actual_id FROM animal WHERE id = $1', [animal.id])).rows[0];
    assert.equal(actual.estado, estado);
    assert.equal(actual.corral_actual_id, origen.id);
  }
});

test('la versión detecta cambios relevantes aun cuando el animal vuelve al corral observado', async () => {
  const origen = await crearCorral();
  const intermedio = await crearCorral();
  const destino = await crearCorral();
  const animal = await crearAnimalMovimiento(origen);
  const payload = payloadMovimiento(animal, destino);
  await db.query('UPDATE animal SET corral_actual_id = $1 WHERE id = $2', [intermedio.id, animal.id]);
  await db.query('UPDATE animal SET corral_actual_id = $1 WHERE id = $2', [origen.id, animal.id]);

  const respuesta = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payload);
  assert.equal(respuesta.status, 409);
  assert.equal(respuesta.body.error.code, 'ANIMAL_VERSION_CONFLICT');
  assert.equal((await db.query('SELECT corral_actual_id FROM animal WHERE id = $1', [animal.id])).rows[0].corral_actual_id, origen.id);
});

test('dos animales que compiten por el último lugar se serializan en el corral destino', async () => {
  const origen = await crearCorral();
  const destino = await crearCorral(1);
  const primero = await crearAnimalMovimiento(origen);
  const segundo = await crearAnimalMovimiento(origen);
  const respuestas = await Promise.all([
    offline('Trabajador', 'patch', `/api/animales/${primero.id}/corral`, payloadMovimiento(primero, destino)),
    offline('Trabajador', 'patch', `/api/animales/${segundo.id}/corral`, payloadMovimiento(segundo, destino)),
  ]);

  assert.deepEqual(respuestas.map((respuesta) => respuesta.status).sort(), [200, 409]);
  assert.equal(respuestas.find((respuesta) => respuesta.status === 409).body.error.code, 'CORRAL_SIN_CAPACIDAD');
  assert.equal(Number((await db.query("SELECT COUNT(*) FROM animal WHERE corral_actual_id = $1 AND estado = 'vivo'", [destino.id])).rows[0].count), 1);
});

test('el trigger serializa también dos altas que compiten por el último lugar', async () => {
  const destino = await crearCorral(1);
  const insertar = (arete) => db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, corral_actual_id)
     VALUES ($1,'hembra','nacimiento','vivo',$2) RETURNING id`,
    [arete, destino.id]
  );
  const resultados = await Promise.allSettled([
    insertar(marca('ALTA-CUPO')),
    insertar(marca('ALTA-CUPO')),
  ]);
  assert.equal(resultados.filter((resultado) => resultado.status === 'fulfilled').length, 1);
  assert.equal(resultados.filter((resultado) => resultado.status === 'rejected').length, 1);
  assert.equal(Number((await db.query("SELECT COUNT(*) FROM animal WHERE corral_actual_id = $1 AND estado = 'vivo'", [destino.id])).rows[0].count), 1);
});

test('fallo de auditoría revierte ubicación, versión, historial y recibo del movimiento', async () => {
  const origen = await crearCorral();
  const destino = await crearCorral();
  const animal = await crearAnimalMovimiento(origen);
  const key = crypto.randomUUID();
  const movimientosAntes = Number((await db.query('SELECT COUNT(*) FROM movimiento_corral WHERE animal_id = $1', [animal.id])).rows[0].count);
  await db.query(`
    CREATE OR REPLACE FUNCTION fallar_auditoria_movimiento_offline()
    RETURNS TRIGGER AS $$
    BEGIN
      IF NEW.accion = 'trasladar_animal' THEN RAISE EXCEPTION 'fallo de auditoría de movimiento'; END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER trg_fallar_auditoria_movimiento_offline
    BEFORE INSERT ON bitacora FOR EACH ROW EXECUTE FUNCTION fallar_auditoria_movimiento_offline();
  `);
  let respuesta;
  try {
    respuesta = await offline('Trabajador', 'patch', `/api/animales/${animal.id}/corral`, payloadMovimiento(animal, destino), key);
  } finally {
    await db.query('DROP TRIGGER IF EXISTS trg_fallar_auditoria_movimiento_offline ON bitacora');
    await db.query('DROP FUNCTION IF EXISTS fallar_auditoria_movimiento_offline()');
  }
  assert.equal(respuesta.status, 500);
  const actual = (await db.query('SELECT corral_actual_id, version FROM animal WHERE id = $1', [animal.id])).rows[0];
  assert.equal(actual.corral_actual_id, origen.id);
  assert.equal(actual.version, animal.version);
  assert.equal(Number((await db.query('SELECT COUNT(*) FROM movimiento_corral WHERE animal_id = $1', [animal.id])).rows[0].count), movimientosAntes);
  assert.equal(await contarRecibos(contexto.trabajador.id, key), 0);
});

test('Auditor no puede sincronizar movimientos ni crear recibos', async () => {
  const origen = await crearCorral();
  const destino = await crearCorral();
  const animal = await crearAnimalMovimiento(origen);
  const key = crypto.randomUUID();
  const respuesta = await offline('Auditor', 'patch', `/api/animales/${animal.id}/corral`, payloadMovimiento(animal, destino), key);
  assert.equal(respuesta.status, 403);
  assert.equal(await contarRecibos(actores.get('Auditor').id, key), 0);
  assert.equal((await db.query('SELECT corral_actual_id FROM animal WHERE id = $1', [animal.id])).rows[0].corral_actual_id, origen.id);
});

test('escenario integral aplica las seis escrituras y recupera cada respuesta perdida sin duplicar', async () => {
  const origen = await crearCorral();
  const destino = await crearCorral();
  const animal = await crearAnimalMovimiento(origen);
  const tarea = await crearTarea(contexto.trabajadorCampo.id);
  const insumo = await crearAlimento(100);
  const marcaPesaje = marca('CERT-PESAJE');
  const marcaNota = marca('CERT-NOTA');
  const movimientosAntes = Number((await db.query('SELECT COUNT(*) FROM movimiento_corral WHERE animal_id = $1', [animal.id])).rows[0].count);
  const casos = [
    { metodo: 'post', ruta: '/api/pesajes', body: { animal_id: animal.id, peso_kg: 405, observacion: marcaPesaje }, status: 201 },
    { metodo: 'post', ruta: '/api/notas-seguimiento', body: { animal_id: animal.id, tag: 'campo', contenido: marcaNota }, status: 201 },
    { metodo: 'patch', ruta: `/api/animales/${animal.id}/estado-salud`, body: { estado_salud: 'observacion' }, status: 200 },
    { metodo: 'patch', ruta: `/api/asignaciones/${tarea.id}/completar`, body: { completada: true, expected_version: tarea.version }, status: 200 },
    { metodo: 'post', ruta: '/api/alimentacion', body: payloadAlimentacion(insumo, 15, { animal_id: animal.id, corral_contexto_id: origen.id }), status: 201 },
    { metodo: 'patch', ruta: `/api/animales/${animal.id}/corral`, body: payloadMovimiento(animal, destino), status: 200 },
  ];
  const respuestas = [];

  for (const caso of casos) {
    const key = crypto.randomUUID();
    const primera = await offline('Trabajador', caso.metodo, caso.ruta, caso.body, key);
    const recuperada = await offline('Trabajador', caso.metodo, caso.ruta, caso.body, key);
    assert.equal(primera.status, caso.status, caso.ruta);
    assert.equal(recuperada.status, caso.status, caso.ruta);
    assert.equal(primera.headers['idempotency-replayed'], 'false', caso.ruta);
    assert.equal(recuperada.headers['idempotency-replayed'], 'true', caso.ruta);
    assert.deepEqual(recuperada.body, primera.body, caso.ruta);
    assert.equal(await contarRecibos(contexto.trabajador.id, key), 1, caso.ruta);
    respuestas.push(primera.body);
  }

  assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM pesaje WHERE observacion = $1', [marcaPesaje])).rows[0].total, 1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS total FROM nota_seguimiento WHERE contenido = $1', [marcaNota])).rows[0].total, 1);
  const animalActual = (await db.query('SELECT estado_salud, corral_actual_id, version FROM animal WHERE id = $1', [animal.id])).rows[0];
  assert.equal(animalActual.estado_salud, 'observacion');
  assert.equal(animalActual.corral_actual_id, destino.id);
  assert.equal(animalActual.version, animal.version + 1);
  assert.equal((await db.query('SELECT estado FROM asignacion_tarea WHERE id = $1', [tarea.id])).rows[0].estado, 'completada');
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumo.id])).rows[0].stock_actual), 85);
  assert.equal(Number((await db.query('SELECT COUNT(*) FROM movimiento_corral WHERE animal_id = $1', [animal.id])).rows[0].count), movimientosAntes + 1);
  assert.equal(respuestas[5].movimiento.corral_destino, destino.nombre);
});
