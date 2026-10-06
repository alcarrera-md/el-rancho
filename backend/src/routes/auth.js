const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { validar } = require('../middleware/validar');
const { cambiarPassword, login } = require('../validation/auth');
const { registrarBitacora } = require('../bitacora');
const { obtenerConfiguracion } = require('../configuracion');
const { autenticar } = require('../middleware/auth');
const { enTransaccion } = require('../transaction');
const { autenticacion, conflicto } = require('../errors');
const { crearLimitadorLogin } = require('../middleware/authRateLimit');

const router = express.Router();
const HASH_COMPARACION_FICTICIA = bcrypt.hashSync('comparacion-ficticia-no-utilizable', 10);

function crearPayload(usuario) {
  return {
    id: usuario.id,
    nombre: usuario.nombre,
    email: usuario.email,
    rol: usuario.rol,
    sesion_version: usuario.sesion_version,
  };
}

function firmarToken(usuario) {
  return jwt.sign(crearPayload(usuario), process.env.JWT_SECRET, { expiresIn: '8h' });
}

// POST /api/auth/login
router.post('/login', crearLimitadorLogin(), validar({ body: login }), asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email y password son obligatorios' });
  }

  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.password_hash, u.activo, u.intentos_fallidos, u.bloqueado_hasta,
            u.sesion_version, r.nombre AS rol
     FROM usuario u JOIN rol r ON r.id = u.rol_id
     WHERE u.email = $1`,
    [email]
  );

  const usuario = rows[0];
  const huellaEmail = crypto.createHash('sha256').update(String(email).trim().toLowerCase()).digest('hex').slice(0, 16);
  // Mensaje genérico a propósito: no revelar si el email existe o no.
  if (!usuario || !usuario.activo) {
    await bcrypt.compare(password, usuario?.password_hash || HASH_COMPARACION_FICTICIA);
    await registrarBitacora(usuario || null, 'login_fallido', 'usuario', usuario?.id || null, {
      resultado: 'fallo', contexto: { motivo: usuario ? 'usuario_inactivo' : 'credenciales_invalidas', identidad: huellaEmail },
    });
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }

  if (usuario.bloqueado_hasta && new Date(usuario.bloqueado_hasta) > new Date()) {
    await bcrypt.compare(password, usuario.password_hash);
    await registrarBitacora(usuario, 'login_fallido', 'usuario', usuario.id, {
      resultado: 'fallo', contexto: { motivo: 'cuenta_bloqueada', identidad: huellaEmail },
    });
    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }

  const claveValida = await bcrypt.compare(password, usuario.password_hash);
  if (!claveValida) {
    const config = await obtenerConfiguracion();
    await enTransaccion(async (client) => {
      const { rows: actualizado } = await client.query(
        'UPDATE usuario SET intentos_fallidos = intentos_fallidos + 1 WHERE id = $1 RETURNING intentos_fallidos',
        [usuario.id]
      );
      const intentos = actualizado[0].intentos_fallidos;
      await registrarBitacora(usuario, 'login_fallido', 'usuario', usuario.id, {
        resultado: 'fallo', contexto: { motivo: 'credenciales_invalidas', identidad: huellaEmail, intento: intentos },
      }, client);
      if (intentos >= config.max_intentos_login) {
        await client.query(
          `UPDATE usuario SET bloqueado_hasta = now() + ($1 * INTERVAL '1 minute'), intentos_fallidos = 0 WHERE id = $2`,
          [config.minutos_bloqueo_login, usuario.id]
        );
        await registrarBitacora(usuario, 'bloqueo_cuenta', 'usuario', usuario.id, {
          contexto: { intentos, minutos: config.minutos_bloqueo_login },
        }, client);
      }
    });

    return res.status(401).json({ error: 'Correo o contraseña incorrectos.' });
  }

  const payload = crearPayload(usuario);
  const token = firmarToken(usuario);

  await enTransaccion(async (client) => {
    await client.query(
      'UPDATE usuario SET ultimo_login = now(), intentos_fallidos = 0, bloqueado_hasta = NULL WHERE id = $1',
      [usuario.id]
    );
    await registrarBitacora(usuario, 'login', 'usuario', usuario.id, { contexto: { identidad: huellaEmail } }, client);
  });

  res.json({ token, usuario: payload });
}));

// GET /api/auth/me — para validar el token guardado al recargar la página
router.get('/me', autenticar, asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.nombre, u.email, u.activo, u.creado_en, u.ultimo_login,
            u.password_cambiado_en, u.sesion_version, r.nombre AS rol,
            t.id AS trabajador_id, t.nombre AS trabajador_nombre, t.telefono AS trabajador_telefono,
            t.activo AS trabajador_activo
     FROM usuario u
     JOIN rol r ON r.id = u.rol_id
     LEFT JOIN LATERAL (
       SELECT id, nombre, telefono, activo FROM trabajador
       WHERE usuario_id = u.id ORDER BY id LIMIT 1
     ) t ON true
     WHERE u.id = $1`,
    [req.usuario.id]
  );
  res.json({ usuario: rows[0] || req.usuario });
}));

// PATCH /api/auth/password — sólo modifica la contraseña de la sesión activa.
router.patch('/password', autenticar, validar({ body: cambiarPassword }), asyncHandler(async (req, res) => {
  const { password_actual, password_nuevo } = req.body;
  await enTransaccion(async (client) => {
    const { rows } = await client.query(
      'SELECT id, password_hash FROM usuario WHERE id = $1 AND activo = true FOR UPDATE',
      [req.usuario.id]
    );
    if (!rows[0] || !(await bcrypt.compare(password_actual, rows[0].password_hash))) {
      throw conflicto('PASSWORD_CURRENT_INVALID', 'La contraseña actual no es correcta.');
    }
    if (await bcrypt.compare(password_nuevo, rows[0].password_hash)) {
      throw conflicto('PASSWORD_SIN_CAMBIOS', 'La nueva contraseña debe ser diferente de la actual.');
    }
    const hash = await bcrypt.hash(password_nuevo, 10);
    await client.query(
      `UPDATE usuario SET password_hash = $1, password_cambiado_en = now(),
              sesion_version = sesion_version + 1, intentos_fallidos = 0, bloqueado_hasta = NULL
       WHERE id = $2`,
      [hash, req.usuario.id]
    );
    await registrarBitacora(req.usuario, 'cambiar_password_propia', 'usuario', req.usuario.id, {
      contexto: { password_actualizada: true },
    }, client);
  });
  res.json({ mensaje: 'Contraseña actualizada correctamente. Inicia sesión de nuevo.', requiere_login: true });
}));

module.exports = router;
