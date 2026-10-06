const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { validar } = require('../middleware/validar');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');
const { conflicto, noEncontrado } = require('../errors');
const { crearUsuario, restablecerPassword } = require('../validation/usuarios');

const router = express.Router();

// Lista de usuarios — la matriz central reserva todo este recurso al Administrador.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.activo, u.ultimo_login, u.rol_id, u.bloqueado_hasta,
            u.password_cambiado_en, r.nombre AS rol,
            t.id AS trabajador_id, t.nombre AS trabajador
     FROM usuario u JOIN rol r ON r.id = u.rol_id
     LEFT JOIN LATERAL (SELECT id, nombre FROM trabajador WHERE usuario_id = u.id ORDER BY id LIMIT 1) t ON true
     ORDER BY u.nombre`
  );
  res.json(rows);
}));

// Catálogo de roles disponibles (para el selector del formulario)
router.get('/roles', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT id, nombre FROM rol ORDER BY id');
  res.json(rows);
}));

// Alta de usuario — solo Administrador
router.post('/', validar({ body: crearUsuario }), asyncHandler(async (req, res) => {
  const { nombre, email, password, rol_id, trabajador_id } = req.body;
  if (!nombre || !email || !password || !rol_id) {
    return res.status(400).json({ error: 'nombre, email, password y rol_id son obligatorios' });
  }
  const hash = await bcrypt.hash(password, 10);
  const usuario = await enTransaccion(async (client) => {
    if (trabajador_id) {
      const trabajador = await client.query('SELECT id, usuario_id FROM trabajador WHERE id = $1 FOR UPDATE', [trabajador_id]);
      if (!trabajador.rows.length) throw noEncontrado('TRABAJADOR_NO_ENCONTRADO', 'No se encontró el trabajador seleccionado.');
      if (trabajador.rows[0].usuario_id) throw conflicto('TRABAJADOR_CON_ACCESO', 'Este trabajador ya tiene una cuenta vinculada.');
    }
    const { rows } = await client.query(
      `INSERT INTO usuario (nombre, email, password_hash, rol_id, requiere_cambio_password, password_cambiado_en)
       VALUES ($1,$2,$3,$4,false,now())
       RETURNING id, nombre, email, activo, rol_id`,
      [nombre, email, hash, rol_id]
    );
    if (trabajador_id) await client.query('UPDATE trabajador SET usuario_id = $1 WHERE id = $2', [rows[0].id, trabajador_id]);
    await registrarBitacora(req.usuario, 'crear_usuario', 'usuario', rows[0].id, {
      despues: rows[0], contexto: { trabajador_id: trabajador_id || null },
    }, client);
    return rows[0];
  });
  res.status(201).json(usuario);
}));

// Cambiar rol o activar/desactivar una cuenta — solo Administrador
router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, email, rol_id, activo } = req.body;
  if (nombre !== undefined && !String(nombre).trim()) return res.status(400).json({ error: 'nombre no puede estar vacío' });
  if (email !== undefined && !String(email).trim()) return res.status(400).json({ error: 'email no puede estar vacío' });
  const usuario = await enTransaccion(async (client) => {
    const anterior = await client.query(
      'SELECT u.id, u.nombre, u.email, u.activo, u.rol_id, r.nombre AS rol FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id = $1 FOR UPDATE OF u',
      [req.params.id]
    );
    if (!anterior.rows.length) return null;
    await client.query(
      'UPDATE usuario SET nombre = COALESCE($1, nombre), email = COALESCE($2, email), rol_id = COALESCE($3, rol_id), activo = COALESCE($4, activo) WHERE id = $5',
      [nombre?.trim() || null, email?.trim().toLowerCase() || null, rol_id, activo, req.params.id]
    );
    const nuevo = await client.query(
      'SELECT u.id, u.nombre, u.email, u.activo, u.rol_id, r.nombre AS rol FROM usuario u JOIN rol r ON r.id = u.rol_id WHERE u.id = $1',
      [req.params.id]
    );
    const cambioRol = anterior.rows[0].rol_id !== nuevo.rows[0].rol_id;
    const desactivado = anterior.rows[0].activo && !nuevo.rows[0].activo;
    await registrarBitacora(req.usuario, cambioRol ? 'cambiar_rol_usuario' : desactivado ? 'desactivar_usuario' : 'editar_usuario', 'usuario', nuevo.rows[0].id, {
      antes: anterior.rows[0], despues: nuevo.rows[0], contexto: { cambio_rol: cambioRol, desactivacion: desactivado },
    }, client);
    return nuevo.rows[0];
  });
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(usuario);
}));

// Restablecer contraseña de un usuario — solo Administrador
router.patch('/:id/password', validar({ body: restablecerPassword }), asyncHandler(async (req, res) => {
  const { password } = req.body;
  if (!password) return res.status(400).json({ error: 'password es obligatorio' });
  const hash = await bcrypt.hash(password, 10);
  const actualizado = await enTransaccion(async (client) => {
    const { rows } = await client.query(
      `UPDATE usuario SET password_hash = $1, requiere_cambio_password = false,
              password_cambiado_en = now(), sesion_version = sesion_version + 1,
              intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE id = $2 RETURNING id`,
      [hash, req.params.id]
    );
    if (!rows.length) return false;
    await registrarBitacora(req.usuario, 'restablecer_password', 'usuario', rows[0].id, {
      contexto: { password_restaurada: true, sesiones_invalidadas: true },
    }, client);
    return true;
  });
  if (!actualizado) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ ok: true });
}));

// Desbloquear una cuenta bloqueada por intentos fallidos, antes de que pase el tiempo — solo Administrador
router.patch('/:id/desbloquear', asyncHandler(async (req, res) => {
  const usuario = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT id, bloqueado_hasta, intentos_fallidos FROM usuario WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
      `UPDATE usuario SET bloqueado_hasta = NULL, intentos_fallidos = 0
       WHERE id = $1 RETURNING id, nombre, email, activo, bloqueado_hasta, intentos_fallidos`,
      [req.params.id]
    );
    await registrarBitacora(req.usuario, 'desbloquear_usuario', 'usuario', rows[0].id, { antes: anterior.rows[0], despues: rows[0] }, client);
    return rows[0];
  });
  if (!usuario) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json(usuario);
}));

module.exports = router;
