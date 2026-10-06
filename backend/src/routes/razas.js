const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');

const router = express.Router();

router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT * FROM raza ORDER BY nombre');
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: 'nombre es obligatorio' });
  const { rows } = await db.query(
    'INSERT INTO raza (nombre) VALUES ($1) ON CONFLICT (nombre) DO UPDATE SET nombre = EXCLUDED.nombre RETURNING *',
    [nombre]
  );
  res.status(201).json(rows[0]);
}));

module.exports = router;
