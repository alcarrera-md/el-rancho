const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { validar } = require('../middleware/validar');
const { compraInsumo } = require('../validation/compras');
const { crearError } = require('../errors');

const router = express.Router();

// Historial de compras de insumos
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query(`
    SELECT ci.*, i.nombre AS insumo, i.unidad_medida, t.nombre AS proveedor
    FROM compra_insumo ci
    JOIN insumo i ON i.id = ci.insumo_id
    JOIN tercero t ON t.id = ci.tercero_id
    ORDER BY ci.fecha DESC
  `);
  res.json(rows);
}));

// Registrar una compra de insumo: aumenta el stock automáticamente — solo Administrador
router.post('/', validar({ body: compraInsumo }), asyncHandler(async (req, res) => {
  const { insumo_id, tercero_id, fecha, cantidad, costo_total } = req.body;
  if (!insumo_id || !tercero_id || !cantidad) {
    return res.status(400).json({ error: 'insumo_id, tercero_id y cantidad son obligatorios' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const insumo = await client.query(
      'SELECT id, stock_actual FROM insumo WHERE id = $1 FOR UPDATE',
      [insumo_id]
    );
    if (!insumo.rows.length) {
      throw crearError('INSUMO_NO_ENCONTRADO', 'No se encontró el insumo solicitado.', 404);
    }
    const compra = await client.query(
      `INSERT INTO compra_insumo (insumo_id, tercero_id, fecha, cantidad, costo_total)
       VALUES ($1,$2, COALESCE($3, CURRENT_DATE), $4, $5) RETURNING *`,
      [insumo_id, tercero_id, fecha, cantidad, costo_total || null]
    );
    const actualizado = await client.query(
      'UPDATE insumo SET stock_actual = stock_actual + $1 WHERE id = $2 RETURNING id, stock_actual',
      [cantidad, insumo_id]
    );
    await registrarBitacora(req.usuario, 'comprar_insumo', 'compra_insumo', compra.rows[0].id, {
      antes: { insumo: insumo.rows[0] },
      despues: { compra: compra.rows[0], insumo: actualizado.rows[0] },
      contexto: { tercero_id },
    }, client);
    await client.query('COMMIT');
    res.status(201).json(compra.rows[0]);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
