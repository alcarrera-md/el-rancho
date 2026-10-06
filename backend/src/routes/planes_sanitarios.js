const express = require('express');
const { mensajePublicoError } = require('../middleware/errorHandler');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// ---------------------------------------------------------
// Plantillas de plan sanitario
// ---------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT p.*, COUNT(i.id) AS total_items
    FROM plan_sanitario p
    LEFT JOIN plan_sanitario_item i ON i.plan_id = p.id
    GROUP BY p.id
    ORDER BY p.nombre
  `);
  res.json(rows);
}));

router.get('/:id', asyncHandler(async (req, res) => {
  const plan = await db.query('SELECT * FROM plan_sanitario WHERE id = $1', [req.params.id]);
  if (!plan.rows.length) return res.status(404).json({ error: 'Plan no encontrado' });
  const items = await db.query(
    `SELECT pi.*, i.nombre AS insumo_nombre FROM plan_sanitario_item pi
     LEFT JOIN insumo i ON i.id = pi.insumo_id
     WHERE pi.plan_id = $1 ORDER BY pi.edad_dias`,
    [req.params.id]
  );
  res.json({ ...plan.rows[0], items: items.rows });
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, descripcion } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  const { rows } = await db.query(
    'INSERT INTO plan_sanitario (nombre, descripcion) VALUES ($1,$2) RETURNING *',
    [nombre, descripcion || null]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, descripcion, activo } = req.body;
  const { rows } = await db.query(
    `UPDATE plan_sanitario SET nombre = COALESCE($1, nombre), descripcion = $2, activo = COALESCE($3, activo)
     WHERE id = $4 RETURNING *`,
    [nombre || null, descripcion, activo, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Plan no encontrado' });
  res.json(rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM plan_sanitario WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Plan no encontrado' });
  res.status(204).send();
}));

// ---------------------------------------------------------
// Ítems de un plan (ej. "Vacuna Triple a los 90 días")
// ---------------------------------------------------------
router.post('/:id/items', asyncHandler(async (req, res) => {
  const { nombre_evento, tipo, insumo_id, edad_dias, descripcion } = req.body;
  if (!nombre_evento || edad_dias === undefined) {
    return res.status(400).json({ error: 'nombre_evento y edad_dias son obligatorios' });
  }
  const { rows } = await db.query(
    `INSERT INTO plan_sanitario_item (plan_id, nombre_evento, tipo, insumo_id, edad_dias, descripcion)
     VALUES ($1,$2, COALESCE($3,'vacuna'), $4, $5, $6) RETURNING *`,
    [req.params.id, nombre_evento, tipo, insumo_id || null, edad_dias, descripcion || null]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/items/:itemId', asyncHandler(async (req, res) => {
  const { nombre_evento, tipo, insumo_id, edad_dias, descripcion } = req.body;
  const { rows } = await db.query(
    `UPDATE plan_sanitario_item SET
       nombre_evento = COALESCE($1, nombre_evento), tipo = COALESCE($2, tipo),
       insumo_id = $3, edad_dias = COALESCE($4, edad_dias), descripcion = $5
     WHERE id = $6 RETURNING *`,
    [nombre_evento || null, tipo || null, insumo_id || null, edad_dias, descripcion, req.params.itemId]
  );
  if (!rows.length) return res.status(404).json({ error: 'Ítem no encontrado' });
  res.json(rows[0]);
}));

router.delete('/items/:itemId', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM plan_sanitario_item WHERE id = $1', [req.params.itemId]);
  if (!rowCount) return res.status(404).json({ error: 'Ítem no encontrado' });
  res.status(204).send();
}));

// ---------------------------------------------------------
// Asignar un plan a uno o varios animales
// ---------------------------------------------------------
router.post('/:id/asignar', asyncHandler(async (req, res) => {
  const { animal_ids } = req.body;
  if (!Array.isArray(animal_ids) || animal_ids.length === 0) {
    return res.status(400).json({ error: 'animal_ids (lista) es obligatorio' });
  }
  const asignados = [];
  const errores = [];
  for (const animal_id of animal_ids) {
    try {
      const { rows } = await db.query(
        `INSERT INTO animal_plan_sanitario (animal_id, plan_id) VALUES ($1,$2)
         ON CONFLICT (animal_id, plan_id) DO NOTHING RETURNING *`,
        [animal_id, req.params.id]
      );
      if (rows.length) asignados.push(rows[0]);
    } catch (err) {
      errores.push({ animal_id, error: mensajePublicoError(err) });
    }
  }
  res.status(201).json({ asignados, errores });
}));

router.delete('/asignaciones/:asignacionId', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM animal_plan_sanitario WHERE id = $1', [req.params.asignacionId]);
  if (!rowCount) return res.status(404).json({ error: 'Asignación no encontrada' });
  res.status(204).send();
}));

// ---------------------------------------------------------
// Pendientes de un animal: compara la edad del animal contra
// cada ítem de sus planes asignados, y ve si ya se aplicó
// (buscando un evento_salud que referencie ese plan_item_id)
// ---------------------------------------------------------
router.get('/animal/:animal_id/pendientes', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT
      aps.id AS asignacion_id,
      p.id AS plan_id, p.nombre AS plan_nombre,
      pi.id AS item_id, pi.nombre_evento, pi.tipo, pi.insumo_id, pi.edad_dias, pi.descripcion,
      i.nombre AS insumo_nombre,
      a.fecha_nacimiento + (pi.edad_dias || ' days')::interval AS fecha_objetivo,
      es.id AS evento_salud_id
    FROM animal_plan_sanitario aps
    JOIN plan_sanitario p ON p.id = aps.plan_id AND p.activo = true
    JOIN plan_sanitario_item pi ON pi.plan_id = p.id
    JOIN animal a ON a.id = aps.animal_id
    LEFT JOIN insumo i ON i.id = pi.insumo_id
    LEFT JOIN evento_salud es ON es.animal_id = aps.animal_id AND es.plan_item_id = pi.id
    WHERE aps.animal_id = $1 AND a.fecha_nacimiento IS NOT NULL
    ORDER BY fecha_objetivo
  `, [req.params.animal_id]);

  const hoy = new Date();
  const resultado = rows.map((r) => {
    const fechaObjetivo = new Date(r.fecha_objetivo);
    let estado;
    if (r.evento_salud_id) estado = 'aplicado';
    else if (fechaObjetivo < hoy) estado = 'vencido';
    else estado = 'proximo';
    return { ...r, estado };
  });
  res.json(resultado);
}));

module.exports = router;
