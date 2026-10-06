const db = require('./db');

const CLAVE_SENSIBLE = /(password|password_hash|contrase(?:ñ|n)a|token|jwt|secret|secreto|api[_-]?key|smtp|credential|credencial)/i;

function sanitizar(valor, vistos = new WeakSet()) {
  if (valor === null || valor === undefined) return valor;
  if (valor instanceof Date) return valor.toISOString();
  if (Array.isArray(valor)) return valor.map((item) => sanitizar(item, vistos));
  if (typeof valor !== 'object') return valor;
  if (vistos.has(valor)) return '[REFERENCIA_CIRCULAR]';
  vistos.add(valor);
  const limpio = {};
  for (const [clave, contenido] of Object.entries(valor)) {
    if (!CLAVE_SENSIBLE.test(clave)) limpio[clave] = sanitizar(contenido, vistos);
  }
  vistos.delete(valor);
  return limpio;
}

function construirDetalle(usuario, datos = {}) {
  const detalle = {
    version: 1,
    resultado: datos.resultado || 'exito',
    actor: { rol: usuario?.rol || null },
  };
  if (datos.antes !== undefined) detalle.antes = sanitizar(datos.antes);
  if (datos.despues !== undefined) detalle.despues = sanitizar(datos.despues);
  if (datos.contexto !== undefined) detalle.contexto = sanitizar(datos.contexto);
  return detalle;
}

// El ejecutor puede ser db o un cliente pg dentro de una transacción. Los
// errores se propagan: el llamador decide si deben provocar rollback.
async function registrarBitacora(usuario, accion, entidad, entidadId, datos = {}, ejecutor = db) {
  const detalle = construirDetalle(usuario, datos);
  const { rows } = await ejecutor.query(
    `INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, detalle)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [usuario?.id || null, accion, entidad || null, entidadId || null, detalle]
  );
  return rows[0];
}

module.exports = { construirDetalle, registrarBitacora, sanitizar };
