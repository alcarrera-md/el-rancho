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
  return `D1-${prefijo}-${secuencia}`;
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

async function crearAnimal(estado = 'vivo', extra = {}) {
  const arete = extra.arete_id || marca('ANIMAL');
  const { rows } = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, categoria, fecha_baja, razon_baja)
     VALUES ($1, 'hembra', $2, $3, $4, $5, $6) RETURNING *`,
    [
      arete,
      extra.origen || 'nacimiento',
      estado,
      extra.categoria || 'cria',
      extra.fecha_baja || null,
      extra.razon_baja || null,
    ]
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

async function stock(insumoId) {
  const { rows } = await db.query('SELECT stock_actual FROM insumo WHERE id = $1', [insumoId]);
  return Number(rows[0].stock_actual);
}

async function instalarFalloHistorial() {
  await db.query(`
    CREATE OR REPLACE FUNCTION d1_fallar_historial_categoria() RETURNS trigger AS $$
    BEGIN
      IF NEW.motivo = 'D1_FORZAR_FALLO' THEN
        RAISE EXCEPTION 'fallo intermedio de historial D1';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER d1_trg_fallar_historial
    BEFORE INSERT ON historial_categoria
    FOR EACH ROW EXECUTE FUNCTION d1_fallar_historial_categoria();
  `);
}

async function quitarFalloHistorial() {
  await db.query('DROP TRIGGER IF EXISTS d1_trg_fallar_historial ON historial_categoria');
  await db.query('DROP FUNCTION IF EXISTS d1_fallar_historial_categoria()');
}

async function instalarFalloEdicionAlimentacion() {
  await db.query(`
    CREATE OR REPLACE FUNCTION d1_fallar_edicion_alimentacion() RETURNS trigger AS $$
    BEGIN
      IF NEW.cantidad = 7.77 THEN
        RAISE EXCEPTION 'fallo intermedio de alimentación D1';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER d1_trg_fallar_edicion_alimentacion
    BEFORE UPDATE ON alimentacion
    FOR EACH ROW EXECUTE FUNCTION d1_fallar_edicion_alimentacion();
  `);
}

async function quitarFalloEdicionAlimentacion() {
  await db.query('DROP TRIGGER IF EXISTS d1_trg_fallar_edicion_alimentacion ON alimentacion');
  await db.query('DROP FUNCTION IF EXISTS d1_fallar_edicion_alimentacion()');
}

test.before(async () => {
  await db.query("INSERT INTO rol (nombre) VALUES ('Administrador') ON CONFLICT (nombre) DO NOTHING");
  await db.query(`
    INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
    SELECT 'Administradora D1', 'admin.d1@rancho.test', 'hash-no-usado', id, true
    FROM rol WHERE nombre = 'Administrador'
    ON CONFLICT (email) DO NOTHING
  `);
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, r.nombre AS rol
     FROM usuario u JOIN rol r ON r.id = u.rol_id
     WHERE u.email = 'admin.d1@rancho.test'`
  );
  token = jwt.sign({ ...rows[0], sesion_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
});

test.after(async () => {
  await quitarFalloHistorial();
  await quitarFalloEdicionAlimentacion();
  await db.pool.end();
});

test('rollback de compra nueva no deja animal parcial', async (t) => {
  t.mock.method(console, 'error', () => {});
  const arete = marca('COMPRA-ROLLBACK');
  const response = await api('post', '/api/compras-animal/nuevo', {
    arete_id: arete,
    sexo: 'hembra',
    tercero_id: 2147483647,
    precio: 12000,
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'INVALID_REFERENCE');
  const animal = await db.query('SELECT id FROM animal WHERE arete_id = $1', [arete]);
  assert.equal(animal.rowCount, 0);
});

test('compra nueva crea animal y compra en una sola operación', async (t) => {
  t.mock.method(console, 'error', () => {});
  const tercero = await crearTercero('proveedor');
  const arete = marca('COMPRA-OK');
  const response = await api('post', '/api/compras-animal/nuevo', {
    arete_id: arete,
    sexo: 'hembra',
    tercero_id: tercero.id,
    precio: 15000,
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.animal.origen, 'compra');
  const { rows } = await db.query(
    `SELECT a.origen, ca.tercero_id, ca.precio
     FROM animal a JOIN compra_animal ca ON ca.animal_id = a.id
     WHERE a.arete_id = $1`,
    [arete]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].origen, 'compra');
  assert.equal(rows[0].tercero_id, tercero.id);
  assert.equal(Number(rows[0].precio), 15000);

  const duplicada = await api('post', '/api/compras-animal/nuevo', {
    arete_id: arete,
    sexo: 'hembra',
    tercero_id: tercero.id,
  });
  assert.equal(duplicada.status, 409);
  assert.equal(duplicada.body.error.code, 'ANIMAL_ARETE_DUPLICADO');
});

test('cambio de categoría actualiza animal e historial', async () => {
  const animal = await crearAnimal('vivo', { categoria: 'cria' });
  const response = await api('patch', `/api/animales/${animal.id}/categoria`, {
    categoria: 'engorde', motivo: 'D1 cambio correcto',
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.categoria, 'engorde');
  const { rows } = await db.query(
    `SELECT a.categoria, h.categoria_anterior, h.categoria_nueva
     FROM animal a JOIN historial_categoria h ON h.animal_id = a.id
     WHERE a.id = $1`,
    [animal.id]
  );
  assert.deepEqual(rows[0], {
    categoria: 'engorde', categoria_anterior: 'cria', categoria_nueva: 'engorde',
  });
});

test('traslado devuelve el movimiento operativo confirmado y no lo duplica', async () => {
  const origen = await db.query(
    'INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 10) RETURNING *',
    [marca('CORRAL-ORIGEN')]
  );
  const destino = await db.query(
    'INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 10) RETURNING *',
    [marca('CORRAL-DESTINO')]
  );
  const animalCreado = await db.query(
    `INSERT INTO animal (arete_id, nombre_alias, sexo, origen, estado, categoria, corral_actual_id)
     VALUES ($1, 'Lucero D1', 'hembra', 'nacimiento', 'vivo', 'vientre', $2) RETURNING *`,
    [marca('MOVIMIENTO'), origen.rows[0].id]
  );
  const animal = animalCreado.rows[0];
  const previos = await db.query('SELECT COUNT(*)::int AS total FROM movimiento_corral WHERE animal_id = $1', [animal.id]);

  const response = await api('patch', `/api/animales/${animal.id}/corral`, { corral_id: destino.rows[0].id });

  assert.equal(response.status, 200);
  assert.equal(response.body.animal.corral_actual_id, destino.rows[0].id);
  assert.equal(response.body.movimiento.animal_id, animal.id);
  assert.equal(response.body.movimiento.corral_origen, origen.rows[0].nombre);
  assert.equal(response.body.movimiento.corral_destino, destino.rows[0].nombre);
  const posteriores = await db.query('SELECT COUNT(*)::int AS total FROM movimiento_corral WHERE animal_id = $1', [animal.id]);
  assert.equal(posteriores.rows[0].total, previos.rows[0].total + 1);
});

test('historial global expone el traslado más reciente primero', async () => {
  const origen = await db.query('INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 10) RETURNING *', [marca('HIST-ORIGEN')]);
  const destino = await db.query('INSERT INTO corral (nombre, capacidad_maxima) VALUES ($1, 10) RETURNING *', [marca('HIST-DESTINO')]);
  const animalCreado = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, categoria, corral_actual_id)
     VALUES ($1, 'macho', 'nacimiento', 'vivo', 'engorde', $2) RETURNING *`,
    [marca('HIST-ANIMAL'), origen.rows[0].id]
  );
  const animal = animalCreado.rows[0];
  const traslado = await api('patch', `/api/animales/${animal.id}/corral`, { corral_id: destino.rows[0].id });

  const historial = await api('get', `/api/corrales/movimientos?animal_id=${animal.id}`);

  assert.equal(historial.status, 200);
  assert.equal(historial.body[0].id, traslado.body.movimiento.id);
  assert.equal(historial.body[0].arete_id, animal.arete_id);
  assert.equal(historial.body[0].corral_origen, origen.rows[0].nombre);
  assert.equal(historial.body[0].corral_destino, destino.rows[0].nombre);
});

test('fallo del historial revierte el cambio de categoría', async (t) => {
  t.mock.method(console, 'error', () => {});
  const animal = await crearAnimal('vivo', { categoria: 'cria' });
  await instalarFalloHistorial();
  let response;
  try {
    response = await api('patch', `/api/animales/${animal.id}/categoria`, {
      categoria: 'vientre', motivo: 'D1_FORZAR_FALLO',
    });
  } finally {
    await quitarFalloHistorial();
  }

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  const actual = await db.query('SELECT categoria FROM animal WHERE id = $1', [animal.id]);
  const historial = await db.query('SELECT id FROM historial_categoria WHERE animal_id = $1', [animal.id]);
  assert.equal(actual.rows[0].categoria, 'cria');
  assert.equal(historial.rowCount, 0);
});

test('venta individual crea venta y actualiza la baja coherentemente', async () => {
  const tercero = await crearTercero('comprador');
  const animal = await crearAnimal('vivo', { razon_baja: 'dato obsoleto' });
  const response = await api('post', '/api/ventas', {
    animal_id: animal.id, tercero_id: tercero.id, fecha: '2026-08-20', precio: 22000,
  });

  assert.equal(response.status, 201);
  const { rows } = await db.query(
    `SELECT a.estado, a.fecha_baja, a.razon_baja, v.precio
     FROM animal a JOIN venta v ON v.animal_id = a.id WHERE a.id = $1`,
    [animal.id]
  );
  assert.equal(rows[0].estado, 'vendido');
  assert.equal(rows[0].fecha_baja.toISOString().slice(0, 10), '2026-08-20');
  assert.equal(rows[0].razon_baja, null);
  assert.equal(Number(rows[0].precio), 22000);
});

test('rechaza volver a vender un animal ya vendido', async () => {
  const tercero = await crearTercero('comprador');
  const animal = await crearAnimal();
  const payload = { animal_id: animal.id, tercero_id: tercero.id, precio: 10000 };
  assert.equal((await api('post', '/api/ventas', payload)).status, 201);

  const segunda = await api('post', '/api/ventas', payload);
  assert.equal(segunda.status, 409);
  assert.equal(segunda.body.error.code, 'ANIMAL_YA_VENDIDO');
  const ventas = await db.query('SELECT id FROM venta WHERE animal_id = $1', [animal.id]);
  assert.equal(ventas.rowCount, 1);
});

test('rechaza vender animales muertos o sacrificados', async () => {
  const tercero = await crearTercero('comprador');
  for (const estado of ['muerto', 'sacrificado']) {
    const animal = await crearAnimal(estado, { fecha_baja: '2026-08-01', razon_baja: estado });
    const response = await api('post', '/api/ventas', {
      animal_id: animal.id, tercero_id: tercero.id, precio: 10000,
    });
    assert.equal(response.status, 409);
    assert.equal(response.body.error.code, 'ANIMAL_NO_DISPONIBLE_PARA_VENTA');
    const ventas = await db.query('SELECT id FROM venta WHERE animal_id = $1', [animal.id]);
    assert.equal(ventas.rowCount, 0);
  }
});

test('doble venta concurrente permite exactamente una venta', async () => {
  const tercero = await crearTercero('comprador');
  const animal = await crearAnimal();
  const payload = { animal_id: animal.id, tercero_id: tercero.id, precio: 18000 };
  const respuestas = await Promise.all([
    api('post', '/api/ventas', payload),
    api('post', '/api/ventas', payload),
  ]);

  assert.deepEqual(respuestas.map((r) => r.status).sort(), [201, 409]);
  assert.equal(respuestas.find((r) => r.status === 409).body.error.code, 'ANIMAL_YA_VENDIDO');
  const ventas = await db.query('SELECT id FROM venta WHERE animal_id = $1', [animal.id]);
  assert.equal(ventas.rowCount, 1);
});

test('alimentación descuenta correctamente el stock', async () => {
  const animal = await crearAnimal();
  const insumo = await crearInsumo(10);
  const response = await api('post', '/api/alimentacion', {
    animal_id: animal.id, insumo_id: insumo.id, cantidad: 3, fecha: '2026-08-20',
  });

  assert.equal(response.status, 201);
  assert.equal(await stock(insumo.id), 7);
});

test('stock insuficiente no crea alimentación ni modifica existencias', async () => {
  const animal = await crearAnimal();
  const insumo = await crearInsumo(2);
  const response = await api('post', '/api/alimentacion', {
    animal_id: animal.id, insumo_id: insumo.id, cantidad: 3,
  });

  assert.equal(response.status, 409);
  assert.equal(response.body.error.code, 'STOCK_INSUFICIENTE');
  assert.equal(await stock(insumo.id), 2);
  const registros = await db.query('SELECT id FROM alimentacion WHERE insumo_id = $1', [insumo.id]);
  assert.equal(registros.rowCount, 0);
});

test('dos consumos concurrentes no pueden usar el mismo stock', async () => {
  const animalA = await crearAnimal();
  const animalB = await crearAnimal();
  const insumo = await crearInsumo(10);
  const respuestas = await Promise.all([
    api('post', '/api/alimentacion', { animal_id: animalA.id, insumo_id: insumo.id, cantidad: 7 }),
    api('post', '/api/alimentacion', { animal_id: animalB.id, insumo_id: insumo.id, cantidad: 7 }),
  ]);

  assert.deepEqual(respuestas.map((r) => r.status).sort(), [201, 409]);
  assert.equal(respuestas.find((r) => r.status === 409).body.error.code, 'STOCK_INSUFICIENTE');
  assert.equal(await stock(insumo.id), 3);
  const registros = await db.query('SELECT id FROM alimentacion WHERE insumo_id = $1', [insumo.id]);
  assert.equal(registros.rowCount, 1);
});

test('editar alimentación ajusta únicamente la diferencia de stock', async () => {
  const animal = await crearAnimal();
  const insumo = await crearInsumo(10);
  const alta = await api('post', '/api/alimentacion', {
    animal_id: animal.id, insumo_id: insumo.id, cantidad: 4,
  });
  assert.equal(await stock(insumo.id), 6);

  const aumento = await api('patch', `/api/alimentacion/${alta.body.id}`, { cantidad: 7 });
  assert.equal(aumento.status, 200);
  assert.equal(await stock(insumo.id), 3);

  const reduccion = await api('patch', `/api/alimentacion/${alta.body.id}`, { cantidad: 2 });
  assert.equal(reduccion.status, 200);
  assert.equal(await stock(insumo.id), 8);
});

test('eliminar alimentación restaura el stock consumido', async () => {
  const animal = await crearAnimal();
  const insumo = await crearInsumo(10);
  const alta = await api('post', '/api/alimentacion', {
    animal_id: animal.id, insumo_id: insumo.id, cantidad: 4,
  });
  assert.equal(await stock(insumo.id), 6);

  const response = await api('delete', `/api/alimentacion/${alta.body.id}`);
  assert.equal(response.status, 204);
  assert.equal(await stock(insumo.id), 10);
  const registro = await db.query('SELECT id FROM alimentacion WHERE id = $1', [alta.body.id]);
  assert.equal(registro.rowCount, 0);
});

test('fallo intermedio revierte edición y ajuste de stock', async (t) => {
  t.mock.method(console, 'error', () => {});
  const animal = await crearAnimal();
  const insumo = await crearInsumo(10);
  const alta = await api('post', '/api/alimentacion', {
    animal_id: animal.id, insumo_id: insumo.id, cantidad: 4,
  });
  assert.equal(await stock(insumo.id), 6);

  await instalarFalloEdicionAlimentacion();
  let response;
  try {
    response = await api('patch', `/api/alimentacion/${alta.body.id}`, { cantidad: 7.77 });
  } finally {
    await quitarFalloEdicionAlimentacion();
  }

  assert.equal(response.status, 500);
  assert.equal(response.body.error.code, 'INTERNAL_ERROR');
  assert.equal(await stock(insumo.id), 6);
  const registro = await db.query('SELECT cantidad FROM alimentacion WHERE id = $1', [alta.body.id]);
  assert.equal(Number(registro.rows[0].cantidad), 4);
});
