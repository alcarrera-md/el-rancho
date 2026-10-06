const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const db = require('../src/db');
const app = require('../src/app');

const JWT_SECRET_ORIGINAL = process.env.JWT_SECRET;

test.before(() => {
  process.env.JWT_SECRET = 'secreto-exclusivo-para-pruebas';
});

test.after(() => {
  if (JWT_SECRET_ORIGINAL === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = JWT_SECRET_ORIGINAL;
});

test('POST /api/auth/login exige correo y contraseña', async () => {
  const response = await request(app).post('/api/auth/login').send({ email: 'admin@rancho.com' });

  assert.equal(response.status, 400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(response.body.error.message, 'Los datos enviados no son válidos.');
  assert.deepEqual(response.body.error.details, [
    { field: 'password', message: 'Campo obligatorio.' },
  ]);
});

test('POST /api/auth/login no revela si el correo existe', async (t) => {
  t.mock.method(db, 'query', async () => ({ rows: [] }));
  const comparar = t.mock.method(bcrypt, 'compare', async () => false);

  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: 'nadie@rancho.com', password: 'incorrecta' });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body.error, {
    code: 'AUTHENTICATION_ERROR',
    message: 'Correo o contraseña incorrectos.',
  });
  assert.equal(comparar.mock.callCount(), 1, 'debe ejecutar una comparación bcrypt ficticia');
});

test('POST /api/auth/login entrega un JWT para credenciales válidas', async (t) => {
  const passwordHash = await bcrypt.hash('ClaveSegura123', 4);
  const usuario = {
    id: 7,
    nombre: 'Administradora de prueba',
    email: 'admin.test@rancho.com',
    password_hash: passwordHash,
    activo: true,
    intentos_fallidos: 0,
    bloqueado_hasta: null,
    sesion_version: 1,
    rol: 'Administrador',
  };

  t.mock.method(db, 'query', async (sql) => {
    if (sql.includes('FROM usuario u JOIN rol')) return { rows: [usuario] };
    if (sql.includes('UPDATE usuario SET ultimo_login')) return { rows: [] };
    if (sql.includes('INSERT INTO bitacora')) return { rows: [] };
    throw new Error(`Consulta inesperada en la prueba: ${sql}`);
  });
  t.mock.method(db.pool, 'connect', async () => ({
    query: async (sql) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      return db.query(sql);
    },
    release() {},
  }));

  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: usuario.email, password: 'ClaveSegura123' });

  assert.equal(response.status, 200);
  assert.equal(response.body.usuario.email, usuario.email);
  assert.equal(response.body.usuario.rol, 'Administrador');

  const payload = jwt.verify(response.body.token, process.env.JWT_SECRET);
  assert.equal(payload.id, usuario.id);
  assert.equal(payload.sesion_version, 1);
  assert.equal(payload.exp - payload.iat, 8 * 60 * 60);
  assert.equal(payload.email, usuario.email);
});

test('una ruta protegida rechaza peticiones sin token', async () => {
  const response = await request(app).get('/api/animales');

  assert.equal(response.status, 401);
  assert.equal(response.body.error.code, 'AUTHENTICATION_ERROR');
  assert.match(response.body.error.message, /No hay sesión activa/);
});
