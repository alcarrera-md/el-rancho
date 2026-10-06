const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');

const router = express.Router();

// Lista de insumos, opcionalmente filtrada por tipo (?tipo=alimento)
router.get('/', asyncHandler(async (req, res) => {
  const { tipo } = req.query;
  const { rows } = await db.query(
    `SELECT * FROM insumo ${tipo ? 'WHERE tipo = $1' : ''} ORDER BY nombre`,
    tipo ? [tipo] : []
  );
  res.json(rows);
}));

// Alta de un insumo nuevo (para cuando se necesite agregar un alimento/vacuna que no existe aún)
router.post('/', asyncHandler(async (req, res) => {
  const { nombre, tipo, unidad_medida, stock_actual, stock_minimo, fecha_caducidad } = req.body;
  if (!nombre || !tipo || !unidad_medida) {
    return res.status(400).json({ error: 'nombre, tipo y unidad_medida son obligatorios' });
  }
  const insumo = await enTransaccion(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO insumo (nombre, tipo, unidad_medida, stock_actual, stock_minimo, fecha_caducidad)
       VALUES ($1,$2,$3, COALESCE($4,0), COALESCE($5,0), $6) RETURNING *`,
      [nombre, tipo, unidad_medida, stock_actual, stock_minimo, fecha_caducidad || null]
    );
    await registrarBitacora(req.usuario, 'crear_insumo', 'insumo', rows[0].id, { despues: rows[0] }, client);
    return rows[0];
  });
  res.status(201).json(insumo);
}));

// Editar un insumo (nombre, stock mínimo, caducidad, unidad). El stock_actual
// NO se edita aquí a propósito — cambia solo por compras o consumos registrados.
router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, unidad_medida, stock_minimo, fecha_caducidad } = req.body;
  const insumo = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT * FROM insumo WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!anterior.rows.length) return null;
    const { rows } = await client.query(
    `UPDATE insumo SET
       nombre = COALESCE($1, nombre),
       unidad_medida = COALESCE($2, unidad_medida),
       stock_minimo = COALESCE($3, stock_minimo),
       fecha_caducidad = $4
     WHERE id = $5 RETURNING *`,
    [nombre || null, unidad_medida || null, stock_minimo, fecha_caducidad || null, req.params.id]
    );
    await registrarBitacora(req.usuario, 'editar_insumo', 'insumo', rows[0].id, { antes: anterior.rows[0], despues: rows[0] }, client);
    return rows[0];
  });
  if (!insumo) return res.status(404).json({ error: 'Insumo no encontrado' });
  res.json(insumo);
}));

module.exports = router;
