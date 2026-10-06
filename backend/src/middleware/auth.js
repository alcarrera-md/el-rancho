const jwt = require('jsonwebtoken');
const db = require('../db');
const { autenticacion } = require('../errors');

// Valida la firma del JWT, pero recarga identidad, estado y rol desde PostgreSQL
// en cada solicitud para no confiar en datos de autorización obsoletos del token.
async function autenticar(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    return next(autenticacion('No hay sesión activa. Inicia sesión de nuevo.'));
  }

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    return next(autenticacion('Sesión inválida o expirada. Inicia sesión de nuevo.', { cause: err }));
  }

  if (!Number.isInteger(Number(payload.id)) || Number(payload.id) <= 0) {
    return next(autenticacion('Sesión inválida o expirada. Inicia sesión de nuevo.'));
  }

  try {
    const { rows } = await db.query(
      `SELECT u.id, u.nombre, u.email, u.activo,
              u.sesion_version, r.nombre AS rol
       FROM usuario u JOIN rol r ON r.id = u.rol_id
       WHERE u.id = $1`,
      [payload.id]
    );
    const usuario = rows[0];
    if (!usuario || !usuario.activo) {
      return next(autenticacion('La cuenta ya no está activa. Inicia sesión con una cuenta habilitada.'));
    }
    if (!Number.isInteger(Number(payload.sesion_version)) || Number(payload.sesion_version) !== usuario.sesion_version) {
      return next(autenticacion('La sesión fue reemplazada por un cambio de seguridad. Inicia sesión de nuevo.'));
    }
    req.usuario = {
      id: usuario.id,
      nombre: usuario.nombre,
      email: usuario.email,
      rol: usuario.rol,
      sesion_version: usuario.sesion_version,
    };
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { autenticar };
