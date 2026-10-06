const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

// Lista de terceros, opcionalmente filtrada por tipo (?tipo=comprador)
router.get('/', asyncHandler(async (req, res) => {
  const { tipo } = req.query;
  const condicion = tipo ? `WHERE tipo = $1 OR tipo = 'ambos'` : '';
  const { rows } = await db.query(
    `SELECT * FROM tercero ${condicion} ORDER BY nombre`,
    tipo ? [tipo] : []
  );
  res.json(rows);
}));

// Alta de un tercero nuevo (comprador o proveedor)
router.post('/', asyncHandler(async (req, res) => {
  const { nombre, tipo, contacto, rfc_nif } = req.body;
  if (!nombre || !tipo) {
    return res.status(400).json({ error: 'nombre y tipo son obligatorios' });
  }
  const { rows } = await db.query(
    `INSERT INTO tercero (nombre, tipo, contacto, rfc_nif) VALUES ($1,$2,$3,$4) RETURNING *`,
    [nombre, tipo, contacto, rfc_nif]
  );
  res.status(201).json(rows[0]);
}));

// Editar un tercero (proveedor/comprador)
router.patch('/:id', asyncHandler(async (req, res) => {
  const { nombre, contacto, rfc_nif } = req.body;
  const { rows } = await db.query(
    `UPDATE tercero SET nombre = COALESCE($1, nombre), contacto = $2, rfc_nif = $3 WHERE id = $4 RETURNING *`,
    [nombre || null, contacto, rfc_nif, req.params.id]
  );
  if (!rows.length) return res.status(404).json({ error: 'Tercero no encontrado' });
  res.json(rows[0]);
}));

module.exports = router;
