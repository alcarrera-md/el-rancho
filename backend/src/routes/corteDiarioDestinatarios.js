const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Correos adicionales que reciben el corte diario junto a los administradores.
// Solo Administrador puede verlos/agregarlos/quitarlos.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT id, email, creado_en FROM corte_diario_destinatario ORDER BY creado_en');
  res.json(rows);
}));

router.post('/', asyncHandler(async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Correo inválido' });
  }
  try {
    const { rows } = await db.query(
      'INSERT INTO corte_diario_destinatario (email, creado_por) VALUES ($1, $2) RETURNING id, email, creado_en',
      [email, req.usuario.id]
    );
    await registrarBitacora(req.usuario, 'agregar_destinatario_corte', 'corte_diario_bitacora', rows[0].id, { despues: rows[0] });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Ese correo ya está en la lista' });
    }
    throw err;
  }
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const { rows } = await db.query('DELETE FROM corte_diario_destinatario WHERE id = $1 RETURNING id, email', [req.params.id]);
  if (rows.length === 0) {
    return res.status(404).json({ error: 'No encontrado' });
  }
  await registrarBitacora(req.usuario, 'quitar_destinatario_corte', 'corte_diario_bitacora', rows[0].id, { antes: rows[0], despues: null });
  res.json({ ok: true });
}));

module.exports = router;
