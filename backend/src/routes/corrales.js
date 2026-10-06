const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');

const router = express.Router();

// Lista de corrales con su ocupación actual y un desglose de salud del lote
// (saludables/en observación/enfermos) + peso promedio — mismo patrón de
// LATERAL join que ya usa reportes.js para el peso promedio por corral.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT c.*, t.nombre AS responsable,
           COUNT(a.id) FILTER (WHERE a.estado = 'vivo') AS ocupacion_actual,
           COUNT(a.id) FILTER (WHERE a.estado = 'vivo' AND a.estado_salud = 'sano') AS saludables,
           COUNT(a.id) FILTER (WHERE a.estado = 'vivo' AND a.estado_salud = 'observacion') AS en_observacion,
           COUNT(a.id) FILTER (WHERE a.estado = 'vivo' AND a.estado_salud = 'enfermo') AS enfermos,
           ROUND(AVG(ultimo.peso_kg) FILTER (WHERE a.estado = 'vivo'), 1) AS peso_promedio
    FROM corral c
    LEFT JOIN trabajador t ON t.id = c.trabajador_id
    LEFT JOIN animal a ON a.corral_actual_id = c.id
    LEFT JOIN LATERAL (
      SELECT peso_kg FROM pesaje p WHERE p.animal_id = a.id ORDER BY fecha DESC LIMIT 1
    ) ultimo ON true
    GROUP BY c.id, t.nombre
    ORDER BY c.nombre
  `);
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre, descripcion, ubicacion, capacidad_maxima, trabajador_id } = req.body;
  const corral = await enTransaccion(async (client) => {
    const { rows } = await client.query(
    `INSERT INTO corral (nombre, descripcion, ubicacion, capacidad_maxima, trabajador_id)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [nombre, descripcion, ubicacion, capacidad_maxima, trabajador_id]
    );
    await registrarBitacora(req.usuario, 'crear_corral', 'corral', rows[0].id, { despues: rows[0] }, client);
    return rows[0];
  });
  res.status(201).json(corral);
}));

// Animales actualmente en un corral (útil para la vista de detalle de corral)
router.get('/:id/animales', asyncHandler(async (req, res) => {
  const { rows } = await db.query(
    `SELECT id, arete_id, nombre_alias, sexo, estado FROM animal
     WHERE corral_actual_id = $1 AND estado = 'vivo' ORDER BY arete_id`,
    [req.params.id]
  );
  res.json(rows);
}));

// Lista global de movimientos de corral (todos los animales) para el módulo
// de Movimientos — filtrable por animal/corral/rango de fechas. Antes solo
// se leía por animal vía /animales/:id/historial; el registro en sí lo sigue
// haciendo el trigger `registrar_movimiento_corral` (no se toca), esta ruta
// solo lee lo que ya se guardó.
router.get('/movimientos', asyncHandler(async (req, res) => {
  const { animal_id, corral_id, desde, hasta } = req.query;
  const condiciones = [];
  const valores = [];

  if (animal_id) {
    valores.push(animal_id);
    condiciones.push(`m.animal_id = $${valores.length}`);
  }
  if (corral_id) {
    valores.push(corral_id);
    condiciones.push(`(m.corral_origen = $${valores.length} OR m.corral_destino = $${valores.length})`);
  }
  if (desde) {
    valores.push(desde);
    condiciones.push(`m.fecha >= $${valores.length}`);
  }
  if (hasta) {
    valores.push(hasta);
    condiciones.push(`m.fecha <= $${valores.length}`);
  }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
  const { rows } = await db.query(
    `SELECT m.id, m.animal_id, m.fecha, m.motivo, m.trabajador_id,
            a.arete_id, a.nombre_alias, co.nombre AS corral_origen,
            cd.nombre AS corral_destino, t.nombre AS responsable
     FROM movimiento_corral m
     JOIN animal a ON a.id = m.animal_id
     LEFT JOIN corral co ON co.id = m.corral_origen
     JOIN corral cd ON cd.id = m.corral_destino
     LEFT JOIN trabajador t ON t.id = m.trabajador_id
     ${where}
     ORDER BY m.fecha DESC, m.id DESC
     LIMIT 300`,
    valores
  );
  res.json(rows);
}));

// Editar un corral (el trigger de BD rechaza reducir la capacidad por debajo de la ocupación actual)
router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, descripcion, ubicacion, capacidad_maxima, trabajador_id } = req.body;
  const corral = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM corral WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
      `UPDATE corral SET
         nombre = COALESCE($1, nombre),
         descripcion = COALESCE($2, descripcion),
         ubicacion = COALESCE($3, ubicacion),
         capacidad_maxima = COALESCE($4, capacidad_maxima),
         trabajador_id = $5
       WHERE id = $6 RETURNING *`,
      [nombre || null, descripcion, ubicacion, capacidad_maxima || null, trabajador_id || null, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_corral', 'corral', rows[0].id, { antes: anterior.rows[0], despues: rows[0] }, client);
    return rows[0];
  });
  if (!corral) return res.status(404).json({ error: 'Corral no encontrado' });
  res.json(corral);
}));

module.exports = router;
