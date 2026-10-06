const express = require('express');
const db = require('../db');
const asyncHandler = require('../middleware/asyncHandler');
const { obtenerEventosCalendario } = require('../calendarioService');

const router = express.Router();

// GET /api/calendario?desde=YYYY-MM-DD&hasta=YYYY-MM-DD
// Junta en una sola lista todo lo que tiene fecha y le importa al día a día:
// vacunas próximas, partos estimados, tareas asignadas y pendientes de plan sanitario.
router.get('/', asyncHandler(async (req, res) => {
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1).toISOString().slice(0, 10);
  const ultimoDiaMes = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0).toISOString().slice(0, 10);
  const desde = req.query.desde || primerDiaMes;
  const hasta = req.query.hasta || ultimoDiaMes;
  res.json(await obtenerEventosCalendario(db, { desde, hasta, usuario: req.usuario }));
}));

module.exports = router;
