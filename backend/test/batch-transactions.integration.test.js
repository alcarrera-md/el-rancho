const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

let secuencia = 0;
let token;

function marca(prefijo) {
  secuencia += 1;
  return `D2-${prefijo}-${Date.now()}-${secuencia}`;
}

function api(method, path, body) {
  const llamada = request(app)[method](path).set('Authorization', `Bearer ${token}`);
  return body === undefined ? llamada : llamada.send(body);
}

async function crearTercero(tipo = 'ambos') {
  const { rows } = await db.query(
    'INSERT INTO tercero (nombre, tipo) VALUES ($1, $2) RETURNING *',
    [marca('TERCERO'), tipo]
  );
  return rows[0];
}

async function crearAnimal(estado = 'vivo') {
  const { rows } = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, categoria)
     VALUES ($1, 'hembra', 'nacimiento', $2, 'cria') RETURNING *`,
    [marca('ANIMAL'), estado]
  );
  return rows[0];
}

async function crearInsumo(stock = 10) {
  const { rows } = await db.query(
    `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo)
     VALUES ($1, 'alimento', 'kg', $2, 0) RETURNING *`,
    [marca('INSUMO'), stock]
  );
  return rows[0];
}

async function obtenerStock(insumoId) {
  const { rows } = await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumoId]);
  return Number(rows[0].stock_actual);
}

async function instalarFalloCompraInsumo() {
  await db.query(`
    CREATE OR REPLACE FUNCTION d2_fallar_compra_insumo() RETURNS trigger AS $$
    BEGIN
      IF NEW.stock_actual - OLD.stock_actual = 7.77 THEN
        RAISE EXCEPTION 'fallo intermedio de compra de insumo D2';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER d2_trg_fallar_compra_insumo
    BEFORE UPDATE ON insumo
    FOR EACH ROW EXECUTE FUNCTION d2_fallar_compra_insumo();
  `);
}

async function quitarFalloCompraInsumo() {
  await db.query('DROP TRIGGER IF EXISTS d2_trg_fallar_compra_insumo ON insumo');
  await db.query('DROP FUNCTION IF EXISTS d2_fallar_compra_insumo()');
}

test.before(async () => {
  await db.query("INSERT INTO rol (nombre) VALUES ('Administrador') ON CONFLICT (nombre) DO NOTHING");
  await db.query(`
    INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
    SELECT 'Administradora D2', 'admin.d2@rancho.test', 'hash-no-usado', id, true
    FROM rol WHERE nombre = 'Administrador'
    ON CONFLICT (email) DO NOTHING
  `);
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, r.nombre AS rol
     FROM usuario u JOIN rol r ON r.id = u.rol_id
     WHERE u.email = 'admin.d2@rancho.test'`
  );
  token = jwt.sign({ ...rows[0], sesion_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

test.after(async () => {
  await quitarFalloCompraInsumo();
  await db.pool.end();
});

test('venta por lote correcta crea todas las ventas y bajas coherentes', async () => {
  const tercero = await crearTercero('comprador');
  const animales = await Promise.all([crearAnimal(), crearAnimal(), crearAnimal()]);
  const response = await api('post', '/api/ventas/lote', {
    animal_ids: animales.map((animal) => animal.id),
    tercero_id: tercero.id,
    fecha: '2026-08-20',
    precio_total: 30000,
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.ventas.length, 3);
  const { rows } = await db.query(
    `SELECT a.estado, a.fecha_baja, a.razon_baja, v.id AS venta_id, v.venta_lote_id
     FROM animal a LEFT JOIN venta v ON v.animal_id = a.id
     WHERE a.id = ANY($1::int[]) ORDER BY a.id`,
    [animales.map((animal) => animal.id)]
  );
  assert.equal(rows.length, 3);
  assert.ok(rows.every((row) => row.estado === 'vendido' && row.venta_id && row.venta_lote_id));
  assert.ok(rows.every((row) => row.fecha_baja.toISOString().slice(0, 10) === '2026-08-20'));
  assert.ok(rows.every((row) => row.razon_baja === null));
});

test('un animal inválido revierte por completo la venta por lote', async () => {
  const tercero = await crearTercero('comprador');
  const vivo = await crearAnimal();
  const muerto = await crearAnimal('muerto');
  const folio = marca('LOTE-ROLLBACK');
  const response = await api('post', '/api/ventas/lote', {
    animal_ids: [vivo.id, muerto.id], tercero_id: tercero.id, precio_total: 20000, factura_folio: folio,
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'ANIMAL_NO_DISPONIBLE_PARA_VENTA');
  const ventas = await db.query('SELECT id FROM venta WHERE animal_id = ANY($1::int[])', [[vivo.id, muerto.id]]);
  const lotes = await db.query('SELECT id FROM venta_lote WHERE factura_folio = $1', [folio]);
  const actual = await db.query('SELECT estado FROM animal WHERE id = $1', [vivo.id]);
  assert.equal(ventas.rowCount, 0);
  assert.equal(lotes.rowCount, 0);
  assert.equal(actual.rows[0].estado, 'vivo');
});

test('dos ventas por lote concurrentes con animales compartidos no dejan lotes parciales', async () => {
  const tercero = await crearTercero('comprador');
  const [a, compartido, b] = await Promise.all([crearAnimal(), crearAnimal(), crearAnimal()]);
  const respuestas = await Promise.all([
    api('post', '/api/ventas/lote', { animal_ids: [a.id, compartido.id], tercero_id: tercero.id, precio_total: 20000 }),
    api('post', '/api/ventas/lote', { animal_ids: [compartido.id, b.id], tercero_id: tercero.id, precio_total: 20000 }),
  ]);

  assert.deepEqual(respuestas.map((response) => response.status).sort(), [201, 409]);
  const ventas = await db.query('SELECT animal_id, venta_lote_id FROM venta WHERE animal_id = ANY($1::int[])', [[a.id, compartido.id, b.id]]);
  assert.equal(ventas.rowCount, 2);
  assert.equal(new Set(ventas.rows.map((row) => row.venta_lote_id)).size, 1);
  const lotes = await db.query('SELECT id FROM venta_lote WHERE id = $1', [ventas.rows[0].venta_lote_id]);
  assert.equal(lotes.rowCount, 1);
});

test('venta individual concurrente con lote mantiene atomicidad del lote', async () => {
  const tercero = await crearTercero('comprador');
  const compartido = await crearAnimal();
  const otro = await crearAnimal();
  const [individual, lote] = await Promise.all([
    api('post', '/api/ventas', { animal_id: compartido.id, tercero_id: tercero.id, precio: 10000 }),
    api('post', '/api/ventas/lote', { animal_ids: [compartido.id, otro.id], tercero_id: tercero.id, precio_total: 20000 }),
  ]);

  assert.deepEqual([individual.status, lote.status].sort(), [201, 409]);
  const compartidas = await db.query('SELECT id FROM venta WHERE animal_id = $1', [compartido.id]);
  assert.equal(compartidas.rowCount, 1);
  const ventaOtro = await db.query('SELECT id, venta_lote_id FROM venta WHERE animal_id = $1', [otro.id]);
  assert.equal(ventaOtro.rowCount, lote.status === 201 ? 1 : 0);
});

test('baja concurrente con venta nunca deja estado y registro contradictorios', async () => {
  const tercero = await crearTercero('comprador');
  const animal = await crearAnimal();
  const [venta, baja] = await Promise.all([
    api('post', '/api/ventas', { animal_id: animal.id, tercero_id: tercero.id, precio: 14000 }),
    api('patch', `/api/animales/${animal.id}/baja`, { estado: 'muerto', razon_baja: 'causa D2' }),
  ]);

  const estados = [venta.status, baja.status];
  assert.equal(estados.filter((status) => status === 409).length, 1);
  assert.equal(estados.filter((status) => status === 200 || status === 201).length, 1);
  const actual = await db.query(
    'SELECT a.estado, COUNT(v.id)::int AS ventas FROM animal a LEFT JOIN venta v ON v.animal_id = a.id WHERE a.id = $1 GROUP BY a.id',
    [animal.id]
  );
  if (actual.rows[0].estado === 'vendido') assert.equal(actual.rows[0].ventas, 1);
  else {
    assert.equal(actual.rows[0].estado, 'muerto');
    assert.equal(actual.rows[0].ventas, 0);
  }
});

test('la baja general acepta muerto', async () => {
  const animal = await crearAnimal();
  const response = await api('patch', `/api/animales/${animal.id}/baja`, {
    estado: 'muerto', razon_baja: 'causa natural', fecha_baja: '2026-08-20',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.estado, 'muerto');
});

test('la baja general acepta sacrificado', async () => {
  const animal = await crearAnimal();
  const response = await api('patch', `/api/animales/${animal.id}/baja`, {
    estado: 'sacrificado', razon_baja: 'decisión sanitaria',
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.estado, 'sacrificado');
});

test('la baja general rechaza vendido y no altera el animal', async () => {
  const animal = await crearAnimal();
  const response = await api('patch', `/api/animales/${animal.id}/baja`, { estado: 'vendido' });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  const actual = await db.query('SELECT estado FROM animal WHERE id = $1', [animal.id]);
  const ventas = await db.query('SELECT id FROM venta WHERE animal_id = $1', [animal.id]);
  assert.equal(actual.rows[0].estado, 'vivo');
  assert.equal(ventas.rowCount, 0);
});

test('un animal solo queda vendido mediante una venta válida', async () => {
  const tercero = await crearTercero('comprador');
  const animal = await crearAnimal();
  const response = await api('post', '/api/ventas', {
    animal_id: animal.id, tercero_id: tercero.id, precio: 17500,
  });
  assert.equal(response.status, 201);
  const { rows } = await db.query(
    'SELECT a.estado, v.id AS venta_id FROM animal a LEFT JOIN venta v ON v.animal_id = a.id WHERE a.id = $1',
    [animal.id]
  );
  assert.equal(rows[0].estado, 'vendido');
  assert.ok(rows[0].venta_id);
});

test('alimentación por lote correcta descuenta el consumo total', async () => {
  const animales = await Promise.all([crearAnimal(), crearAnimal(), crearAnimal()]);
  const insumo = await crearInsumo(20);
  const response = await api('post', '/api/alimentacion/lote', {
    animal_ids: animales.map((animal) => animal.id), insumo_id: insumo.id, cantidad: 4,
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.atomic, false);
  assert.equal(response.body.creados.length, 3);
  assert.equal(response.body.errores.length, 0);
  assert.equal(response.body.consumo_total_aplicado, 12);
  assert.equal(await obtenerStock(insumo.id), 8);
});

test('stock insuficiente produce resultado parcial reproducible sin stock negativo', async () => {
  const animales = await Promise.all([crearAnimal(), crearAnimal(), crearAnimal()]);
  const insumo = await crearInsumo(10);
  const response = await api('post', '/api/alimentacion/lote', {
    animal_ids: animales.map((animal) => animal.id), insumo_id: insumo.id, cantidad: 4,
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.creados.length, 2);
  assert.equal(response.body.errores.length, 1);
  assert.equal(response.body.errores[0].animal_id, animales[2].id);
  assert.equal(response.body.errores[0].code, 'STOCK_INSUFICIENTE');
  assert.equal(await obtenerStock(insumo.id), 2);
});

test('dos alimentaciones por lote concurrentes serializan el consumo del mismo insumo', async () => {
  const animales = await Promise.all([crearAnimal(), crearAnimal(), crearAnimal(), crearAnimal()]);
  const insumo = await crearInsumo(10);
  const respuestas = await Promise.all([
    api('post', '/api/alimentacion/lote', { animal_ids: [animales[0].id, animales[1].id], insumo_id: insumo.id, cantidad: 3 }),
    api('post', '/api/alimentacion/lote', { animal_ids: [animales[2].id, animales[3].id], insumo_id: insumo.id, cantidad: 3 }),
  ]);
  assert.ok(respuestas.every((response) => response.status === 201));
  assert.deepEqual(respuestas.map((response) => response.body.creados.length).sort(), [1, 2]);
  assert.equal(respuestas.reduce((total, response) => total + response.body.errores.length, 0), 1);
  assert.equal(await obtenerStock(insumo.id), 1);
});

test('compra de insumo crea registro y aumenta stock atómicamente', async () => {
  const tercero = await crearTercero('proveedor');
  const insumo = await crearInsumo(5);
  const response = await api('post', '/api/compras-insumo', {
    insumo_id: insumo.id, tercero_id: tercero.id, cantidad: 8, costo_total: 1200,
  });
  assert.equal(response.status, 201);
  assert.equal(await obtenerStock(insumo.id), 13);
  const compra = await db.query('SELECT cantidad, costo_total FROM compra_insumo WHERE id = $1', [response.body.id]);
  assert.equal(Number(compra.rows[0].cantidad), 8);
  assert.equal(Number(compra.rows[0].costo_total), 1200);
});

test('fallo al actualizar stock revierte la compra de insumo', async (t) => {
  t.mock.method(console, 'error', () => {});
  const tercero = await crearTercero('proveedor');
  const insumo = await crearInsumo(5);
  await instalarFalloCompraInsumo();
  let response;
  try {
    response = await api('post', '/api/compras-insumo', {
      insumo_id: insumo.id, tercero_id: tercero.id, cantidad: 7.77, costo_total: 100,
    });
  } finally {
    await quitarFalloCompraInsumo();
  }
  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(await obtenerStock(insumo.id), 5);
  const compras = await db.query('SELECT id FROM compra_insumo WHERE insumo_id = $1', [insumo.id]);
  assert.equal(compras.rowCount, 0);
});

test('dos compras concurrentes del mismo insumo no pierden incrementos', async () => {
  const tercero = await crearTercero('proveedor');
  const insumo = await crearInsumo(5);
  const respuestas = await Promise.all([
    api('post', '/api/compras-insumo', { insumo_id: insumo.id, tercero_id: tercero.id, cantidad: 4 }),
    api('post', '/api/compras-insumo', { insumo_id: insumo.id, tercero_id: tercero.id, cantidad: 7 }),
  ]);
  assert.ok(respuestas.every((response) => response.status === 201));
  assert.equal(await obtenerStock(insumo.id), 16);
  const compras = await db.query('SELECT id FROM compra_insumo WHERE insumo_id = $1', [insumo.id]);
  assert.equal(compras.rowCount, 2);
});
