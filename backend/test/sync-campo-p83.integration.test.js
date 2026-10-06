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
const sufijo = `P83-${Date.now()}`;
let corral;
let vaca;
let vendida;
let vacuna;
let vacunaCaducada;

async function crearActor(rol, nombre = rol) {
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, 'hash-test', id, true FROM rol WHERE nombre = $3
     RETURNING id, nombre, email, sesion_version`,
    [`P83 ${nombre}`, `p83-${nombre.toLowerCase()}-${Date.now()}@rancho.test`, rol]
  );
  const actor = { ...rows[0], rol };
  actor.token = jwt.sign({ id: actor.id, nombre: actor.nombre, email: actor.email, sesion_version: actor.sesion_version }, process.env.JWT_SECRET, { expiresIn: '1h' });
  actor.trabajador = (await db.query('INSERT INTO trabajador (usuario_id, nombre, activo) VALUES ($1,$2,true) RETURNING id', [actor.id, `Trabajador ${nombre}`])).rows[0];
  actores.set(nombre, actor);
  return actor;
}

function offline(actor, metodo, ruta, body, { key = crypto.randomUUID(), fechaLocal = '2026-09-21T10:00:00-06:00' } = {}) {
  return request(app)[metodo](ruta)
    .set('Authorization', `Bearer ${actores.get(actor).token}`)
    .set('X-Offline-Operation', 'true')
    .set('Idempotency-Key', key)
    .set('X-Client-Installation-Id', instalacionId)
    .set('X-Client-Local-Timestamp', fechaLocal)
    .send(body);
}

async function recibos(key) {
  return (await db.query('SELECT COUNT(*)::int n FROM operacion_cliente WHERE client_operation_id = $1', [key])).rows[0].n;
}

async function crearTarea(actor, extra = {}) {
  const { rows } = await db.query(
    `INSERT INTO asignacion_tarea (trabajador_id, titulo, descripcion, tipo, fecha, prioridad, estado)
     VALUES ($1,$2,'Tarea P8.3','revision_general',CURRENT_DATE,'media',$3) RETURNING *`,
    [actores.get(actor).trabajador.id, extra.titulo || `Tarea ${crypto.randomUUID().slice(0, 8)}`, extra.estado || 'pendiente']
  );
  return rows[0];
}

test.before(async () => {
  await crearActor('Administrador');
  await crearActor('Veterinario');
  await crearActor('Trabajador');
  await crearActor('Trabajador', 'Trabajador2');
  await crearActor('Auditor');
  corral = (await db.query('INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 50) RETURNING *', [`Corral ${sufijo}`])).rows[0];
  const animal = async (arete) => (await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, categoria, fecha_nacimiento, corral_actual_id)
     VALUES ($1,'hembra','nacimiento','vivo','vientre','2022-01-01',$2) RETURNING *`, [arete, corral.id])).rows[0];
  vaca = await animal(`${sufijo}-VACA`);
  vendida = await animal(`${sufijo}-VENDIDA`);
  await db.query(`UPDATE animal SET estado='vendido', fecha_baja='2026-09-20' WHERE id=$1`, [vendida.id]);
  vacuna = (await db.query(`INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo, fecha_caducidad) VALUES ($1,'vacuna','dosis',10,0,'2099-01-01') RETURNING *`, [`Vacuna ${sufijo}`])).rows[0];
  vacunaCaducada = (await db.query(`INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo, fecha_caducidad) VALUES ($1,'vacuna','dosis',10,0,'2025-01-01') RETURNING *`, [`Vacuna caducada ${sufijo}`])).rows[0];
});

test.after(async () => db.pool.end());

test('P8.3 Salud: evento sanitario offline es idempotente, respeta baja, permisos e insumo caducado', async () => {
  const evento = { animal_id: vaca.id, tipo: 'vacuna', insumo_id: vacuna.id, fecha: '2026-09-21', proxima_dosis: '2026-10-21', descripcion: 'Refuerzo' };
  const key = crypto.randomUUID();
  const primero = await offline('Veterinario', 'post', '/api/salud', evento, { key });
  assert.equal(primero.status, 201);
  // El servidor aplicó pero la respuesta se perdió: el reenvío devuelve lo mismo.
  const reenvio = await offline('Veterinario', 'post', '/api/salud', evento, { key });
  assert.equal(reenvio.status, 201);
  assert.equal(reenvio.headers['idempotency-replayed'], 'true');
  assert.equal(reenvio.body.id, primero.body.id);
  assert.equal((await db.query(`SELECT COUNT(*)::int n FROM evento_salud WHERE animal_id=$1 AND descripcion='Refuerzo'`, [vaca.id])).rows[0].n, 1);
  assert.equal(await recibos(key), 1);
  // La misma clave con otro contenido no se reutiliza.
  const alterado = await offline('Veterinario', 'post', '/api/salud', { ...evento, descripcion: 'Otro' }, { key });
  assert.equal(alterado.status, 409);
  assert.equal(alterado.body.error.code, 'IDEMPOTENCY_KEY_REUSED');

  // Tratamiento (procedimiento) y diagnóstico usan el mismo alta.
  const tratamiento = await offline('Veterinario', 'post', '/api/salud', { animal_id: vaca.id, tipo: 'tratamiento', enfermedad: 'Cojera', fecha: '2026-09-21' });
  assert.equal(tratamiento.status, 201);

  // Regla de baja (P8.2) por fecha efectiva.
  assert.equal((await offline('Veterinario', 'post', '/api/salud', { animal_id: vendida.id, tipo: 'vacuna', fecha: '2026-09-20' })).status, 201);
  const keyPosterior = crypto.randomUUID();
  const posterior = await offline('Veterinario', 'post', '/api/salud', { animal_id: vendida.id, tipo: 'vacuna', fecha: '2026-09-21' }, { key: keyPosterior });
  assert.equal(posterior.status, 409);
  assert.equal(posterior.body.error.code, 'ANIMAL_DADO_DE_BAJA');
  assert.equal(await recibos(keyPosterior), 0);

  // Insumo caducado: conflicto de negocio, no 500.
  const caducado = await offline('Veterinario', 'post', '/api/salud', { animal_id: vaca.id, tipo: 'vacuna', insumo_id: vacunaCaducada.id, fecha: '2026-09-21' });
  assert.equal(caducado.status, 409);
  assert.equal(caducado.body.error.code, 'INSUMO_CADUCADO');

  // Permisos de policy.js: Trabajador y Auditor no registran salud.
  for (const actor of ['Trabajador', 'Auditor']) {
    const keyRol = crypto.randomUUID();
    const r = await offline(actor, 'post', '/api/salud', evento, { key: keyRol });
    assert.equal(r.status, 403, actor);
    assert.equal(await recibos(keyRol), 0);
  }
  // Online sin cabeceras sigue funcionando igual.
  const online = await request(app).post('/api/salud').set('Authorization', `Bearer ${actores.get('Administrador').token}`).send({ animal_id: vaca.id, tipo: 'desparasitacion', fecha: '2026-09-21' });
  assert.equal(online.status, 201);
});

test('P8.3 Condición corporal: idempotente, responsable desde la sesión y regla de baja', async () => {
  const otro = actores.get('Trabajador2').trabajador.id;
  const captura = { animal_id: vaca.id, fecha: '2026-09-21', puntuacion: 4, observacion: 'Buena', trabajador_id: otro };
  const key = crypto.randomUUID();
  const primero = await offline('Trabajador', 'post', '/api/condicion-corporal', captura, { key });
  assert.equal(primero.status, 201);
  assert.equal(primero.body.trabajador_id, actores.get('Trabajador').trabajador.id, 'no se confía el responsable del cliente');
  const reenvio = await offline('Trabajador', 'post', '/api/condicion-corporal', captura, { key });
  assert.equal(reenvio.headers['idempotency-replayed'], 'true');
  assert.equal((await db.query(`SELECT COUNT(*)::int n FROM condicion_corporal WHERE animal_id=$1 AND observacion='Buena'`, [vaca.id])).rows[0].n, 1);
  assert.equal((await offline('Veterinario', 'post', '/api/condicion-corporal', { animal_id: vendida.id, fecha: '2026-09-19', puntuacion: 3 })).status, 201);
  const posterior = await offline('Veterinario', 'post', '/api/condicion-corporal', { animal_id: vendida.id, fecha: '2026-09-22', puntuacion: 3 });
  assert.equal(posterior.status, 409);
  assert.equal(posterior.body.error.code, 'ANIMAL_DADO_DE_BAJA');
  assert.equal((await offline('Auditor', 'post', '/api/condicion-corporal', captura)).status, 403);
});

test('P8.3 Tareas: completar offline, reintento y cada conflicto con su motivo', async () => {
  const completar = (actor, tarea, key) => offline(actor, 'patch', `/api/asignaciones/${tarea.id}/completar`, { completada: true, expected_version: tarea.version }, { key });

  const normal = await crearTarea('Trabajador');
  const key = crypto.randomUUID();
  assert.equal((await completar('Trabajador', normal, key)).status, 200);
  const reintento = await completar('Trabajador', normal, key);
  assert.equal(reintento.status, 200);
  assert.equal(reintento.headers['idempotency-replayed'], 'true');

  // Otra persona la completó primero: motivo explícito, sin segunda finalización.
  const compartida = await crearTarea('Trabajador');
  await db.query(`UPDATE asignacion_tarea SET estado='completada' WHERE id=$1`, [compartida.id]);
  const yaCompletada = await completar('Trabajador', compartida);
  assert.equal(yaCompletada.status, 409);
  assert.equal(yaCompletada.body.error.code, 'TAREA_ALREADY_COMPLETED');
  assert.match(yaCompletada.body.error.message, /ya fue completada mientras estabas sin conexión/);

  const modificada = await crearTarea('Trabajador');
  await db.query(`UPDATE asignacion_tarea SET prioridad='alta' WHERE id=$1`, [modificada.id]);
  assert.equal((await completar('Trabajador', modificada)).body.error.code, 'TAREA_VERSION_CONFLICT');

  const cancelada = await crearTarea('Trabajador');
  await db.query(`UPDATE asignacion_tarea SET estado='cancelada' WHERE id=$1`, [cancelada.id]);
  assert.equal((await completar('Trabajador', cancelada)).body.error.code, 'TAREA_CANCELADA');

  const reasignada = await crearTarea('Trabajador');
  await db.query('UPDATE asignacion_tarea SET trabajador_id=$1 WHERE id=$2', [actores.get('Trabajador2').trabajador.id, reasignada.id]);
  assert.equal((await completar('Trabajador', { ...reasignada, version: reasignada.version + 1 })).body.error.code, 'TAREA_REASIGNADA');

  // Rol cambiado mientras estaba offline: manda el servidor.
  const trabajador = actores.get('Trabajador');
  const tareaRol = await crearTarea('Trabajador');
  await db.query(`UPDATE usuario SET rol_id=(SELECT id FROM rol WHERE nombre='Auditor') WHERE id=$1`, [trabajador.id]);
  assert.equal((await completar('Trabajador', tareaRol)).status, 403);
  await db.query(`UPDATE usuario SET rol_id=(SELECT id FROM rol WHERE nombre='Trabajador') WHERE id=$1`, [trabajador.id]);
  assert.equal((await db.query('SELECT estado FROM asignacion_tarea WHERE id=$1', [tareaRol.id])).rows[0].estado, 'pendiente');
});

test('P8.3 cola grande: 100 operaciones mixtas en orden, una sola vez cada una', async () => {
  const insumo = (await db.query(`INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo, fecha_caducidad) VALUES ($1,'alimento','kg',1000,0,'2099-01-01') RETURNING *`, [`Heno ${sufijo}`])).rows[0];
  const operaciones = [];
  for (let i = 0; i < 100; i += 1) {
    const tipo = i % 4;
    if (tipo === 0) operaciones.push(['post', '/api/pesajes', { animal_id: vaca.id, fecha: '2026-09-21', peso_kg: 400 + i }, 'Trabajador']);
    if (tipo === 1) operaciones.push(['post', '/api/condicion-corporal', { animal_id: vaca.id, fecha: '2026-09-21', puntuacion: (i % 5) + 1, observacion: `cola ${i}` }, 'Trabajador']);
    if (tipo === 2) operaciones.push(['post', '/api/alimentacion', { animal_id: vaca.id, insumo_id: insumo.id, cantidad: 5, fecha: '2026-09-21', unidad_medida: 'kg', expected_version: insumo.version, stock_observado: 1000, corral_contexto_id: corral.id }, 'Trabajador']);
    if (tipo === 3) operaciones.push(['post', '/api/salud', { animal_id: vaca.id, tipo: 'diagnostico', enfermedad: `cola ${i}`, fecha: '2026-09-21' }, 'Veterinario']);
  }
  const claves = operaciones.map(() => crypto.randomUUID());
  const inicio = Date.now();
  for (let i = 0; i < operaciones.length; i += 1) {
    const [metodo, ruta, body, actor] = operaciones[i];
    const r = await offline(actor, metodo, ruta, body, { key: claves[i] });
    assert.equal(r.status, 201, `${ruta} #${i}: ${JSON.stringify(r.body)}`);
  }
  const msPrimera = Date.now() - inicio;
  // Segunda pasada completa (p. ej. corte antes de recibir confirmaciones): todo es replay.
  const inicioReplay = Date.now();
  for (let i = 0; i < operaciones.length; i += 1) {
    const [metodo, ruta, body, actor] = operaciones[i];
    const r = await offline(actor, metodo, ruta, body, { key: claves[i] });
    assert.equal(r.headers['idempotency-replayed'], 'true');
  }
  const msReplay = Date.now() - inicioReplay;
  console.info('[p83-cola]', { operaciones: 100, ms_primera: msPrimera, ms_por_operacion: Math.round(msPrimera / 100), ms_replay: msReplay });
  assert.equal(Number((await db.query('SELECT stock_actual FROM insumo WHERE id=$1', [insumo.id])).rows[0].stock_actual), 1000 - 25 * 5);
  assert.equal((await db.query(`SELECT COUNT(*)::int n FROM condicion_corporal WHERE animal_id=$1 AND observacion LIKE 'cola %'`, [vaca.id])).rows[0].n, 25);
  assert.equal((await db.query(`SELECT COUNT(*)::int n FROM evento_salud WHERE animal_id=$1 AND enfermedad LIKE 'cola %'`, [vaca.id])).rows[0].n, 25);
  assert.equal((await db.query('SELECT COUNT(*)::int n FROM operacion_cliente WHERE client_operation_id = ANY($1::uuid[])', [claves])).rows[0].n, 100);
});
