const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

const actores = new Map();
let secuencia = 0;
let contexto;
let tareaTrabajador;
let tareaVeterinario;

function marca(prefijo) {
  secuencia += 1;
  return `TAREA-${prefijo}-${Date.now()}-${secuencia}`;
}

async function crearActor(rol) {
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, 'hash-test', id, true FROM rol WHERE nombre = $3
     RETURNING id, nombre, email`,
    [`Actor ${rol}`, `${marca(rol).toLowerCase()}@rancho.test`, rol]
  );
  const actor = { ...rows[0], rol };
  actor.token = jwt.sign({ ...actor, sesion_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  actores.set(rol, actor);
  return actor;
}

function api(rol, metodo, ruta, body) {
  const llamada = request(app)[metodo](ruta).set('Authorization', `Bearer ${actores.get(rol).token}`);
  return body === undefined ? llamada : llamada.send(body);
}

async function crearTrabajador(usuario, nombre) {
  const { rows } = await db.query(
    'INSERT INTO trabajador (usuario_id, nombre, activo) VALUES ($1,$2,true) RETURNING *',
    [usuario?.id || null, nombre]
  );
  return rows[0];
}

test.before(async () => {
  const admin = await crearActor('Administrador');
  const veterinario = await crearActor('Veterinario');
  const trabajador = await crearActor('Trabajador');
  await crearActor('Auditor');
  const responsableVeterinario = await crearTrabajador(veterinario, 'Veterinario asignable');
  const responsableTrabajador = await crearTrabajador(trabajador, 'Trabajador asignable');
  const { rows: corrales } = await db.query(
    'INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 20), ($2, 15) RETURNING *', [marca('CORRAL'), marca('CORRAL')]
  );
  const { rows: animales } = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, corral_actual_id)
     VALUES ($1, 'hembra', 'nacimiento', 'vivo', $2) RETURNING *`, [marca('ARETE'), corrales[0].id]
  );
  const { rows: insumos } = await db.query(
    `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo)
     VALUES ($1, 'alimento', 'kg', 100, 5) RETURNING *`, [marca('ALIMENTO')]
  );
  contexto = { admin, responsableVeterinario, responsableTrabajador, corral: corrales[0], segundoCorral: corrales[1], animal: animales[0], insumo: insumos[0] };
});

test.after(async () => {
  await db.pool.end();
});

test('la migración amplía tareas y conserva filas históricas', async () => {
  const columnas = await db.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'asignacion_tarea'`
  );
  const nombres = new Set(columnas.rows.map((fila) => fila.column_name));
  for (const columna of ['titulo', 'tipo', 'animal_id', 'insumo_id', 'prioridad', 'estado', 'creador_usuario_id', 'creado_en', 'completado_en']) {
    assert.ok(nombres.has(columna), `falta ${columna}`);
  }
  const { rows } = await db.query(
    `INSERT INTO asignacion_tarea (trabajador_id, descripcion, fecha, completada)
     VALUES ($1, 'Tarea histórica completada', CURRENT_DATE, true) RETURNING *`,
    [contexto.responsableTrabajador.id]
  );
  assert.equal(rows[0].titulo, 'Tarea histórica completada');
  assert.equal(rows[0].estado, 'completada');
  assert.ok(rows[0].completado_en);
});

test('Administrador crea tareas con contexto y auditoría transaccional', async () => {
  const response = await api('Administrador', 'post', '/api/asignaciones', {
    titulo: 'Alimentar las vacas del corral',
    descripcion: 'Suministrar el alimento indicado y confirmar al terminar.',
    tipo: 'alimentacion', trabajador_id: contexto.responsableTrabajador.id,
    corral_ids: [contexto.corral.id, contexto.segundoCorral.id], animal_id: contexto.animal.id, insumo_id: contexto.insumo.id,
    cantidad: 4.5, fecha_limite: '2026-08-28', prioridad: 'alta',
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.estado, 'pendiente');
  assert.equal(response.body.creador_usuario_id, contexto.admin.id);
  assert.deepEqual(response.body.corral_ids.sort((a, b) => a - b), [contexto.corral.id, contexto.segundoCorral.id].sort((a, b) => a - b));
  assert.equal(response.body.corrales.length, 2);
  tareaTrabajador = response.body;

  const audit = await db.query(
    "SELECT * FROM bitacora WHERE accion = 'crear_tarea' AND entidad_id = $1 ORDER BY id DESC LIMIT 1",
    [tareaTrabajador.id]
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].usuario_id, contexto.admin.id);
});

test('valida referencias y evita asignar a responsables inexistentes', async () => {
  const response = await api('Administrador', 'post', '/api/asignaciones', {
    titulo: 'Tarea inválida', descripcion: 'No debe persistir.', tipo: 'otra',
    trabajador_id: 999999, fecha_limite: '2026-08-28', prioridad: 'media',
  });
  assert.equal(response.status, 404);
  assert.equal(response.body.error.code, 'TRABAJADOR_NO_ENCONTRADO');
});

test('Administrador asigna una tarea clínica al Veterinario', async () => {
  const response = await api('Administrador', 'post', '/api/asignaciones', {
    titulo: 'Revisar salud del animal', descripcion: 'Realizar revisión y registrar hallazgos.', tipo: 'revision_salud',
    trabajador_id: contexto.responsableVeterinario.id, animal_id: contexto.animal.id,
    fecha_limite: '2026-08-28', prioridad: 'urgente',
  });
  assert.equal(response.status, 201);
  tareaVeterinario = response.body;
});

test('filtra una tarea por cualquiera de sus corrales y permite actualizar el conjunto', async () => {
  const filtrada = await api('Administrador', 'get', `/api/asignaciones?corral_id=${contexto.segundoCorral.id}`);
  assert.equal(filtrada.status, 200);
  assert.ok(filtrada.body.some((tarea) => tarea.id === tareaTrabajador.id));

  const editada = await api('Administrador', 'patch', `/api/asignaciones/${tareaTrabajador.id}`, { corral_ids: [contexto.segundoCorral.id] });
  assert.equal(editada.status, 200);
  assert.deepEqual(editada.body.corral_ids, [contexto.segundoCorral.id]);
  assert.equal(editada.body.corral_id, contexto.segundoCorral.id);
});

test('cada rol recibe el alcance de lectura correcto', async () => {
  const [admin, trabajador, veterinario, auditor] = await Promise.all([
    api('Administrador', 'get', '/api/asignaciones'), api('Trabajador', 'get', '/api/asignaciones'),
    api('Veterinario', 'get', '/api/asignaciones'), api('Auditor', 'get', '/api/asignaciones'),
  ]);
  assert.equal(admin.status, 200);
  assert.ok(admin.body.some((tarea) => tarea.id === tareaTrabajador.id));
  assert.deepEqual(trabajador.body.filter((tarea) => [tareaTrabajador.id, tareaVeterinario.id].includes(tarea.id)).map((tarea) => tarea.id), [tareaTrabajador.id]);
  assert.deepEqual(veterinario.body.filter((tarea) => [tareaTrabajador.id, tareaVeterinario.id].includes(tarea.id)).map((tarea) => tarea.id), [tareaVeterinario.id]);
  assert.ok(auditor.body.some((tarea) => tarea.id === tareaTrabajador.id));
  assert.ok(auditor.body.some((tarea) => tarea.id === tareaVeterinario.id));
  assert.equal(trabajador.body.find((tarea) => tarea.id === tareaTrabajador.id).responsable, 'Trabajador asignable');
});

test('Trabajador completa sólo su tarea y se registra fecha y auditoría', async () => {
  const ajena = await api('Trabajador', 'patch', `/api/asignaciones/${tareaVeterinario.id}/completar`, { completada: true });
  assert.equal(ajena.status, 404);

  const propia = await api('Trabajador', 'patch', `/api/asignaciones/${tareaTrabajador.id}/completar`, { completada: true });
  assert.equal(propia.status, 200);
  assert.equal(propia.body.estado, 'completada');
  assert.equal(propia.body.completada, true);
  assert.ok(propia.body.completado_en);
  const audit = await db.query(
    "SELECT detalle FROM bitacora WHERE accion = 'completar_tarea' AND entidad_id = $1 ORDER BY id DESC LIMIT 1",
    [tareaTrabajador.id]
  );
  assert.equal(audit.rows[0].detalle.actor.rol, 'Trabajador');
});

test('Administrador edita, reasigna y cancela; Auditor no modifica', async () => {
  const denegada = await api('Auditor', 'patch', `/api/asignaciones/${tareaVeterinario.id}`, { prioridad: 'baja' });
  assert.equal(denegada.status, 403);

  const editada = await api('Administrador', 'patch', `/api/asignaciones/${tareaVeterinario.id}`, {
    trabajador_id: contexto.responsableTrabajador.id, prioridad: 'alta', estado: 'en_progreso',
  });
  assert.equal(editada.status, 200);
  assert.equal(editada.body.trabajador_id, contexto.responsableTrabajador.id);
  assert.equal(editada.body.estado, 'en_progreso');

  const cancelada = await api('Administrador', 'patch', `/api/asignaciones/${tareaVeterinario.id}`, { estado: 'cancelada' });
  assert.equal(cancelada.status, 200);
  assert.equal(cancelada.body.completada, false);
  const completarCancelada = await api('Trabajador', 'patch', `/api/asignaciones/${tareaVeterinario.id}/completar`, { completada: true });
  assert.equal(completarCancelada.status, 409);
});

test('eliminación conserva auditoría del recurso eliminado', async () => {
  const response = await api('Administrador', 'delete', `/api/asignaciones/${tareaVeterinario.id}`);
  assert.equal(response.status, 204);
  const audit = await db.query(
    "SELECT detalle FROM bitacora WHERE accion = 'eliminar_tarea' AND entidad_id = $1 ORDER BY id DESC LIMIT 1",
    [tareaVeterinario.id]
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].detalle.antes.titulo, 'Revisar salud del animal');
});
