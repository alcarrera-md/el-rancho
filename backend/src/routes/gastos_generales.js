const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');

const router = express.Router();

// ---------------------------------------------------------
// Categorías de gasto
// ---------------------------------------------------------
router.get('/categorias', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM categoria_gasto ORDER BY nombre');
  res.json(rows);
}));

router.post('/categorias', asyncHandler(async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  const { rows } = await db.query(
    `INSERT INTO categoria_gasto (nombre) VALUES ($1)
     ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING *`,
    [nombre]
  );
  res.status(201).json(rows[0]);
}));

// ---------------------------------------------------------
// Gastos generales
// ---------------------------------------------------------
router.get('/', asyncHandler(async (req, res) => {
  const { desde, hasta, categoria_id } = req.query;
  const condiciones = [];
  const valores = [];

  if (desde) { valores.push(desde); condiciones.push(`g.fecha >= $${valores.length}`); }
  if (hasta) { valores.push(hasta); condiciones.push(`g.fecha <= $${valores.length}`); }
  if (categoria_id) { valores.push(categoria_id); condiciones.push(`g.categoria_id = $${valores.length}`); }

  const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';

  const { rows } = await db.query(`
    SELECT g.*, c.nombre AS categoria, co.nombre AS corral, u.nombre AS registrado_por
    FROM gasto_general g
    JOIN categoria_gasto c ON c.id = g.categoria_id
    LEFT JOIN corral co ON co.id = g.corral_id
    LEFT JOIN usuario u ON u.id = g.usuario_id
    ${where}
    ORDER BY g.fecha DESC
  `, valores);
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { categoria_id, fecha, monto, descripcion, corral_id, comprobante_folio } = req.body;
  if (!categoria_id || monto === undefined) {
    return res.status(400).json({ error: 'categoria_id y monto son obligatorios' });
  }
  const { rows } = await db.query(
    `INSERT INTO gasto_general (categoria_id, fecha, monto, descripcion, corral_id, comprobante_folio, usuario_id)
     VALUES ($1, COALESCE($2, CURRENT_DATE), $3, $4, $5, $6, $7) RETURNING *`,
    [categoria_id, fecha || null, monto, descripcion || null, corral_id || null, comprobante_folio || null, req.usuario.id]
  );
  await registrarBitacora(req.usuario, 'registrar_gasto', 'gasto_general', rows[0].id, { despues: rows[0] });
  res.status(201).json(rows[0]);
}));

router.patch('/:id', asyncHandler(async (req, res) => {
  const { categoria_id, fecha, monto, descripcion, corral_id, comprobante_folio } = req.body;
  const { rows } = await db.query(
    `UPDATE gasto_general SET
       categoria_id = COALESCE($1, categoria_id), fecha = COALESCE($2, fecha),
       monto = COALESCE($3, monto), descripcion = $4, corral_id = $5, comprobante_folio = $6
     WHERE id = $7 RETURNING *`,
    [categoria_id || null, fecha || null, monto, descripcion, corral_id || null, comprobante_folio, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Gasto no encontrado' });
  res.json(rows[0]);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await db.query('DELETE FROM gasto_general WHERE id = $1', [req.params.id]);
  if (!rowCount) return res.status(404).json({ error: 'Gasto no encontrado' });
  res.status(204).send();
}));

module.exports = router;
