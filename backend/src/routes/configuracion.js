const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { registrarBitacora } = require('../bitacora');
const { enTransaccion } = require('../transaction');

const router = express.Router();

// Cualquiera con sesión puede ver la configuración (es informativo, no sensible)
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await db.query('SELECT clave, valor, descripcion FROM configuracion ORDER BY clave');
  res.json(rows);
}));

// Solo Administrador puede modificarla. Acepta un objeto { clave: nuevoValor, ... }
router.patch('/', asyncHandler(async (req, res) => {
  const cambios = req.body;
  const claves = Object.keys(cambios);
  if (claves.length === 0) {
    return res.status(400).json({ error: 'No se enviaron cambios' });
  }

  for (const clave of claves) {
    if (cambios[clave] === null || cambios[clave] === undefined || String(cambios[clave]).trim() === '' || !Number.isFinite(Number(cambios[clave]))) {
      return res.status(400).json({ error: `El valor de "${clave}" debe ser un número` });
    }
  }
  if ('ubicacion_lat' in cambios && (Number(cambios.ubicacion_lat) < -90 || Number(cambios.ubicacion_lat) > 90)) return res.status(400).json({ error: 'La latitud debe estar entre -90 y 90' });
  if ('ubicacion_lon' in cambios && (Number(cambios.ubicacion_lon) < -180 || Number(cambios.ubicacion_lon) > 180)) return res.status(400).json({ error: 'La longitud debe estar entre -180 y 180' });
  const rows = await enTransaccion(async (client) => {
    const anterior = await client.query('SELECT clave, valor, descripcion FROM configuracion WHERE clave = ANY($1) FOR UPDATE', [claves]);
    for (const clave of claves) await client.query('UPDATE configuracion SET valor = $1 WHERE clave = $2', [Number(cambios[clave]), clave]);
    const nuevo = await client.query('SELECT clave, valor, descripcion FROM configuracion ORDER BY clave');
    await registrarBitacora(req.usuario, 'editar_configuracion', 'configuracion', null, {
      antes: anterior.rows,
      despues: nuevo.rows.filter((fila) => claves.includes(fila.clave)),
      contexto: { claves },
    }, client);
    return nuevo.rows;
  });
  res.json(rows);
}));

module.exports = router;
