const express = require('express');
const asyncHandler = require('../middleware/asyncHandler');
const { obtenerConfiguracion } = require('../configuracion');
const { obtenerPronostico, calcularRecomendacionesClima } = require('../clima');

const router = express.Router();

// GET /api/clima/pronostico
router.get('/pronostico', asyncHandler(async (req, res) => {
  const config = await obtenerConfiguracion();
  const dias = await obtenerPronostico(config.ubicacion_lat, config.ubicacion_lon);
  res.json({ dias, recomendaciones: calcularRecomendacionesClima(dias) });
}));

module.exports = router;
