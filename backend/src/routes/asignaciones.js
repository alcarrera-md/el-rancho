const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');
const { validar } = require('../middleware/validar');
const validaciones = require('../validation/asignaciones');
const { autorizacion, conflicto, crearError, noEncontrado } = require('../errors');
const { ejecutarIdempotente, responderIdempotente } = require('../idempotency');

const router = express.Router();
const ROLES_PROPIOS = new Set(['Veterinario', 'Trabajador']);

const SELECT_TAREA = `
  SELECT a.*, a.fecha AS fecha_limite,
    t.nombre AS responsable, t.nombre AS trabajador, t.usuario_id AS responsable_usuario_id, t.activo AS responsable_activo,
    c.nombre AS corral, an.arete_id AS animal_arete, an.nombre_alias AS animal_alias,
    i.nombre AS insumo, i.unidad_medida, u.nombre AS creador,
    COALESCE(contexto.corrales, '[]'::json) AS corrales,
    COALESCE(contexto.corral_ids, ARRAY[]::int[]) AS corral_ids
  FROM asignacion_tarea a
  JOIN trabajador t ON t.id = a.trabajador_id
  LEFT JOIN corral c ON c.id = a.corral_id
  LEFT JOIN animal an ON an.id = a.animal_id
  LEFT JOIN insumo i ON i.id = a.insumo_id
  LEFT JOIN usuario u ON u.id = a.creador_usuario_id
  LEFT JOIN LATERAL (
    SELECT json_agg(json_build_object('id', cx.id, 'nombre', cx.nombre) ORDER BY cx.nombre) AS corrales,
           array_agg(cx.id ORDER BY cx.nombre) AS corral_ids
    FROM asignacion_tarea_corral ac
    JOIN corral cx ON cx.id = ac.corral_id
    WHERE ac.tarea_id = a.id
  ) contexto ON true`;

function condicionAcceso(req, condiciones, valores) {
  if (ROLES_PROPIOS.has(req.usuario.rol)) {
    valores.push(req.usuario.id);
    condiciones.push(`t.usuario_id = $${valores.length}`);
  }
}

async function validarReferencias(ejecutor, datos, { exigirTrabajador = false } = {}) {
  if (exigirTrabajador || datos.trabajador_id !== undefined) {
    const trabajador = await ejecutor.query('SELECT id, activo FROM trabajador WHERE id = $1', [datos.trabajador_id]);
    if (!trabajador.rows.length) throw noEncontrado('TRABAJADOR_NO_ENCONTRADO', 'No se encontró el responsable seleccionado.');
    if (!trabajador.rows[0].activo) throw conflicto('TRABAJADOR_INACTIVO', 'No se puede asignar trabajo a un responsable inactivo.');
  }
  if (datos.corral_ids !== undefined) {
    const ids = [...new Set(datos.corral_ids.map(Number))];
    if (ids.length) {
      const corrales = await ejecutor.query('SELECT id FROM corral WHERE id = ANY($1::int[])', [ids]);
      if (corrales.rowCount !== ids.length) throw noEncontrado('CORRAL_NO_ENCONTRADO', 'Uno de los corrales seleccionados ya no existe.');
    }
  }
  for (const [campo, tabla, codigo, mensaje] of [
    ['corral_id', 'corral', 'CORRAL_NO_ENCONTRADO', 'No se encontró el corral seleccionado.'],
    ['animal_id', 'animal', 'ANIMAL_NO_ENCONTRADO', 'No se encontró el animal seleccionado.'],
    ['insumo_id', 'insumo', 'INSUMO_NO_ENCONTRADO', 'No se encontró el insumo seleccionado.'],
  ]) {
    if (datos[campo] === undefined || datos[campo] === null) continue;
    const referencia = await ejecutor.query(`SELECT id FROM ${tabla} WHERE id = $1`, [datos[campo]]);
    if (!referencia.rows.length) throw noEncontrado(codigo, mensaje);
  }
}

async function sincronizarCorrales(ejecutor, tareaId, ids) {
  const unicos = [...new Set((ids || []).map(Number))];
  await ejecutor.query('DELETE FROM asignacion_tarea_corral WHERE tarea_id = $1', [tareaId]);
  if (unicos.length) {
    await ejecutor.query(
      'INSERT INTO asignacion_tarea_corral (tarea_id, corral_id) SELECT $1, unnest($2::int[])',
      [tareaId, unicos]
    );
  }
}

async function obtenerTarea(id, req, ejecutor = db) {
  const condiciones = ['a.id = $1'];
  const valores = [id];
  condicionAcceso(req, condiciones, valores);
  const { rows } = await ejecutor.query(`${SELECT_TAREA} WHERE ${condiciones.join(' AND ')}`, valores);
  return rows[0] || null;
}

router.get('/', validar({ query: validaciones.query }), asyncHandler(async (req, res) => {
  const condiciones = [];
  const valores = [];
  condicionAcceso(req, condiciones, valores);
  const filtros = {
    trabajador_id: 'a.trabajador_id', animal_id: 'a.animal_id',
    tipo: 'a.tipo', prioridad: 'a.prioridad', estado: 'a.estado',
  };
  for (const [campo, columna] of Object.entries(filtros)) {
    if (req.query[campo] === undefined) continue;
    valores.push(req.query[campo]);
    condiciones.push(`${columna} = $${valores.length}`);
  }
  if (req.query.corral_id !== undefined) {
    valores.push(req.query.corral_id);
    condiciones.push(`EXISTS (SELECT 1 FROM asignacion_tarea_corral filtro_corral WHERE filtro_corral.tarea_id = a.id AND filtro_corral.corral_id = $${valores.length})`);
  }
  if (req.query.completada !== undefined) {
    valores.push(req.query.completada === 'true');
    condiciones.push(`a.completada = $${valores.length}`);
  }
  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await db.query(
    `${SELECT_TAREA} ${where}
     ORDER BY CASE a.estado WHEN 'pendiente' THEN 0 WHEN 'en_progreso' THEN 1 WHEN 'completada' THEN 2 ELSE 3 END,
       CASE a.prioridad WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'media' THEN 2 ELSE 3 END,
       a.fecha, a.id`,
    valores
  );
  res.json(rows);
}));

router.get('/:id', validar({ params: validaciones.paramsId }), asyncHandler(async (req, res) => {
  const tarea = await obtenerTarea(req.params.id, req);
  if (!tarea) throw noEncontrado('TAREA_NO_ENCONTRADA', 'No se encontró la tarea solicitada.');
  res.json(tarea);
}));

router.post('/', validar({ body: validaciones.crear }), asyncHandler(async (req, res) => {
  const tarea = await enTransaccion(async (client) => {
    await validarReferencias(client, req.body, { exigirTrabajador: true });
    const { titulo, descripcion, tipo, trabajador_id, corral_id, corral_ids, animal_id, insumo_id, cantidad, fecha_limite, prioridad } = req.body;
    const corrales = corral_ids ?? (corral_id ? [corral_id] : []);
    const corralPrincipal = corrales[0] || null;
    const { rows } = await client.query(
      `INSERT INTO asignacion_tarea
       (titulo, descripcion, tipo, trabajador_id, corral_id, animal_id, insumo_id, cantidad,
        fecha, prioridad, estado, creador_usuario_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pendiente',$11) RETURNING *`,
      [titulo, descripcion, tipo, trabajador_id, corralPrincipal, animal_id || null,
        insumo_id || null, cantidad || null, fecha_limite, prioridad, req.usuario.id]
    );
    await sincronizarCorrales(client, rows[0].id, corrales);
    await registrarBitacora(req.usuario, 'crear_tarea', 'asignacion_tarea', rows[0].id, {
      despues: rows[0], contexto: { responsable_id: trabajador_id },
    }, client);
    return obtenerTarea(rows[0].id, req, client);
  });
  res.status(201).json(tarea);
}));

router.patch('/:id/completar', validar({ params: validaciones.paramsId, body: validaciones.completar }), asyncHandler(async (req, res) => {
  const ejecucion = await ejecutarIdempotente(req, {
    tipo: 'asignacion_tarea.completar', entidad: 'asignacion_tarea',
    payload: { params: { id: req.params.id }, body: req.body },
  }, async (client, contexto) => {
    const anterior = await client.query(
      `SELECT a.*, t.usuario_id AS responsable_usuario_id
       FROM asignacion_tarea a JOIN trabajador t ON t.id = a.trabajador_id
       WHERE a.id = $1 FOR UPDATE OF a`,
      [req.params.id]
    );
    if (!anterior.rows.length) return null;
    const previa = anterior.rows[0];
    if (ROLES_PROPIOS.has(req.usuario.rol) && Number(previa.responsable_usuario_id) !== Number(req.usuario.id)) {
      if (contexto.offline) throw conflicto('TAREA_REASIGNADA', 'La tarea fue reasignada y ya no puede completarse desde este dispositivo.');
      throw noEncontrado('TAREA_NO_ENCONTRADA', 'No se encontró la tarea solicitada.');
    }
    if (previa.estado === 'cancelada') throw conflicto('TAREA_CANCELADA', 'Una tarea cancelada no puede completarse.');
    if (contexto.offline && req.body.expected_version === undefined) {
      throw crearError('OFFLINE_VERSION_REQUIRED', 'La operación offline debe indicar la versión conocida de la tarea.', 400);
    }
    // Si otra persona ya la completó, la versión también cambió; se informa
    // el motivo real en lugar de un "la tarea cambió" genérico.
    if (contexto.offline && req.body.completada && previa.estado === 'completada') {
      throw conflicto('TAREA_ALREADY_COMPLETED', 'La tarea ya fue completada mientras estabas sin conexión.');
    }
    if (req.body.expected_version !== undefined && Number(req.body.expected_version) !== Number(previa.version)) {
      throw conflicto('TAREA_VERSION_CONFLICT', 'La tarea cambió desde la última sincronización. Actualiza los datos antes de continuar.');
    }
    if (!req.body.completada && req.usuario.rol !== 'Administrador') {
      throw autorizacion('Sólo el Administrador puede reabrir una tarea completada.');
    }
    const { rows } = await client.query(
      'UPDATE asignacion_tarea SET estado = $1 WHERE id = $2 RETURNING *',
      [req.body.completada ? 'completada' : 'pendiente', req.params.id]
    );
    await registrarBitacora(req.usuario, req.body.completada ? 'completar_tarea' : 'reabrir_tarea', 'asignacion_tarea', rows[0].id, {
      antes: previa, despues: rows[0],
    }, client);
    return rows[0];
  });
  if (!ejecucion.resultado) throw noEncontrado('TAREA_NO_ENCONTRADA', 'No se encontró la tarea solicitada.');
  return responderIdempotente(res, ejecucion);
}));

router.patch('/:id', validar({ params: validaciones.paramsId, body: validaciones.editar }), asyncHandler(async (req, res) => {
  const tarea = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM asignacion_tarea WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    await validarReferencias(client, req.body);
    const columnas = {
      titulo: 'titulo', descripcion: 'descripcion', tipo: 'tipo', trabajador_id: 'trabajador_id',
      corral_id: 'corral_id', animal_id: 'animal_id', insumo_id: 'insumo_id', cantidad: 'cantidad',
      fecha_limite: 'fecha', prioridad: 'prioridad', estado: 'estado',
    };
    const asignaciones = [];
    const valores = [];
    for (const [campo, columna] of Object.entries(columnas)) {
      if (req.body[campo] === undefined) continue;
      valores.push(req.body[campo]);
      asignaciones.push(`${columna} = $${valores.length}`);
    }
    if (req.body.corral_ids !== undefined) {
      valores.push(req.body.corral_ids[0] || null);
      asignaciones.push(`corral_id = $${valores.length}`);
    }
    valores.push(req.params.id);
    const { rows } = await client.query(
      `UPDATE asignacion_tarea SET ${asignaciones.join(', ')} WHERE id = $${valores.length} RETURNING *`,
      valores
    );
    if (req.body.corral_ids !== undefined) await sincronizarCorrales(client, rows[0].id, req.body.corral_ids);
    else if (req.body.corral_id !== undefined) await sincronizarCorrales(client, rows[0].id, req.body.corral_id ? [req.body.corral_id] : []);
    await registrarBitacora(req.usuario, 'editar_tarea', 'asignacion_tarea', rows[0].id, {
      antes: anterior.rows[0], despues: rows[0], contexto: { reasignada: anterior.rows[0].trabajador_id !== rows[0].trabajador_id },
    }, client);
    return obtenerTarea(rows[0].id, req, client);
  });
  if (!tarea) throw noEncontrado('TAREA_NO_ENCONTRADA', 'No se encontró la tarea solicitada.');
  res.json(tarea);
}));

router.delete('/:id', validar({ params: validaciones.paramsId }), asyncHandler(async (req, res) => {
  const eliminada = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM asignacion_tarea WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    await client.query('DELETE FROM asignacion_tarea WHERE id = $1', [req.params.id]);
    await registrarBitacora(req.usuario, 'eliminar_tarea', 'asignacion_tarea', req.params.id, { antes: anterior.rows[0] }, client);
    return anterior.rows[0];
  });
  if (!eliminada) throw noEncontrado('TAREA_NO_ENCONTRADA', 'No se encontró la tarea solicitada.');
  res.status(204).send();
}));

module.exports = router;
