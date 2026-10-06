const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');

const router = express.Router();

// Cualquiera con sesión puede ver qué módulos están activos (lo necesita
// el menú para saber qué mostrar)
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT clave, nombre, activo FROM modulo_sistema ORDER BY nombre');
  res.json(rows);
}));

// Solo Administrador puede prender/apagar módulos
router.patch('/', asyncHandler(async (req, res) => {
  const cambios = req.body; // { clave: true/false, ... }
  const claves = Object.keys(cambios || {});
  if (claves.length === 0) {
    return res.status(400).json({ error: 'No se enviaron cambios' });
  }
  for (const clave of claves) {
    await db.query('UPDATE modulo_sistema SET activo = $1 WHERE clave = $2', [Boolean(cambios[clave]), clave]);
  }
  const { rows } = await db.query('SELECT clave, nombre, activo FROM modulo_sistema ORDER BY nombre');
  await registrarBitacora(req.usuario, 'editar_modulos', 'modulo_sistema', null, { despues: cambios });
  res.json(rows);
}));

module.exports = router;
