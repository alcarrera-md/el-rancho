const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

const usuarios = new Map();
let secuencia = 0;

function marca(prefijo) {
  secuencia += 1;
  return `E-${prefijo}-${Date.now()}-${secuencia}`;
}

async function crearUsuario(rol) {
  const email = `${marca(rol).toLowerCase()}@rancho.test`;
  const { rows } = await db.query(
    `INSERT INTO usuario (nombre, email, password_hash, rol_id, activo)
     SELECT $1, $2, 'hash-no-usado', id, true FROM rol WHERE nombre = $3
     RETURNING id, nombre, email`,
    [`Usuario ${rol}`, email, rol]
  );
  const usuario = { ...rows[0], rol };
  usuario.token = jwt.sign({ ...usuario, sesion_version: 1 }, process.env.JWT_SECRET, { expiresIn: '1h' });
  usuarios.set(rol, usuario);
  return usuario;
}

function api(rol, method, path, body) {
  const llamada = request(app)[method](path).set('Authorization', `Bearer ${usuarios.get(rol).token}`);
  return body === undefined ? llamada : llamada.send(body);
}

async function crearAnimal() {
  const { rows } = await db.query(
    `INSERT INTO animal (arete_id, sexo, origen, estado, categoria)
     VALUES ($1, 'hembra', 'nacimiento', 'vivo', 'cria') RETURNING *`,
    [marca('ANIMAL')]
  );
  return rows[0];
}

async function crearInsumo(stock = 20) {
  const { rows } = await db.query(
    `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo)
     VALUES ($1, 'alimento', 'kg', $2, 0) RETURNING *`,
    [marca('INSUMO'), stock]
  );
  return rows[0];
}

test.before(async () => {
  for (const rol of ['Administrador', 'Veterinario', 'Trabajador', 'Auditor']) {
    await crearUsuario(rol);
  }
});

test.after(async () => {
  await db.pool.end();
});

test('Administrador puede ejecutar una operación administrativa', async () => {
  const response = await api('Administrador', 'post', '/api/usuarios', {
    nombre: 'Cuenta creada por E', email: `${marca('ADMIN')}@rancho.test`, password: 'ClaveSegura123', rol_id: 4,
  });
  assert.equal(response.status, 201);
  assert.ok(response.body.id);
});

test('Administrador crea y restablece acceso vinculado sin exponer contraseñas', async () => {
  const trabajador = await db.query('INSERT INTO trabajador (nombre, activo) VALUES ($1, true) RETURNING id, nombre', [marca('TRABAJADOR-ACCESO')]);
  const rol = await db.query("SELECT id FROM rol WHERE nombre = 'Trabajador'");
  const email = `${marca('ACCESO').toLowerCase()}@rancho.test`;
  const alta = await api('Administrador', 'post', '/api/usuarios', {
    nombre: trabajador.rows[0].nombre, email, password: 'TemporalSegura7', rol_id: rol.rows[0].id, trabajador_id: trabajador.rows[0].id,
  });
  assert.equal(alta.status, 201);
  assert.equal(alta.body.password, undefined);
  assert.equal(alta.body.password_hash, undefined);
  assert.equal(alta.body.requiere_cambio_password, undefined);

  const personal = await api('Administrador', 'get', '/api/trabajadores');
  const vinculado = personal.body.find((item) => item.id === trabajador.rows[0].id);
  assert.equal(vinculado.email, email);
  assert.equal(vinculado.usuario_activo, true);

  const reset = await api('Administrador', 'patch', `/api/usuarios/${alta.body.id}/password`, { password: 'OtraTemporal8' });
  assert.deepEqual(reset.body, { ok: true });
  const estado = await db.query('SELECT requiere_cambio_password, sesion_version, intentos_fallidos, bloqueado_hasta FROM usuario WHERE id = $1', [alta.body.id]);
  assert.equal(estado.rows[0].requiere_cambio_password, false);
  assert.equal(estado.rows[0].sesion_version, 2);
  assert.equal(estado.rows[0].intentos_fallidos, 0);
  assert.equal(estado.rows[0].bloqueado_hasta, null);
});

test('Veterinario puede escribir salud y reproducción', async () => {
  const animal = await crearAnimal();
  await db.query("UPDATE animal SET categoria='vientre' WHERE id=$1", [animal.id]);
  const salud = await api('Veterinario', 'post', '/api/salud', {
    animal_id: animal.id, tipo: 'diagnostico', enfermedad: 'Revisión E', fecha: '2026-08-20',
  });
  const reproduccion = await api('Veterinario', 'post', '/api/reproduccion', {
    madre_id: animal.id, tipo_monta: 'natural', fecha_monta: '2026-08-20',
  });
  assert.equal(salud.status, 201);
  assert.equal(reproduccion.status, 201);
});

test('Veterinario no puede administrar usuarios ni el catálogo de insumos', async () => {
  const usuariosResponse = await api('Veterinario', 'get', '/api/usuarios');
  const insumosResponse = await api('Veterinario', 'post', '/api/insumos', {
    nombre: marca('CATALOGO'), tipo: 'medicamento', unidad_medida: 'ml',
  });
  assert.equal(usuariosResponse.status, 403);
  assert.equal(insumosResponse.status, 403);
  assert.equal(insumosResponse.body.error.code, 'AUTHORIZATION_ERROR');
});

test('Trabajador puede registrar alimentación', async () => {
  const animal = await crearAnimal();
  const insumo = await crearInsumo();
  const response = await api('Trabajador', 'post', '/api/alimentacion', {
    animal_id: animal.id, insumo_id: insumo.id, cantidad: 3,
  });
  assert.equal(response.status, 201);
});

test('Trabajador no puede ejecutar operaciones financieras sensibles', async () => {
  const venta = await api('Trabajador', 'post', '/api/ventas', {});
  const compra = await api('Trabajador', 'post', '/api/compras-insumo', {});
  assert.equal(venta.status, 403);
  assert.equal(compra.status, 403);
  assert.equal(venta.body.error.code, 'AUTHORIZATION_ERROR');
});

test('Trabajador puede reportar observación pero no establecer estado clínico', async () => {
  const animal = await crearAnimal();
  const observacion = await api('Trabajador', 'patch', `/api/animales/${animal.id}/estado-salud`, {
    estado_salud: 'observacion',
  });
  const diagnostico = await api('Trabajador', 'patch', `/api/animales/${animal.id}/estado-salud`, {
    estado_salud: 'enfermo', salud_diagnostico: 'No autorizado',
  });
  assert.equal(observacion.status, 200);
  assert.equal(observacion.body.estado_salud, 'observacion');
  assert.equal(diagnostico.status, 403);
});

test('Trabajador no puede administrar razas', async () => {
  const response = await api('Trabajador', 'post', '/api/razas', { nombre: marca('RAZA') });
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'AUTHORIZATION_ERROR');
});

test('Auditor puede leer reportes financieros y bitácora', async () => {
  const financiero = await api('Auditor', 'get', '/api/reportes/financiero');
  const bitacora = await api('Auditor', 'get', '/api/bitacora');
  assert.equal(financiero.status, 200);
  assert.equal(bitacora.status, 200);
  assert.ok(Array.isArray(bitacora.body));
});

test('Auditor no puede crear, editar ni eliminar datos operativos', async () => {
  const animal = await crearAnimal();
  const alta = await api('Auditor', 'post', '/api/animales', {});
  const edicion = await api('Auditor', 'patch', `/api/animales/${animal.id}`, {});
  const eliminacion = await api('Auditor', 'delete', '/api/pesajes/2147483647');
  assert.deepEqual([alta.status, edicion.status, eliminacion.status], [403, 403, 403]);
  assert.ok([alta, edicion, eliminacion].every((response) => response.body.error.code === 'AUTHORIZATION_ERROR'));
});

test('Auditor no puede eliminar una nota aunque figure como autor', async () => {
  const animal = await crearAnimal();
  const auditor = usuarios.get('Auditor');
  const { rows } = await db.query(
    `INSERT INTO nota_seguimiento (animal_id, usuario_id, contenido)
     VALUES ($1,$2,'Nota histórica E') RETURNING id`,
    [animal.id, auditor.id]
  );
  const response = await api('Auditor', 'delete', `/api/notas-seguimiento/${rows[0].id}`);
  assert.equal(response.status, 403);
  const nota = await db.query('SELECT id FROM nota_seguimiento WHERE id = $1', [rows[0].id]);
  assert.equal(nota.rowCount, 1);
});

test('usuario desactivado pierde acceso aunque su JWT siga vigente', async () => {
  const trabajador = usuarios.get('Trabajador');
  await db.query('UPDATE usuario SET activo = false WHERE id = $1', [trabajador.id]);
  const response = await api('Trabajador', 'get', '/api/animales');
  const me = await api('Trabajador', 'get', '/api/auth/me');
  assert.equal(response.status, 401);
  assert.equal(me.status, 401);
  assert.equal(response.body.error.code, 'AUTHENTICATION_ERROR');
  await db.query('UPDATE usuario SET activo = true WHERE id = $1', [trabajador.id]);
});

test('un cambio de rol se refleja inmediatamente con el mismo JWT', async () => {
  const trabajador = usuarios.get('Trabajador');
  const rolAuditor = await db.query("SELECT id FROM rol WHERE nombre = 'Auditor'");
  await db.query('UPDATE usuario SET rol_id = $1 WHERE id = $2', [rolAuditor.rows[0].id, trabajador.id]);
  const me = await api('Trabajador', 'get', '/api/auth/me');
  const response = await api('Trabajador', 'post', '/api/alimentacion', {});
  assert.equal(me.status, 200);
  assert.equal(me.body.usuario.rol, 'Auditor');
  assert.equal(response.status, 403);
  assert.equal(response.body.error.code, 'AUTHORIZATION_ERROR');
  const rolTrabajador = await db.query("SELECT id FROM rol WHERE nombre = 'Trabajador'");
  await db.query('UPDATE usuario SET rol_id = $1 WHERE id = $2', [rolTrabajador.rows[0].id, trabajador.id]);
});

test('una denegación devuelve 403 estructurado y sin detalles internos', async () => {
  const response = await api('Auditor', 'patch', '/api/configuracion', { precio_leche_litro: 10 });
  assert.equal(response.status, 403);
  assert.deepEqual(response.body, {
    error: {
      code: 'AUTHORIZATION_ERROR',
      message: 'Tu rol no tiene permiso para realizar esta acción.',
    },
  });
});

test('las lecturas generales permitidas continúan funcionando', async () => {
  for (const rol of ['Veterinario', 'Trabajador', 'Auditor']) {
    const animales = await api(rol, 'get', '/api/animales');
    const ventas = await api(rol, 'get', '/api/ventas/reporte');
    const configuracion = await api(rol, 'get', '/api/configuracion');
    assert.equal(animales.status, 200, rol);
    assert.equal(ventas.status, 200, rol);
    assert.equal(configuracion.status, 200, rol);
  }
});
