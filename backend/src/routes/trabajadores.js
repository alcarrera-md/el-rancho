const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');

const router = express.Router();

// Lista de trabajadores
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT t.*, u.id AS acceso_usuario_id, u.email, u.activo AS usuario_activo,
            u.ultimo_login, r.nombre AS rol
     FROM trabajador t
     LEFT JOIN usuario u ON u.id = t.usuario_id
     LEFT JOIN rol r ON r.id = u.rol_id
     ORDER BY t.nombre`
  );
  res.json(rows);
}));

// Alta de trabajador (sin cuenta de usuario todavía; eso se agrega al construir el login)
router.post('/', asyncHandler(async (req, res) => {
  const { nombre, telefono } = req.body;
  if (!nombre) {
    return res.status(400).json({ error: 'nombre es obligatorio' });
  }
  const trabajador = await enTransaccion(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO trabajador (nombre, telefono) VALUES ($1,$2) RETURNING *`,
      [nombre, telefono || null]
    );
    await registrarBitacora(req.usuario, 'crear_trabajador', 'trabajador', rows[0].id, { despues: rows[0] }, client);
    return rows[0];
  });
  res.status(201).json(trabajador);
}));

// Editar datos generales del trabajador
router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, telefono } = req.body;
  const trabajador = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM trabajador WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
    `UPDATE trabajador SET nombre = COALESCE($1, nombre), telefono = $2 WHERE id = $3 RETURNING *`,
    [nombre || null, telefono, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_trabajador', 'trabajador', rows[0].id, { antes: anterior.rows[0], despues: rows[0] }, client);
    return rows[0];
  });
  if (!trabajador) return res.status(404).json({ error: 'Trabajador no encontrado' });
  res.json(trabajador);
}));

// Activar/desactivar un trabajador (baja lógica, no se borra el historial de asignaciones).
// Si se desactiva, avisa (sin bloquear) si sigue como responsable de algún corral
// o tiene tareas pendientes — para que el Administrador pueda reasignarlas.
router.patch('/:id/estado', asyncHandler(async (req, res) => {
  const { activo } = req.body;
  const resultado = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM trabajador WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query('UPDATE trabajador SET activo = $1 WHERE id = $2 RETURNING *', [activo, req.params.id]);
    const advertencias = [];
    if (activo === false) {
      const corrales = await client.query('SELECT nombre FROM corral WHERE trabajador_id = $1', [req.params.id]);
      const tareas = await client.query("SELECT COUNT(*) AS total FROM asignacion_tarea WHERE trabajador_id = $1 AND estado IN ('pendiente', 'en_progreso')", [req.params.id]);
      if (corrales.rows.length) advertencias.push(`Sigue como responsable de: ${corrales.rows.map((c) => c.nombre).join(', ')}.`);
      if (Number(tareas.rows[0].total) > 0) advertencias.push(`Tiene ${tareas.rows[0].total} tarea(s) pendiente(s) asignada(s).`);
    }
    await registrarBitacora(req.usuario, activo ? 'activar_trabajador' : 'desactivar_trabajador', 'trabajador', rows[0].id, {
      antes: anterior.rows[0], despues: rows[0], contexto: { advertencias },
    }, client);
    return { ...rows[0], advertencias };
  });
  if (!resultado) return res.status(404).json({ error: 'Trabajador no encontrado' });
  res.json(resultado);
}));

module.exports = router;
