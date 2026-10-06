const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

let secuencia = 0;
const actores = new Map();

function marca(prefijo) {
  secuencia += 1;
  return `F-${prefijo}-${Date.now()}-${secuencia}`;
}

function api(rol, method, path, body) {
  const llamada = request(app)[method](path).set('Authorization', `Bearer ${actores.get(rol).token}`);
  return body === undefined ? llamada : llamada.send(body);
}

async function crearActor(rol) {
  const email = `${marca(rol).toLowerCase()}@rancho.test`;
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, 'hash-no-usado', id, true FROM rol WHERE nombre = $3
     RETURNING id, nombre, email`,
    [`Actor ${rol}`, email, rol]
  );
  const actor = { ...rows[0], rol };
  actor.token = jwt.sign({ ...actor, sesion_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  actores.set(rol, actor);
}

async function crearAnimal() {
  const { rows } = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, categoria)
     VALUES ($1, 'hembra', 'nacimiento', 'vivo', 'cria') RETURNING *`,
    [marca('ANIMAL')]
  );
  return rows[0];
}

async function crearTercero(tipo = 'ambos') {
  const { rows } = await db.query('INSERT INTO tercero (nombre, tipo) VALUES ($1,$2) RETURNING *', [marca('TERCERO'), tipo]);
  return rows[0];
}

async function crearInsumo(stock = 30) {
  const { rows } = await db.query(
    `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo)
     VALUES ($1, 'alimento', 'kg', $2, 0) RETURNING *`,
    [marca('INSUMO'), stock]
  );
  return rows[0];
}

async function evento(accion, entidadId) {
  const { rows } = await db.query(
    'SELECT * FROM bitacora WHERE accion = $1 AND ($2::int IS NULL OR entidad_id = $2) ORDER BY id DESC LIMIT 1',
    [accion, entidadId ?? null]
  );
  return rows[0];
}

test.before(async () => {
  for (const rol of ['Administrador', 'Trabajador', 'Auditor']) await crearActor(rol);
});

test.after(async () => {
  await db.query('DROP TRIGGER IF EXISTS f_fallar_auditoria_venta ON bitacora');
  await db.query('DROP FUNCTION IF EXISTS f_fallar_auditoria_venta()');
  await db.pool.end();
});

test('venta exitosa registra actor, cambio comercial y estado coherente', async () => {
  const animal = await crearAnimal();
  const tercero = await crearTercero('comprador');
  const response = await api('Administrador', 'post', '/api/ventas', { animal_id: animal.id, tercero_id: tercero.id, precio: 12500 });
  assert.equal(response.status, 201);
  const audit = await evento('registrar_venta', response.body.id);
  assert.equal(audit.usuario_id, actores.get('Administrador').id);
  assert.equal(audit.detalle.actor.rol, 'Administrador');
  assert.equal(audit.detalle.resultado, 'exito');
  assert.equal(audit.detalle.antes.animal.estado, 'vivo');
  assert.equal(audit.detalle.despues.animal.estado, 'vendido');
  assert.equal(audit.detalle.despues.venta.id, response.body.id);
});

test('venta rechazada o revertida no genera evento de éxito falso', async () => {
  const animal = await crearAnimal();
  const tercero = await crearTercero('comprador');
  await db.query("UPDATE animal SET estado = 'muerto' WHERE id = $1", [animal.id]);
  const antes = await db.query("SELECT COUNT(*)::int AS total FROM bitacora WHERE accion = 'registrar_venta'");
  const response = await api('Administrador', 'post', '/api/ventas', { animal_id: animal.id, tercero_id: tercero.id, precio: 100 });
  const despues = await db.query("SELECT COUNT(*)::int AS total FROM bitacora WHERE accion = 'registrar_venta'");
  assert.equal(response.status, 409);
  assert.equal(despues.rows[0].total, antes.rows[0].total);
});

test('fallo de auditoría revierte la venta y el estado del animal', async () => {
  const animal = await crearAnimal();
  const tercero = await crearTercero('comprador');
  await db.query(`
    CREATE OR REPLACE FUNCTION f_fallar_auditoria_venta() RETURNS trigger AS $$
    BEGIN
      IF NEW.accion = 'registrar_venta' THEN RAISE EXCEPTION 'fallo de auditoría F'; END IF;
      RETURN NEW;
    END; $$ LANGUAGE plpgsql;
    CREATE TRIGGER f_fallar_auditoria_venta BEFORE INSERT ON bitacora
    FOR EACH ROW EXECUTE FUNCTION f_fallar_auditoria_venta();
  `);
  const response = await api('Administrador', 'post', '/api/ventas', { animal_id: animal.id, tercero_id: tercero.id, precio: 9000 });
  await db.query('DROP TRIGGER f_fallar_auditoria_venta ON bitacora');
  await db.query('DROP FUNCTION f_fallar_auditoria_venta()');
  assert.equal(response.status, 500);
  const venta = await db.query('SELECT id FROM venta WHERE animal_id = $1', [animal.id]);
  const actual = await db.query('SELECT estado FROM animal WHERE id = $1', [animal.id]);
  assert.equal(venta.rowCount, 0);
  assert.equal(actual.rows[0].estado, 'vivo');
});

test('compra y alimentación generan eventos transaccionales', async () => {
  const animal = await crearAnimal();
  const tercero = await crearTercero('proveedor');
  const compra = await api('Administrador', 'post', '/api/compras-animal', { animal_id: animal.id, tercero_id: tercero.id, precio: 8000 });
  assert.equal(compra.status, 201);
  assert.ok(await evento('comprar_animal', compra.body.id));

  const insumo = await crearInsumo();
  const alimentacion = await api('Administrador', 'post', '/api/alimentacion', { animal_id: animal.id, insumo_id: insumo.id, cantidad: 2 });
  assert.equal(alimentacion.status, 201);
  assert.ok(await evento('registrar_alimentacion', alimentacion.body.id));
});

test('edición conserva antes/después y eliminación conserva el recurso borrado', async () => {
  const animal = await crearAnimal();
  const edicion = await api('Administrador', 'patch', `/api/animales/${animal.id}`, { nombre_alias: 'Editado F' });
  assert.equal(edicion.status, 200);
  const auditEdicion = await evento('editar_animal', animal.id);
  assert.notEqual(auditEdicion.detalle.antes.nombre_alias, 'Editado F');
  assert.equal(auditEdicion.detalle.despues.nombre_alias, 'Editado F');

  const insumo = await crearInsumo();
  const alta = await api('Administrador', 'post', '/api/alimentacion', { animal_id: animal.id, insumo_id: insumo.id, cantidad: 1 });
  const eliminacion = await api('Administrador', 'delete', `/api/alimentacion/${alta.body.id}`);
  assert.equal(eliminacion.status, 204);
  const auditEliminacion = await evento('eliminar_alimentacion', alta.body.id);
  assert.equal(auditEliminacion.detalle.antes.id, alta.body.id);
  assert.equal(auditEliminacion.detalle.despues.eliminado, true);
});

test('cambio de rol y desactivación quedan auditados sin secretos', async () => {
  await crearActor('Veterinario');
  const objetivo = actores.get('Veterinario');
  const rolTrabajador = await db.query("SELECT id FROM rol WHERE nombre = 'Trabajador'");
  const cambio = await api('Administrador', 'patch', `/api/usuarios/${objetivo.id}`, { rol_id: rolTrabajador.rows[0].id });
  assert.equal(cambio.status, 200);
  const auditRol = await evento('cambiar_rol_usuario', objetivo.id);
  assert.equal(auditRol.detalle.antes.rol, 'Veterinario');
  assert.equal(auditRol.detalle.despues.rol, 'Trabajador');

  const baja = await api('Administrador', 'patch', `/api/usuarios/${objetivo.id}`, { activo: false });
  assert.equal(baja.status, 200);
  assert.ok(await evento('desactivar_usuario', objetivo.id));

  const nuevoEmail = `${marca('SECRETO')}@rancho.test`;
  const alta = await api('Administrador', 'post', '/api/usuarios', { nombre: 'Sin secretos', email: nuevoEmail, password: 'ClaveNoAuditable123', rol_id: rolTrabajador.rows[0].id });
  assert.equal(alta.status, 201);
  const textos = await db.query("SELECT COALESCE(string_agg(detalle::text, ' '), '') AS texto FROM bitacora");
  assert.doesNotMatch(textos.rows[0].texto, /ClaveNoAuditable123|password_hash|Bearer |JWT_SECRET/i);
});

test('Auditor consulta bitácora pero no puede modificarla', async () => {
  const lectura = await api('Auditor', 'get', '/api/bitacora');
  const escritura = await api('Auditor', 'post', '/api/bitacora/corte-diario', { fecha: '2026-08-20' });
  assert.equal(lectura.status, 200);
  assert.ok(Array.isArray(lectura.body));
  assert.equal(escritura.status, 403);
  assert.equal(escritura.body.error.code, 'AUTHORIZATION_ERROR');
});

test('operaciones concurrentes conservan un evento por operación confirmada', async () => {
  const [animalA, animalB] = await Promise.all([crearAnimal(), crearAnimal()]);
  const insumo = await crearInsumo(20);
  const respuestas = await Promise.all([
    api('Administrador', 'post', '/api/alimentacion', { animal_id: animalA.id, insumo_id: insumo.id, cantidad: 3 }),
    api('Administrador', 'post', '/api/alimentacion', { animal_id: animalB.id, insumo_id: insumo.id, cantidad: 4 }),
  ]);
  assert.deepEqual(respuestas.map((r) => r.status), [201, 201]);
  const ids = respuestas.map((r) => r.body.id);
  const eventos = await db.query("SELECT entidad_id FROM bitacora WHERE accion = 'registrar_alimentacion' AND entidad_id = ANY($1::int[])", [ids]);
  assert.equal(eventos.rowCount, 2);
});
