const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { cargarEntornoPruebas } = require('./helpers/testEnvironment');

cargarEntornoPruebas();
const db = require('../src/db');
const app = require('../src/app');

const EMAIL = 'admin.integracion@rancho.test';
const PASSWORD = 'PruebaSegura123!';

async function limpiarEstadoAutenticacion() {
  await db.query(
    `DELETE FROM bitacora
     WHERE usuario_id = (SELECT id FROM usuario WHERE email = $1)`,
    [EMAIL]
  );
  await db.query(
    `UPDATE usuario
     SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_login = NULL, activo = true
         , requiere_cambio_password = false, sesion_version = 1, password_cambiado_en = NULL
     WHERE email = $1`,
    [EMAIL]
  );
}

test.beforeEach(limpiarEstadoAutenticacion);
test.afterEach(limpiarEstadoAutenticacion);
test.after(async () => {
  await db.pool.end();
});

test('login real valida bcrypt, actualiza el usuario y registra bitácora', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, password: PASSWORD });

  assert.equal(response.status, 200);
  assert.equal(response.body.usuario.email, EMAIL);

  const payload = jwt.verify(response.body.token, process.env.JWT_SECRET);
  assert.equal(payload.email, EMAIL);
  assert.equal(payload.sesion_version, 1);

  const { rows } = await db.query(
    `SELECT u.ultimo_login,
            (SELECT COUNT(*)::int FROM bitacora b WHERE b.usuario_id = u.id AND b.accion = 'login') AS logins
     FROM usuario u WHERE u.email = $1`,
    [EMAIL]
  );
  assert.ok(rows[0].ultimo_login);
  assert.equal(rows[0].logins, 1);
});

test('contraseña incorrecta incrementa intentos en PostgreSQL', async () => {
  const response = await request(app)
    .post('/api/auth/login')
    .send({ email: EMAIL, password: 'NoEsLaClave' });

  assert.equal(response.status, 401);
  assert.deepEqual(response.body.error, {
    code: 'AUTHENTICATION_ERROR',
    message: 'Correo o contraseña incorrectos.',
  });

  const { rows } = await db.query(
    'SELECT intentos_fallidos FROM usuario WHERE email = $1',
    [EMAIL]
  );
  assert.equal(rows[0].intentos_fallidos, 1);
});

test('una cuenta bloqueada conserva respuesta pública uniforme y detalle interno auditado', async () => {
  await db.query("UPDATE usuario SET bloqueado_hasta = now() + interval '10 minutes' WHERE email = $1", [EMAIL]);
  const response = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
  assert.equal(response.status, 401);
  assert.deepEqual(response.body.error, { code: 'AUTHENTICATION_ERROR', message: 'Correo o contraseña incorrectos.' });
  const auditoria = await db.query("SELECT detalle FROM bitacora WHERE accion = 'login_fallido' AND usuario_id = (SELECT id FROM usuario WHERE email = $1) ORDER BY id DESC LIMIT 1", [EMAIL]);
  assert.equal(auditoria.rows[0].detalle.contexto.motivo, 'cuenta_bloqueada');
});

test('la sesión consulta su perfil ampliado y cambia únicamente su propia contraseña', async () => {
  const login = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
  const token = login.body.token;
  const nueva = 'NuevaPruebaSegura456!';
  const anterior = await db.query('SELECT password_hash FROM usuario WHERE email = $1', [EMAIL]);
  try {
    const perfil = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(perfil.status, 200);
    assert.equal(perfil.body.usuario.email, EMAIL);
    assert.equal(perfil.body.usuario.activo, true);
    assert.ok('trabajador_nombre' in perfil.body.usuario);
    assert.equal('password_hash' in perfil.body.usuario, false);

    const debil = await request(app).patch('/api/auth/password').set('Authorization', `Bearer ${token}`).send({ password_actual: PASSWORD, password_nuevo: 'corta' });
    assert.equal(debil.status, 400);

    const incorrecta = await request(app).patch('/api/auth/password').set('Authorization', `Bearer ${token}`).send({ password_actual: 'Incorrecta123', password_nuevo: nueva });
    assert.equal(incorrecta.status, 409);

    const cambio = await request(app).patch('/api/auth/password').set('Authorization', `Bearer ${token}`).send({ password_actual: PASSWORD, password_nuevo: nueva });
    assert.equal(cambio.status, 200);
    const actualizado = await db.query('SELECT password_hash, password_cambiado_en, sesion_version FROM usuario WHERE email = $1', [EMAIL]);
    assert.equal(await bcrypt.compare(nueva, actualizado.rows[0].password_hash), true);
    assert.ok(actualizado.rows[0].password_cambiado_en);
    assert.equal(actualizado.rows[0].sesion_version, 2);
    const tokenAnterior = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    assert.equal(tokenAnterior.status, 401);
    const auditoria = await db.query("SELECT detalle FROM bitacora WHERE accion = 'cambiar_password_propia' AND usuario_id = (SELECT id FROM usuario WHERE email = $1) ORDER BY id DESC LIMIT 1", [EMAIL]);
    assert.equal(auditoria.rows.length, 1);
    assert.equal(JSON.stringify(auditoria.rows[0].detalle).includes(nueva), false);
    assert.equal(JSON.stringify(auditoria.rows[0].detalle).includes(PASSWORD), false);
  } finally {
    await db.query('UPDATE usuario SET password_hash = $1, sesion_version = 1, password_cambiado_en = NULL WHERE email = $2', [anterior.rows[0].password_hash, EMAIL]);
  }
});

test('una cuenta creada y restablecida usa una sola contraseña sin bloqueo inicial', async () => {
  const adminLogin = await request(app).post('/api/auth/login').send({ email: EMAIL, password: PASSWORD });
  const adminToken = adminLogin.body.token;
  const rol = await db.query("SELECT id FROM rol WHERE nombre = 'Trabajador'");
  const email = `unica-${Date.now()}@rancho.test`;
  const passwordInicial = 'frase inicial segura';
  const passwordRestablecida = 'frase restablecida segura';
  const alta = await request(app).post('/api/usuarios').set('Authorization', `Bearer ${adminToken}`).send({
    nombre: 'Cuenta de contraseña única', email, password: passwordInicial, rol_id: rol.rows[0].id,
  });
  assert.equal(alta.status, 201);
  assert.equal(alta.body.requiere_cambio_password, undefined);

  // Una cuenta histórica marcada con el indicador legado tampoco queda bloqueada.
  await db.query('UPDATE usuario SET requiere_cambio_password = true WHERE email = $1', [email]);

  const loginInicial = await request(app).post('/api/auth/login').send({ email, password: passwordInicial });
  assert.equal(loginInicial.status, 200);
  const tokenInicial = loginInicial.body.token;
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenInicial}`)).status, 200);
  assert.equal((await request(app).get('/api/animales').set('Authorization', `Bearer ${tokenInicial}`)).status, 200);

  const reset = await request(app).patch(`/api/usuarios/${alta.body.id}/password`).set('Authorization', `Bearer ${adminToken}`).send({ password: passwordRestablecida });
  assert.equal(reset.status, 200);
  assert.deepEqual(reset.body, { ok: true });
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenInicial}`)).status, 401);
  assert.equal((await request(app).post('/api/auth/login').send({ email, password: passwordInicial })).status, 401);

  const loginRestablecida = await request(app).post('/api/auth/login').send({ email, password: passwordRestablecida });
  assert.equal(loginRestablecida.status, 200);
  assert.equal((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${loginRestablecida.body.token}`)).status, 200);
  assert.equal((await request(app).get('/api/animales').set('Authorization', `Bearer ${loginRestablecida.body.token}`)).status, 200);

  const estado = await db.query('SELECT requiere_cambio_password, sesion_version, password_cambiado_en FROM usuario WHERE email = $1', [email]);
  assert.equal(estado.rows[0].requiere_cambio_password, false);
  assert.equal(estado.rows[0].sesion_version, 2);
  assert.ok(estado.rows[0].password_cambiado_en);
  const auditoria = await db.query("SELECT detalle FROM bitacora WHERE accion = 'restablecer_password' AND entidad_id = $1 ORDER BY id DESC LIMIT 1", [alta.body.id]);
  assert.equal(auditoria.rows.length, 1);
  const detalle = JSON.stringify(auditoria.rows[0].detalle);
  assert.doesNotMatch(detalle, /frase inicial|frase restablecida/i);

  const desactivada = await request(app).patch(`/api/usuarios/${alta.body.id}`).set('Authorization', `Bearer ${adminToken}`).send({ activo: false });
  assert.equal(desactivada.status, 200);
  assert.equal((await request(app).post('/api/auth/login').send({ email, password: passwordRestablecida })).status, 401);
});
